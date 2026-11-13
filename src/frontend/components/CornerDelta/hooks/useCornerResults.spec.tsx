import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ChannelBridge,
  LapTraceSampleSnapshot,
  LovelyTrackSection,
  ReferenceLap,
  Session,
} from '@irdashies/types';
import { useReferenceLapStore, useSessionStore } from '@irdashies/context';
import { useCornerResults } from './useCornerResults';
import { MAX_CORNER_HISTORY } from './useCornerDeltaSettings';

vi.mock('@irdashies/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockSections = vi.fn<() => LovelyTrackSection[]>(() => []);
vi.mock('@irdashies/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@irdashies/context')>();
  return {
    ...actual,
    useLovelyTrackData: () => ({ sections: mockSections(), info: null }),
  };
});

const TRACK_M = 4000;
const POINTS = 400;
const PLAYER_CAR_IDX = 3;
/** One frame at 60 Hz. */
const FRAME_SEC = 1 / 60;

const corner = (
  overrides: Partial<LovelyTrackSection> = {}
): LovelyTrackSection =>
  ({
    section_id: 'turn-1',
    name: 'Turn 1',
    corner_number: 'T1',
    type: 'corner',
    start_pct: 0.2,
    end_pct: 0.25,
    length_pct: 0.05,
    ...overrides,
  }) as LovelyTrackSection;

const TWO_CORNERS = [
  corner(),
  corner({
    section_id: 'eau-rouge',
    name: 'Eau Rouge',
    corner_number: undefined,
    start_pct: 0.5,
    end_pct: 0.55,
  }),
];

/** A whole lap at one speed, with its speeds recorded. */
const steadyLap = (speedMs: number): ReferenceLap => {
  const lapTime = TRACK_M / speedMs;
  const pointPos = new Float32Array(POINTS);
  const times = new Float32Array(POINTS);
  for (let index = 0; index < POINTS; index += 1) {
    pointPos[index] = (index + 0.3) / POINTS;
    times[index] = pointPos[index] * lapTime;
  }
  return {
    pointPos,
    times,
    tangents: new Float32Array(POINTS).fill(lapTime),
    speedsKph: new Float32Array(POINTS).fill(speedMs * 3.6),
    interval: 1 / POINTS,
    pointsCount: POINTS,
    startTime: 0,
    finishTime: lapTime,
    lastTrackedPct: 0.999,
    isCleanLap: true,
  };
};

const setSession = (trackName: string | undefined) =>
  useSessionStore.setState({
    session: {
      WeekendInfo: { TrackName: trackName, TrackLength: '4.00 km' },
      DriverInfo: { DriverCarIdx: PLAYER_CAR_IDX },
    } as unknown as Session,
  });

let deliver: Record<string, ((payload: unknown) => void) | undefined>;
let subscribedChannels: string[];
let sampleVersion = 0;
/** Where the car is and what the session clock reads. */
let pct = 0;
let clock = 0;

const sample = (
  overrides: Partial<LapTraceSampleSnapshot> = {}
): LapTraceSampleSnapshot => ({
  sessionTime: clock,
  lapDistPct: pct,
  throttle: 1,
  brake: 0,
  speed: 50,
  gear: 4,
  brakeAbsActive: false,
  onPitRoad: false,
  isOnTrack: true,
  sessionNum: 0,
  lastLapTime: 0,
  lapCompleted: 0,
  incidentCount: 0,
  simLapInvalidated: false,
  version: ++sampleVersion,
  ...overrides,
});

const frame = (overrides: Partial<LapTraceSampleSnapshot> = {}) =>
  act(() => {
    deliver['lap-trace.sample']?.(sample(overrides));
  });

/** Drives on by a distance at a speed, a frame at a time. */
const go = (
  metres: number,
  speedMs = 50,
  overrides: Partial<LapTraceSampleSnapshot> = {}
) => {
  const stepM = speedMs * FRAME_SEC;
  for (let driven = 0; driven < metres; driven += stepM) {
    clock += FRAME_SEC;
    pct = (pct + stepM / TRACK_M) % 1;
    frame({ speed: speedMs, ...overrides });
  }
};

/** Puts the car somewhere without driving there, as a fresh start. */
const placeAt = (at: number) => {
  pct = at;
  clock += 5;
  frame();
};

describe('useCornerResults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSections.mockReturnValue(TWO_CORNERS);
    pct = 0;
    clock = 100;

    deliver = {};
    subscribedChannels = [];
    const subscribe = vi.fn(
      (channel: string, callback: (payload: unknown) => void) => {
        subscribedChannels.push(channel);
        deliver[channel] = callback;
        return () => {
          deliver[channel] = undefined;
        };
      }
    );
    window.channelBridge = { subscribe } as unknown as ChannelBridge;

    setSession('imola gp');
    useReferenceLapStore.getState().completeSession();
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).channelBridge;
    useSessionStore.setState({ session: null });
    useReferenceLapStore.getState().completeSession();
  });

  it('reports a corner once it has been driven through', () => {
    const { result } = renderHook(() => useCornerResults(true, 'name'));

    placeAt(0.19);
    go(140);
    // Inside the corner: nothing until it is finished.
    expect(result.current.results).toHaveLength(0);

    go(120);
    expect(result.current.results).toHaveLength(1);
    const [last] = result.current.results;
    expect(last.sectionId).toBe('turn-1');
    // 200 m at 50 m/s, in and out at 180 km/h.
    expect(last.timeSec).toBeCloseTo(4, 6);
    expect(last.entrySpeedKph).toBeCloseTo(180, 6);
    expect(last.exitSpeedKph).toBeCloseTo(180, 6);
  });

  it('sets the corner against the session best of the player own car', () => {
    useReferenceLapStore.setState({
      bestLaps: new Map([
        [PLAYER_CAR_IDX, steadyLap(40)],
        // Another car's best is not the player's.
        [PLAYER_CAR_IDX + 1, steadyLap(60)],
      ]),
    });
    const { result } = renderHook(() => useCornerResults(true, 'name'));

    placeAt(0.19);
    go(260);

    const { readings } = result.current.results[0];
    // Four seconds against five, and 180 km/h against 144.
    expect(readings.sessionBest.timeDeltaSec).toBeCloseTo(-1, 2);
    expect(readings.sessionBest.entrySpeedDeltaKph).toBeCloseTo(36, 3);
    expect(readings.sessionBest.exitSpeedDeltaKph).toBeCloseTo(36, 3);
    // Neither of the others exists yet, and neither borrows from it.
    expect(readings.allTime.timeDeltaSec).toBeNull();
    expect(readings.lastLap.timeDeltaSec).toBeNull();
  });

  it('sets the corner against the all-time lap from the lap library', () => {
    useReferenceLapStore.setState({ playerAllTimeLap: steadyLap(62.5) });
    const { result } = renderHook(() => useCornerResults(true, 'name'));

    placeAt(0.19);
    go(260);

    const { readings } = result.current.results[0];
    // Four seconds against 3.2.
    expect(readings.allTime.timeDeltaSec).toBeCloseTo(0.8, 2);
    expect(readings.allTime.entrySpeedDeltaKph).toBeCloseTo(-45, 3);
    expect(readings.sessionBest.timeDeltaSec).toBeNull();
  });

  it('reads the reference laps as they are when the corner is completed', () => {
    const { result } = renderHook(() => useCornerResults(true, 'name'));

    placeAt(0.19);
    go(140);
    // A best lap is set while the car is mid-corner.
    act(() => {
      useReferenceLapStore.setState({
        bestLaps: new Map([[PLAYER_CAR_IDX, steadyLap(40)]]),
      });
    });
    go(120);

    expect(
      result.current.results[0].readings.sessionBest.timeDeltaSec
    ).toBeCloseTo(-1, 2);
  });

  it('sets the corner against the last time it was driven', () => {
    const { result } = renderHook(() => useCornerResults(true, 'name'));

    placeAt(0.19);
    go(260, 50);
    // Round the lap and through it again, quicker.
    go(TRACK_M, 62.5);

    const turnOne = result.current.results.find(
      (entry) => entry.sectionId === 'turn-1'
    );
    expect(turnOne?.readings.lastLap.timeDeltaSec).toBeCloseTo(-0.8, 3);
    expect(turnOne?.readings.lastLap.entrySpeedDeltaKph).toBeCloseTo(45, 3);
  });

  it('lists the corners newest first, and keeps no more than it can show', () => {
    const { result } = renderHook(() => useCornerResults(true, 'name'));

    placeAt(0.19);
    go(TRACK_M * 0.4);
    expect(result.current.results.map((entry) => entry.sectionId)).toEqual([
      'eau-rouge',
      'turn-1',
    ]);

    go(TRACK_M * 4);
    expect(result.current.results).toHaveLength(MAX_CORNER_HISTORY + 1);
    // Every entry is its own pass, even of the same corner.
    const serials = result.current.results.map((entry) => entry.serial);
    expect(new Set(serials).size).toBe(serials.length);
    expect(serials).toEqual([...serials].sort((a, b) => b - a));
  });

  it('clears the list in the pit lane and keeps how each corner was driven', () => {
    const { result } = renderHook(() => useCornerResults(true, 'name'));

    placeAt(0.19);
    go(260);
    expect(result.current.results).toHaveLength(1);

    go(100, 20, { onPitRoad: true });
    expect(result.current.results).toHaveLength(0);

    // Out again and a lap round, through the corner: the stop is not its
    // last lap.
    go(TRACK_M, 62.5);
    const turnOne = result.current.results.find(
      (entry) => entry.sectionId === 'turn-1'
    );
    expect(turnOne?.readings.lastLap.timeDeltaSec).toBeCloseTo(-0.8, 3);
  });

  it('does not report a corner driven through the pit lane', () => {
    const { result } = renderHook(() => useCornerResults(true, 'name'));

    placeAt(0.19);
    go(260, 20, { onPitRoad: true });

    expect(result.current.results).toHaveLength(0);
  });

  it('starts afresh when the session moves on', () => {
    const { result } = renderHook(() => useCornerResults(true, 'name'));

    placeAt(0.19);
    go(260);
    expect(result.current.results).toHaveLength(1);

    // Practice into qualifying.
    go(100, 50, { sessionNum: 1 });
    expect(result.current.results).toHaveLength(0);

    go(TRACK_M - 100, 50, { sessionNum: 1 });
    const turnOne = result.current.results.find(
      (entry) => entry.sectionId === 'turn-1'
    );
    // Driven in practice, but that is not this session's last lap.
    expect(turnOne).toBeDefined();
    expect(turnOne?.readings.lastLap.timeDeltaSec).toBeNull();
  });

  it('reports nothing while a replay is playing', () => {
    const { result } = renderHook(() => useCornerResults(true, 'name'));
    act(() => {
      deliver['track-state.snapshot']?.({ isReplayPlaying: true });
    });

    placeAt(0.19);
    go(260);
    expect(result.current.results).toHaveLength(0);

    act(() => {
      deliver['track-state.snapshot']?.({ isReplayPlaying: false });
    });
    go(TRACK_M * 0.4);
    expect(result.current.results.map((entry) => entry.sectionId)).toEqual([
      'eau-rouge',
    ]);
  });

  it('labels the corners in the style asked for without losing the list', () => {
    const { result, rerender } = renderHook(
      ({ style }: { style: 'name' | 'number' }) =>
        useCornerResults(true, style),
      { initialProps: { style: 'name' } }
    );

    placeAt(0.19);
    go(TRACK_M * 0.4);
    expect(result.current.labels.get('eau-rouge')).toBe('Eau Rouge');
    expect(result.current.labels.get('turn-1')).toBe('T1');

    rerender({ style: 'number' });
    // Only one of the two has a number of its own, so both are counted off.
    expect(result.current.labels.get('eau-rouge')).toBe('T2');
    expect(result.current.results).toHaveLength(2);
  });

  it('says whether the track has corners, once a track is named', () => {
    expect(
      renderHook(() => useCornerResults(true, 'name')).result.current.hasCorners
    ).toBe(true);

    mockSections.mockReturnValue([]);
    expect(
      renderHook(() => useCornerResults(true, 'name')).result.current.hasCorners
    ).toBe(false);

    setSession(undefined);
    expect(
      renderHook(() => useCornerResults(true, 'name')).result.current.hasCorners
    ).toBeUndefined();
  });

  it('subscribes to nothing while switched off', () => {
    const { result } = renderHook(() => useCornerResults(false, 'name'));

    expect(subscribedChannels).toEqual([]);
    expect(result.current.results).toHaveLength(0);
  });

  it('lets go of its channels and its list when switched off', () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useCornerResults(enabled, 'name'),
      { initialProps: { enabled: true } }
    );
    placeAt(0.19);
    go(260);
    expect(result.current.results).toHaveLength(1);

    rerender({ enabled: false });

    expect(deliver['lap-trace.sample']).toBeUndefined();
    expect(deliver['track-state.snapshot']).toBeUndefined();
    expect(result.current.results).toHaveLength(0);
  });

  it('starts afresh on another track', () => {
    const { result, rerender } = renderHook(() =>
      useCornerResults(true, 'name')
    );
    placeAt(0.19);
    go(260);
    expect(result.current.results).toHaveLength(1);

    mockSections.mockReturnValue([
      corner({ section_id: 'la-source', start_pct: 0.3, end_pct: 0.35 }),
    ]);
    act(() => setSession('spa 2024 up'));
    rerender();
    expect(result.current.results).toHaveLength(0);

    go(TRACK_M * 0.2);
    expect(result.current.results.map((entry) => entry.sectionId)).toEqual([
      'la-source',
    ]);
  });
});
