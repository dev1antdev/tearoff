import dgram from 'dgram';
import os from 'os';

type Interfaces = ReturnType<typeof os.networkInterfaces>;

/**
 * Adapter names that are not a network card another device can reach this
 * PC by: the switches Hyper-V and WSL make, virtual machine hosts, container
 * bridges, tunnels and VPN clients, Bluetooth and Wi-Fi Direct.
 *
 * A name is all there is to go by: Node reports no adapter type. So this is a
 * preference, never a filter: when every adapter looks virtual, one of them
 * is still chosen.
 */
const VIRTUAL_ADAPTER =
  /vethernet|virtual|hyper-v|wsl|vmware|vmnet|vbox|docker|^br-|^veth|^virbr|loopback|tailscale|zerotier|wireguard|^wg\d|openvpn|vpn|nordlynx|hamachi|\btap\b|tap-windows|\btap\d|\btun\d|^utun|bluetooth|local area connection\*/i;

export const looksVirtual = (adapterName: string): boolean =>
  VIRTUAL_ADAPTER.test(adapterName);

/** 10/8, 172.16/12 and 192.168/16: the addresses a home or office network gives. */
const isPrivate = (ip: string): boolean => {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
  );
};

/** 169.254/16: what an adapter gives itself when nothing answered it. */
const isLinkLocal = (ip: string): boolean => ip.startsWith('169.254.');

interface Candidate {
  address: string;
  linkLocal: boolean;
  virtual: boolean;
  routed: boolean;
  private: boolean;
}

/**
 * The address the links for other devices should name, or null when this PC
 * has none but its own.
 *
 * The rule, in order; the first difference decides, and adapters that tie
 * stay in the order the system lists them:
 *
 * 1. an address a network gave over one the adapter gave itself (169.254);
 * 2. an adapter that does not look virtual by its name over one that does,
 *    so a WSL or Hyper-V switch, or a VPN, does not win over the network
 *    card;
 * 3. the adapter the default route leaves by (`routedAddress`) over the
 *    others, which settles Ethernet against Wi-Fi and, where the network card
 *    is itself behind a virtual switch, picks that switch;
 * 4. a private address over a public one.
 *
 * `routedAddress` that is not one of the adapters' addresses is ignored.
 */
export function pickLanAddress(
  interfaces: Interfaces,
  routedAddress: string | null
): string | null {
  const candidates: Candidate[] = [];
  for (const [name, nets] of Object.entries(interfaces)) {
    for (const net of nets ?? []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      candidates.push({
        address: net.address,
        linkLocal: isLinkLocal(net.address),
        virtual: looksVirtual(name),
        routed: net.address === routedAddress,
        private: isPrivate(net.address),
      });
    }
  }
  const rank = (c: Candidate): number =>
    (c.linkLocal ? 0 : 8) +
    (c.virtual ? 0 : 4) +
    (c.routed ? 2 : 0) +
    (c.private ? 1 : 0);
  let best: Candidate | null = null;
  for (const candidate of candidates) {
    if (!best || rank(candidate) > rank(best)) best = candidate;
  }
  return best?.address ?? null;
}

/**
 * The local address the system would send from to reach the internet: the
 * adapter that has the default route. Null when there is no such route, or
 * the system does not say within `timeoutMs`.
 *
 * Connecting a UDP socket sends nothing. It only makes the system choose a
 * route, and the socket's own address is then that adapter's. The address
 * connected to is one reserved for documentation (192.0.2.1), which no
 * network has, so nothing could be reached there even by mistake.
 */
export function readRoutedAddress(timeoutMs = 300): Promise<string | null> {
  return new Promise((resolve) => {
    let socket: dgram.Socket | null = null;
    let settled = false;
    const finish = (address: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // Already closed, or never opened.
      }
      resolve(address);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      socket = dgram.createSocket('udp4');
      socket.once('error', () => finish(null));
      socket.connect(9, '192.0.2.1', () => {
        try {
          finish(socket?.address().address ?? null);
        } catch {
          finish(null);
        }
      });
    } catch {
      finish(null);
    }
  });
}

/** This PC's address on the network, or `localhost` when it has none. */
export async function findLanAddress(): Promise<string> {
  return (
    pickLanAddress(os.networkInterfaces(), await readRoutedAddress()) ??
    'localhost'
  );
}
