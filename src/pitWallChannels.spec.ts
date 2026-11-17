import { EventEmitter } from 'node:events';
import { Server } from 'node:http';
import { createElement, type ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { WebSocket as ServerWebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHANNEL_SUBSCRIBE,
  ChannelBus,
  setupChannelBridge,
} from './app/bridge/channelBridge';
import { createChannelRendererBridge } from './app/bridge/channelRendererBridge';
import logger from './app/logger';
import { ClassTyresRuntime } from './app/processors/classTyresRuntime';
import {
  PlayerLedgerRuntime,
  type PlayerLedgerPersistence,
} from './app/processors/playerLedgerRuntime';
import { createDefaultProcessorHost } from './app/processors/processorRegistry';
import {
  RaceHistoryRuntime,
  type RaceHistoryPersistence,
} from './app/processors/raceHistoryRuntime';
import { watchRaceHistoryDemand } from './app/raceHistoryDemand';
import { createSessionLifecycle } from './app/sessionLifecycle';
import { createBridgeProxy } from './app/webserver/bridgeProxy';
import { WebSocketBridge } from './app/webserver/componentRenderer';
import { getChannelSnapshotStore } from './frontend/context/ChannelStore/ChannelSnapshotStore';
import { getWidget } from './frontend/WidgetIndex';
import {
  getWidgetRuntimeDefinition,
  useWidgetChannelRate,
  WidgetRuntimeProvider,
} from './frontend/widgetRuntime';
import {
  channelRegistry,
  DEFAULT_SIM_WIDGET_SUPPORT,
  KNOWN_WIDGET_IDS,
  PIT_WALL_HOSTED_WIDGETS,
  PIT_WALL_LAYOUT_LIST,
  PIT_WALL_WIDGET_ID,
  pitWallTabSlots,
} from './types';
import type {
  ChannelBridge,
  ChannelName,
  DashboardLayout,
  IrSdkSourceBridge,
  PitLaneCalibration,
} from './types';

/**
 * The Pit Wall shows the app's widgets in two places: a window of the app,
 * which is fed over IPC, and a page served to a browser, which is fed over a
 * socket. A widget reads its channels the same way in both, through
 * `window.channelBridge`, and neither side may import the other, so nothing
 * but a spec above both can hold the two roads to what the widgets declare.
 *
 * Each road is driven from end to end with the code the app runs at every
 * step, and only the wire between the two processes is stood in for:
 *
 * - the window: the preload's bridge, the main process's handler, the bus;
 * - the browser: the page's socket bridge, the server's proxy, the same bus.
 *
 * What publishes is real as well: the processors under their host and the
 * three runtimes beside it, composed by hand the way `src/main.ts` and the
 * simulator bridges compose them, because that file starts the app when it
 * is imported.
 *
 * Which channels a widget reads is taken from its runtime definition, and
 * the layouts from `src/types/pitWall.ts`, so a panel or a channel added to
 * either is covered without a line here.
 */

type IpcHandler = (event: { sender: unknown }, ...args: unknown[]) => unknown;
type IpcListener = (event: unknown, ...args: unknown[]) => void;

/** The wire between a window and the main process, and the window itself. */
const ipc = vi.hoisted(() => {
  const wire = {
    /** What the main process answers, by IPC channel. */
    handlers: new Map<string, IpcHandler>(),
    /** What the window listens for, by IPC channel. */
    listeners: new Map<string, IpcListener>(),
    /** What the main process listens for on the window: show, hide. */
    windowListeners: new Map<string, () => void>(),
    visible: true,
    /** Every request the window made, as it was sent. */
    invoked: [] as unknown[][],
    /** What a handler threw at a request. */
    refused: [] as unknown[],
    sender: {
      id: 7,
      isDestroyed: () => false,
      once: () => undefined,
      send: (channel: string, ...args: unknown[]) =>
        wire.listeners.get(channel)?.({}, ...args),
    },
  };
  return wire;
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: IpcHandler) =>
      ipc.handlers.set(channel, handler),
    removeHandler: (channel: string) => ipc.handlers.delete(channel),
  },
  ipcRenderer: {
    on: (channel: string, listener: IpcListener) =>
      ipc.listeners.set(channel, listener),
    invoke: (channel: string, ...args: unknown[]) => {
      ipc.invoked.push([channel, ...args]);
      try {
        const handler = ipc.handlers.get(channel);
        if (!handler) throw new Error(`No handler registered for ${channel}`);
        return Promise.resolve(handler({ sender: ipc.sender }, ...args));
      } catch (error) {
        // Electron rejects the window's promise, which the bridge does not
        // wait for. Kept here instead, so a spec can say nothing was refused.
        ipc.refused.push(error);
        return Promise.resolve(undefined);
      }
    },
  },
  BrowserWindow: {
    fromWebContents: () => ({
      isVisible: () => ipc.visible,
      on: (event: string, listener: () => void) =>
        ipc.windowListeners.set(event, listener),
      removeListener: (event: string) => ipc.windowListeners.delete(event),
    }),
  },
  contextBridge: { exposeInMainWorld: vi.fn() },
}));

// The proxy's own message handling, without a network under it.
vi.mock('ws', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ws')>();
  const { EventEmitter } = await import('node:events');
  return { ...actual, WebSocketServer: class extends EventEmitter {} };
});
vi.mock('./app/bridge/iracingSdk/setup', () => ({
  getActiveSimulator: () => 'lmu',
  getIsDemoMode: () => false,
  onActiveSimulatorChanged: vi.fn(),
}));
vi.mock('./app/bridge/iracingSdk/sims/registry', () => ({
  getAvailableSimulators: () => ['lmu'],
}));
vi.mock('./app/storage/simWidgetSupport', () => ({
  loadSimWidgetSupport: vi.fn(),
}));
vi.mock('./app/widgetVisibility', () => ({
  getHiddenWidgets: () => [],
  onWidgetHiddenChanged: vi.fn(),
}));
vi.mock('./app/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

/** The page's header and every widget some tab of some layout hosts. */
const PAGE_AND_PANELS: readonly string[] = [
  PIT_WALL_WIDGET_ID,
  ...PIT_WALL_HOSTED_WIDGETS,
];

interface Reading {
  widget: string;
  channel: ChannelName;
}

const channelsOf = (widget: string): readonly ChannelName[] =>
  getWidgetRuntimeDefinition(widget).channels ?? [];

/** Every channel a runtime definition names, with the widget that names it. */
const READINGS: Reading[] = PAGE_AND_PANELS.flatMap((widget) =>
  channelsOf(widget).map((channel) => ({ widget, channel }))
);

/** Every tab of every layout, with what its panels and the header read. */
const TABS = PIT_WALL_LAYOUT_LIST.flatMap((layout) =>
  layout.tabs.map((tab) => ({
    layout: layout.id,
    tab: tab.id,
    readings: [
      PIT_WALL_WIDGET_ID,
      ...pitWallTabSlots(tab).map((slot) => slot.widget),
    ].flatMap((widget) =>
      channelsOf(widget).map((channel): Reading => ({ widget, channel }))
    ),
  }))
);

/**
 * The channels made from the race's record, which the race is recorded for
 * as long as one of them has a reader. `watchRaceHistoryDemand` keeps its
 * list to itself (`CHANNELS` in `src/app/raceHistoryDemand.ts`), so it is
 * said again here.
 */
const RECORD_CHANNELS = [
  'race-history.summary',
  'race-log.snapshot',
  'class-tyres.snapshot',
] as const satisfies readonly ChannelName[];

/**
 * The rate a hook of the widget asks a channel for, from the widget's own
 * definition by the rule the hooks use; undefined asks for the channel's.
 */
const rateOf = ({ widget, channel }: Reading): number | undefined =>
  renderHook(() => useWidgetChannelRate(channel), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(WidgetRuntimeProvider, { widgetType: widget, children }),
  }).result.current;

/** What both bridges put on the wire for a reader that names no rate. */
const requestedRate = (reading: Reading): number | undefined => {
  const definition = channelRegistry[reading.channel];
  return (
    rateOf(reading) ??
    (definition.kind === 'snapshot' ? definition.defaultRateHz : undefined)
  );
};

/**
 * The bus holds a snapshot back until the reader's rate allows another. The
 * slowest any widget asks for is once a second, so a minute on the bus's
 * clock is past the wait at any rate one could sensibly be given.
 */
const PAST_ANY_RATE_MS = 60_000;

/** The bus's clock, moved by the specs, with what it has put off. */
class Clock {
  now = 0;
  private tasks: { at: number; callback: () => void; cancelled: boolean }[] =
    [];

  schedule = (callback: () => void, delayMs: number) => {
    const task = { at: this.now + delayMs, callback, cancelled: false };
    this.tasks.push(task);
    return { cancel: () => (task.cancelled = true) };
  };

  advance(ms: number): void {
    this.now += ms;
    const due = this.tasks
      .filter((task) => !task.cancelled && task.at <= this.now)
      .sort((a, b) => a.at - b.at);
    this.tasks = this.tasks.filter((task) => !due.includes(task));
    for (const task of due) task.callback();
  }
}

/** Storage that keeps nothing: no race is driven here. */
const noRaceStored: RaceHistoryPersistence = {
  queueLap: () => undefined,
  queueStint: () => undefined,
  queueDriverChange: () => undefined,
  queueEvent: () => undefined,
  queueEventsRemoved: () => undefined,
  queueInfo: () => undefined,
  queueCarReplaced: () => undefined,
  flush: () => Promise.resolve(),
  onStored: () => () => undefined,
  findCandidates: () => Promise.resolve([]),
  load: () => Promise.resolve(null),
  listRaces: () => Promise.resolve([]),
  carLaps: () => Promise.resolve([]),
  carStints: () => Promise.resolve([]),
  driverChanges: () => Promise.resolve([]),
  events: () => Promise.resolve([]),
};

const noLapStored: PlayerLedgerPersistence = {
  recordLap: () => Promise.resolve(null),
  upsertStint: () => undefined,
  recentLedgerLaps: () => Promise.resolve([]),
};

const noSimulator: IrSdkSourceBridge = {
  onTelemetry: () => () => undefined,
  onSessionData: () => () => undefined,
  onRunningState: () => () => undefined,
  stop: () => undefined,
  changeCameraNumber: () => undefined,
  changeReplayPosition: () => undefined,
  triggerReplaySessionSearch: () => undefined,
};

/** A profile whose Pit Wall is switched off: only a reader is a reason. */
const PIT_WALL_OFF: DashboardLayout = {
  widgets: [
    {
      id: PIT_WALL_WIDGET_ID,
      enabled: false,
      layout: { x: 0, y: 0, width: 100, height: 100 },
    },
  ],
};

/** What a case has started, to be let go of when it is over. */
const started: (() => void)[] = [];

/**
 * The main process as far as channels go: the bus and everything that
 * publishes on it for the Pit Wall, wired as the app wires it.
 *
 * - The processors, under the host every simulator bridge makes with
 *   `createDefaultProcessorHost`.
 * - The race history, which publishes its summary and the race's log, and
 *   is switched on and off by `watchRaceHistoryDemand` (`setupRaceHistory`
 *   in `src/main.ts`).
 * - The class tyres, which follow the race history (`setupClassTyres`).
 * - The player's ledger, which publishes the wear forecast
 *   (`setupLapLibraryRecording`).
 *
 * No session and no frame is fed. A processor and a runtime each send a
 * window that arrives what they hold, which is all that is asked of them
 * here: that somebody answers on the channel.
 */
const startMainProcess = () => {
  const clock = new Clock();
  const bus = new ChannelBus({
    now: () => clock.now,
    schedule: clock.schedule,
  });
  const lifecycle = createSessionLifecycle();
  const metrics = { markStart: () => undefined, markEnd: () => undefined };
  const host = createDefaultProcessorHost({
    bus,
    lifecycle,
    metrics,
    referenceLapPersistence: { load: () => null, save: () => undefined },
  });
  const raceHistory = new RaceHistoryRuntime(
    bus,
    lifecycle,
    metrics,
    noRaceStored,
    {
      simulator: () => 'lmu',
      sessionIdsAreUnique: () => false,
      now: () => clock.now,
      bootId: 'spec',
    }
  );
  const stopWatching = watchRaceHistoryDemand({
    bus,
    initialLayout: PIT_WALL_OFF,
    onDashboardUpdated: () => undefined,
    getSimulator: () => 'lmu',
    onSimulatorChanged: () => undefined,
    getSupport: () => DEFAULT_SIM_WIDGET_SUPPORT,
    onChange: (needed) => raceHistory.updateEnabled(needed),
  });
  const classTyres = new ClassTyresRuntime(
    bus,
    lifecycle,
    metrics,
    {
      recording: raceHistory.records.recording,
      history: raceHistory.records,
      own: () => undefined,
      tuning: () => ({ tyreChangeSeconds: 0 }),
    },
    { now: () => clock.now }
  );
  const ledger = new PlayerLedgerRuntime(bus, lifecycle, metrics, noLapStored, {
    simulator: 'lmu',
    bootId: 'spec',
    now: () => clock.now,
  });

  started.push(() => {
    stopWatching();
    ledger.dispose();
    classTyres.dispose();
    raceHistory.dispose();
    host.dispose();
    bus.dispose();
  });

  return {
    bus,
    /** Lets the bus deliver the next snapshot of any channel at once. */
    wait: () => clock.advance(PAST_ANY_RATE_MS),
    /** How often the channel has been published on, by anybody. */
    publications: (channel: ChannelName): number =>
      bus.metricsSnapshot().channelPublications[channel] ?? 0,
    /** The race history is reading frames. */
    recording: (): boolean => raceHistory.records.recording(),
  };
};

type MainProcess = ReturnType<typeof startMainProcess>;

/**
 * Publishes something a publisher never would, so that what arrives can be
 * told from what the publisher sent on its own.
 */
const publishMarker = (main: MainProcess, channel: ChannelName, id: string) => {
  const marker = { marker: id };
  // As a plain string: the marker is not the channel's payload.
  main.bus.publish(channel as string, marker);
  return marker;
};

/**
 * The Pit Wall's window: `window.channelBridge` as the preload makes it, on
 * a wire to the handlers `setupChannelBridge` installs.
 */
const openWindow = (main: MainProcess) => {
  started.push(setupChannelBridge(main.bus));
  const bridge = createChannelRendererBridge();
  return {
    bridge,
    hide: () => {
      ipc.visible = false;
      ipc.windowListeners.get('hide')?.();
    },
    show: () => {
      ipc.visible = true;
      ipc.windowListeners.get('show')?.();
    },
  };
};

/** The page's end of its socket: what `new WebSocket(url)` hands the bridge. */
class PageSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static latest?: PageSocket;

  readyState = PageSocket.OPEN;
  onopen?: () => void;
  onmessage?: (event: MessageEvent) => void;
  onerror?: (event: Event) => void;
  onclose?: (event?: CloseEvent) => void;
  /** Every message the page sent, parsed. */
  readonly sent: { type: string; data?: unknown }[] = [];
  /** Where a message goes once the server has taken the connection. */
  toServer?: (message: string) => void;

  constructor(readonly url: string) {
    PageSocket.latest = this;
  }

  send(message: string): void {
    this.sent.push(JSON.parse(message));
    this.toServer?.(message);
  }

  close(): void {
    this.readyState = PageSocket.CLOSED;
  }

  addEventListener(): void {
    // Only the bridge's request and answer calls listen this way.
  }

  removeEventListener(): void {
    // See addEventListener.
  }
}

/** The server's end of the same socket, as the proxy is handed it. */
class ServerSocket extends EventEmitter {
  readyState: number = ServerWebSocket.OPEN;
  /** Every message the server sent, parsed. */
  readonly sent: { type: string; data?: unknown }[] = [];

  constructor(private readonly page: PageSocket) {
    super();
    page.toServer = (message) => this.emit('message', Buffer.from(message));
  }

  send(message: string): void {
    this.sent.push(JSON.parse(message));
    this.page.onmessage?.({ data: message } as MessageEvent);
  }
}

/**
 * The Pit Wall's page in a browser: `window.channelBridge` as
 * `dashboard-view-entry.tsx` sets it, a `WebSocketBridge` that has
 * connected, on a socket whose other end the server's proxy has taken.
 */
const openBrowserPage = async (main: MainProcess) => {
  const proxy = createBridgeProxy(
    new Server(),
    noSimulator,
    undefined,
    main.bus
  );
  vi.stubGlobal('WebSocket', PageSocket);
  const bridge = new WebSocketBridge();
  const connecting = bridge.connect('http://localhost:3000');
  const page = PageSocket.latest;
  if (!page) throw new Error('The bridge opened no socket');
  const server = new ServerSocket(page);
  proxy.wss.emit('connection', server);
  page.onopen?.();
  await connecting;
  started.push(() => bridge.stop());
  return { bridge, page, server };
};

/**
 * Subscribes the way the renderer's channel store does for a hook, with one
 * callback and the rate the hook was given, and keeps what arrives.
 */
const read = (
  bridge: ChannelBridge,
  channel: ChannelName,
  rate: number | undefined
) => {
  const received: unknown[] = [];
  const stop = bridge.subscribe(
    channel,
    (payload) => {
      received.push(payload);
    },
    rate
  );
  return { received, stop };
};

/**
 * Reads a channel through the store the hooks of a renderer share, one for
 * a channel and a bridge, which is what hands a second reader of a channel
 * the snapshot the first one was sent.
 */
const hold = (bridge: ChannelBridge, reading: Reading) => {
  const selection = getChannelSnapshotStore(
    reading.channel,
    bridge
  ).createSelection((snapshot) => snapshot, Object.is, rateOf(reading));
  started.push(selection.subscribe(() => undefined));
  return selection;
};

beforeEach(() => {
  ipc.handlers.clear();
  ipc.listeners.clear();
  ipc.windowListeners.clear();
  ipc.visible = true;
  ipc.invoked.length = 0;
  ipc.refused.length = 0;
  PageSocket.latest = undefined;
  vi.clearAllMocks();
});

afterEach(() => {
  started.splice(0).forEach((stop) => stop());
  vi.unstubAllGlobals();
});

describe('what the Pit Wall hosts', () => {
  it('is something, so that the cases below are about a page', () => {
    // A list that came out empty would leave every case made from it out
    // of the run, and the run green.
    expect(PIT_WALL_HOSTED_WIDGETS).not.toEqual([]);
    expect(TABS).not.toEqual([]);
    expect(READINGS).not.toEqual([]);
  });

  it.each(PAGE_AND_PANELS)(
    '%s says what it reads in a runtime definition of its own',
    (widget) => {
      // A widget with none is given the default one, which names no channel
      // and no session: every figure of its panel would be read at whatever
      // rate the page's header happens to use.
      expect(getWidgetRuntimeDefinition(widget).id).toBe(widget);
      expect(channelsOf(widget).length).toBeGreaterThan(0);
    }
  );

  it.each(PAGE_AND_PANELS)('%s is a widget the app knows', (widget) => {
    expect(KNOWN_WIDGET_IDS).toContain(widget);
    // What a panel is drawn through. A type with no component draws nothing
    // and says nothing.
    expect(getWidget(widget)).toBeDefined();
  });
});

describe('who publishes what the Pit Wall reads', () => {
  it.each(READINGS)(
    '$channel, which $widget reads, is a channel somebody answers on',
    ({ channel }) => {
      // Both bridges refuse a name the registry does not have.
      expect(channelRegistry[channel]).toBeDefined();

      const main = startMainProcess();
      const win = openWindow(main);
      expect(main.publications(channel)).toBe(0);

      const reader = read(win.bridge, channel, undefined);

      // Nothing was published by this spec: a processor or a runtime of the
      // main process sent the window what it holds.
      expect(main.publications(channel)).toBeGreaterThan(0);
      expect(reader.received).toHaveLength(1);
      expect(reader.received[0]).toBeDefined();
    }
  );
});

describe('the Pit Wall window', () => {
  it.each(READINGS)(
    '$widget is sent $channel while the window is on screen',
    (reading) => {
      const { channel } = reading;
      const main = startMainProcess();
      const win = openWindow(main);

      const reader = read(win.bridge, channel, rateOf(reading));

      // At the widget's own rate, and taken: a rate the bus refuses would
      // leave the panel with nothing and no word of why.
      expect(ipc.invoked).toEqual([
        [CHANNEL_SUBSCRIBE, channel, requestedRate(reading)],
      ]);
      expect(ipc.refused).toEqual([]);
      expect(main.bus.subscriberCount(channel)).toBe(1);
      // What the publisher holds, sent as the window arrives.
      expect(reader.received).toHaveLength(1);

      main.wait();
      const marker = publishMarker(main, channel, 'on screen');
      expect(reader.received).toHaveLength(2);
      expect(reader.received[1]).toBe(marker);
    }
  );

  it.each(READINGS)(
    '$widget is sent no $channel while the window is hidden, and is caught up when it is shown',
    (reading) => {
      const { channel } = reading;
      const main = startMainProcess();
      const win = openWindow(main);
      const reader = read(win.bridge, channel, rateOf(reading));
      expect(reader.received).toHaveLength(1);

      // Rule R4.6: a window nobody sees is no demand, though it is still
      // subscribed, and is sent no snapshot.
      win.hide();
      expect(main.bus.subscriberCount(channel)).toBe(0);
      expect(main.bus.registeredSubscriberCount(channel)).toBe(1);
      main.wait();
      publishMarker(main, channel, 'hidden');
      expect(reader.received).toHaveLength(1);

      // Back on screen it is demand again, and its publisher sends it what
      // it holds now.
      win.show();
      expect(main.bus.subscriberCount(channel)).toBe(1);
      expect(reader.received).toHaveLength(2);
      expect(reader.received[1]).toBeDefined();
    }
  );
});

describe('the Pit Wall page in a browser', () => {
  it.each(READINGS)(
    '$widget is sent $channel over the socket',
    async (reading) => {
      const { channel } = reading;
      const main = startMainProcess();
      const { bridge, page, server } = await openBrowserPage(main);

      const reader = read(bridge, channel, rateOf(reading));

      // The page asked, at the widget's own rate, and the server took it:
      // the proxy logs what it refuses and carries on.
      expect(page.sent).toEqual([
        {
          type: 'channelSubscribe',
          data: { channel, requestedRateHz: requestedRate(reading) },
        },
      ]);
      expect(logger.error).not.toHaveBeenCalled();
      expect(main.bus.subscriberCount(channel)).toBe(1);
      // What the publisher holds, sent as the page arrives.
      expect(reader.received).toHaveLength(1);

      main.wait();
      const marker = publishMarker(main, channel, 'over the socket');
      expect(server.sent.at(-1)).toEqual({
        type: 'channel',
        data: { channel, payload: marker },
      });
      expect(reader.received).toHaveLength(2);
      expect(reader.received[1]).toEqual(marker);
    }
  );
});

describe('a whole tab of the Pit Wall', () => {
  it.each(TABS)(
    'the $tab tab of the $layout layout holds all it reads, in the window and in a browser alike',
    async ({ readings }) => {
      const main = startMainProcess();
      const win = openWindow(main);
      const { bridge } = await openBrowserPage(main);

      // The header and every panel at once, through one bridge each, as
      // the page mounts them.
      const inWindow = readings.map((reading) => hold(win.bridge, reading));
      const inBrowser = readings.map((reading) => hold(bridge, reading));

      expect(ipc.refused).toEqual([]);
      expect(logger.error).not.toHaveBeenCalled();
      readings.forEach(({ widget, channel }, index) => {
        const held = inWindow[index].getSnapshot();
        expect(held, `${widget} reading ${channel}`).toBeDefined();
        // The socket carries JSON. What a publisher holds before a session
        // has to come through it as the window has it.
        expect(
          inBrowser[index].getSnapshot(),
          `${widget} reading ${channel} in a browser`
        ).toEqual(held);
      });
    }
  );
});

describe('the race recorded for a panel that reads it', () => {
  it.each(RECORD_CHANNELS)('%s is read by a panel', (channel) => {
    // The day no panel reads one of them, its cases below prove nothing
    // about the Pit Wall and are to go.
    expect(READINGS.map((reading) => reading.channel)).toContain(channel);
  });

  it.each(RECORD_CHANNELS)(
    'a panel reading %s in the window has the race recorded',
    (channel) => {
      // The Pit Wall is switched off in this profile, so that nothing but
      // a reader is a reason to record.
      const main = startMainProcess();
      const win = openWindow(main);
      expect(main.recording()).toBe(false);

      const reader = read(win.bridge, channel, undefined);
      expect(main.recording()).toBe(true);

      // A hidden window is no reader (rule R4.6). The race goes on being
      // recorded behind a minimised Pit Wall because the Pit Wall is
      // switched on, which is a reason of its own.
      win.hide();
      expect(main.recording()).toBe(false);
      win.show();
      expect(main.recording()).toBe(true);

      reader.stop();
      expect(main.recording()).toBe(false);
    }
  );

  it.each(RECORD_CHANNELS)(
    'a panel reading %s in a browser has the race recorded',
    async (channel) => {
      // As a page served to a tablet does, with the Pit Wall off on the
      // desktop.
      const main = startMainProcess();
      const { bridge } = await openBrowserPage(main);
      expect(main.recording()).toBe(false);

      const reader = read(bridge, channel, undefined);
      expect(main.recording()).toBe(true);

      reader.stop();
      expect(main.recording()).toBe(false);
    }
  );
});

describe('the pit lane a panel measures by', () => {
  /**
   * `pit-lane.reset` is read by no widget and named by no runtime
   * definition: `PitLaneProvider` reads it for a widget whose definition
   * sets `pitLaneData`, which the Timing Tower's does. It is an event,
   * published by `createPitLaneBridge` (`src/app/bridge/pitLaneBridge.ts`)
   * when the settings window resets a track or reloads the file, so nothing
   * answers a reader that arrives and the reset is published by hand here.
   */
  const CHANNEL = 'pit-lane.reset';
  const reset = (revision: number): PitLaneCalibration => ({
    trackId: '47',
    sourceId: 'spec',
    revision,
    data: null,
  });

  it('is asked for by a panel the Pit Wall hosts', () => {
    // The day none does, the two cases below are about no panel.
    expect(
      PAGE_AND_PANELS.filter(
        (widget) => getWidgetRuntimeDefinition(widget).pitLaneData === true
      )
    ).not.toEqual([]);
  });

  it('is reset in the window, on screen or not', () => {
    const main = startMainProcess();
    const win = openWindow(main);

    // No rate: the bus refuses one for an event.
    const reader = read(win.bridge, CHANNEL, undefined);
    expect(ipc.invoked).toEqual([[CHANNEL_SUBSCRIBE, CHANNEL, undefined]]);
    expect(ipc.refused).toEqual([]);
    expect(reader.received).toEqual([]);

    const first = reset(1);
    main.bus.publish(CHANNEL, first);
    expect(reader.received).toEqual([first]);

    // An event missed is lost for good, so a hidden window is sent it.
    win.hide();
    const second = reset(2);
    main.bus.publish(CHANNEL, second);
    expect(reader.received).toEqual([first, second]);
  });

  it('is reset in a browser', async () => {
    const main = startMainProcess();
    const { bridge, page } = await openBrowserPage(main);

    const reader = read(bridge, CHANNEL, undefined);
    expect(page.sent).toEqual([
      { type: 'channelSubscribe', data: { channel: CHANNEL } },
    ]);
    expect(logger.error).not.toHaveBeenCalled();

    main.bus.publish(CHANNEL, reset(1));
    expect(reader.received).toEqual([reset(1)]);
  });
});
