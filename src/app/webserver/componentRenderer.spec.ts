import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SIM_WIDGET_SUPPORT,
  type FuelProjectionSnapshot,
  type RacePlanState,
} from '@irdashies/types';
import { WebSocketBridge } from './componentRenderer';

class FakeWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static latest?: FakeWebSocket;

  readonly sent: string[] = [];
  readyState = FakeWebSocket.OPEN;
  onopen?: () => void;
  onmessage?: (event: MessageEvent) => void;
  onerror?: (event: Event) => void;
  onclose?: (event?: CloseEvent) => void;

  constructor(readonly url: string) {
    FakeWebSocket.latest = this;
  }

  send(message: string): void {
    this.sent.push(message);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
  }

  /** One-shot handlers registered by the bridge's request/response helper. */
  readonly listeners = new Set<(event: MessageEvent) => void>();

  addEventListener = vi.fn(
    (_: string, handler: (event: MessageEvent) => void) => {
      this.listeners.add(handler);
    }
  );

  removeEventListener = vi.fn(
    (_: string, handler: (event: MessageEvent) => void) => {
      this.listeners.delete(handler);
    }
  );

  /** Delivers a server message to the socket handler and the one-shot ones. */
  deliver(message: unknown): void {
    const event = { data: JSON.stringify(message) } as MessageEvent;
    this.onmessage?.(event);
    [...this.listeners].forEach((handler) => handler(event));
  }

  /** Answers the last request of `type` the way the bridge proxy would. */
  reply(type: string, data: unknown): void {
    const request = [...this.sent]
      .reverse()
      .map((message) => JSON.parse(message))
      .find((message) => message.type === type);
    this.deliver({ type, requestId: request?.requestId, data });
  }
}

const projection: FuelProjectionSnapshot = {
  isReplay: false,
  fuelLevel: 40,
  fuelLevelPct: 0.5,
  currentLap: 2,
  lapDistPct: 0.25,
  currentLapUsage: 0.5,
  projectedLapUsage: 2,
  lastLapUsage: 2.1,
  sessionLapsRemain: 10,
  sessionTimeRemain: 900,
  sessionTimeTotal: 1800,
  sessionFlags: 0,
  sessionState: 4,
  sessionNum: 0,
  sessionLaps: 12,
  calculatedTotalRaceLaps: 12,
  estimatedLapsRemaining: 0,
  hasValidRaceEstimate: false,
  isFixedLapRace: true,
  sessionType: 'Race',
  isOnTrack: true,
  completedLaps: [],
  engine: {
    accumulatedRefuel: 0,
    isLapDistPctReset: false,
    lapCrossingTime: 90,
    lapStartFuel: 40.5,
    lastLap: 1,
    lastLapDistPct: 0.25,
    lastSessionFlags: 0,
    wasOnPitRoad: false,
  },
};

describe('WebSocketBridge channels', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('subscribes at the highest local rate and dispatches channel snapshots', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);

    const bridge = new WebSocketBridge();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = bridge.subscribe('fuel.projection', first, 5);
    const connecting = bridge.connect('http://localhost:3000');
    const socket = FakeWebSocket.latest;
    socket?.onopen?.();
    await connecting;

    const unsubscribeSecond = bridge.subscribe('fuel.projection', second, 10);
    socket?.onmessage?.({
      data: JSON.stringify({
        type: 'channel',
        data: { channel: 'fuel.projection', payload: projection },
      }),
    } as MessageEvent);

    expect(first).toHaveBeenCalledWith(projection);
    expect(second).toHaveBeenCalledWith(projection);
    expect(socket?.sent.map((message) => JSON.parse(message))).toEqual([
      {
        type: 'channelSubscribe',
        data: { channel: 'fuel.projection', requestedRateHz: 5 },
      },
      {
        type: 'channelSubscribe',
        data: { channel: 'fuel.projection', requestedRateHz: 10 },
      },
    ]);

    unsubscribeSecond();
    expect(JSON.parse(socket?.sent.at(-1) ?? '{}')).toEqual({
      type: 'channelSubscribe',
      data: { channel: 'fuel.projection', requestedRateHz: 5 },
    });
    unsubscribeFirst();
    expect(JSON.parse(socket?.sent.at(-1) ?? '{}')).toEqual({
      type: 'channelUnsubscribe',
      data: { channel: 'fuel.projection' },
    });
  });

  it('preserves the channel default when another consumer requests less', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);

    const bridge = new WebSocketBridge();
    const unsubscribeDefault = bridge.subscribe('fuel.projection', vi.fn());
    const connecting = bridge.connect('http://localhost:3000');
    const socket = FakeWebSocket.latest;
    socket?.onopen?.();
    await connecting;
    const messagesBeforeSecondConsumer = socket?.sent.length ?? 0;
    const unsubscribeSlow = bridge.subscribe('fuel.projection', vi.fn(), 2);

    expect(socket?.sent).toHaveLength(messagesBeforeSecondConsumer + 1);
    expect(JSON.parse(socket?.sent.at(-1) ?? '{}')).toEqual({
      type: 'channelSubscribe',
      data: { channel: 'fuel.projection', requestedRateHz: 5 },
    });

    unsubscribeDefault();
    expect(JSON.parse(socket?.sent.at(-1) ?? '{}')).toEqual({
      type: 'channelSubscribe',
      data: { channel: 'fuel.projection', requestedRateHz: 2 },
    });
    unsubscribeSlow();
  });

  it('drops channel callbacks when stopped', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);

    const bridge = new WebSocketBridge();
    const callback = vi.fn();
    bridge.subscribe('fuel.projection', callback);
    const connecting = bridge.connect('http://localhost:3000');
    const socket = FakeWebSocket.latest;
    socket?.onopen?.();
    await connecting;
    bridge.stop();

    socket?.onmessage?.({
      data: JSON.stringify({
        type: 'channel',
        data: { channel: 'fuel.projection', payload: projection },
      }),
    } as MessageEvent);

    expect(callback).not.toHaveBeenCalled();
  });

  it('subscribes to Inspector telemetry only while a consumer exists', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);

    const bridge = new WebSocketBridge();
    const connecting = bridge.connect('http://localhost:3000');
    const socket = FakeWebSocket.latest;
    socket?.onopen?.();
    await connecting;

    expect(socket?.sent).toEqual([]);
    const unsubscribe = bridge.onTelemetry(vi.fn());
    expect(JSON.parse(socket?.sent.at(-1) ?? '{}')).toEqual({
      type: 'telemetryInspectorSubscribe',
      data: { stream: 'telemetryInspector' },
    });

    unsubscribe?.();
    expect(JSON.parse(socket?.sent.at(-1) ?? '{}')).toEqual({
      type: 'telemetryInspectorUnsubscribe',
      data: { stream: 'telemetryInspector' },
    });
  });
});

describe('WebSocketBridge simulator compatibility', () => {
  afterEach(() => vi.unstubAllGlobals());

  const connected = async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const bridge = new WebSocketBridge();
    const connecting = bridge.connect('http://localhost:3000');
    const socket = FakeWebSocket.latest;
    socket?.onopen?.();
    await connecting;
    return { bridge, socket: socket as FakeWebSocket };
  };

  it('reports the running simulator from the initial state', async () => {
    // Browser views never receive OverlayManager's window message, so the
    // initial state is the only thing that tells them which sim is running --
    // and without it every widget passes the compatibility filter.
    const { bridge, socket } = await connected();
    const seen = vi.fn();

    socket.deliver({ type: 'initialState', data: { simulator: 'lmu' } });
    bridge.onSimulatorChanged(seen);

    expect(seen).toHaveBeenCalledWith('lmu');
  });

  it('tells a page that subscribes after the connection opened whether a simulator is running', async () => {
    // The app says it once, as the connection opens, and the page is drawn
    // after that: a subscriber that was told nothing would show "no
    // simulator is running" in the middle of a race.
    const { bridge, socket } = await connected();
    socket.deliver({ type: 'initialState', data: { isRunning: true } });

    const seen = vi.fn();
    bridge.onRunningState(seen);

    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith(true);
    await expect(bridge.getRunningState()).resolves.toBe(true);
  });

  it('tells a late subscriber the latest word, not the first', async () => {
    const { bridge, socket } = await connected();
    socket.deliver({ type: 'initialState', data: { isRunning: true } });
    socket.deliver({ type: 'runningState', data: false });

    const seen = vi.fn();
    bridge.onRunningState(seen);

    expect(seen).toHaveBeenCalledWith(false);
    await expect(bridge.getRunningState()).resolves.toBe(false);
  });

  it('says nothing of a simulator before the app has, and takes no answer that is not one', async () => {
    const { bridge, socket } = await connected();
    const seen = vi.fn();
    const unsubscribe = bridge.onRunningState(seen);

    expect(seen).not.toHaveBeenCalled();
    await expect(bridge.getRunningState()).resolves.toBe(false);

    socket.deliver({ type: 'runningState', data: 'yes' });
    socket.deliver({ type: 'initialState', data: { simulator: 'lmu' } });
    expect(seen).not.toHaveBeenCalled();

    socket.deliver({ type: 'runningState', data: true });
    expect(seen).toHaveBeenCalledWith(true);

    unsubscribe?.();
    socket.deliver({ type: 'runningState', data: false });
    expect(seen).toHaveBeenCalledTimes(1);
    // Still kept for whoever asks next.
    await expect(bridge.getRunningState()).resolves.toBe(false);
  });

  it('forwards a simulator change to its subscribers', async () => {
    const { bridge, socket } = await connected();
    const seen = vi.fn();
    const unsubscribe = bridge.onSimulatorChanged(seen);

    socket.deliver({ type: 'simulatorChanged', data: 'iracing' });
    expect(seen).toHaveBeenCalledWith('iracing');

    unsubscribe?.();
    socket.deliver({ type: 'simulatorChanged', data: 'lmu' });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('answers the seeding requests over the socket', async () => {
    const { bridge, socket } = await connected();

    const simulator = bridge.getActiveSimulator();
    socket.reply('getActiveSimulator', 'lmu');
    await expect(simulator).resolves.toBe('lmu');

    const support = bridge.getSimWidgetSupport();
    socket.reply('getSimWidgetSupport', {
      message: 'nope',
      disabledWidgets: { iracing: [], lmu: ['input'] },
    });
    await expect(support).resolves.toEqual({
      message: 'nope',
      disabledWidgets: { iracing: [], lmu: ['input'] },
    });

    const available = bridge.getAvailableSimulators();
    socket.reply('getAvailableSimulators', ['iracing']);
    await expect(available).resolves.toEqual(['iracing']);
  });

  it('falls back rather than hanging when the socket is down', async () => {
    // A hung promise would leave the filtering permanently undecided; the
    // bundled defaults are the same thing the Electron renderer starts on.
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const bridge = new WebSocketBridge();

    await expect(bridge.getActiveSimulator()).resolves.toBeNull();
    await expect(bridge.getSimWidgetSupport()).resolves.toEqual(
      DEFAULT_SIM_WIDGET_SUPPORT
    );
    await expect(bridge.getAvailableSimulators()).resolves.toEqual([]);
  });
});

describe('WebSocketBridge image responses', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    'getGarageCoverImageAsDataUrl',
    'getPlayerIconImageAsDataUrl',
  ] as const)(
    '%s validates the response before returning it to image consumers',
    async (method) => {
      vi.stubGlobal('WebSocket', FakeWebSocket);
      const bridge = new WebSocketBridge();
      const connecting = bridge.connect('http://localhost:3000');
      const socket = FakeWebSocket.latest;
      socket?.onopen?.();
      await connecting;
      for (const payload of [
        'data:image/png;base64,YQ==',
        'data:image/svg+xml;base64,PHN2Zy8+',
        'https://example.com/image.png',
        'javascript:alert(1)',
        'data:text/html;base64,PHN2Zy8+',
        42,
        {},
        null,
      ]) {
        const response = bridge[method]('image.png');
        socket?.reply(method, payload);
        await expect(response).resolves.toBe(
          typeof payload === 'string' && payload.startsWith('data:image/')
            ? payload
            : null
        );
        expect(socket?.listeners.size).toBe(0);
      }
      bridge.stop();
    }
  );
});

describe('WebSocketBridge race plan state', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const reconnectedWithSubscriber = async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const bridge = new WebSocketBridge();
    const connecting = bridge.connect('http://localhost:3000');
    (FakeWebSocket.latest as FakeWebSocket).onopen?.();
    await connecting;
    const callback = vi.fn();
    bridge.onRacePlanState(callback);
    (FakeWebSocket.latest as FakeWebSocket).onclose?.();
    await vi.advanceTimersByTimeAsync(1000);
    const socket = FakeWebSocket.latest as FakeWebSocket;
    socket.onopen?.();
    return { bridge, socket, callback };
  };

  const state = (fetchedAt: number) =>
    ({ fetchedAt }) as unknown as RacePlanState;

  it('seeds the current state after a reconnect', async () => {
    const { bridge, socket, callback } = await reconnectedWithSubscriber();
    socket.reply('racePlan:getState', state(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(callback).toHaveBeenLastCalledWith(state(1));
    bridge.stop();
  });

  it('drops a reconnect seed once a newer push has arrived', async () => {
    const { bridge, socket, callback } = await reconnectedWithSubscriber();
    socket.deliver({ type: 'racePlanState', data: state(2) });
    socket.reply('racePlan:getState', state(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenLastCalledWith(state(2));
    bridge.stop();
  });
});

describe('WebSocketBridge pit lane calibration', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const connected = async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const bridge = new WebSocketBridge();
    const connecting = bridge.connect('http://localhost:3000');
    const socket = FakeWebSocket.latest as FakeWebSocket;
    socket.onopen?.();
    await connecting;
    return { bridge, socket };
  };

  it('carries source identity and revision through typed read/save/reset requests', async () => {
    const { bridge, socket } = await connected();
    const calibration = {
      trackId: '47',
      sourceId: 'source-one',
      revision: 2,
      data: null,
    };
    const read = bridge.getPitLaneData('47');
    socket.reply('pitLane:getData', calibration);
    expect(await read).toEqual(calibration);
    const saving = bridge.updatePitLaneData(
      '47',
      { pitEntryPct: 0.92 },
      2,
      'source-one'
    );
    expect(JSON.parse(socket.sent.at(-1) ?? '{}').data).toEqual({
      trackId: '47',
      update: { pitEntryPct: 0.92 },
      revision: 2,
      sourceId: 'source-one',
    });
    socket.reply('pitLane:updateData', true);
    expect(await saving).toBe(true);
    const resetting = bridge.resetPitLaneData('47');
    socket.reply('pitLane:resetData', null);
    await resetting;
    bridge.stop();
  });

  it('rejects failed reset responses instead of reporting success', async () => {
    const { bridge, socket } = await connected();
    const resetting = bridge.resetPitLaneData('47');
    const expected = expect(resetting).rejects.toThrow('disk full');
    const request = JSON.parse(socket.sent.at(-1) ?? '{}');
    socket.deliver({
      type: 'pitLane:resetData',
      requestId: request.requestId,
      error: 'disk full',
    });
    await expected;
    bridge.stop();
  });

  it('reloads calibration after reconnect so an offline browser sees a missed reset', async () => {
    vi.useFakeTimers();
    const { bridge, socket } = await connected();
    const callback = vi.fn();
    bridge.subscribe('pit-lane.reset', callback);
    socket.onclose?.();
    await vi.advanceTimersByTimeAsync(1000);
    const reconnected = FakeWebSocket.latest as FakeWebSocket;
    reconnected.onopen?.();
    reconnected.reply('pitLane:getCurrentTrack', {
      trackId: '47',
      trackName: 'Laguna Seca',
      hasCalibration: false,
    });
    await vi.advanceTimersByTimeAsync(0);
    reconnected.reply('pitLane:getData', {
      trackId: '47',
      sourceId: 'new-main-instance',
      revision: 0,
      data: null,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(callback).toHaveBeenCalledWith({
      trackId: '47',
      sourceId: 'new-main-instance',
      revision: 0,
      data: null,
    });
    bridge.stop();
  });
});

describe('browser page whose key was replaced', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const connected = async (onKeyReplaced?: () => void) => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const bridge = new WebSocketBridge({ onKeyReplaced });
    const connecting = bridge.connect('http://192.168.1.50:3000');
    const socket = FakeWebSocket.latest as FakeWebSocket;
    socket.onopen?.();
    await connecting;
    return { bridge, socket };
  };

  it('stops knocking and says so, instead of coming back with the old key', async () => {
    const onKeyReplaced = vi.fn();
    const { bridge, socket } = await connected(onKeyReplaced);

    socket.onclose?.({ code: 4403 } as CloseEvent);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(onKeyReplaced).toHaveBeenCalledTimes(1);
    // No second socket was opened in a minute of waiting.
    expect(FakeWebSocket.latest).toBe(socket);
    bridge.stop();
  });

  it('asks for the whole page again unless told what to do', async () => {
    const reload = vi.fn();
    vi.stubGlobal('window', { top: { location: { reload } } });
    const { bridge, socket } = await connected();

    socket.onclose?.({ code: 4403 } as CloseEvent);

    expect(reload).toHaveBeenCalledTimes(1);
    bridge.stop();
  });

  it('asks for its own frame again where the page around it is out of reach', async () => {
    const reload = vi.fn();
    vi.stubGlobal('window', {
      get top(): never {
        throw new Error('cross-origin');
      },
      location: { reload },
    });
    const { bridge, socket } = await connected();

    socket.onclose?.({ code: 4403 } as CloseEvent);

    expect(reload).toHaveBeenCalledTimes(1);
    bridge.stop();
  });

  it('comes back as before after any other close', async () => {
    const onKeyReplaced = vi.fn();
    const { bridge, socket } = await connected(onKeyReplaced);

    socket.onclose?.({ code: 1006 } as CloseEvent);
    await vi.advanceTimersByTimeAsync(1000);

    expect(onKeyReplaced).not.toHaveBeenCalled();
    expect(FakeWebSocket.latest).not.toBe(socket);
    bridge.stop();
  });
});

describe('WebSocketBridge race history', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const connected = async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const bridge = new WebSocketBridge({ onKeyReplaced: vi.fn() });
    const connecting = bridge.connect('http://localhost:3000');
    const socket = FakeWebSocket.latest as FakeWebSocket;
    socket.onopen?.();
    await connecting;
    // The bridge's own timers, which are not a read's: counted from here.
    return { bridge, socket, timers: vi.getTimerCount() };
  };

  /** What the page sent that asks for the race history, oldest first. */
  const asked = (socket: FakeWebSocket) =>
    socket.sent
      .map(
        (message) =>
          JSON.parse(message) as {
            type: string;
            requestId: string;
            data: unknown;
          }
      )
      .filter((message) => message.type.startsWith('raceHistory:'));

  /** Reads still waiting for an answer: what must not be left behind. */
  const waiting = (bridge: WebSocketBridge) =>
    (bridge as unknown as { raceHistoryReads: Map<string, unknown> })
      .raceHistoryReads.size;

  const laps = (revision: number) => ({ laps: [], missingLaps: [], revision });

  it('asks for each read with its arguments in a list, as IPC carries them', async () => {
    const { bridge, socket } = await connected();

    void bridge.raceHistory.getCarLaps(7).catch(() => undefined);
    void bridge.raceHistory.getCarLaps(7, 12).catch(() => undefined);
    void bridge.raceHistory.getCarStints(3).catch(() => undefined);
    void bridge.raceHistory.getDriverChanges().catch(() => undefined);
    void bridge.raceHistory.getDriverChanges(12).catch(() => undefined);
    void bridge.raceHistory.listRaces().catch(() => undefined);
    void bridge.raceHistory.getEvents().catch(() => undefined);
    void bridge.raceHistory.getEvents(undefined, 801).catch(() => undefined);

    expect(asked(socket).map(({ type, data }) => [type, data])).toEqual([
      ['raceHistory:getCarLaps', [7]],
      ['raceHistory:getCarLaps', [7, 12]],
      ['raceHistory:getCarStints', [3]],
      ['raceHistory:getDriverChanges', []],
      ['raceHistory:getDriverChanges', [12]],
      ['raceHistory:listRaces', []],
      ['raceHistory:getEvents', []],
      // The race left out and the event given: the place is kept by a null,
      // which the bridge reads as the race being recorded.
      ['raceHistory:getEvents', [null, 801]],
    ]);
    const ids = asked(socket).map((message) => message.requestId);
    expect(new Set(ids).size).toBe(ids.length);
    bridge.stop();
  });

  it('gives each answer to the read that asked, whatever order they come in', async () => {
    const { bridge, socket, timers } = await connected();
    const first = bridge.raceHistory.getCarLaps(1);
    const second = bridge.raceHistory.getCarLaps(2);
    const stints = bridge.raceHistory.getCarStints(1);
    const [a, b, c] = asked(socket);

    socket.deliver({ type: b.type, requestId: b.requestId, data: laps(2) });
    socket.deliver({ type: c.type, requestId: c.requestId, data: [] });
    socket.deliver({ type: a.type, requestId: a.requestId, data: laps(1) });

    await expect(first).resolves.toEqual(laps(1));
    await expect(second).resolves.toEqual(laps(2));
    await expect(stints).resolves.toEqual([]);
    expect(waiting(bridge)).toBe(0);
    expect(vi.getTimerCount()).toBe(timers);
    bridge.stop();
  });

  it('takes no answer that is not its own', async () => {
    const { bridge, socket } = await connected();
    const settled = vi.fn();
    const read = bridge.raceHistory.getCarLaps(1);
    void read.then(settled, settled);
    const [request] = asked(socket);

    // Another id, no id, and the right id under another read's name.
    socket.deliver({ type: request.type, requestId: 'rh999', data: laps(9) });
    socket.deliver({ type: request.type, data: laps(9) });
    socket.deliver({
      type: 'raceHistory:getCarStints',
      requestId: request.requestId,
      data: [],
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).not.toHaveBeenCalled();

    socket.deliver({
      type: request.type,
      requestId: request.requestId,
      data: laps(1),
    });
    await expect(read).resolves.toEqual(laps(1));
    bridge.stop();
  });

  it('rejects with the app’s words when the answer is an error', async () => {
    const { bridge, socket, timers } = await connected();
    const read = bridge.raceHistory.getCarLaps(128);
    const refused = expect(read).rejects.toThrow(
      'Invalid car for raceHistory:getCarLaps'
    );
    const [request] = asked(socket);

    socket.deliver({
      type: request.type,
      requestId: request.requestId,
      error: 'Invalid car for raceHistory:getCarLaps',
    });

    await refused;
    expect(waiting(bridge)).toBe(0);
    expect(vi.getTimerCount()).toBe(timers);
    bridge.stop();
  });

  it('rejects every read that was waiting when the socket closes', async () => {
    const { bridge, socket, timers } = await connected();
    const reads = [
      bridge.raceHistory.getCarLaps(1),
      bridge.raceHistory.getCarStints(1),
      bridge.raceHistory.getEvents(undefined, 801),
    ];
    const rejected = Promise.all(
      reads.map((read) =>
        expect(read).rejects.toThrow(
          'The connection closed before the race history answered'
        )
      )
    );

    socket.onclose?.({ code: 1006 } as CloseEvent);

    await rejected;
    expect(waiting(bridge)).toBe(0);
    bridge.stop();
    expect(vi.getTimerCount()).toBe(timers);
  });

  it('rejects at once while the socket is down, and sends nothing later', async () => {
    const { bridge, socket } = await connected();
    socket.onclose?.({ code: 1006 } as CloseEvent);

    await expect(bridge.raceHistory.getCarLaps(1)).rejects.toThrow(
      'The race history cannot be read while disconnected'
    );
    await expect(bridge.raceHistory.listRaces()).rejects.toThrow(
      'The race history cannot be read while disconnected'
    );
    expect(waiting(bridge)).toBe(0);

    // Back again: nothing asked while it was down is asked now.
    await vi.advanceTimersByTimeAsync(1000);
    const reconnected = FakeWebSocket.latest as FakeWebSocket;
    expect(reconnected).not.toBe(socket);
    reconnected.onopen?.();
    expect(asked(reconnected)).toEqual([]);
    bridge.stop();
  });

  it('asks afresh after a reconnect, under an id no earlier read had', async () => {
    const { bridge, socket } = await connected();
    const lost = bridge.raceHistory.getCarLaps(1);
    const lostRejected = expect(lost).rejects.toThrow('connection closed');
    const [old] = asked(socket);
    socket.onclose?.({ code: 1006 } as CloseEvent);
    await lostRejected;
    await vi.advanceTimersByTimeAsync(1000);
    const reconnected = FakeWebSocket.latest as FakeWebSocket;
    reconnected.onopen?.();

    const again = bridge.raceHistory.getCarLaps(1);
    const [fresh] = asked(reconnected);
    expect(fresh.requestId).not.toBe(old.requestId);
    // An answer to the read that was lost is nobody's any more.
    reconnected.deliver({
      type: old.type,
      requestId: old.requestId,
      data: laps(99),
    });
    reconnected.deliver({
      type: fresh.type,
      requestId: fresh.requestId,
      data: laps(1),
    });

    await expect(again).resolves.toEqual(laps(1));
    expect(waiting(bridge)).toBe(0);
    bridge.stop();
  });

  it('gives up on a read that is never answered, and ignores the answer if it comes', async () => {
    const { bridge, socket } = await connected();
    const read = bridge.raceHistory.getCarLaps(1);
    const gaveUp = expect(read).rejects.toThrow(
      'The race history did not answer'
    );
    const [request] = asked(socket);

    await vi.advanceTimersByTimeAsync(30_000);
    await gaveUp;
    expect(waiting(bridge)).toBe(0);

    expect(() =>
      socket.deliver({
        type: request.type,
        requestId: request.requestId,
        data: laps(1),
      })
    ).not.toThrow();
    bridge.stop();
  });

  it('rejects what was waiting when the page lets go of the socket', async () => {
    const { bridge, timers } = await connected();
    const read = bridge.raceHistory.listRaces();
    const rejected = expect(read).rejects.toThrow('connection closed');

    bridge.stop();

    await rejected;
    expect(waiting(bridge)).toBe(0);
    expect(vi.getTimerCount()).toBe(timers);
  });

  it('holds no more than is unanswered, however many reads go through', async () => {
    const { bridge, socket, timers } = await connected();

    for (let round = 0; round < 500; round++) {
      const read = bridge.raceHistory.getCarLaps(round % 128);
      const request = asked(socket).at(-1);
      socket.deliver(
        round % 2
          ? { type: request?.type, requestId: request?.requestId, error: 'no' }
          : {
              type: request?.type,
              requestId: request?.requestId,
              data: laps(round),
            }
      );
      await read.catch(() => undefined);
    }

    expect(waiting(bridge)).toBe(0);
    expect(vi.getTimerCount()).toBe(timers);
    // Each read listened on its own account for nothing.
    expect(socket.listeners.size).toBe(0);
    bridge.stop();
  });

  it('leaves the channels and the other answers as they were', async () => {
    const { bridge, socket } = await connected();
    const summary = vi.fn();
    bridge.subscribe('race-history.summary', summary);
    const version = bridge.getAppVersion();
    void bridge.raceHistory.getCarLaps(1).catch(() => undefined);

    socket.deliver({
      type: 'channel',
      data: { channel: 'race-history.summary', payload: { raceToken: 'a' } },
    });
    socket.reply('getAppVersion', '2.2.3');

    expect(summary).toHaveBeenCalledWith({ raceToken: 'a' });
    await expect(version).resolves.toBe('2.2.3');
    bridge.stop();
  });
});

describe('WebSocketBridge connection, for a page that says when it is down', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('is down until the socket opens, and says when that changes', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const bridge = new WebSocketBridge({ onKeyReplaced: vi.fn() });
    const seen: boolean[] = [];
    const unsubscribe = bridge.connection.onConnectionChanged((connected) =>
      seen.push(connected)
    );
    expect(bridge.connection.isConnected()).toBe(false);

    const connecting = bridge.connect('http://localhost:3000');
    const socket = FakeWebSocket.latest as FakeWebSocket;
    socket.onopen?.();
    await connecting;
    expect(bridge.connection.isConnected()).toBe(true);

    socket.onclose?.({ code: 1006 } as CloseEvent);
    expect(bridge.connection.isConnected()).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    (FakeWebSocket.latest as FakeWebSocket).onopen?.();
    expect(bridge.connection.isConnected()).toBe(true);
    expect(seen).toEqual([true, false, true]);

    unsubscribe();
    (FakeWebSocket.latest as FakeWebSocket).onclose?.({
      code: 1006,
    } as CloseEvent);
    expect(seen).toEqual([true, false, true]);
    bridge.stop();
  });

  it('stays down while the app is away, through every attempt to come back', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const bridge = new WebSocketBridge({ onKeyReplaced: vi.fn() });
    const connecting = bridge.connect('http://localhost:3000');
    (FakeWebSocket.latest as FakeWebSocket).onopen?.();
    await connecting;
    const seen: boolean[] = [];
    bridge.connection.onConnectionChanged((connected) => seen.push(connected));

    // The app is closed: every socket the page opens is closed again.
    (FakeWebSocket.latest as FakeWebSocket).onclose?.({
      code: 1006,
    } as CloseEvent);
    for (let attempt = 0; attempt < 4; attempt++) {
      await vi.advanceTimersByTimeAsync(5000);
      (FakeWebSocket.latest as FakeWebSocket).onclose?.({
        code: 1006,
      } as CloseEvent);
    }

    // Said once, not once an attempt.
    expect(seen).toEqual([false]);
    expect(bridge.connection.isConnected()).toBe(false);
    bridge.stop();
  });
});

describe('WebSocketBridge coming back after the app went away', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('waits once longer for each attempt that fails: 1 s, 2 s, 4 s, then 5 s', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const bridge = new WebSocketBridge({ onKeyReplaced: vi.fn() });
    const connecting = bridge.connect('http://localhost:3000');
    let socket = FakeWebSocket.latest as FakeWebSocket;
    socket.onopen?.();
    await connecting;

    // The app is closed, and stays closed.
    socket.onclose?.({ code: 1006 } as CloseEvent);

    for (const wait of [1000, 2000, 4000, 5000, 5000]) {
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(FakeWebSocket.latest, `1 ms short of ${wait}`).toBe(socket);
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeWebSocket.latest, `after ${wait} ms`).not.toBe(socket);
      socket = FakeWebSocket.latest as FakeWebSocket;

      // A browser reports an attempt that failed twice over: an error, which
      // rejects the attempt, and then the close of the socket it made. Each
      // used to count as a failure of its own, so the wait doubled twice.
      socket.onerror?.({} as Event);
      await Promise.resolve();
      socket.onclose?.({ code: 1006 } as CloseEvent);
    }
    bridge.stop();
  });

  it('starts from one second again once it has come back', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const bridge = new WebSocketBridge({ onKeyReplaced: vi.fn() });
    const connecting = bridge.connect('http://localhost:3000');
    let socket = FakeWebSocket.latest as FakeWebSocket;
    socket.onopen?.();
    await connecting;

    socket.onclose?.({ code: 1006 } as CloseEvent);
    await vi.advanceTimersByTimeAsync(1000);
    socket = FakeWebSocket.latest as FakeWebSocket;
    socket.onerror?.({} as Event);
    await Promise.resolve();
    socket.onclose?.({ code: 1006 } as CloseEvent);
    await vi.advanceTimersByTimeAsync(2000);
    socket = FakeWebSocket.latest as FakeWebSocket;
    socket.onopen?.();
    expect(bridge.connection.isConnected()).toBe(true);

    // Dropped again: the first wait is the short one.
    socket.onclose?.({ code: 1006 } as CloseEvent);
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeWebSocket.latest).not.toBe(socket);
    bridge.stop();
  });
});
