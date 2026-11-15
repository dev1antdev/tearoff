import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ActiveSimulator,
  Session,
  Telemetry,
  TrackProfile,
  TrackProfileDemand,
  TrackProfileKey,
  TrackProfileLap,
} from '../types';
import type { TrackProfileStore } from './storage/trackProfiles';

const stub = vi.hoisted(() => ({
  store: undefined as unknown,
}));

vi.mock('./storage/trackProfiles', () => ({
  getTrackProfileStore: () => stub.store,
}));

import {
  getSessionTrackKey,
  getTrackProfileSource,
  setupTrackProfileRecording,
  startTrackProfiles,
} from './trackProfileRecording';

const TRACK_LENGTH_M = 3590.35;
const TRACK_ID = 694510461;

const session = (trackId = TRACK_ID): Session =>
  ({
    WeekendInfo: {
      TrackID: trackId,
      TrackDisplayName: 'WeatherTech Raceway Laguna Seca',
      TrackLength: `${TRACK_LENGTH_M} m`,
    },
    DriverInfo: { DriverCarIdx: 0 },
  }) as unknown as Session;

/** What stands in for the store: it keeps what it is handed. */
const createStore = () => {
  const state = {
    demand: 'first' as TrackProfileDemand,
    profile: null as TrackProfile | null,
    revision: 7,
  };
  const laps: { key: TrackProfileKey; lap: TrackProfileLap }[] = [];
  const imported: { key: TrackProfileKey; pairs: unknown }[] = [];
  const store = {
    load: vi.fn(() => state.profile),
    revision: () => state.revision,
    whenLoaded: vi.fn(async () => state.profile),
    demand: vi.fn(() => state.demand),
    recordLap: vi.fn(async (key: TrackProfileKey, lap: TrackProfileLap) => {
      laps.push({ key, lap });
      return true;
    }),
    importElevation: vi.fn(async (key: TrackProfileKey, pairs: unknown) => {
      imported.push({ key, pairs });
      return true;
    }),
  } as unknown as TrackProfileStore;
  return { store, state, laps, imported };
};

/** A telemetry bridge that hands out what the spec feeds it. */
const createBridge = () => {
  const sessions = new Set<(session: Session) => void>();
  const frames = new Set<(telemetry: Telemetry) => void>();
  return {
    onSessionData: (callback: (session: Session) => void) => {
      sessions.add(callback);
      return () => sessions.delete(callback);
    },
    onTelemetry: (callback: (telemetry: Telemetry) => void) => {
      frames.add(callback);
      return () => frames.delete(callback);
    },
    session: (value: Session) =>
      sessions.forEach((callback) => callback(value)),
    frame: (value: Telemetry) => frames.forEach((callback) => callback(value)),
    listeners: () => sessions.size + frames.size,
  };
};

/** Something that happens, with whoever asked to hear of it. */
const listeners = <T = undefined>() => {
  const callbacks = new Set<(value: T) => void>();
  return {
    add: (callback: (value: T) => void) => {
      callbacks.add(callback);
      return () => {
        callbacks.delete(callback);
      };
    },
    emit: (value?: T) => callbacks.forEach((callback) => callback(value as T)),
    size: () => callbacks.size,
  };
};

/** Drives the player over the line `crossings` times at 60 m/s. */
const drive = (
  bridge: ReturnType<typeof createBridge>,
  crossings: number,
  clock = { time: 100, pct: 0.97 }
) => {
  const step = 0.6 / TRACK_LENGTH_M;
  let crossed = 0;
  while (crossed < crossings) {
    clock.time += 0.01;
    clock.pct += step;
    if (clock.pct >= 1) {
      clock.pct -= 1;
      crossed += 1;
    }
    bridge.frame({
      SessionTime: { value: [clock.time] },
      SessionNum: { value: [0] },
      CarIdxLapDistPct: { value: [clock.pct] },
      CarIdxOnPitRoad: { value: [false] },
      IsOnTrack: { value: [true] },
      LmuPlayerWorldPos: { value: [clock.pct * 100, 5, clock.pct * -100] },
    } as unknown as Telemetry);
  }
  return clock;
};

const setup = ({
  // null for a simulator that has not been named yet.
  simulator = 'lmu' as ActiveSimulator | null,
  live = true,
  findElevation = vi.fn(async () => null) as (
    trackName: string
  ) => Promise<[number, number][] | null>,
} = {}) => {
  const { store, state, laps, imported } = createStore();
  const bridge = createBridge();
  const simulatorChanged = listeners();
  const bridgeChanged = listeners();
  const entered = listeners<{ replay: boolean }>();
  const disconnected = listeners();
  const liveChanged = listeners();
  const world: { simulator: ActiveSimulator | undefined; live: boolean } = {
    simulator: simulator ?? undefined,
    live,
  };
  const dispose = setupTrackProfileRecording({
    store,
    getBridge: () => bridge,
    getSimulator: () => world.simulator,
    onBridgeChanged: (callback) => bridgeChanged.add(callback),
    onSimulatorChanged: (callback) => simulatorChanged.add(callback),
    lifecycle: {
      onEnter: (callback) => entered.add(callback),
      onDisconnect: (callback) => disconnected.add(callback),
    },
    isLive: () => world.live,
    onLiveChanged: (callback) => liveChanged.add(callback),
    findElevation,
  });
  return {
    store,
    state,
    laps,
    imported,
    bridge,
    world,
    simulatorChanged,
    entered,
    disconnected,
    liveChanged,
    findElevation,
    dispose,
  };
};

/** Lets the promises a session set off run to their end. */
const settle = async () => {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
};

describe('track profile recording', () => {
  beforeEach(() => {
    stub.store = undefined;
  });

  it('records a clean lap into the store, under the simulator it was driven in', async () => {
    const { bridge, laps, store, dispose } = setup();
    bridge.session(session());
    drive(bridge, 2);
    await settle();

    expect(laps).toHaveLength(1);
    expect(laps[0].key).toEqual({
      simulator: 'lmu',
      trackId: TRACK_ID,
      trackName: 'WeatherTech Raceway Laguna Seca',
      trackLengthM: TRACK_LENGTH_M,
      pointsCount: 360,
    });
    expect(laps[0].lap.source).toBe('recorded');
    // Asked what the track wants as a lap that reads its heights.
    expect(store.demand).toHaveBeenCalledWith(laps[0].key, 'recorded');
    dispose();
  });

  it('waits for the simulator to be named before it records anything', async () => {
    const { bridge, laps, world, simulatorChanged, dispose } = setup({
      simulator: null,
    });
    // Auto-detect: the bridge is there, and no game has been found yet.
    expect(bridge.listeners()).toBe(0);

    world.simulator = 'lmu';
    simulatorChanged.emit();
    expect(bridge.listeners()).toBe(2);
    bridge.session(session());
    drive(bridge, 2);
    await settle();

    expect(laps).toHaveLength(1);
    dispose();
  });

  it('starts a new recorder when another simulator takes over', async () => {
    const { bridge, store, world, simulatorChanged, dispose } = setup();
    bridge.session(session());
    drive(bridge, 1);

    world.simulator = 'iracing';
    simulatorChanged.emit();
    bridge.session(session(18));
    // No velocity or pitch on these frames: nothing to add up, no lap. What
    // matters is who is asked.
    drive(bridge, 2);

    expect(store.demand).toHaveBeenLastCalledWith(
      expect.objectContaining({ simulator: 'iracing', trackId: 18 }),
      'integrated'
    );
    dispose();
  });

  describe('what is not the player driving live', () => {
    it('takes nothing from a tape, a replay file or demo mode', async () => {
      const { bridge, laps, world, liveChanged, dispose } = setup({
        live: false,
      });
      bridge.session(session());
      drive(bridge, 3);
      await settle();
      expect(laps).toHaveLength(0);

      // Back to the player's own driving.
      world.live = true;
      liveChanged.emit();
      drive(bridge, 2, { time: 1000, pct: 0.97 });
      await settle();
      expect(laps).toHaveLength(1);
      dispose();
    });

    it('takes nothing from a replay the sim itself is playing', async () => {
      const { bridge, laps, entered, dispose } = setup();
      bridge.session(session());
      entered.emit({ replay: true });
      drive(bridge, 3);
      await settle();
      expect(laps).toHaveLength(0);

      entered.emit({ replay: false });
      drive(bridge, 2, { time: 1000, pct: 0.97 });
      await settle();
      expect(laps).toHaveLength(1);
      dispose();
    });

    it('drops the lap under way when it stops being live', async () => {
      const { bridge, laps, world, liveChanged, dispose } = setup();
      bridge.session(session());
      const clock = drive(bridge, 1);
      world.live = false;
      liveChanged.emit();
      world.live = true;
      liveChanged.emit();
      drive(bridge, 1, clock);
      await settle();

      expect(laps).toHaveLength(0);
      dispose();
    });
  });

  it('drops the lap under way when the sim disconnects', async () => {
    const { bridge, laps, disconnected, dispose } = setup();
    bridge.session(session());
    const clock = drive(bridge, 1);
    disconnected.emit();
    drive(bridge, 1, clock);
    await settle();

    expect(laps).toHaveLength(0);
    dispose();
  });

  describe('an elevation to start from', () => {
    const PAIRS: [number, number][] = [
      [0, 1],
      [1000, 12],
    ];

    it('is looked for once, by the track name, for a track with none', async () => {
      const findElevation = vi.fn(async () => PAIRS);
      const { bridge, imported, dispose } = setup({ findElevation });
      bridge.session(session());
      // The session is republished every time anything in it moves.
      bridge.session(session());
      bridge.session(session());
      await settle();

      expect(findElevation).toHaveBeenCalledTimes(1);
      expect(findElevation).toHaveBeenCalledWith(
        'WeatherTech Raceway Laguna Seca'
      );
      expect(imported).toHaveLength(1);
      expect(imported[0].key.trackId).toBe(TRACK_ID);
      expect(imported[0].pairs).toBe(PAIRS);
      dispose();
    });

    it('is looked for again for another track', async () => {
      const findElevation = vi.fn(async () => null);
      const { bridge, imported, dispose } = setup({ findElevation });
      bridge.session(session());
      bridge.session(session(42));
      await settle();

      expect(findElevation).toHaveBeenCalledTimes(2);
      expect(imported).toHaveLength(0);
      dispose();
    });

    it('is not looked for when the track has one', async () => {
      const findElevation = vi.fn(async () => PAIRS);
      const { bridge, state, imported, dispose } = setup({ findElevation });
      state.profile = {
        pointsCount: 360,
        elevationM: [1, 2, 3],
      } as unknown as TrackProfile;
      bridge.session(session());
      await settle();

      expect(findElevation).not.toHaveBeenCalled();
      expect(imported).toHaveLength(0);
      dispose();
    });

    it('is not looked for under a sim that states no height to compare', async () => {
      const findElevation = vi.fn(async () => PAIRS);
      const { bridge, dispose } = setup({
        simulator: 'iracing',
        findElevation,
      });
      bridge.session(session());
      await settle();

      expect(findElevation).not.toHaveBeenCalled();
      dispose();
    });

    it('is not looked for from a tape, and is once it is live', async () => {
      const findElevation = vi.fn(async () => PAIRS);
      const { bridge, world, dispose } = setup({ live: false, findElevation });
      bridge.session(session());
      await settle();
      expect(findElevation).not.toHaveBeenCalled();

      world.live = true;
      bridge.session(session());
      await settle();
      expect(findElevation).toHaveBeenCalledTimes(1);
      dispose();
    });

    it('does not stop the recording when the search fails', async () => {
      const findElevation = vi.fn(async () => {
        throw new Error('drive not ready');
      });
      const { bridge, laps, dispose } = setup({ findElevation });
      bridge.session(session());
      drive(bridge, 2);
      await settle();

      expect(laps).toHaveLength(1);
      dispose();
    });
  });

  it('lets go of the bridge and the lifecycle when it is disposed of', () => {
    const {
      bridge,
      simulatorChanged,
      entered,
      disconnected,
      liveChanged,
      dispose,
    } = setup();
    expect(bridge.listeners()).toBe(2);
    dispose();

    expect(bridge.listeners()).toBe(0);
    expect(simulatorChanged.size()).toBe(0);
    expect(entered.size()).toBe(0);
    expect(disconnected.size()).toBe(0);
    expect(liveChanged.size()).toBe(0);
  });

  describe('the track of the running session', () => {
    it('is named as a profile is filed under it, once a session is on', () => {
      expect(getSessionTrackKey()).toBeNull();
      const { bridge, dispose } = setup();
      // A recorder, and no session yet.
      expect(getSessionTrackKey()).toBeNull();

      bridge.session(session());
      expect(getSessionTrackKey()).toEqual({
        simulator: 'lmu',
        trackId: TRACK_ID,
        trackName: 'WeatherTech Raceway Laguna Seca',
        trackLengthM: TRACK_LENGTH_M,
        pointsCount: 360,
      });

      bridge.session(session(42));
      expect(getSessionTrackKey()?.trackId).toBe(42);

      dispose();
      expect(getSessionTrackKey()).toBeNull();
    });

    it('is named from a tape too, where nothing is recorded', () => {
      const { bridge, dispose } = setup({ live: false });
      bridge.session(session());

      expect(getSessionTrackKey()?.trackId).toBe(TRACK_ID);
      dispose();
    });
  });

  describe('what the channel reads', () => {
    it('is the installation store and the lap being recorded', () => {
      const { store, state } = createStore();
      stub.store = store;
      // Nothing to read until the profiles have been opened.
      expect(getTrackProfileSource()).toBeNull();
      expect(startTrackProfiles()).toBe(store);
      const source = getTrackProfileSource();
      if (!source) throw new Error('No source after start');

      state.profile = { pointsCount: 360 } as unknown as TrackProfile;
      expect(source.load('lmu', TRACK_ID, 360)).toBe(state.profile);
      expect(store.load).toHaveBeenCalledWith('lmu', TRACK_ID, 360);
      expect(source.revision()).toBe(7);
      // Nothing is being recorded.
      expect(source.recordingProgress()).toBeNull();

      const { bridge, dispose } = setup();
      bridge.session(session());
      drive(bridge, 1);
      const progress = source.recordingProgress();
      expect(progress).not.toBeNull();
      expect(progress).toBeLessThan(0.01);

      dispose();
      expect(source.recordingProgress()).toBeNull();
    });
  });
});
