import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CUT_OFF_MS,
  DEVICE_KEY_COOKIE,
  MAX_TRACKED_ADDRESSES,
  WRONG_KEYS_ALLOWED,
  WRONG_KEY_MEMORY_MS,
  createKeyGate,
  createKeyRefusalLog,
  forgetKeyCookie,
  generateDeviceKey,
  isDeviceKey,
  isThisMachine,
  keyCookie,
  keyRefusalAnswer,
  keysMatch,
  readCookie,
} from './deviceKey';

const KEY = 'k'.repeat(32);
const OLD_KEY = 'o'.repeat(32);
const LAN = '192.168.1.50';
const TABLET = '192.168.1.77';
const PHONE = '192.168.1.78';
const wrongKey = (n: number) =>
  `wrong-key-${String(n).padStart(4, '0')}-${'x'.repeat(12)}`;

function gate({ key = KEY as string | null } = {}) {
  const state = { key, clock: 1_000_000 };
  const built = createKeyGate({
    key: () => state.key,
    localHosts: () => ['racing-pc', 'racing-pc.local', LAN],
    now: () => state.clock,
  });
  return { ...built, state };
}

describe('generateDeviceKey', () => {
  it('makes 192 random bits that need no escaping in a link', () => {
    const made = new Set(Array.from({ length: 50 }, generateDeviceKey));

    expect(made.size).toBe(50);
    for (const key of made) {
      expect(key).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect(Buffer.from(key, 'base64url')).toHaveLength(24);
      expect(encodeURIComponent(key)).toBe(key);
      expect(isDeviceKey(key)).toBe(true);
    }
  });
});

describe('isDeviceKey', () => {
  it.each([
    undefined,
    null,
    42,
    '',
    'short',
    'a'.repeat(21),
    'a'.repeat(65),
    `${'a'.repeat(30)} b`,
    `${'a'.repeat(30)};x`,
  ])('does not take %s for a key', (value) =>
    expect(isDeviceKey(value)).toBe(false)
  );

  it('takes 128 bits and more of base64url', () => {
    expect(isDeviceKey('a'.repeat(22))).toBe(true);
    expect(isDeviceKey('A-_9'.repeat(8))).toBe(true);
  });
});

describe('keysMatch', () => {
  afterEach(() => vi.restoreAllMocks());

  it('tells the key from everything else', () => {
    expect(keysMatch(KEY, KEY)).toBe(true);
    expect(keysMatch(OLD_KEY, KEY)).toBe(false);
    expect(keysMatch(KEY.slice(0, -1), KEY)).toBe(false);
    expect(keysMatch(`${KEY}k`, KEY)).toBe(false);
    expect(keysMatch('', KEY)).toBe(false);
  });

  it('compares in constant time, over two sides of one length', () => {
    const compare = vi.spyOn(crypto, 'timingSafeEqual');

    keysMatch('a', KEY);
    keysMatch('a'.repeat(4000), KEY);

    expect(compare).toHaveBeenCalledTimes(2);
    for (const [shown, key] of compare.mock.calls) {
      expect(shown).toHaveLength(32);
      expect(key).toHaveLength(32);
    }
  });
});

describe('readCookie', () => {
  it('finds one cookie among several', () => {
    expect(
      readCookie(
        `theme=dark; ${DEVICE_KEY_COOKIE}=${KEY}; a=b`,
        DEVICE_KEY_COOKIE
      )
    ).toBe(KEY);
    expect(readCookie(`${DEVICE_KEY_COOKIE}="${KEY}"`, DEVICE_KEY_COOKIE)).toBe(
      KEY
    );
  });

  it('finds nothing where the cookie is not', () => {
    expect(readCookie(undefined, DEVICE_KEY_COOKIE)).toBeUndefined();
    expect(readCookie('', DEVICE_KEY_COOKIE)).toBeUndefined();
    expect(readCookie('theme=dark', DEVICE_KEY_COOKIE)).toBeUndefined();
    // A cookie whose name only ends the same is another cookie.
    expect(
      readCookie(`not_${DEVICE_KEY_COOKIE}=${KEY}`, DEVICE_KEY_COOKIE)
    ).toBeUndefined();
  });
});

describe('the key cookie', () => {
  it('is kept from scripts and from other sites, for every path', () => {
    const attributes = keyCookie(KEY).split('; ');

    expect(attributes[0]).toBe(`${DEVICE_KEY_COOKIE}=${KEY}`);
    expect(attributes).toContain('HttpOnly');
    expect(attributes).toContain('SameSite=Strict');
    expect(attributes).toContain('Path=/');
    expect(attributes.find((a) => a.startsWith('Max-Age='))).toBe(
      `Max-Age=${400 * 24 * 60 * 60}`
    );
  });

  it('is dropped with the same attributes and no value', () => {
    expect(forgetKeyCookie()).toBe(
      `${DEVICE_KEY_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`
    );
  });
});

describe('isThisMachine', () => {
  const hosts = ['racing-pc', 'racing-pc.local', LAN];

  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1', LAN, `::ffff:${LAN}`])(
    'takes %s for this machine',
    (address) => expect(isThisMachine(address, hosts)).toBe(true)
  );

  it.each([
    undefined,
    '',
    TABLET,
    `::ffff:${TABLET}`,
    '192.168.1.5',
    'racing-pc',
  ])('does not take %s for this machine', (address) =>
    expect(isThisMachine(address, hosts)).toBe(false)
  );

  it('takes only loopback for this machine when it has no other address', () => {
    expect(isThisMachine('127.0.0.1', [])).toBe(true);
    expect(isThisMachine(LAN, [])).toBe(false);
  });
});

describe('the key rule', () => {
  it('asks this machine for no key', () => {
    const { check } = gate();
    const own = { allowed: true, thisMachine: true, staleCookie: false };

    expect(check({ remoteAddress: '127.0.0.1' })).toEqual(own);
    expect(check({ remoteAddress: '::1', queryKey: 'not-the-key' })).toEqual(
      own
    );
    expect(check({ remoteAddress: '127.0.0.1', cookieKey: OLD_KEY })).toEqual(
      own
    );
    // A browser source on this PC whose link names the PC by its address.
    expect(check({ remoteAddress: LAN })).toEqual(own);
  });

  it('asks this machine for no key even where no key was ever made', () => {
    const { check } = gate({ key: null });

    expect(check({ remoteAddress: '127.0.0.1' }).allowed).toBe(true);
  });

  it('refuses another device that shows no key', () => {
    const { check, trackedAddresses } = gate();

    expect(check({ remoteAddress: TABLET })).toEqual({
      allowed: false,
      thisMachine: false,
      refusal: 'missing',
      staleCookie: false,
    });
    expect(
      check({ remoteAddress: TABLET, queryKey: '', cookieKey: null }).refusal
    ).toBe('missing');
    // Asking without a key is not a guess, and is not counted as one.
    expect(trackedAddresses()).toBe(0);
  });

  it('refuses another device that shows a wrong key', () => {
    const { check } = gate();

    expect(check({ remoteAddress: TABLET, queryKey: OLD_KEY })).toEqual({
      allowed: false,
      thisMachine: false,
      refusal: 'wrong',
      staleCookie: false,
    });
    expect(check({ remoteAddress: TABLET, queryKey: `${KEY}k` }).allowed).toBe(
      false
    );
    expect(
      check({ remoteAddress: TABLET, queryKey: KEY.slice(1) }).allowed
    ).toBe(false);
  });

  it('lets another device in with the key in its link', () => {
    const { check } = gate();

    expect(check({ remoteAddress: TABLET, queryKey: KEY })).toEqual({
      allowed: true,
      thisMachine: false,
      via: 'query',
      staleCookie: false,
    });
  });

  it('lets another device in with the key in its cookie', () => {
    const { check } = gate();

    expect(
      check({ remoteAddress: `::ffff:${TABLET}`, cookieKey: KEY })
    ).toEqual({
      allowed: true,
      thisMachine: false,
      via: 'cookie',
      staleCookie: false,
    });
  });

  it('takes the link over the cookie, and either one that is right', () => {
    const { check, trackedAddresses } = gate();

    expect(
      check({ remoteAddress: TABLET, queryKey: KEY, cookieKey: OLD_KEY }).via
    ).toBe('query');
    expect(
      check({ remoteAddress: TABLET, queryKey: KEY, cookieKey: KEY }).via
    ).toBe('query');
    // An old link opened on a device that already holds the key.
    expect(
      check({ remoteAddress: TABLET, queryKey: OLD_KEY, cookieKey: KEY }).via
    ).toBe('cookie');
    expect(trackedAddresses()).toBe(0);
  });

  it('says so when a refused device sent a cookie, so its browser can drop it', () => {
    const { check } = gate();

    expect(check({ remoteAddress: TABLET, cookieKey: OLD_KEY })).toMatchObject({
      allowed: false,
      refusal: 'wrong',
      staleCookie: true,
    });
  });

  it('lets no other device in while there is no key, whatever it shows', () => {
    const { check, trackedAddresses } = gate({ key: null });

    expect(check({ remoteAddress: TABLET })).toMatchObject({
      allowed: false,
      refusal: 'missing',
    });
    expect(
      check({ remoteAddress: TABLET, queryKey: KEY, cookieKey: KEY })
    ).toMatchObject({
      allowed: false,
      refusal: 'missing',
      staleCookie: true,
    });
    expect(check({ remoteAddress: TABLET, queryKey: '' }).allowed).toBe(false);
    expect(trackedAddresses()).toBe(0);
  });

  it('refuses the old key at once when the key is replaced', () => {
    const { check, state } = gate({ key: OLD_KEY });
    expect(check({ remoteAddress: TABLET, cookieKey: OLD_KEY }).allowed).toBe(
      true
    );

    state.key = KEY;

    expect(check({ remoteAddress: TABLET, cookieKey: OLD_KEY })).toMatchObject({
      allowed: false,
      refusal: 'wrong',
      staleCookie: true,
    });
    expect(check({ remoteAddress: TABLET, queryKey: KEY }).allowed).toBe(true);
  });
});

describe('wrong keys from one address', () => {
  const guess = (
    check: ReturnType<typeof gate>['check'],
    from: string,
    n: number
  ) => check({ remoteAddress: from, queryKey: wrongKey(n) });

  it('cuts the address off after a few different ones, the right key included', () => {
    const { check } = gate();

    for (let n = 1; n <= WRONG_KEYS_ALLOWED; n++) {
      expect(guess(check, TABLET, n).refusal, `guess ${n}`).toBe('wrong');
    }

    expect(check({ remoteAddress: TABLET, queryKey: KEY })).toEqual({
      allowed: false,
      thisMachine: false,
      refusal: 'cutOff',
      staleCookie: false,
      retryAfterS: CUT_OFF_MS / 1000,
    });
    expect(guess(check, TABLET, 99).refusal).toBe('cutOff');
    expect(check({ remoteAddress: TABLET }).refusal).toBe('cutOff');
  });

  it('listens again once the cut-off has been sat out, with a new allowance', () => {
    const { check, state } = gate();
    for (let n = 1; n <= WRONG_KEYS_ALLOWED; n++) guess(check, TABLET, n);

    state.clock += CUT_OFF_MS - 1;
    expect(check({ remoteAddress: TABLET, queryKey: KEY })).toMatchObject({
      refusal: 'cutOff',
      retryAfterS: 1,
    });

    state.clock += 1;
    expect(guess(check, TABLET, 50).refusal).toBe('wrong');
    expect(check({ remoteAddress: TABLET, queryKey: KEY }).allowed).toBe(true);
  });

  it('does not count one stale key shown over and over', () => {
    // A page left open after the key was replaced knocks every few seconds.
    const { check } = gate();

    for (let knock = 0; knock < 500; knock++) {
      expect(check({ remoteAddress: TABLET, cookieKey: OLD_KEY }).refusal).toBe(
        'wrong'
      );
    }

    expect(check({ remoteAddress: TABLET, queryKey: KEY }).allowed).toBe(true);
  });

  it('counts a wrong link and a wrong cookie in one request as two', () => {
    const { check } = gate();

    check({
      remoteAddress: TABLET,
      queryKey: wrongKey(1),
      cookieKey: wrongKey(2),
    });
    check({
      remoteAddress: TABLET,
      queryKey: wrongKey(3),
      cookieKey: wrongKey(4),
    });
    expect(guess(check, TABLET, 5).refusal).toBe('wrong');

    expect(check({ remoteAddress: TABLET, queryKey: KEY }).refusal).toBe(
      'cutOff'
    );
  });

  it('forgives what came before once the right key is shown', () => {
    const { check, trackedAddresses } = gate();
    for (let n = 1; n < WRONG_KEYS_ALLOWED; n++) guess(check, TABLET, n);

    expect(check({ remoteAddress: TABLET, queryKey: KEY }).allowed).toBe(true);
    expect(trackedAddresses()).toBe(0);

    for (let n = 11; n < 10 + WRONG_KEYS_ALLOWED; n++) {
      expect(guess(check, TABLET, n).refusal).toBe('wrong');
    }
    expect(check({ remoteAddress: TABLET, queryKey: KEY }).allowed).toBe(true);
  });

  it('forgets wrong keys that are old', () => {
    const { check, state, trackedAddresses } = gate();
    for (let n = 1; n < WRONG_KEYS_ALLOWED; n++) guess(check, TABLET, n);

    state.clock += WRONG_KEY_MEMORY_MS + 1;

    expect(guess(check, TABLET, 20).refusal).toBe('wrong');
    expect(check({ remoteAddress: TABLET, queryKey: KEY }).allowed).toBe(true);
    expect(trackedAddresses()).toBe(0);
  });

  it('gives one device no way to cut off another', () => {
    const { check } = gate();
    for (let n = 1; n <= WRONG_KEYS_ALLOWED * 3; n++) guess(check, PHONE, n);
    expect(check({ remoteAddress: PHONE, queryKey: KEY }).refusal).toBe(
      'cutOff'
    );

    expect(check({ remoteAddress: TABLET, queryKey: KEY }).allowed).toBe(true);
    expect(check({ remoteAddress: TABLET, cookieKey: KEY }).allowed).toBe(true);
    expect(check({ remoteAddress: '127.0.0.1' }).allowed).toBe(true);
    expect(check({ remoteAddress: LAN }).allowed).toBe(true);
  });

  it('remembers a bounded number of addresses, and forgetting one only forgives it', () => {
    const { check, trackedAddresses } = gate();
    // The tablet is one guess from being cut off.
    for (let n = 1; n < WRONG_KEYS_ALLOWED; n++) guess(check, TABLET, n);

    for (let host = 0; host < MAX_TRACKED_ADDRESSES * 3; host++) {
      guess(check, `10.${(host >> 8) & 255}.${host & 255}.9`, host);
      expect(trackedAddresses()).toBeLessThanOrEqual(MAX_TRACKED_ADDRESSES);
    }
    expect(trackedAddresses()).toBe(MAX_TRACKED_ADDRESSES);

    // Pushed out by the flood, the tablet has its whole allowance back.
    for (let n = 30; n < 30 + WRONG_KEYS_ALLOWED - 1; n++) {
      expect(guess(check, TABLET, n).refusal).toBe('wrong');
    }
    expect(check({ remoteAddress: TABLET, queryKey: KEY }).allowed).toBe(true);
  });
});

describe('keyRefusalAnswer', () => {
  it('answers 403 for a missing or wrong key and 429 for a cut-off address', () => {
    const refused = { allowed: false, thisMachine: false, staleCookie: false };

    expect(keyRefusalAnswer({ ...refused, refusal: 'missing' }).status).toBe(
      403
    );
    expect(keyRefusalAnswer({ ...refused, refusal: 'wrong' }).status).toBe(403);
    expect(keyRefusalAnswer({ ...refused, refusal: 'cutOff' }).status).toBe(
      429
    );
  });

  it('tells a refused device where the link is, and nothing the server holds', () => {
    const refused = { allowed: false, thisMachine: false, staleCookie: false };
    const { text } = keyRefusalAnswer({ ...refused, refusal: 'missing' });

    expect(text).toContain('Forbidden');
    expect(text).toContain('Tearoff');
    expect(text).not.toContain(KEY);
  });
});

describe('createKeyRefusalLog', () => {
  it('names a device once per reason, stops at fifty, and never writes a key', () => {
    const lines: string[] = [];
    const report = createKeyRefusalLog((line) => lines.push(line));

    report('missing', TABLET);
    report('missing', TABLET);
    report('wrong', TABLET);
    report('cutOff', undefined);
    report(undefined, TABLET);

    expect(lines).toEqual([
      `refused (no key): from ${TABLET}`,
      `refused (wrong key): from ${TABLET}`,
      'refused (cut off after wrong keys): from an unknown address',
    ]);

    for (let host = 0; host < 100; host++) report('wrong', `10.0.0.${host}`);
    expect(lines).toHaveLength(50);
  });
});
