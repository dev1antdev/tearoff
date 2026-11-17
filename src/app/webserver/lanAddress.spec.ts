import { EventEmitter } from 'node:events';
import type os from 'os';
import { afterEach, describe, expect, it, vi } from 'vitest';

const createSocket = vi.fn();
vi.mock('dgram', () => ({
  default: { createSocket: (...args: unknown[]) => createSocket(...args) },
}));

import { looksVirtual, pickLanAddress, readRoutedAddress } from './lanAddress';

type Interfaces = ReturnType<typeof os.networkInterfaces>;

const v4 = (address: string, internal = false) => ({
  family: 'IPv4',
  internal,
  address,
});
const adapters = (list: Record<string, unknown[]>) =>
  list as unknown as Interfaces;

describe('the address handed out for other devices', () => {
  it('is the network card, not a WSL or Hyper-V switch the system lists first', () => {
    // What a Windows PC with WSL lists: the old rule took the first private
    // address, which is the switch only this PC can reach.
    const interfaces = adapters({
      'vEthernet (WSL (Hyper-V firewall))': [v4('172.29.96.1')],
      'vEthernet (Default Switch)': [v4('172.17.160.1')],
      'Loopback Pseudo-Interface 1': [v4('127.0.0.1', true)],
      'Wi-Fi': [v4('192.168.1.50')],
    });
    expect(pickLanAddress(interfaces, null)).toBe('192.168.1.50');
    expect(pickLanAddress(interfaces, '192.168.1.50')).toBe('192.168.1.50');
  });

  it('is the adapter the default route leaves by, of two network cards', () => {
    const interfaces = adapters({
      Ethernet: [v4('10.0.0.5')],
      'Wi-Fi': [v4('192.168.1.50')],
    });
    expect(pickLanAddress(interfaces, '192.168.1.50')).toBe('192.168.1.50');
    expect(pickLanAddress(interfaces, '10.0.0.5')).toBe('10.0.0.5');
    // With no route to go by, the order the system lists them in.
    expect(pickLanAddress(interfaces, null)).toBe('10.0.0.5');
  });

  it('is the network card and not a VPN that took the default route', () => {
    const interfaces = adapters({
      'Wi-Fi': [v4('192.168.1.50')],
      'OpenVPN TAP-Windows6': [v4('10.8.0.2')],
    });
    expect(pickLanAddress(interfaces, '10.8.0.2')).toBe('192.168.1.50');
  });

  it('is the routed virtual switch where the network card sits behind one', () => {
    const interfaces = adapters({
      'vEthernet (Default Switch)': [v4('172.17.160.1')],
      'vEthernet (External)': [v4('192.168.1.50')],
    });
    expect(pickLanAddress(interfaces, '192.168.1.50')).toBe('192.168.1.50');
  });

  it('is an address a network gave before one an adapter gave itself', () => {
    const interfaces = adapters({
      Ethernet: [v4('169.254.10.20')],
      'vEthernet (External)': [v4('192.168.1.50')],
    });
    expect(pickLanAddress(interfaces, null)).toBe('192.168.1.50');
  });

  it('still names a virtual adapter when there is no other', () => {
    expect(
      pickLanAddress(adapters({ 'vEthernet (WSL)': [v4('172.29.96.1')] }), null)
    ).toBe('172.29.96.1');
  });

  it('is nothing when this PC has only its own addresses', () => {
    expect(pickLanAddress(adapters({}), null)).toBeNull();
    expect(
      pickLanAddress(
        adapters({ lo: [v4('127.0.0.1', true)], Ethernet: undefined as never }),
        '127.0.0.1'
      )
    ).toBeNull();
  });

  it('ignores a routed address none of the adapters has', () => {
    const interfaces = adapters({
      'vEthernet (WSL)': [v4('172.29.96.1')],
      Ethernet: [v4('192.168.1.50')],
    });
    expect(pickLanAddress(interfaces, '203.0.113.9')).toBe('192.168.1.50');
  });

  it.each([
    'vEthernet (WSL (Hyper-V firewall))',
    'VirtualBox Host-Only Network',
    'VMware Network Adapter VMnet8',
    'Tailscale',
    'ZeroTier One [abc]',
    'wg0',
    'tun0',
    'docker0',
    'br-1f2e3d',
    'Bluetooth Network Connection',
    'Local Area Connection* 2',
  ])('takes "%s" for a virtual adapter', (name) => {
    expect(looksVirtual(name)).toBe(true);
  });

  it.each([
    'Ethernet',
    'Ethernet 2',
    'Wi-Fi',
    'Local Area Connection',
    'eth0',
    'wlan0',
    'en0',
  ])('takes "%s" for a network card', (name) => {
    expect(looksVirtual(name)).toBe(false);
  });
});

describe('the adapter the default route leaves by', () => {
  afterEach(() => {
    vi.useRealTimers();
    createSocket.mockReset();
  });

  class FakeSocket extends EventEmitter {
    close = vi.fn();
    connect = vi.fn();
    address = vi.fn(() => ({ address: '192.168.1.50' }));
  }

  it('is read from a socket that was connected and sent nothing', async () => {
    const socket = new FakeSocket();
    socket.connect.mockImplementation(
      (_port: number, _host: string, done: () => void) => done()
    );
    createSocket.mockReturnValue(socket);

    await expect(readRoutedAddress()).resolves.toBe('192.168.1.50');
    expect(createSocket).toHaveBeenCalledWith('udp4');
    // An address reserved for documentation: no network has it.
    expect(socket.connect.mock.calls[0][1]).toBe('192.0.2.1');
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it('is unknown where there is no route', async () => {
    const socket = new FakeSocket();
    socket.connect.mockImplementation(() =>
      queueMicrotask(() => socket.emit('error', new Error('ENETUNREACH')))
    );
    createSocket.mockReturnValue(socket);
    await expect(readRoutedAddress()).resolves.toBeNull();
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it('is unknown where a socket cannot be made', async () => {
    createSocket.mockImplementation(() => {
      throw new Error('EPERM');
    });
    await expect(readRoutedAddress()).resolves.toBeNull();
  });

  it('is unknown where the system does not answer in time', async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    createSocket.mockReturnValue(socket);
    const read = readRoutedAddress(300);
    await vi.advanceTimersByTimeAsync(300);
    await expect(read).resolves.toBeNull();
    expect(socket.close).toHaveBeenCalledOnce();
  });
});
