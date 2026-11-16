import os from 'os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLocalHostsReader,
  createRefusalLog,
  evaluateAccess,
  isLoopbackAddress,
  parseHostHeader,
  type AccessPolicy,
} from './accessPolicy';

const policy = (overrides: Partial<AccessPolicy> = {}): AccessPolicy => ({
  port: () => 3000,
  networkAccess: () => false,
  extraOrigins: () => [],
  localHosts: () => ['racing-pc', 'racing-pc.local', '192.168.1.50'],
  ...overrides,
});

const open = policy({ networkAccess: () => true });

describe('isLoopbackAddress', () => {
  it.each(['127.0.0.1', '127.8.9.10', '::1', '::ffff:127.0.0.1'])(
    'takes %s for this machine',
    (address) => expect(isLoopbackAddress(address)).toBe(true)
  );

  it.each([undefined, '', '192.168.1.50', '::ffff:192.168.1.50', '1127.0.0.1'])(
    'does not take %s for this machine',
    (address) => expect(isLoopbackAddress(address)).toBe(false)
  );
});

describe('parseHostHeader', () => {
  it('reads a name and a port', () => {
    expect(parseHostHeader('LocalHost:3000')).toEqual({
      host: 'localhost',
      port: 3000,
    });
  });

  it('keeps an IPv6 literal in its brackets', () => {
    expect(parseHostHeader('[::1]:3000')).toEqual({
      host: '[::1]',
      port: 3000,
    });
  });

  it('reads a host with no port', () => {
    expect(parseHostHeader('localhost')).toEqual({
      host: 'localhost',
      port: null,
    });
  });

  it.each([
    undefined,
    '',
    'localhost:3000/path',
    'user@localhost:3000',
    'local host:3000',
    'localhost:0',
    'localhost:70000',
    'localhost:30a0',
  ])('refuses %s', (value) => expect(parseHostHeader(value)).toBeNull());
});

describe('evaluateAccess', () => {
  it('lets a plain navigation on this machine read', () => {
    expect(
      evaluateAccess(
        { host: 'localhost:3000', origin: undefined, remoteAddress: '::1' },
        policy()
      )
    ).toEqual({ allowed: true, ownPage: false, loopback: true });
  });

  it("knows the server's own page by its origin", () => {
    expect(
      evaluateAccess(
        {
          host: 'localhost:3000',
          origin: 'http://localhost:3000',
          remoteAddress: '127.0.0.1',
        },
        policy()
      )
    ).toEqual({ allowed: true, ownPage: true, loopback: true });
  });

  it('accepts the loopback spellings of the origin against each other', () => {
    for (const origin of ['http://127.0.0.1:3000', 'http://[::1]:3000']) {
      const decision = evaluateAccess(
        { host: 'localhost:3000', origin, remoteAddress: '127.0.0.1' },
        policy()
      );
      expect(decision.ownPage, origin).toBe(true);
    }
  });

  it('refuses a page from another site that reaches for localhost', () => {
    expect(
      evaluateAccess(
        {
          host: 'localhost:3000',
          origin: 'https://example.com',
          remoteAddress: '127.0.0.1',
        },
        policy()
      )
    ).toMatchObject({ allowed: false, refusal: 'origin', ownPage: false });
  });

  it.each([
    'null',
    'file://',
    'https://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3000.example.com',
    'http://localhost:3000/',
    'http://user@localhost:3000',
  ])('refuses the origin %s', (origin) => {
    expect(
      evaluateAccess(
        { host: 'localhost:3000', origin, remoteAddress: '127.0.0.1' },
        policy()
      ).allowed
    ).toBe(false);
  });

  it('refuses a name pointed at this machine by somebody else', () => {
    // DNS rebinding: Origin and Host agree, and neither is ours.
    expect(
      evaluateAccess(
        {
          host: 'attacker.example:3000',
          origin: 'http://attacker.example:3000',
          remoteAddress: '127.0.0.1',
        },
        open
      )
    ).toMatchObject({ allowed: false, refusal: 'host' });
  });

  it('refuses a request with no Host, or for another port', () => {
    for (const host of [undefined, 'localhost', 'localhost:3001']) {
      expect(
        evaluateAccess(
          { host, origin: undefined, remoteAddress: '127.0.0.1' },
          policy()
        ).allowed,
        String(host)
      ).toBe(false);
    }
  });

  it("answers to this machine's network names only when it is open to the network", () => {
    for (const host of [
      '192.168.1.50:3000',
      'racing-pc:3000',
      'Racing-PC.local:3000',
    ]) {
      const request = {
        host,
        origin: `http://${host}`,
        remoteAddress: '192.168.1.77',
      };
      expect(evaluateAccess(request, policy()).allowed, host).toBe(false);
      expect(evaluateAccess(request, open), host).toEqual({
        allowed: true,
        ownPage: true,
        loopback: false,
      });
    }
  });

  it('lets a device on the network read without an origin, as nobody', () => {
    expect(
      evaluateAccess(
        {
          host: '192.168.1.50:3000',
          origin: undefined,
          remoteAddress: '192.168.1.77',
        },
        open
      )
    ).toEqual({ allowed: true, ownPage: false, loopback: false });
  });

  it('takes the development bundle for our own page, by exact origin', () => {
    const dev = policy({ extraOrigins: () => ['http://localhost:5173'] });
    const from = (origin: string) =>
      evaluateAccess(
        { host: 'localhost:3000', origin, remoteAddress: '127.0.0.1' },
        dev
      );
    expect(from('http://localhost:5173').ownPage).toBe(true);
    expect(from('http://localhost:5174').allowed).toBe(false);
  });
});

describe('createLocalHostsReader', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists the name and the outward IPv4 addresses, and re-reads after ten seconds', () => {
    vi.spyOn(os, 'hostname').mockReturnValue('Racing-PC');
    const interfaces = vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
      eth: [
        { family: 'IPv4', internal: false, address: '192.168.1.50' },
        { family: 'IPv6', internal: false, address: 'fe80::1' },
      ],
    } as unknown as ReturnType<typeof os.networkInterfaces>);
    let clock = 0;
    const read = createLocalHostsReader(() => clock);

    expect(read()).toEqual(['racing-pc', 'racing-pc.local', '192.168.1.50']);
    clock = 9_999;
    read();
    expect(interfaces).toHaveBeenCalledTimes(1);
    clock = 10_000;
    read();
    expect(interfaces).toHaveBeenCalledTimes(2);
  });
});

describe('createRefusalLog', () => {
  it('names a visitor once, cuts its headers short, and stops at fifty', () => {
    const lines: string[] = [];
    const report = createRefusalLog((line) => lines.push(line));
    const visitor = {
      host: 'localhost:3000',
      origin: `https://${'a'.repeat(500)}.example`,
      remoteAddress: '127.0.0.1',
    };

    report('origin', visitor);
    report('origin', visitor);
    expect(lines).toHaveLength(1);
    expect(lines[0].length).toBeLessThan(200);
    expect(lines[0]).toContain('refused (origin): Host "localhost:3000"');

    report('host', { host: undefined, origin: undefined, remoteAddress: '' });
    expect(lines[1]).toBe('refused (host): Host none, Origin none');

    for (let i = 0; i < 100; i++) {
      report('host', { ...visitor, host: `name-${i}.example:3000` });
    }
    expect(lines).toHaveLength(50);
  });
});
