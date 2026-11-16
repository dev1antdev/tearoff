import crypto from 'node:crypto';
import net from 'node:net';
import { isLoopbackAddress } from './accessPolicy';

/**
 * The key a device that is not this PC must show.
 *
 * With network access on, the server is bound to every interface. The Host
 * and Origin rules of `accessPolicy` then say that a request names this
 * machine and comes from one of its own pages; they do not say whose device
 * is asking, and anything on the network can ask by this machine's address.
 * So a visitor that is not this machine also has to hold the key: in `?key=`
 * the first time, and in the cookie the server sets in answer from then on,
 * which is how the page's scripts, styles and socket carry it.
 *
 * The key is an addition to those rules and never a replacement: they are
 * asked first, and a request they refuse is not looked at here.
 */

/** The cookie a device keeps the key in. */
export const DEVICE_KEY_COOKIE = 'tearoff_key';

/** As long as browsers let a cookie live. */
const COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;

/**
 * The different wrong keys one address may show before it is cut off. A
 * device that repeats one stale key, as a page left open does after the key
 * was replaced, never gets here: only a new guess counts.
 */
export const WRONG_KEYS_ALLOWED = 5;
/** How long a cut-off address is not listened to, whatever it shows. */
export const CUT_OFF_MS = 5 * 60_000;
/** Wrong keys older than this are forgotten. */
export const WRONG_KEY_MEMORY_MS = 10 * 60_000;
/** The most addresses remembered for their wrong keys; the oldest go first. */
export const MAX_TRACKED_ADDRESSES = 256;

/** 24 random bytes: 192 bits, in 32 characters a link needs no escaping for. */
export const generateDeviceKey = (): string =>
  crypto.randomBytes(24).toString('base64url');

/** At least 128 bits of base64url, and nothing a key is not made of. */
export const isDeviceKey = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{22,64}$/.test(value);

const digest = (value: string) =>
  crypto.createHash('sha256').update(value, 'utf8').digest();

/**
 * Whether `shown` is the key, in time that does not depend on how much of it
 * is right. Both are hashed first, so the two sides are always the same
 * length and the length of the key is not given away either.
 */
export const keysMatch = (shown: string, key: string): boolean =>
  crypto.timingSafeEqual(digest(shown), digest(key));

/** The value of one cookie in a `Cookie` header. */
export function readCookie(
  header: string | undefined,
  name: string
): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at < 0 || part.slice(0, at).trim() !== name) continue;
    const value = part.slice(at + 1).trim();
    return value.startsWith('"') && value.endsWith('"') && value.length > 1
      ? value.slice(1, -1)
      : value;
  }
  return undefined;
}

/**
 * `HttpOnly` keeps the key from the page's own scripts; `SameSite=Strict`
 * keeps a page from another site from sending it along.
 */
export const keyCookie = (key: string): string =>
  `${DEVICE_KEY_COOKIE}=${key}; Path=/; Max-Age=${COOKIE_MAX_AGE_S}; HttpOnly; SameSite=Strict`;

/** Tells a browser to drop a key that is no longer the key. */
export const forgetKeyCookie = (): string =>
  `${DEVICE_KEY_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`;

/**
 * Whether a connection comes from this machine, by the socket's remote
 * address and nothing a visitor can write: loopback, or one of this
 * machine's own addresses, which is what a browser source on this PC arrives
 * from when its link names the PC by its network address.
 *
 * Another device cannot arrive from one of those. The answer to its first
 * packet would go to this machine and nowhere else, so its connection is
 * never made.
 *
 * @param localHosts This machine's names and addresses. Only the addresses
 * are compared; a name is never taken for one.
 */
export function isThisMachine(
  remoteAddress: string | undefined,
  localHosts: readonly string[]
): boolean {
  if (!remoteAddress) return false;
  if (isLoopbackAddress(remoteAddress)) return true;
  const plain = remoteAddress.startsWith('::ffff:')
    ? remoteAddress.slice(7)
    : remoteAddress;
  return net.isIP(plain) !== 0 && localHosts.includes(plain);
}

export interface KeyVisitor {
  remoteAddress: string | undefined;
  /** `?key=` of the request. A socket handshake has none to offer. */
  queryKey?: string | null;
  /** The key cookie of the request. */
  cookieKey?: string | null;
}

/**
 * - `missing`: no key was shown, or there is no key to show yet.
 * - `wrong`: what was shown is not the key.
 * - `cutOff`: too many different wrong keys came from this address; nothing
 *   it shows is looked at until `retryAfterS` has passed.
 */
export type KeyRefusal = 'missing' | 'wrong' | 'cutOff';

export interface KeyDecision {
  allowed: boolean;
  /** The visitor is this machine, which needs no key. */
  thisMachine: boolean;
  /** How another device showed the key; absent for this machine. */
  via?: 'query' | 'cookie';
  /** Why it was refused; absent when allowed. */
  refusal?: KeyRefusal;
  /** A refused visitor sent a key cookie, which its browser should drop. */
  staleCookie: boolean;
  /** Seconds until a cut-off address is listened to again. */
  retryAfterS?: number;
}

export interface KeyGateOptions {
  /** The key now. Null while there is none, which lets no other device in. */
  key: () => string | null;
  /** This machine's names and addresses on the network. */
  localHosts: () => readonly string[];
  now?: () => number;
}

interface Attempts {
  /** Fingerprints of the different wrong keys the address has shown. */
  wrong: Set<string>;
  lastWrongAt: number;
  cutOffUntil: number;
}

/** Enough of a hash to tell two wrong keys apart; the keys are not kept. */
const fingerprint = (value: string) =>
  digest(value).toString('base64url').slice(0, 16);

/**
 * Decides, for one request or handshake, whether its sender may be answered
 * as far as the key goes.
 *
 * Wrong keys are counted per remote address, so a device can only use up
 * its own allowance and never another's. What is remembered is bounded: a
 * handful of fingerprints for each of a fixed number of addresses, and
 * forgetting an address only ever gives it its allowance back.
 */
export function createKeyGate(options: KeyGateOptions) {
  const now = options.now ?? Date.now;
  const tracked = new Map<string, Attempts>();

  const recall = (address: string, at: number): Attempts | undefined => {
    const attempts = tracked.get(address);
    if (!attempts) return undefined;
    if (
      at >= attempts.cutOffUntil &&
      at - attempts.lastWrongAt > WRONG_KEY_MEMORY_MS
    ) {
      tracked.delete(address);
      return undefined;
    }
    return attempts;
  };

  const noteWrong = (address: string, shown: readonly string[], at: number) => {
    const attempts = recall(address, at) ?? {
      wrong: new Set<string>(),
      lastWrongAt: at,
      cutOffUntil: 0,
    };
    const known = attempts.wrong.size;
    for (const value of shown) attempts.wrong.add(fingerprint(value));
    // A key shown before is not a new guess: it adds nothing to the count
    // and does not keep the older ones remembered any longer.
    if (attempts.wrong.size > known) attempts.lastWrongAt = at;
    if (attempts.wrong.size >= WRONG_KEYS_ALLOWED) {
      attempts.cutOffUntil = at + CUT_OFF_MS;
      // The allowance starts again once the cut-off has been sat out.
      attempts.wrong.clear();
    }
    // Moved to the end, so the address heard from longest ago goes first.
    tracked.delete(address);
    tracked.set(address, attempts);
    for (const oldest of tracked.keys()) {
      if (tracked.size <= MAX_TRACKED_ADDRESSES) break;
      tracked.delete(oldest);
    }
  };

  const check = (visitor: KeyVisitor): KeyDecision => {
    if (isThisMachine(visitor.remoteAddress, options.localHosts())) {
      return { allowed: true, thisMachine: true, staleCookie: false };
    }

    const shown = (
      [
        ['query', visitor.queryKey],
        ['cookie', visitor.cookieKey],
      ] as const
    ).flatMap(([via, value]) =>
      typeof value === 'string' && value.length > 0 ? [{ via, value }] : []
    );
    const refuse = (
      refusal: KeyRefusal,
      retryAfterS?: number
    ): KeyDecision => ({
      allowed: false,
      thisMachine: false,
      refusal,
      staleCookie: shown.some(({ via }) => via === 'cookie'),
      ...(retryAfterS === undefined ? {} : { retryAfterS }),
    });

    const key = options.key();
    // No key was ever made: the server is not open to other devices.
    if (key === null) return refuse('missing');

    const address = visitor.remoteAddress ?? '';
    const at = now();
    const attempts = recall(address, at);
    if (attempts && at < attempts.cutOffUntil) {
      return refuse('cutOff', Math.ceil((attempts.cutOffUntil - at) / 1000));
    }

    const match = shown.find(
      ({ value }) => isDeviceKey(value) && keysMatch(value, key)
    );
    if (match) {
      tracked.delete(address);
      return {
        allowed: true,
        thisMachine: false,
        via: match.via,
        staleCookie: false,
      };
    }
    if (shown.length === 0) return refuse('missing');

    noteWrong(
      address,
      shown.map(({ value }) => value),
      at
    );
    return refuse('wrong');
  };

  return {
    check,
    /** How many addresses are remembered for their wrong keys. */
    trackedAddresses: () => tracked.size,
  };
}

export type KeyGate = ReturnType<typeof createKeyGate>;

/** What a refused device is told. It names nothing the server holds. */
export const KEY_NEEDED_TEXT =
  'Forbidden. This device needs the link with the key: in Tearoff on the PC, open Settings, Pit Wall, and copy the link for other devices.';
export const CUT_OFF_TEXT =
  'Too many wrong keys from this device. Wait a few minutes, then open the link for other devices from Tearoff again.';

/** The status and the text a refusal is answered with. */
export const keyRefusalAnswer = (
  decision: KeyDecision
): { status: number; text: string } =>
  decision.refusal === 'cutOff'
    ? { status: 429, text: CUT_OFF_TEXT }
    : { status: 403, text: KEY_NEEDED_TEXT };

const REFUSAL_WORDS: Record<KeyRefusal, string> = {
  missing: 'no key',
  wrong: 'wrong key',
  cutOff: 'cut off after wrong keys',
};

/**
 * Names a device that was refused for its key once per reason, and only so
 * many devices in all. The key itself, right or wrong, is never written.
 */
export function createKeyRefusalLog(report: (line: string) => void) {
  const seen = new Set<string>();
  return (
    refusal: KeyRefusal | undefined,
    remoteAddress: string | undefined
  ) => {
    if (!refusal) return;
    const from = (remoteAddress ?? 'an unknown address').slice(0, 64);
    const line = `refused (${REFUSAL_WORDS[refusal]}): from ${from}`;
    if (seen.has(line) || seen.size >= 50) return;
    seen.add(line);
    report(line);
  };
}
