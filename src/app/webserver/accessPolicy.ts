import os from 'os';

/**
 * Who may talk to the built-in web server, and what they may do.
 *
 * The server exists for browser sources: OBS, a VR overlay host, a tablet. Its
 * pages are served by the server itself, so a request that belongs to one of
 * them names this machine in `Host` and, when a browser sends `Origin`, names
 * the same place there. Two kinds of visitor do not:
 *
 * - A page from somewhere else, open in a browser on this PC, that opens
 *   `ws://localhost:<port>`. Browsers do not apply the same-origin rule to
 *   WebSockets; they send `Origin` and leave the decision to the server.
 * - A page on a name that an attacker points at this machine (DNS rebinding).
 *   Its `Origin` and `Host` agree with each other, so the test is whether
 *   `Host` is a name this machine actually has.
 *
 * Both are refused. A request with no `Origin` is a plain navigation or a
 * program rather than a page; it may read, and is never allowed to write.
 */
export interface AccessPolicy {
  /** The port the server listens on, known only once it does. */
  port: () => number;
  /** Whether the server is bound to every interface and not only loopback. */
  networkAccess: () => boolean;
  /**
   * Origins besides the server's own that may connect: the Vite dev server,
   * which serves the page bundle in development.
   */
  extraOrigins: () => readonly string[];
  /** Names and addresses this machine answers to on the network. */
  localHosts: () => readonly string[];
}

export interface AccessRequest {
  host: string | undefined;
  origin: string | undefined;
  remoteAddress: string | undefined;
}

export type AccessRefusal = 'host' | 'origin';

export interface AccessDecision {
  allowed: boolean;
  /** Why it was refused; absent when allowed. */
  refusal?: AccessRefusal;
  /** A page this server served is asking, not a program or a navigation. */
  ownPage: boolean;
  /** The request came from this machine. */
  loopback: boolean;
}

const LOOPBACK_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]'];

/** Whether a socket's remote address is this machine. */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const plain = address.startsWith('::ffff:') ? address.slice(7) : address;
  return plain === '::1' || /^127(\.\d{1,3}){3}$/.test(plain);
}

/**
 * Splits `host[:port]`, keeping an IPv6 literal in its brackets.
 *
 * Returns null for anything that is not a bare host and port: a `Host` with a
 * path, credentials or spaces in it is not one a browser would send.
 */
export function parseHostHeader(
  value: string | undefined
): { host: string; port: number | null } | null {
  if (!value) return null;
  const match = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?$/i.exec(
    value.trim()
  );
  if (!match) return null;
  const port = match[2] === undefined ? null : Number(match[2]);
  if (port !== null && (port < 1 || port > 65535)) return null;
  return { host: match[1].toLowerCase(), port };
}

function isKnownHost(
  parsed: { host: string; port: number | null } | null,
  policy: AccessPolicy
): boolean {
  if (!parsed || parsed.port !== policy.port()) return false;
  if (LOOPBACK_HOSTS.includes(parsed.host)) return true;
  if (!policy.networkAccess()) return false;
  return policy.localHosts().some((name) => name.toLowerCase() === parsed.host);
}

/** `absent` when the header was not sent at all. */
function originStanding(
  origin: string | undefined,
  policy: AccessPolicy
): 'absent' | 'own' | 'foreign' {
  if (origin === undefined) return 'absent';
  if (policy.extraOrigins().includes(origin)) return 'own';
  const match = /^http:\/\/(.+)$/i.exec(origin);
  if (!match) return 'foreign';
  return isKnownHost(parseHostHeader(match[1]), policy) ? 'own' : 'foreign';
}

export function evaluateAccess(
  request: AccessRequest,
  policy: AccessPolicy
): AccessDecision {
  const loopback = isLoopbackAddress(request.remoteAddress);
  if (!isKnownHost(parseHostHeader(request.host), policy)) {
    return { allowed: false, refusal: 'host', ownPage: false, loopback };
  }
  const standing = originStanding(request.origin, policy);
  if (standing === 'foreign') {
    return { allowed: false, refusal: 'origin', ownPage: false, loopback };
  }
  return { allowed: true, ownPage: standing === 'own', loopback };
}

/**
 * Remembers which refusals were logged, so a visitor that keeps knocking is
 * named once. Header text is the visitor's own; it is cut short before it
 * reaches the log, and only so many different visitors are ever named.
 */
export function createRefusalLog(report: (line: string) => void) {
  const seen = new Set<string>();
  const brief = (value: string | undefined) =>
    value === undefined ? 'none' : `"${value.slice(0, 120)}"`;
  return (refusal: AccessRefusal | undefined, request: AccessRequest) => {
    const line = `refused (${refusal}): Host ${brief(request.host)}, Origin ${brief(request.origin)}`;
    if (seen.has(line) || seen.size >= 50) return;
    seen.add(line);
    report(line);
  };
}

const LOCAL_HOSTS_TTL_MS = 10_000;

/**
 * The machine's own name and IPv4 addresses, re-read at most every ten
 * seconds: an address changes when a network does, and a request must not pay
 * for the lookup each time.
 */
export function createLocalHostsReader(
  now: () => number = Date.now
): () => readonly string[] {
  let readAt = Number.NEGATIVE_INFINITY;
  let hosts: readonly string[] = [];
  return () => {
    if (now() - readAt < LOCAL_HOSTS_TTL_MS) return hosts;
    readAt = now();
    const found = new Set<string>();
    const name = os.hostname().toLowerCase();
    if (name) {
      found.add(name);
      found.add(`${name}.local`);
    }
    for (const nets of Object.values(os.networkInterfaces())) {
      for (const net of nets ?? []) {
        if (net.family === 'IPv4' && !net.internal) found.add(net.address);
      }
    }
    hosts = [...found];
    return hosts;
  };
}
