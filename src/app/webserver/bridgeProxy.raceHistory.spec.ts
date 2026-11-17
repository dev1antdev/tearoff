import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SIM_WIDGET_SUPPORT,
  KEY_REPLACED_CLOSE_CODE,
  RACE_HISTORY_MAX_LAPS_PER_CAR,
  type DashboardBridge,
  type IrSdkSourceBridge,
  type RaceCarLaps,
  type RaceHistoryBridge,
  type RaceHistorySummarySnapshot,
  type RaceLap,
} from '@irdashies/types';
import { ChannelBus, type RendererTarget } from '../bridge/channelBus';
import logger from '../logger';
import { watchRaceHistoryDemand } from '../raceHistoryDemand';
import type { AccessPolicy } from './accessPolicy';
import { createDeviceAccess } from './deviceAccess';

// Real sockets on a real port, as in bridgeProxy.deviceKey.spec.ts: who gets
// a socket at all is half of what is under test here, and the other half is
// what a socket that was let in may then ask of the race history.
//
// A visitor from the network is staged the same way as there: the test
// server sets the accepted socket's `remoteAddress`, which is where the
// proxy reads who is calling, before any request on it is read.
//
// The bridge behind the socket is the real one, with its own checks, over a
// source that only counts what it is asked. The last block puts the real
// runtime and a real file behind it.

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}));
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

import { createRaceHistoryBridge } from '../bridge/raceHistoryBridge';
import { createSessionLifecycle } from '../sessionLifecycle';
import { driveLaps, Field } from '../processors/raceHistoryFixture';
import { RaceHistoryRuntime } from '../processors/raceHistoryRuntime';
import {
  idle,
  openRaceHistoryFile,
  type RaceHistoryFile,
} from '../processors/raceHistoryStoreFixture';
import { createBridgeProxy } from './bridgeProxy';
import {
  RACE_HISTORY_BUSY,
  RACE_HISTORY_MAX_WAITING,
  RACE_HISTORY_NO_ARGS,
  RACE_HISTORY_NO_ID,
  RACE_HISTORY_UNAVAILABLE,
} from './raceHistoryReads';

const LAN = '192.168.1.50';
const TABLET = '192.168.1.77';
const KEY = 'the-key-0123456789abcdefghijklmn';
const NEW_KEY = 'new-key-0123456789abcdefghijklmn';

/** The channels whose readers are a reason to record the race. */
const DEMAND_CHANNELS = ['race-history.summary', 'race-log.snapshot'] as const;

/** Every read the bridge has, with arguments it takes. */
const READS = [
  ['raceHistory:getCarLaps', [7, 12]],
  ['raceHistory:getCarStints', [7, null]],
  ['raceHistory:getDriverChanges', [12]],
  ['raceHistory:listRaces', []],
  ['raceHistory:getEvents', [null, 801]],
] as const;

const irsdk = {
  onTelemetry: () => () => undefined,
  onSessionData: () => () => undefined,
  onRunningState: () => () => undefined,
  stop: vi.fn(),
  changeCameraNumber: vi.fn(),
  changeReplayPosition: vi.fn(),
  triggerReplaySessionSearch: vi.fn(),
} as unknown as IrSdkSourceBridge;

/** A race history that only counts what it is asked. */
const countingSource = () =>
  ({
    getCarLaps: vi.fn<RaceHistoryBridge['getCarLaps']>(async (carIdx) => ({
      laps: [],
      missingLaps: [],
      revision: carIdx,
    })),
    getCarStints: vi.fn<RaceHistoryBridge['getCarStints']>(async () => []),
    getDriverChanges: vi.fn<RaceHistoryBridge['getDriverChanges']>(
      async () => []
    ),
    listRaces: vi.fn<RaceHistoryBridge['listRaces']>(async () => []),
    getEvents: vi.fn<RaceHistoryBridge['getEvents']>(async () => []),
  }) satisfies RaceHistoryBridge;

const untouched = (source: ReturnType<typeof countingSource>) => {
  for (const method of Object.values(source)) {
    expect(method).not.toHaveBeenCalled();
  }
};

/** A promise settled from outside. */
const gate = <T>() => {
  let open!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    open = resolve;
  });
  return { promise, open };
};

const servers: http.Server[] = [];
const sockets: WebSocket[] = [];
const disposals: (() => void)[] = [];
/** Where the next connection to arrive is said to come from. */
let arrivingFrom: string | undefined;

interface Staging {
  /** What the bridge is answered from, unless `runtime` is given. */
  source?: ReturnType<typeof countingSource>;
  /** The real race history to answer from, in place of `source`. */
  runtime?: RaceHistoryBridge;
  /** False starts the server with no race history handed to it. */
  withBridge?: boolean;
  bus?: ChannelBus;
  /** Told whether the race is to be recorded; nothing listens, left out. */
  onDemand?: (needed: boolean) => void;
}

async function start({
  source = countingSource(),
  runtime,
  withBridge = true,
  bus = new ChannelBus(),
  onDemand,
}: Staging = {}) {
  const demand = vi.fn<(needed: boolean) => void>((needed) =>
    onDemand?.(needed)
  );
  // As the app wires it: no Pit Wall on the desktop, so a reader of one of
  // the race history's channels is the only reason there can be.
  disposals.push(
    watchRaceHistoryDemand({
      bus,
      initialLayout: undefined,
      onDashboardUpdated: () => undefined,
      getSimulator: () => 'lmu',
      onSimulatorChanged: () => undefined,
      getSupport: () => DEFAULT_SIM_WIDGET_SUPPORT,
      onChange: demand,
    })
  );

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
  let key = KEY;
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
    irsdk,
    {
      dashboardUpdated: vi.fn(),
      // Asked for after what a test sent, to know the server has read it.
      getAppVersion: async () => '2.2.3',
    } as unknown as DashboardBridge,
    bus,
    undefined,
    policy,
    devices,
    withBridge ? createRaceHistoryBridge(runtime ?? source) : undefined
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  port = (server.address() as AddressInfo).port;
  return { port, bus, demand, devices, source };
}

interface Message {
  type: string;
  requestId?: string | null;
  data?: unknown;
  error?: string;
}

interface Visit {
  status: 'open' | number;
  messages: Message[];
  /** The size of each message as it came off the wire, in bytes. */
  bytes: number[];
  socket: WebSocket;
  closed: Promise<{ code: number }>;
  send: (type: string, data?: unknown, requestId?: unknown) => void;
  reply: (type: string, requestId?: string | null) => Promise<Message>;
  /** Asks and waits for the answer under the same id. */
  ask: (type: string, args: unknown, requestId?: string) => Promise<Message>;
}

interface From {
  /** The socket's remote address; this machine's loopback when left out. */
  from?: string;
  /** The key the visitor's cookie holds. */
  cookie?: string;
  /** The page asking; a page of this server's own when left out. */
  origin?: string;
  /** Sends no `Origin` at all, as a program does. */
  noOrigin?: boolean;
  host?: string;
}

let asked = 0;

/** A page served to `LAN` opening its socket, from wherever `from` says. */
function visit(port: number, who: From = {}): Promise<Visit> {
  return new Promise((resolve, reject) => {
    arrivingFrom = who.from;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/`, {
      origin: who.noOrigin
        ? undefined
        : (who.origin ?? `http://${LAN}:${port}`),
      headers: {
        host: who.host ?? `${LAN}:${port}`,
        ...(who.cookie ? { cookie: `tearoff_key=${who.cookie}` } : {}),
      },
    });
    sockets.push(socket);
    const messages: Message[] = [];
    const bytes: number[] = [];
    const closed = new Promise<{ code: number }>((done) =>
      socket.on('close', (code) => done({ code }))
    );
    socket.on('message', (raw: Buffer) => {
      bytes.push(raw.length);
      messages.push(JSON.parse(raw.toString()));
    });
    const reply: Visit['reply'] = (type, requestId) =>
      vi.waitFor(() => {
        const found = messages.find(
          (m) => m.type === type && m.requestId === requestId
        );
        if (!found) throw new Error(`no ${type} reply yet`);
        return found;
      });
    const send: Visit['send'] = (type, data, requestId) =>
      socket.send(JSON.stringify({ type, data, requestId }));
    socket.on('unexpected-response', (_req, res) => {
      res.resume();
      resolve({
        status: res.statusCode ?? 0,
        messages,
        bytes,
        socket,
        closed,
        send: () => undefined,
        reply: () => Promise.reject(new Error('never opened')),
        ask: () => Promise.reject(new Error('never opened')),
      });
    });
    socket.on('error', reject);
    socket.on('open', () =>
      resolve({
        status: 'open',
        messages,
        bytes,
        socket,
        closed,
        send,
        reply,
        ask: (type, args, requestId = `q${++asked}`) => {
          send(type, args, requestId);
          return reply(type, requestId);
        },
      })
    );
  });
}

/** A round trip after `send`, so the server has handled what went before it. */
async function settled(client: Visit) {
  const id = `settle${++asked}`;
  client.send('getAppVersion', undefined, id);
  await client.reply('getAppVersion', id);
}

afterEach(async () => {
  arrivingFrom = undefined;
  vi.mocked(logger.info).mockClear();
  vi.mocked(logger.warn).mockClear();
  disposals.splice(0).forEach((dispose) => dispose());
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

describe('the race history, read over a page’s socket', () => {
  it('answers every read the bridge has for a page on this PC', async () => {
    const { port, source } = await start();
    const page = await visit(port, {
      host: `127.0.0.1:${port}`,
      origin: `http://127.0.0.1:${port}`,
    });

    const answers = [];
    for (const [type, args] of READS) answers.push(await page.ask(type, args));

    expect(
      answers.map(({ type, data, error }) => ({ type, data, error }))
    ).toEqual([
      {
        type: 'raceHistory:getCarLaps',
        data: { laps: [], missingLaps: [], revision: 7 },
      },
      { type: 'raceHistory:getCarStints', data: [] },
      { type: 'raceHistory:getDriverChanges', data: [] },
      { type: 'raceHistory:listRaces', data: [] },
      { type: 'raceHistory:getEvents', data: [] },
    ]);
    // Asked as a window would have asked over IPC: a race left out as null
    // is the race being recorded.
    expect(source.getCarLaps).toHaveBeenCalledExactlyOnceWith(7, 12);
    expect(source.getCarStints).toHaveBeenCalledExactlyOnceWith(7, undefined);
    expect(source.getDriverChanges).toHaveBeenCalledExactlyOnceWith(12);
    expect(source.listRaces).toHaveBeenCalledExactlyOnceWith();
    expect(source.getEvents).toHaveBeenCalledExactlyOnceWith(undefined, 801);
  });

  it('answers this PC by its network address, and a program that sends no origin', async () => {
    // Reading is what every visitor the handshake lets in may do.
    const { port, source } = await start();
    const obs = await visit(port, { from: LAN });
    const program = await visit(port, { noOrigin: true });

    expect((await obs.ask('raceHistory:getCarLaps', [3])).data).toMatchObject({
      revision: 3,
    });
    expect(
      (await program.ask('raceHistory:getCarLaps', [4])).data
    ).toMatchObject({ revision: 4 });
    expect(source.getCarLaps).toHaveBeenCalledTimes(2);
  });

  it('answers a device on the network that showed the key', async () => {
    const { port, source } = await start();
    const tablet = await visit(port, { from: TABLET, cookie: KEY });

    expect(tablet.status).toBe('open');
    expect((await tablet.ask('raceHistory:listRaces', [])).data).toEqual([]);
    expect(source.listRaces).toHaveBeenCalledTimes(1);
  });

  it('answers each socket under its own ids, however they are named', async () => {
    const { port } = await start();
    const first = await visit(port);
    const second = await visit(port);

    // The same id on two sockets, and two ids on one.
    const [a, b, c] = await Promise.all([
      first.ask('raceHistory:getCarLaps', [1], 'same'),
      second.ask('raceHistory:getCarLaps', [2], 'same'),
      first.ask('raceHistory:getCarLaps', [3], 'other'),
    ]);

    expect([a.data, b.data, c.data]).toMatchObject([
      { revision: 1 },
      { revision: 2 },
      { revision: 3 },
    ]);
    expect(first.messages.filter((m) => m.requestId === 'same')).toHaveLength(
      1
    );
    expect(second.messages.filter((m) => m.requestId === 'same')).toHaveLength(
      1
    );
  });

  it('says so where the server was started with no race history', async () => {
    const { port } = await start({ withBridge: false });
    const page = await visit(port);

    expect(await page.ask('raceHistory:listRaces', [])).toMatchObject({
      error: RACE_HISTORY_UNAVAILABLE,
    });
  });
});

/**
 * One lap as wide as a lap gets: every figure a double printed in full, as
 * the sims hand them over, a name of thirty-odd letters, sectors and
 * compounds all present.
 */
const widestLap = (index: number): RaceLap => {
  const wide = (value: number) =>
    value + ((index * 7919) % 1000) / 1e3 + Math.SQRT2 * 1e-9;
  return {
    carIdx: 103,
    lap: index + 1,
    sessionTime: wide(200 + index * 237),
    lapTime: wide(237),
    sectors: [wide(78), wide(96), wide(62)],
    position: 58,
    classPosition: 21,
    classGap: wide(1380),
    flags: 0b1011010,
    driver: 'Maximilian von Günther-Hohenlohe',
    energy: wide(0) / 2,
    energyIsVirtual: false,
    compounds: [11, 11, 12, 12],
  };
};

describe('the largest answer', () => {
  it('is a full car’s laps in one message, well inside a megabyte', async () => {
    const full: RaceCarLaps = {
      laps: Array.from({ length: RACE_HISTORY_MAX_LAPS_PER_CAR }, (_, index) =>
        widestLap(index)
      ),
      missingLaps: [],
      revision: RACE_HISTORY_MAX_LAPS_PER_CAR,
    };
    const source = countingSource();
    source.getCarLaps.mockResolvedValueOnce(full);
    const { port } = await start({ source });
    const page = await visit(port);

    const answer = await page.ask('raceHistory:getCarLaps', [103], 'full');

    expect(answer.data).toEqual(full);
    const size = page.bytes[page.messages.indexOf(answer)];
    expect(size).toBe(
      Buffer.byteLength(
        JSON.stringify({
          type: 'raceHistory:getCarLaps',
          requestId: 'full',
          data: full,
        })
      )
    );
    // Measured here: 698,701 bytes for 2,000 staged laps at their widest,
    // 349 a lap. The 90 laps the recorder takes from the Le Mans Ultimate
    // recording are 318 bytes each on average (299 to 328), which would be
    // 636,000 for a full car.
    expect(size).toBe(698_701);
    // The server takes no message from a page above 4 MB; what it sends is
    // not limited by that, and is a sixth of it.
    expect(size).toBeLessThan(1024 * 1024);
  });
});

/** Why a handshake is refused before any message, case by case. */
const REFUSED: readonly [string, (port: number) => From][] = [
  ['a device on the network with no key', () => ({ from: TABLET })],
  [
    'a device on the network with a key that is not the key',
    () => ({ from: TABLET, cookie: NEW_KEY }),
  ],
  [
    'a page of another site open on this PC',
    () => ({ origin: 'https://example.com' }),
  ],
  [
    'a page of another site on a device that holds the key',
    () => ({ from: TABLET, cookie: KEY, origin: 'https://example.com' }),
  ],
  [
    'a page on a name somebody pointed at this machine',
    (port) => ({
      host: `attacker.example:${port}`,
      origin: `http://attacker.example:${port}`,
    }),
  ],
];

/** A client's text frame, masked as a client's frames are. */
const textFrame = (text: string): Buffer => {
  const payload = Buffer.from(text, 'utf8');
  if (payload.length > 125) throw new Error('one short frame only');
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const masked = Buffer.from(payload.map((byte, at) => byte ^ mask[at % 4]));
  return Buffer.concat([
    Buffer.from([0x81, 0x80 | payload.length]),
    mask,
    masked,
  ]);
};

/**
 * Sends an upgrade request and, in the same breath and before any answer,
 * a frame asking for the race history: what a visitor does that will not
 * take no for an answer. Resolves with everything the server sent back.
 */
const forceRequest = (port: number, who: From): Promise<string> =>
  new Promise((resolve, reject) => {
    arrivingFrom = who.from;
    const socket = net.connect(port, '127.0.0.1', () => {
      const upgrade = [
        'GET / HTTP/1.1',
        `Host: ${who.host ?? `${LAN}:${port}`}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version: 13',
        `Origin: ${who.origin ?? `http://${LAN}:${port}`}`,
        ...(who.cookie ? [`Cookie: tearoff_key=${who.cookie}`] : []),
        '',
        '',
      ].join('\r\n');
      // One write: the frame is in the server's hands with the request.
      socket.write(
        Buffer.concat([
          Buffer.from(upgrade, 'latin1'),
          textFrame(
            JSON.stringify({
              type: 'raceHistory:listRaces',
              requestId: 'forced',
              data: [],
            })
          ),
        ])
      );
    });
    let answer = '';
    socket.on('data', (chunk) => (answer += chunk.toString('latin1')));
    socket.on('close', () => resolve(answer));
    socket.on('error', reject);
    // An accepted upgrade leaves the socket open: long enough for an answer.
    setTimeout(() => socket.destroy(), 400);
  });

describe('who never reaches the race history', () => {
  it.each(REFUSED)(
    'refuses the handshake of %s, so there is no socket to ask on',
    async (_who, from) => {
      const { port, source, bus, demand } = await start();

      const visitor = await visit(port, from(port));

      expect(visitor.status).toBe(403);
      expect(visitor.messages).toEqual([]);
      untouched(source);
      for (const channel of DEMAND_CHANNELS) {
        expect(bus.registeredSubscriberCount(channel)).toBe(0);
      }
      expect(demand.mock.calls).toEqual([[false]]);
    }
  );

  it.each(REFUSED)(
    'reads nothing %s sends along with the handshake',
    async (_who, from) => {
      const { port, source } = await start();

      const answer = await forceRequest(port, from(port));

      expect(answer).toMatch(/^HTTP\/1\.1 403 /);
      expect(answer).not.toContain('raceHistory');
      // A page that is let in is answered after it: the server has handled
      // everything the refused visitor sent by then.
      const own = await visit(port);
      await settled(own);
      untouched(source);
    }
  );

  it('does read the same bytes from a page it lets in', async () => {
    // The check on the check: the frame above is a request, and it is the
    // refusal, not the way it was sent, that keeps it from being read.
    const { port, source } = await start();

    const answer = await forceRequest(port, {});

    expect(answer).toMatch(/^HTTP\/1\.1 101 /);
    expect(answer).toContain('"type":"raceHistory:listRaces"');
    expect(answer).toContain('"requestId":"forced"');
    expect(source.listRaces).toHaveBeenCalledTimes(1);
  });

  it('answers no read on a socket that is being closed for its key', async () => {
    const source = countingSource();
    const first = gate<RaceCarLaps>();
    source.getCarLaps.mockImplementationOnce(() => first.promise);
    const { port, devices } = await start({ source });
    const tablet = await visit(port, { from: TABLET, cookie: KEY });
    tablet.send('raceHistory:getCarLaps', [1], 'a');
    tablet.send('raceHistory:getCarLaps', [2], 'b');
    await settled(tablet);

    await devices.replaceKey();
    first.open({ laps: [], missingLaps: [], revision: 1 });

    expect((await tablet.closed).code).toBe(KEY_REPLACED_CLOSE_CODE);
    await idle();
    // The read under way had been asked for; the one behind it never is.
    expect(source.getCarLaps).toHaveBeenCalledTimes(1);
    expect(
      tablet.messages.filter((m) => m.type.startsWith('raceHistory:'))
    ).toEqual([]);
  });
});

describe('what a socket may not ask of the race history', () => {
  it('answers malformed arguments with an error, and the source is never asked', async () => {
    const { port, source } = await start();
    const page = await visit(port);
    const refusedWith = async (type: string, args: unknown) =>
      (await page.ask(type, args)).error;

    // A car slot outside 0..127, or no number at all.
    for (const car of [-1, 128, 1.5, '7', null, [7], { carIdx: 7 }, true]) {
      expect(await refusedWith('raceHistory:getCarLaps', [car])).toBe(
        'Invalid car for raceHistory:getCarLaps'
      );
      expect(await refusedWith('raceHistory:getCarStints', [car, 12])).toBe(
        'Invalid car for raceHistory:getCarStints'
      );
    }
    expect(await refusedWith('raceHistory:getCarLaps', [])).toBe(
      'Invalid car for raceHistory:getCarLaps'
    );
    // A race that is not a row id.
    for (const race of [-4, 0, 2.5, '12', '1; DROP TABLE race', [12], {}]) {
      expect(await refusedWith('raceHistory:getCarLaps', [7, race])).toBe(
        'Invalid race for raceHistory:getCarLaps'
      );
      expect(await refusedWith('raceHistory:getDriverChanges', [race])).toBe(
        'Invalid race for raceHistory:getDriverChanges'
      );
      expect(await refusedWith('raceHistory:getEvents', [race])).toBe(
        'Invalid race for raceHistory:getEvents'
      );
    }
    // An event that is not an event's number.
    for (const before of [0, -3, 10.5, '200', {}]) {
      expect(await refusedWith('raceHistory:getEvents', [null, before])).toBe(
        'Invalid event for raceHistory:getEvents'
      );
    }
    // More than the read takes.
    expect(await refusedWith('raceHistory:getCarLaps', [7, 12, 1])).toBe(
      'raceHistory:getCarLaps takes at most 2 argument(s)'
    );
    expect(await refusedWith('raceHistory:getCarStints', [7, 12, 'x'])).toBe(
      'raceHistory:getCarStints takes at most 2 argument(s)'
    );
    expect(await refusedWith('raceHistory:getDriverChanges', [12, 12])).toBe(
      'raceHistory:getDriverChanges takes at most 1 argument(s)'
    );
    expect(await refusedWith('raceHistory:listRaces', [null])).toBe(
      'raceHistory:listRaces takes at most 0 argument(s)'
    );
    expect(await refusedWith('raceHistory:getEvents', [12, 801, 5000])).toBe(
      'raceHistory:getEvents takes at most 2 argument(s)'
    );
    expect(
      await refusedWith(
        'raceHistory:getCarLaps',
        Array.from({ length: 100_000 }, () => 7)
      )
    ).toBe('raceHistory:getCarLaps takes at most 2 argument(s)');

    untouched(source);
    // What was sent is not repeated in what comes back.
    expect(JSON.stringify(page.messages)).not.toContain('DROP TABLE');
  });

  it('answers what is not a list of arguments, or has no id, with an error', async () => {
    const { port, source } = await start();
    const page = await visit(port);

    for (const data of [undefined, null, 7, '7', { carIdx: 7 }, true]) {
      expect(await page.ask('raceHistory:getCarLaps', data)).toMatchObject({
        error: RACE_HISTORY_NO_ARGS,
      });
    }
    page.send('raceHistory:getCarLaps', [7]);
    page.send('raceHistory:getCarLaps', [7], 7);
    page.send('raceHistory:getCarLaps', [7], { id: 'a' });
    page.send('raceHistory:getCarLaps', [7], 'x'.repeat(65));
    await settled(page);

    expect(page.messages.filter((m) => m.error === RACE_HISTORY_NO_ID)).toEqual(
      Array.from({ length: 4 }, () => ({
        type: 'raceHistory:getCarLaps',
        requestId: null,
        error: RACE_HISTORY_NO_ID,
      }))
    );
    untouched(source);
  });

  it('knows no message that writes, deletes or clears, and no other raceHistory type', async () => {
    const { port, source } = await start();
    const page = await visit(port);
    const unknown = [
      'raceHistory:deleteRace',
      'raceHistory:removeRace',
      'raceHistory:clear',
      'raceHistory:clearHistory',
      'raceHistory:write',
      'raceHistory:saveRace',
      'raceHistory:setCarLaps',
      'raceHistory:updateCarLaps',
      'raceHistory:dispose',
      // Names an object has without being given them.
      'raceHistory:constructor',
      'raceHistory:__proto__',
      'raceHistory:toString',
      'raceHistory:hasOwnProperty',
      // Near misses of a read.
      'raceHistory:getCarLaps ',
      'raceHistory:GetCarLaps',
      'RaceHistory:getCarLaps',
      'raceHistory:',
      'raceHistory',
    ];

    for (const type of unknown) page.send(type, [7, 12], `u-${type}`);
    await settled(page);

    // Not answered at all, as any message the server does not know.
    expect(page.messages.filter((m) => m.type !== 'initialState')).toEqual([
      expect.objectContaining({ type: 'getAppVersion' }),
    ]);
    untouched(source);
    for (const type of unknown) {
      expect(logger.info).toHaveBeenCalledWith(
        'Bridge proxy: Unknown message type:',
        type
      );
    }
    // And the socket is as good as before.
    expect((await page.ask('raceHistory:getCarLaps', [7])).data).toMatchObject({
      revision: 7,
    });
  });
});

describe('a socket that asks faster than it is answered', () => {
  it(`has ${RACE_HISTORY_MAX_WAITING} reads held for it and is refused the rest`, async () => {
    const source = countingSource();
    const first = gate<RaceCarLaps>();
    source.getCarLaps.mockImplementationOnce(() => first.promise);
    const { port } = await start({ source });
    const page = await visit(port);
    const other = await visit(port);

    for (let n = 0; n < RACE_HISTORY_MAX_WAITING; n++) {
      page.send('raceHistory:getCarLaps', [n], `in-${n}`);
    }
    for (let n = 0; n < 3; n++) {
      page.send('raceHistory:getCarLaps', [n], `over-${n}`);
    }

    for (let n = 0; n < 3; n++) {
      expect(await page.reply('raceHistory:getCarLaps', `over-${n}`)).toEqual({
        type: 'raceHistory:getCarLaps',
        requestId: `over-${n}`,
        error: RACE_HISTORY_BUSY,
      });
    }
    // One read under way, the others waiting, and those refused not asked.
    expect(source.getCarLaps.mock.calls).toEqual([[0, undefined]]);
    // The cap is each socket's own: another page is answered meanwhile.
    expect(
      (await other.ask('raceHistory:getCarLaps', [99])).data
    ).toMatchObject({ revision: 99 });

    first.open({ laps: [], missingLaps: [], revision: 0 });
    await page.reply(
      'raceHistory:getCarLaps',
      `in-${RACE_HISTORY_MAX_WAITING - 1}`
    );

    // Everything that was taken is answered, in the order it was asked.
    expect(
      page.messages
        .map((m) => m.requestId)
        .filter((id) => typeof id === 'string' && id.startsWith('in-'))
    ).toEqual(
      Array.from({ length: RACE_HISTORY_MAX_WAITING }, (_, n) => `in-${n}`)
    );
    expect(source.getCarLaps).toHaveBeenCalledTimes(
      RACE_HISTORY_MAX_WAITING + 1
    );
    // With room again, the page is answered again.
    expect((await page.ask('raceHistory:getCarLaps', [5])).data).toMatchObject({
      revision: 5,
    });
  });
});

describe('a socket that closes with reads waiting', () => {
  it('is read for no further, and the next page is answered as usual', async () => {
    const source = countingSource();
    const first = gate<RaceCarLaps>();
    source.getCarLaps.mockImplementationOnce(() => first.promise);
    const { port } = await start({ source });
    const page = await visit(port);
    page.send('raceHistory:getCarLaps', [1], 'a');
    page.send('raceHistory:getCarLaps', [2], 'b');
    page.send('raceHistory:getCarStints', [3], 'c');
    await settled(page);

    // Gone without a goodbye, as a tablet out of range goes.
    page.socket.terminate();
    await page.closed;
    await idle();
    first.open({ laps: [], missingLaps: [], revision: 1 });
    await idle();

    // The read under way was asked; the two behind it never are.
    expect(source.getCarLaps).toHaveBeenCalledTimes(1);
    expect(source.getCarStints).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();

    const next = await visit(port);
    expect((await next.ask('raceHistory:getCarLaps', [9])).data).toMatchObject({
      revision: 9,
    });
  });
});

describe('a page’s subscription as a reason to record the race', () => {
  /** A window of the app's own, as the channel bridge hands one to the bus. */
  const windowTarget = (id: number): RendererTarget => ({
    id,
    isDestroyed: () => false,
    isVisible: () => true,
    send: () => undefined,
  });

  it.each(DEMAND_CHANNELS)(
    'counts a socket that reads %s exactly as it counts a window',
    async (channel) => {
      const { port, bus, demand } = await start();
      const page = await visit(port);
      expect(demand.mock.calls).toEqual([[false]]);

      page.send('channelSubscribe', { channel, requestedRateHz: 1 });
      await settled(page);

      expect(bus.subscriberCount(channel)).toBe(1);
      expect(demand.mock.calls).toEqual([[false], [true]]);

      // A window beside it is one more of the same, and no more than that.
      bus.subscribe(windowTarget(1), channel, 1);
      expect(bus.subscriberCount(channel)).toBe(2);
      bus.removeRenderer(1);
      expect(bus.subscriberCount(channel)).toBe(1);
      expect(demand.mock.calls).toEqual([[false], [true]]);

      page.send('channelUnsubscribe', { channel });
      await settled(page);

      expect(bus.subscriberCount(channel)).toBe(0);
      expect(demand.mock.calls).toEqual([[false], [true], [false]]);
    }
  );

  it.each(DEMAND_CHANNELS)(
    'stops counting a reader of %s when its socket closes',
    async (channel) => {
      const { port, bus, demand } = await start();
      const page = await visit(port);
      page.send('channelSubscribe', { channel, requestedRateHz: 1 });
      await settled(page);
      expect(demand).toHaveBeenLastCalledWith(true);

      page.socket.close();
      await page.closed;

      await vi.waitFor(() => expect(demand).toHaveBeenLastCalledWith(false));
      expect(bus.registeredSubscriberCount(channel)).toBe(0);
    }
  );

  it('stops counting when the socket is gone without a goodbye, whatever it read', async () => {
    const { port, bus, demand } = await start();
    const page = await visit(port);
    for (const channel of DEMAND_CHANNELS) {
      page.send('channelSubscribe', { channel, requestedRateHz: 1 });
    }
    await settled(page);
    expect(
      DEMAND_CHANNELS.map((channel) => bus.subscriberCount(channel))
    ).toEqual([1, 1]);

    page.socket.terminate();

    await vi.waitFor(() => expect(demand).toHaveBeenLastCalledWith(false));
    expect(demand.mock.calls).toEqual([[false], [true], [false]]);
    for (const channel of DEMAND_CHANNELS) {
      expect(bus.registeredSubscriberCount(channel)).toBe(0);
    }
  });

  it('goes on recording for the page that stays when another leaves', async () => {
    const { port, bus, demand } = await start();
    const staying = await visit(port);
    const leaving = await visit(port, { from: TABLET, cookie: KEY });
    for (const page of [staying, leaving]) {
      page.send('channelSubscribe', {
        channel: 'race-history.summary',
        requestedRateHz: 1,
      });
      await settled(page);
    }
    expect(bus.subscriberCount('race-history.summary')).toBe(2);

    leaving.socket.close();
    await leaving.closed;
    await vi.waitFor(() =>
      expect(bus.subscriberCount('race-history.summary')).toBe(1)
    );

    expect(demand.mock.calls).toEqual([[false], [true]]);
  });

  it('stops counting a device whose key was replaced', async () => {
    const { port, bus, demand, devices } = await start();
    const tablet = await visit(port, { from: TABLET, cookie: KEY });
    tablet.send('channelSubscribe', {
      channel: 'race-history.summary',
      requestedRateHz: 1,
    });
    await settled(tablet);
    expect(demand).toHaveBeenLastCalledWith(true);

    await devices.replaceKey();
    await tablet.closed;

    await vi.waitFor(() => expect(demand).toHaveBeenLastCalledWith(false));
    expect(bus.registeredSubscriberCount('race-history.summary')).toBe(0);
  });

  it('starts nothing for a read alone', async () => {
    const { port, demand } = await start();
    const page = await visit(port);

    for (const [type, args] of READS) await page.ask(type, args);

    expect(demand.mock.calls).toEqual([[false]]);
  });
});

describe('the real race history behind the socket', () => {
  const T0 = Date.UTC(2026, 10, 17, 12, 0, 0);
  let file: RaceHistoryFile | undefined;

  afterEach(() => {
    file?.close();
    file = undefined;
  });

  /** The runtime on a file of its own, wired to demand as the app wires it. */
  const startRecording = async () => {
    file = openRaceHistoryFile();
    let wall = T0;
    const bus = new ChannelBus({
      now: () => wall,
      // Nothing is held back for later: the runtime publishes no more than
      // once a second, which is the channels' own rate.
      schedule: () => ({ cancel: () => undefined }),
    });
    const metrics = { markStart: vi.fn(), markEnd: vi.fn() };
    const runtime = new RaceHistoryRuntime(
      bus,
      createSessionLifecycle(),
      metrics,
      file.openStore(),
      {
        simulator: () => 'lmu',
        sessionIdsAreUnique: () => false,
        now: () => wall,
        bootId: 'spec',
      }
    );
    // In the app's order: whether anything wants the record is known
    // before the first session arrives.
    const staged = await start({
      runtime,
      bus,
      onDemand: (needed) => runtime.updateEnabled(needed),
    });
    const field = new Field({ lmu: true });
    runtime.onSession(field.session());
    return {
      ...staged,
      runtime,
      metrics,
      /** Staged frames: a small field lapping, see raceHistoryFixture.ts. */
      lap: (laps: number) =>
        driveLaps(
          field,
          {
            onFrame: (frame) => {
              wall = T0 + field.time * 1000;
              runtime.onFrame(frame);
            },
          },
          0,
          laps
        ),
    };
  };

  it('answers empty with nothing recorded, and reads no frame for having been asked', async () => {
    const { port, runtime, metrics, demand, lap } = await startRecording();
    const page = await visit(port);

    const before = [];
    for (const [type, args] of [
      ['raceHistory:getCarLaps', [0]],
      ['raceHistory:getCarStints', [0]],
      ['raceHistory:getDriverChanges', []],
      ['raceHistory:listRaces', []],
      ['raceHistory:getEvents', []],
    ] as const) {
      before.push((await page.ask(type, args)).data);
    }
    lap(2);
    const after = (await page.ask('raceHistory:getCarLaps', [0])).data;

    expect(before).toEqual([
      { laps: [], missingLaps: [], revision: 0 },
      [],
      [],
      [],
      [],
    ]);
    // Nobody reads its channels and the Pit Wall is off: two laps went by
    // and none of them was read, asked about or not.
    expect(after).toEqual({ laps: [], missingLaps: [], revision: 0 });
    expect(demand.mock.calls).toEqual([[false]]);
    expect(metrics.markStart).not.toHaveBeenCalled();
    expect(runtime.currentRace()).toBeNull();
  });

  it('records for a page that reads the summary, and answers it what a window is answered', async () => {
    const { port, runtime, lap } = await startRecording();
    const page = await visit(port);
    page.send('channelSubscribe', {
      channel: 'race-history.summary',
      requestedRateHz: 1,
    });
    await settled(page);

    lap(3);
    await settled(page);

    // The summary reached the page, and says the car's records have moved.
    const summaries = page.messages
      .filter((m) => m.type === 'channel')
      .map(
        (m) =>
          (m.data as { channel: string; payload: RaceHistorySummarySnapshot })
            .payload
      );
    const latest = summaries.at(-1);
    expect(latest?.raceToken).not.toBe('');
    expect(latest?.laps[0]).toBeGreaterThanOrEqual(2);

    // Asked the way the shared hook asks: the laps and the stints of a car.
    const laps = (await page.ask('raceHistory:getCarLaps', [0])).data;
    const stints = (await page.ask('raceHistory:getCarStints', [0])).data;
    const bridge = createRaceHistoryBridge(runtime);

    // What crossed the socket is what the IPC road hands a window.
    expect(laps).toEqual(
      JSON.parse(JSON.stringify(await bridge.getCarLaps(0)))
    );
    expect(stints).toEqual(
      JSON.parse(JSON.stringify(await bridge.getCarStints(0)))
    );
    expect((laps as RaceCarLaps).laps.length).toBeGreaterThanOrEqual(2);
    expect((laps as RaceCarLaps).laps[0]).toMatchObject({ carIdx: 0, lap: 1 });
  });
});
