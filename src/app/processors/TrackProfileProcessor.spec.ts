import { describe, expect, it, vi } from 'vitest';
import type {
  Session,
  Telemetry,
  TrackNote,
  TrackProfile,
} from '@irdashies/types';
import {
  TrackProfileProcessor,
  type TrackProfileSource,
} from './TrackProfileProcessor';

const TRACK_ID = 694510461;
const POINTS = 360;

const session = ({
  trackId = TRACK_ID,
  trackLength = '3590.35 m',
  sectors = [0, 1 / 3, 2 / 3],
}: {
  trackId?: number;
  trackLength?: string;
  sectors?: number[];
} = {}): Session =>
  ({
    WeekendInfo: { TrackID: trackId, TrackLength: trackLength },
    SplitTimeInfo: {
      Sectors: sectors.map((SectorStartPct, SectorNum) => ({
        SectorNum,
        SectorStartPct,
      })),
    },
  }) as unknown as Session;

const frame = (sessionNum = 0): Telemetry =>
  ({ SessionNum: { value: [sessionNum] } }) as unknown as Telemetry;

const NOTE: TrackNote = {
  id: 'n1',
  distanceM: 520,
  kind: 'track',
  text: 'Turn 2',
  comment: '',
  pit: false,
};

/** Laguna Seca's shape in miniature: -10.6 m at the line, -15.4 to 39.8 m. */
const profile = (overrides: Partial<TrackProfile> = {}): TrackProfile => ({
  version: 1,
  simulator: 'lmu',
  trackId: TRACK_ID,
  trackName: 'WeatherTech Raceway Laguna Seca',
  trackLengthM: 3590.35,
  pointsCount: POINTS,
  elevationM: Array.from({ length: POINTS }, (_, bucket) =>
    bucket === 0
      ? -10.6
      : bucket === 60
        ? -15.43
        : bucket === 239
          ? 39.76
          : 3.14159
  ),
  elevationSource: 'recorded',
  elevationLaps: 1,
  xM: null,
  zM: null,
  sectorStartPct: [0, 0.39, 0.792],
  sectorSource: 'learned',
  notes: [NOTE],
  updatedAt: 1000,
  ...overrides,
});

/** A source whose profile, revision and progress a case sets by hand. */
const createSource = (initial: TrackProfile | null = null) => {
  const state = {
    profile: initial,
    revision: 0,
    progress: null as number | null,
  };
  const load = vi.fn(
    (_simulator: string, trackId: number, pointsCount: number) =>
      state.profile?.trackId === trackId &&
      state.profile.pointsCount === pointsCount
        ? state.profile
        : null
  );
  const source: TrackProfileSource = {
    load,
    revision: () => state.revision,
    recordingProgress: () => state.progress,
  };
  return { source, state, load };
};

const start = (initial: TrackProfile | null = null) => {
  const { source, state, load } = createSource(initial);
  const processor = new TrackProfileProcessor(source, 'lmu');
  processor.init(session());
  processor.onLifecycle({ type: 'enter', replay: false });
  return { processor, state, load };
};

describe('TrackProfileProcessor', () => {
  it('declares the channel and publishes on events only', () => {
    const processor = new TrackProfileProcessor();

    expect(processor.channel).toBe('track-profile.snapshot');
    expect(processor.tickRateHz).toBe('event');
  });

  it('starts with no track and no profile', () => {
    expect(new TrackProfileProcessor().snapshot()).toEqual({
      trackKey: null,
      trackLengthM: 0,
      elevationM: [],
      lineElevationM: 0,
      elevationRangeM: 0,
      elevationSource: null,
      recordingProgress: null,
      sectorStartPct: [],
      notes: [],
      sessionNum: null,
      version: 0,
    });
  });

  it('names the track and gives the session sectors before any lap', () => {
    const { processor, load } = start();

    expect(load).toHaveBeenCalledWith('lmu', TRACK_ID, POINTS);
    expect(processor.snapshot()).toMatchObject({
      trackKey: `lmu:${TRACK_ID}`,
      trackLengthM: 3590.35,
      elevationM: [],
      elevationRangeM: 0,
      elevationSource: null,
      sectorStartPct: [0, 1 / 3, 2 / 3],
      notes: [],
    });
    expect(processor.snapshot().version).toBe(1);
  });

  it('publishes the heights from the lowest point, to a tenth of a metre', () => {
    const { processor } = start(profile());
    const snapshot = processor.snapshot();

    expect(snapshot.elevationM).toHaveLength(POINTS);
    expect(Math.min(...snapshot.elevationM)).toBe(0);
    expect(snapshot.elevationM[60]).toBe(0);
    expect(snapshot.elevationM[239]).toBe(55.2);
    // 3.14159 + 15.43, rounded.
    expect(snapshot.elevationM[100]).toBe(18.6);
    // The line, on the same scale.
    expect(snapshot.elevationM[0]).toBe(4.8);
    expect(snapshot.lineElevationM).toBe(4.8);
    expect(snapshot.elevationRangeM).toBe(55.2);
    expect(snapshot.elevationSource).toBe('recorded');
    expect(snapshot.sectorStartPct).toEqual([0, 0.39, 0.792]);
    expect(snapshot.notes).toEqual([NOTE]);
  });

  it('gives the notes of a track that has no elevation yet', () => {
    const { processor } = start(
      profile({
        elevationM: null,
        elevationSource: null,
        sectorStartPct: [],
        sectorSource: 'nominal',
      })
    );

    expect(processor.snapshot()).toMatchObject({
      elevationM: [],
      lineElevationM: 0,
      elevationRangeM: 0,
      elevationSource: null,
      // Nothing learned: the session's own stand.
      sectorStartPct: [0, 1 / 3, 2 / 3],
      notes: [NOTE],
    });
  });

  it('republishes when the store says the profile has changed', () => {
    const { processor, state } = start();
    processor.onFrame(frame());
    const before = processor.snapshot().version;

    // The first lap has just been kept.
    state.profile = profile();
    state.revision += 1;
    processor.onFrame(frame());

    expect(processor.snapshot().version).toBe(before + 1);
    expect(processor.snapshot().elevationRangeM).toBe(55.2);

    // And then a note is edited.
    state.profile = profile({ notes: [] });
    state.revision += 1;
    processor.onFrame(frame());
    expect(processor.snapshot().version).toBe(before + 2);
    expect(processor.snapshot().notes).toEqual([]);
  });

  it('does not republish for a change to some other track', () => {
    const { processor, state } = start(profile());
    processor.onFrame(frame());
    const before = processor.snapshot().version;

    // The revision moved, and this track's profile is the same object.
    state.revision += 1;
    processor.onFrame(frame());

    expect(processor.snapshot().version).toBe(before);
  });

  it('asks the store only when its revision moves', () => {
    const { processor, load } = start(profile());
    const asked = load.mock.calls.length;
    for (let tick = 0; tick < 500; tick += 1) processor.onFrame(frame());

    expect(load).toHaveBeenCalledTimes(asked);
  });

  it('publishes nothing on a frame where nothing changed', () => {
    const { processor } = start(profile());
    processor.onFrame(frame());
    const before = processor.snapshot().version;
    for (let tick = 0; tick < 100; tick += 1) processor.onFrame(frame());

    expect(processor.snapshot().version).toBe(before);
  });

  describe('while the first lap is being recorded', () => {
    it('reports progress each time it passes another 5 %', () => {
      const { processor, state } = start();
      processor.onFrame(frame());
      const before = processor.snapshot().version;
      const seen: (number | null)[] = [];
      for (let step = 0; step <= 1000; step += 1) {
        state.progress = step / 1000;
        processor.onFrame(frame());
        const progress = processor.snapshot().recordingProgress;
        if (seen.at(-1) !== progress) seen.push(progress);
      }

      expect(seen).toEqual(
        Array.from({ length: 20 }, (_, index) => index / 20)
      );
      // Twenty publishes for a thousand frames.
      expect(processor.snapshot().version).toBe(before + 20);
    });

    it('goes back to null when the lap is dropped or done', () => {
      const { processor, state } = start();
      state.progress = 0.42;
      processor.onFrame(frame());
      expect(processor.snapshot().recordingProgress).toBe(0.4);

      state.progress = null;
      processor.onFrame(frame());
      expect(processor.snapshot().recordingProgress).toBeNull();
    });
  });

  describe('when the session names another track', () => {
    it('loads that track and republishes', () => {
      const { processor, load } = start(profile());
      const before = processor.snapshot().version;
      processor.init(session({ trackId: 42, trackLength: '5.4 km' }));

      expect(load).toHaveBeenLastCalledWith('lmu', 42, 540);
      expect(processor.snapshot()).toMatchObject({
        trackKey: 'lmu:42',
        trackLengthM: 5400,
        elevationM: [],
        notes: [],
        version: before + 1,
      });
    });

    it('does nothing for a session republished unchanged', () => {
      const { processor, load } = start(profile());
      const before = processor.snapshot().version;
      const asked = load.mock.calls.length;
      processor.init(session());

      expect(processor.snapshot().version).toBe(before);
      expect(load).toHaveBeenCalledTimes(asked);
    });

    it('does not use a profile sampled at another length', () => {
      const { processor } = start(profile());
      // The same track id, a few metres longer after a sim update.
      processor.init(session({ trackLength: '3602 m' }));

      expect(processor.snapshot().elevationM).toEqual([]);
      expect(processor.snapshot().trackLengthM).toBe(3602);
    });

    it("follows the session's sectors when they change", () => {
      const { processor } = start();
      const before = processor.snapshot().version;
      processor.init(session({ sectors: [0, 0.25, 0.5, 0.75] }));

      expect(processor.snapshot().sectorStartPct).toEqual([0, 0.25, 0.5, 0.75]);
      expect(processor.snapshot().version).toBe(before + 1);
    });
  });

  describe('lifecycle', () => {
    it('keeps the profile through a session change: the track is the same', () => {
      const { processor } = start(profile());
      processor.onFrame(frame(0));
      const before = processor.snapshot().version;
      processor.onLifecycle({ type: 'sessionNumChange' });
      expect(processor.snapshot().version).toBe(before);

      processor.onFrame(frame(1));
      expect(processor.snapshot().sessionNum).toBe(1);
      expect(processor.snapshot().elevationRangeM).toBe(55.2);
      expect(processor.snapshot().version).toBe(before + 1);
    });

    it('keeps the profile in a replay', () => {
      const { processor } = start(profile());
      const before = processor.snapshot().version;
      processor.onLifecycle({ type: 'enter', replay: true });

      expect(processor.snapshot().version).toBe(before);
      expect(processor.snapshot().elevationM).toHaveLength(POINTS);
    });

    it('empties the snapshot on disconnect', () => {
      const { processor, state } = start(profile());
      state.progress = 0.5;
      processor.onFrame(frame(3));
      const before = processor.snapshot().version;
      processor.onLifecycle({ type: 'disconnect' });

      expect(processor.snapshot()).toEqual({
        trackKey: null,
        trackLengthM: 0,
        elevationM: [],
        lineElevationM: 0,
        elevationRangeM: 0,
        elevationSource: null,
        recordingProgress: null,
        sectorStartPct: [],
        notes: [],
        sessionNum: null,
        version: before + 1,
      });

      // And comes back with the next session.
      state.progress = null;
      processor.init(session());
      expect(processor.snapshot().elevationRangeM).toBe(55.2);
    });
  });

  it('names no track where there is no store behind it', () => {
    const processor = new TrackProfileProcessor();
    processor.init(session());
    processor.onFrame(frame());

    expect(processor.snapshot()).toMatchObject({
      trackKey: null,
      trackLengthM: 3590.35,
      elevationM: [],
      sectorStartPct: [0, 1 / 3, 2 / 3],
      sessionNum: 0,
    });
  });
});
