import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  KEY_REPLACED_CLOSE_CODE,
  type DashboardBridge,
  type DashboardLayout,
  type IrSdkSourceBridge,
  type PitLaneBridge,
} from '@irdashies/types';
import { createBridgeProxy } from './bridgeProxy';
import type { AccessPolicy } from './accessPolicy';
import { createDeviceAccess } from './deviceAccess';

// Real sockets on a real port, as in bridgeProxy.access.spec.ts: the
// handshake is the thing under test.
//
// The machine running this has only loopback to connect from, so a visitor
// from the network is staged where the server learns who is calling: the
// accepted socket's `remoteAddress`. The test server sets it, as the
// connection arrives and before any request on it is read, to the address
// the visit says it comes from. Nothing in the code under test is changed
// for it, and no header is involved: the proxy reads the socket's remote
// address exactly as it does in the app.

vi.mock('../bridge/iracingSdk/setup', () => ({
  getActiveSimulator: () => 'lmu',
  getIsDemoMode: () => false,
  onActiveSimulatorChanged: vi.fn(),
}));
vi.mock('../bridge/iracingSdk/sims/registry', () => ({
  getAvailableSimulators: () => ['lmu'],
}));
vi.mock('../storage/simWidgetSupport', () => ({
  loadSimWidgetSupport: vi.fn(),
}));
vi.mock('../widgetVisibility', () => ({
  getHiddenWidgets: () => [],
  onWidgetHiddenChanged: vi.fn(),
}));
vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const LAN = '192.168.1.50';
const TABLET = '192.168.1.77';
const PHONE = '192.168.1.78';
const OLD_KEY = 'old-key-0123456789abcdefghijklmn';
const NEW_KEY = 'new-key-0123456789abcdefghijklmn';

const storedDashboard = (): DashboardLayout =>
  ({
    widgets: [
      {
        id: 'standings',
        enabled: true,
        layout: { x: 0, y: 0, width: 400, height: 600 },
        config: { background: { opacity: 80 } },
      },
    ],
    generalSettings: { enableNetworkAccess: true },
  }) as unknown as DashboardLayout;

const position = { x: 120, y: 40, width: 420, height: 640 };

const source = {
  onTelemetry: () => () => undefined,
  onSessionData: () => () => undefined,
  onRunningState: () => () => undefined,
  stop: vi.fn(),
  changeCameraNumber: vi.fn(),
  changeReplayPosition: vi.fn(),
  triggerReplaySessionSearch: vi.fn(),
} as unknown as IrSdkSourceBridge;

const servers: http.Server[] = [];
const sockets: WebSocket[] = [];
/** Where the next connection to arrive is said to come from. */
let arrivingFrom: string | undefined;

async function start({ keyRule = true } = {}) {
  const dashboardBridge = {
    getCurrentDashboard: vi.fn(() => storedDashboard()),
    getDashboardForProfile: vi.fn(async (id: string) =>
      id === 'default' ? storedDashboard() : null
    ),
    dashboardUpdated: vi.fn(),
    saveDashboard: vi.fn(),
    reloadDashboard: vi.fn(),
    getAppVersion: vi.fn(async () => '2.2.3'),
  };
  const pitLaneBridge = {
    updatePitLaneData: vi.fn(async () => true),
  };
  const server = http.createServer((_req, res) => res.end());
  server.on('connection', (socket) => {
    if (arrivingFrom === undefined) return;
    Object.defineProperty(socket, 'remoteAddress', { value: arrivingFrom });
  });
  let port = 0;
  const policy: AccessPolicy = {
    port: () => port,
    networkAccess: () => true,
    extraOrigins: () => [],
    localHosts: () => [LAN],
  };
  let key = OLD_KEY;
  const devices = createDeviceAccess({
    keys: {
      current: () => key,
      replace: async () => {
        key = NEW_KEY;
        return key;
      },
    },
    localHosts: policy.localHosts,
  });
  createBridgeProxy(
    server,
    source,
    dashboardBridge as unknown as DashboardBridge,
    undefined,
    pitLaneBridge as unknown as PitLaneBridge,
    policy,
    keyRule ? devices : undefined
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  port = (server.address() as AddressInfo).port;
  return { port, devices, dashboardBridge, pitLaneBridge };
}

interface Visit {
  status: 'open' | number;
  /** What a refused handshake was answered with. */
  refusal?: { body: string; setCookie: string | undefined };
  messages: { type: string; requestId?: string; data?: unknown }[];
  /** The close the server sent, once it has. */
  closed: Promise<{ code: number; reason: string }>;
  send: (type: string, data?: unknown, requestId?: string) => void;
  reply: (type: string, requestId?: string) => Promise<Visit['messages'][0]>;
}

interface From {
  /** The socket's remote address; this machine's loopback when left out. */
  from?: string;
  /** The key the visitor's cookie holds. */
  cookie?: string;
  origin?: string;
  /** Asked for in the socket's own address, which a page of ours never does. */
  query?: string;
}

/** A page served to `LAN` opening its socket, from wherever `from` says. */
function visit(port: number, who: From = {}): Promise<Visit> {
  return new Promise((resolve, reject) => {
    arrivingFrom = who.from;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/${who.query ?? ''}`, {
      origin: who.origin ?? `http://${LAN}:${port}`,
      headers: {
        host: `${LAN}:${port}`,
        ...(who.cookie ? { cookie: `tearoff_key=${who.cookie}` } : {}),
      },
    });
    sockets.push(socket);
    const messages: Visit['messages'] = [];
    const closed = new Promise<{ code: number; reason: string }>((done) =>
      socket.on('close', (code, reason) =>
        done({ code, reason: reason.toString() })
      )
    );
    socket.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
    socket.on('unexpected-response', (_req, res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          refusal: {
            body: Buffer.concat(chunks).toString('utf8'),
            setCookie: res.headers['set-cookie']?.[0],
          },
          messages,
          closed,
          send: () => undefined,
          reply: () => Promise.reject(new Error('never opened')),
        })
      );
    });
    socket.on('error', reject);
    socket.on('open', () =>
      resolve({
        status: 'open',
        messages,
        closed,
        send: (type, data, requestId) =>
          socket.send(JSON.stringify({ type, data, requestId })),
        reply: (type, requestId) =>
          vi.waitFor(() => {
            const found = messages.find(
              (m) => m.type === type && m.requestId === requestId
            );
            if (!found) throw new Error(`no ${type} reply yet`);
            return found;
          }),
      })
    );
  });
}

/** A round trip after `send`, so the server has handled what went before it. */
async function settled(client: Visit) {
  client.send('getAppVersion', undefined, 'settle');
  await client.reply('getAppVersion', 'settle');
}

afterEach(async () => {
  arrivingFrom = undefined;
  sockets.splice(0).forEach((socket) => socket.terminate());
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        })
    )
  );
});

describe('a device that is not this PC, opening the socket', () => {
  it('is refused without the key, and is sent nothing', async () => {
    const { port, devices } = await start();
    const tablet = await visit(port, { from: TABLET });

    expect(tablet.status).toBe(403);
    expect(tablet.refusal?.body).toMatch(/^Forbidden\. This device needs/);
    expect(tablet.refusal?.setCookie).toBeUndefined();
    expect(tablet.messages).toEqual([]);
    expect(devices.devices()).toBe(0);
  });

  it('is refused a key that is not the key, and told to drop its cookie', async () => {
    const { port } = await start();
    const tablet = await visit(port, { from: TABLET, cookie: NEW_KEY });

    expect(tablet.status).toBe(403);
    expect(tablet.refusal?.setCookie).toBe(
      'tearoff_key=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict'
    );
    expect(tablet.messages).toEqual([]);
  });

  it('is let in with the key in its cookie, greeted, and counted', async () => {
    const { port, devices } = await start();
    const tablet = await visit(port, { from: TABLET, cookie: OLD_KEY });

    expect(tablet.status).toBe('open');
    await vi.waitFor(() =>
      expect(tablet.messages.map((m) => m.type)).toContain('initialState')
    );
    expect(devices.devices()).toBe(1);
  });

  it('is not let in by a key in the address of the socket', async () => {
    // The handshake takes the cookie the server set, and nothing else.
    const { port } = await start();
    const tablet = await visit(port, {
      from: TABLET,
      query: `?key=${OLD_KEY}`,
    });

    expect(tablet.status).toBe(403);
  });

  it('is never told the key over the socket', async () => {
    const { port } = await start();
    const tablet = await visit(port, { from: TABLET, cookie: OLD_KEY });

    tablet.send('getDashboard');
    tablet.send('getDashboardForProfile', { profileId: 'default' }, 'd');
    tablet.send('getCurrentProfile', undefined, 'p');
    tablet.send('getKey', undefined, 'k');
    tablet.send('browserAccess:get', undefined, 'k');
    await tablet.reply('getDashboardForProfile', 'd');
    await settled(tablet);

    expect(JSON.stringify(tablet.messages)).not.toContain(OLD_KEY);
  });

  it('keeps the two writes a page of ours has, and no more', async () => {
    const { port, dashboardBridge, pitLaneBridge } = await start();
    const tablet = await visit(port, { from: TABLET, cookie: OLD_KEY });

    tablet.send('saveDashboard', {
      dashboard: {
        generalSettings: { enableNetworkAccess: false },
        widgets: [
          {
            id: 'standings',
            enabled: false,
            config: { background: { opacity: 0 }, browserPosition: position },
          },
        ],
      },
      options: { profileId: 'default' },
    });
    tablet.send(
      'pitLane:updateData',
      {
        trackId: '47',
        update: { pitEntryPct: 0.9 },
        revision: 0,
        sourceId: 's',
      },
      'p'
    );
    tablet.send('pitLane:resetData', { trackId: '47' }, 'r');

    expect((await tablet.reply('pitLane:updateData', 'p')).data).toBe(true);
    expect(await tablet.reply('pitLane:resetData', 'r')).toMatchObject({
      error: 'Not allowed over a browser connection',
    });
    await settled(tablet);
    expect(pitLaneBridge.updatePitLaneData).toHaveBeenCalledTimes(1);
    expect(dashboardBridge.saveDashboard).toHaveBeenCalledExactlyOnceWith(
      {
        ...storedDashboard(),
        widgets: [
          {
            ...storedDashboard().widgets[0],
            config: { background: { opacity: 80 }, browserPosition: position },
          },
        ],
      },
      { profileId: 'default' }
    );
  });

  it('is not let in by its key where another site is asking', async () => {
    const { port } = await start();
    const tablet = await visit(port, {
      from: TABLET,
      cookie: OLD_KEY,
      origin: 'https://example.com',
    });

    // The origin rule answers first, in its own words.
    expect(tablet.status).toBe(403);
    expect(tablet.refusal?.body).toBe('Forbidden');
  });

  it('is cut off after a few different wrong keys, the right one included', async () => {
    const { port } = await start();
    for (let guess = 0; guess < 5; guess++) {
      const knock = await visit(port, {
        from: TABLET,
        cookie: `wrong-key-${guess}-0123456789abcdef`,
      });
      expect(knock.status).toBe(403);
    }

    expect((await visit(port, { from: TABLET, cookie: OLD_KEY })).status).toBe(
      429
    );
    // The phone is not the tablet.
    expect((await visit(port, { from: PHONE, cookie: OLD_KEY })).status).toBe(
      'open'
    );
  });

  it('counts two pages on one device once, and forgets them as they close', async () => {
    const { port, devices } = await start();
    const counts: number[] = [];
    devices.onDevicesChanged((count) => counts.push(count));

    await visit(port, { from: TABLET, cookie: OLD_KEY });
    await visit(port, { from: TABLET, cookie: OLD_KEY });
    await visit(port, { from: PHONE, cookie: OLD_KEY });
    expect(devices.devices()).toBe(2);

    sockets.splice(0).forEach((socket) => socket.close());

    await vi.waitFor(() => expect(devices.devices()).toBe(0));
    expect(counts).toEqual([1, 2, 1, 0]);
  });
});

describe('this machine, opening the socket', () => {
  it('needs no key by loopback, and is not counted as a device', async () => {
    const { port, devices } = await start();
    const page = await visit(port);

    expect(page.status).toBe('open');
    expect(devices.devices()).toBe(0);
  });

  it('needs no key by its own address, as a link for OBS names it', async () => {
    const { port, devices } = await start();
    const page = await visit(port, { from: LAN });

    expect(page.status).toBe('open');
    expect(devices.devices()).toBe(0);
  });
});

describe('replacing the key', () => {
  it('closes the open socket of a device that held the old one', async () => {
    const { port, devices } = await start();
    const tablet = await visit(port, { from: TABLET, cookie: OLD_KEY });
    const own = await visit(port);
    await settled(tablet);

    await devices.replaceKey();

    expect(await tablet.closed).toEqual({
      code: KEY_REPLACED_CLOSE_CODE,
      reason: 'Key replaced',
    });
    expect(devices.devices()).toBe(0);
    // This machine's own page is not a device with a key, and stays.
    await settled(own);
  });

  it('refuses the old key from then on and lets the new one in', async () => {
    const { port, devices } = await start();
    await devices.replaceKey();

    const stale = await visit(port, { from: TABLET, cookie: OLD_KEY });
    expect(stale.status).toBe(403);
    expect(stale.refusal?.setCookie).toContain('Max-Age=0');

    const fresh = await visit(port, { from: TABLET, cookie: NEW_KEY });
    expect(fresh.status).toBe('open');
  });

  it('is not held up by a device that keeps knocking with the old key', async () => {
    // What a page left open does, every few seconds, until it is reloaded.
    const { port, devices } = await start();
    await devices.replaceKey();
    for (let knock = 0; knock < 12; knock++) {
      expect(
        (await visit(port, { from: TABLET, cookie: OLD_KEY })).status
      ).toBe(403);
    }

    expect((await visit(port, { from: TABLET, cookie: NEW_KEY })).status).toBe(
      'open'
    );
  });
});

describe('a socket server with no key rule to ask', () => {
  it('lets loopback in and nobody else', async () => {
    const { port } = await start({ keyRule: false });

    expect((await visit(port)).status).toBe('open');
    expect((await visit(port, { from: TABLET, cookie: OLD_KEY })).status).toBe(
      403
    );
  });
});
