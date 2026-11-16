import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  DashboardBridge,
  DashboardLayout,
  IrSdkSourceBridge,
  PitLaneBridge,
} from '@irdashies/types';
import { createBridgeProxy } from './bridgeProxy';
import type { AccessPolicy } from './accessPolicy';

// Real sockets on a real port: the handshake is the thing under test.

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
    generalSettings: { enableNetworkAccess: false },
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

async function start({ networkAccess = false } = {}) {
  const dashboardBridge = {
    getCurrentDashboard: vi.fn(() => storedDashboard()),
    getDashboardForProfile: vi.fn(async (id: string) =>
      id === 'default' ? storedDashboard() : null
    ),
    dashboardUpdated: vi.fn(),
    saveDashboard: vi.fn(),
    reloadDashboard: vi.fn(),
    getAppVersion: vi.fn(async () => '2.2.3'),
    updateProfileTheme: vi.fn(),
    savePlayerIconImage: vi.fn(async () => 'icon.png'),
  };
  const pitLaneBridge = {
    getPitLaneData: vi.fn(async () => ({
      pitEntryPct: null,
      pitExitPct: null,
    })),
    updatePitLaneData: vi.fn(async () => true),
    resetPitLaneData: vi.fn(async () => undefined),
    getCurrentTrackPitLaneInfo: vi.fn(async () => null),
  };
  const server = http.createServer((_req, res) => res.end());
  let port = 0;
  const policy: AccessPolicy = {
    port: () => port,
    networkAccess: () => networkAccess,
    extraOrigins: () => [],
    localHosts: () => [LAN],
  };
  createBridgeProxy(
    server,
    source,
    dashboardBridge as unknown as DashboardBridge,
    undefined,
    pitLaneBridge as unknown as PitLaneBridge,
    policy
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  port = (server.address() as AddressInfo).port;
  return { port, dashboardBridge, pitLaneBridge };
}

interface Visit {
  status: 'open' | number;
  messages: {
    type: string;
    requestId?: string;
    data?: unknown;
    error?: string;
  }[];
  send: (type: string, data?: unknown, requestId?: string) => void;
  reply: (type: string, requestId?: string) => Promise<Visit['messages'][0]>;
}

function visit(
  port: number,
  { origin, host }: { origin?: string; host?: string } = {}
): Promise<Visit> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, {
      origin,
      headers: host ? { host } : undefined,
    });
    sockets.push(socket);
    const messages: Visit['messages'] = [];
    socket.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
    socket.on('unexpected-response', (_req, res) =>
      resolve({
        status: res.statusCode ?? 0,
        messages,
        send: () => undefined,
        reply: () => Promise.reject(new Error('never opened')),
      })
    );
    socket.on('error', reject);
    socket.on('open', () =>
      resolve({
        status: 'open',
        messages,
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

describe('who may open the socket', () => {
  it("lets the server's own page in and greets it", async () => {
    const { port } = await start();
    const client = await visit(port, { origin: `http://127.0.0.1:${port}` });

    expect(client.status).toBe('open');
    await vi.waitFor(() =>
      expect(client.messages.map((m) => m.type)).toContain('initialState')
    );
  });

  it('refuses a page from another site', async () => {
    const { port } = await start();
    const client = await visit(port, { origin: 'https://example.com' });

    expect(client.status).toBe(403);
    expect(client.messages).toEqual([]);
  });

  it('refuses a page on a name somebody pointed at this machine', async () => {
    const { port } = await start({ networkAccess: true });
    const client = await visit(port, {
      host: `attacker.example:${port}`,
      origin: `http://attacker.example:${port}`,
    });

    expect(client.status).toBe(403);
  });

  it("answers to the machine's network address only when open to the network", async () => {
    const closed = await start();
    const open = await start({ networkAccess: true });
    const knock = (port: number) =>
      visit(port, { host: `${LAN}:${port}`, origin: `http://${LAN}:${port}` });

    expect((await knock(closed.port)).status).toBe(403);
    expect((await knock(open.port)).status).toBe('open');
  });

  it('lets a program with no origin read', async () => {
    const { port } = await start();
    const client = await visit(port);

    expect(client.status).toBe('open');
    client.send('getAppVersion', undefined, 'v');
    expect((await client.reply('getAppVersion', 'v')).data).toBe('2.2.3');
  });
});

describe('what a visitor may change', () => {
  const tampered = {
    generalSettings: { enableNetworkAccess: true },
    widgets: [
      {
        id: 'standings',
        enabled: false,
        config: { background: { opacity: 0 }, browserPosition: position },
      },
    ],
  };

  it('saves only where the widgets sit, and only for our own page', async () => {
    const { port, dashboardBridge } = await start();
    const page = await visit(port, { origin: `http://127.0.0.1:${port}` });

    page.send('saveDashboard', {
      dashboard: tampered,
      options: { profileId: 'default', forceReload: true },
    });
    await settled(page);

    expect(dashboardBridge.saveDashboard).toHaveBeenCalledTimes(1);
    expect(dashboardBridge.saveDashboard).toHaveBeenCalledWith(
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

  it('saves nothing for a profile that does not exist', async () => {
    const { port, dashboardBridge } = await start();
    const page = await visit(port, { origin: `http://127.0.0.1:${port}` });

    page.send('saveDashboard', {
      dashboard: tampered,
      options: { profileId: 'invented' },
    });
    await settled(page);

    expect(dashboardBridge.saveDashboard).not.toHaveBeenCalled();
  });

  it('saves nothing for a program with no origin', async () => {
    const { port, dashboardBridge, pitLaneBridge } = await start();
    const program = await visit(port);

    program.send('saveDashboard', {
      dashboard: tampered,
      options: { profileId: 'default' },
    });
    program.send(
      'pitLane:updateData',
      {
        trackId: '47',
        update: { pitEntryPct: 0.9 },
        revision: 0,
        sourceId: 's',
      },
      'p'
    );

    expect((await program.reply('pitLane:updateData', 'p')).error).toBe(
      'Not allowed over a browser connection'
    );
    await settled(program);
    expect(dashboardBridge.saveDashboard).not.toHaveBeenCalled();
    expect(pitLaneBridge.updatePitLaneData).not.toHaveBeenCalled();
  });

  it('lets our own page report the pit lane it measured', async () => {
    const { port, pitLaneBridge } = await start();
    const page = await visit(port, { origin: `http://127.0.0.1:${port}` });

    page.send(
      'pitLane:updateData',
      {
        trackId: '47',
        update: { pitEntryPct: 0.9 },
        revision: 0,
        sourceId: 's',
      },
      'p'
    );

    expect((await page.reply('pitLane:updateData', 'p')).data).toBe(true);
    expect(pitLaneBridge.updatePitLaneData).toHaveBeenCalledWith(
      '47',
      { pitEntryPct: 0.9 },
      0,
      's'
    );
  });

  it('refuses what only the settings window does, even from our own page', async () => {
    const { port, dashboardBridge, pitLaneBridge } = await start();
    const page = await visit(port, { origin: `http://127.0.0.1:${port}` });

    page.send('pitLane:resetData', { trackId: '47' }, 'r');
    page.send(
      'updateProfileTheme',
      { profileId: 'default', themeSettings: { fontSize: 'xl' } },
      't'
    );
    page.send('savePlayerIconImage', { buffer: [1, 2, 3] }, 'i');

    const refused = 'Not allowed over a browser connection';
    expect((await page.reply('pitLane:resetData', 'r')).error).toBe(refused);
    expect((await page.reply('updateProfileTheme', 't')).error).toBe(refused);
    expect(await page.reply('savePlayerIconImage', 'i')).toMatchObject({
      data: '',
      error: refused,
    });
    expect(pitLaneBridge.resetPitLaneData).not.toHaveBeenCalled();
    expect(dashboardBridge.updateProfileTheme).not.toHaveBeenCalled();
    expect(dashboardBridge.savePlayerIconImage).not.toHaveBeenCalled();
  });

  it('answers a malformed read with the current dashboard and no lookup', async () => {
    const { port, dashboardBridge } = await start();
    const client = await visit(port);

    client.send('getDashboardForProfile', { profileId: { $ne: null } }, 'd');

    expect((await client.reply('getDashboardForProfile', 'd')).data).toEqual(
      storedDashboard()
    );
    expect(dashboardBridge.getDashboardForProfile).not.toHaveBeenCalled();
  });
});
