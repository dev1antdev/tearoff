import { KEY_REPLACED_CLOSE_CODE } from '@irdashies/types';
import { createKeyGate, type KeyDecision, type KeyVisitor } from './deviceKey';

/** As much of a socket as is needed to close it. */
export interface DeviceSocket {
  close: (code?: number, reason?: string) => void;
}

/** As much of the key's store as is needed here. */
export interface DeviceKeySource {
  current: () => string | null;
  replace: () => Promise<string>;
}

export interface DeviceAccessOptions {
  keys: DeviceKeySource;
  /** This machine's names and addresses on the network. */
  localHosts: () => readonly string[];
  now?: () => number;
}

/**
 * The key rule with what goes on around it: which other devices have a page
 * connected right now, and what happens to them when the key is replaced.
 */
export function createDeviceAccess(options: DeviceAccessOptions) {
  const gate = createKeyGate({
    key: options.keys.current,
    localHosts: options.localHosts,
    now: options.now,
  });
  /** The open sockets of other devices, each with the address it is from. */
  const sockets = new Map<DeviceSocket, string>();
  const listeners = new Set<(devices: number) => void>();

  // Two pages on one tablet are one device.
  const devices = () => new Set(sockets.values()).size;

  let announced = 0;
  const announce = () => {
    const count = devices();
    if (count === announced) return;
    announced = count;
    for (const listener of [...listeners]) listener(count);
  };

  return {
    /** The key rule for one request or handshake. */
    check: (visitor: KeyVisitor): KeyDecision => gate.check(visitor),

    /**
     * Counts the socket of another device as connected until the returned
     * function is called, which its close does.
     */
    admit(socket: DeviceSocket, remoteAddress: string | undefined) {
      sockets.set(socket, remoteAddress ?? '');
      announce();
      return () => {
        if (sockets.delete(socket)) announce();
      };
    },

    /** Other devices with a page connected right now. */
    devices,

    onDevicesChanged(listener: (devices: number) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /** The key now; null while the server answers this machine only. */
    key: options.keys.current,

    /**
     * Makes a new key. From the moment it is stored the old one is refused,
     * and every device connected with it is disconnected, told why so that
     * its page does not keep knocking. Rejects with the old key in force
     * when the new one could not be stored.
     */
    async replaceKey(): Promise<string> {
      const key = await options.keys.replace();
      const connected = [...sockets.keys()];
      // Gone from the count now, not when each one has finished closing.
      sockets.clear();
      announce();
      for (const socket of connected) {
        socket.close(KEY_REPLACED_CLOSE_CODE, 'Key replaced');
      }
      return key;
    },
  };
}

export type DeviceAccess = ReturnType<typeof createDeviceAccess>;
