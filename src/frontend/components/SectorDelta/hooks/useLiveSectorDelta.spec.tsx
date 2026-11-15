import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReferenceLap, Session } from '@irdashies/types';
import {
  useReferenceLapStore,
  useSectorTimingStore,
  useSessionStore,
} from '@irdashies/context';
import { useLiveSectorDelta } from './useLiveSectorDelta';

vi.mock('@irdashies/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Sixty percent round the lap, twenty seconds after entering the sector
// that starts at forty.
const trackState = vi.hoisted(() => ({ lapDistPct: 0.6, sessionTime: 160 }));
vi.mock('@irdashies/context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@irdashies/context')>()),
  useTrackStateSnapshot: () => trackState,
}));

const PLAYER_CAR_IDX = 0;
const PLAYER_CLASS_ID = 1;
const POINTS = 400;

/** A lap driven at one speed: its time to any point is that share of it. */
const steadyLap = (lapTime: number): ReferenceLap => {
  const pointPos = new Float32Array(POINTS);
  const times = new Float32Array(POINTS);
  for (let index = 0; index < POINTS; index += 1) {
    pointPos[index] = index / POINTS;
    times[index] = pointPos[index] * lapTime;
  }
  return {
    pointPos,
    times,
    tangents: new Float32Array(POINTS).fill(lapTime),
    interval: 1 / POINTS,
    pointsCount: POINTS,
    startTime: 0,
    finishTime: lapTime,
    lastTrackedPct: 0.999,
    isCleanLap: true,
  };
};

beforeEach(() => {
  useReferenceLapStore.getState().completeSession();
  useSectorTimingStore.getState().reset();
  useSectorTimingStore.setState({
    sectors: [
      { SectorNum: 0, SectorStartPct: 0 },
      { SectorNum: 1, SectorStartPct: 0.4 },
      { SectorNum: 2, SectorStartPct: 0.8 },
    ],
    currentSectorIdx: 1,
    sectorEntryTime: 140,
    sectorEntryValid: true,
  });
  useSessionStore.setState({
    session: {
      DriverInfo: {
        DriverCarIdx: PLAYER_CAR_IDX,
        Drivers: [{ CarIdx: PLAYER_CAR_IDX, CarClassID: PLAYER_CLASS_ID }],
      },
    } as unknown as Session,
  });
});

const liveDelta = () => renderHook(() => useLiveSectorDelta()).result.current;

describe('the live delta in the current sector', () => {
  it('has nothing to show without a lap to measure against', () => {
    expect(liveDelta()).toBeNull();
  });

  it("measures against the player's all-time lap where the class has no reference", () => {
    // Le Mans Ultimate before a clean lap in the session. A 100 s lap
    // covers this fifth of it in the same twenty seconds.
    useReferenceLapStore.setState({ playerAllTimeLap: steadyLap(100) });
    expect(liveDelta()).toBeCloseTo(0, 2);
  });

  it("prefers the player's best lap of the session to either ghost", () => {
    useReferenceLapStore.setState({
      bestLaps: new Map([[PLAYER_CAR_IDX, steadyLap(90)]]),
      persistedLaps: new Map([[PLAYER_CLASS_ID, steadyLap(80)]]),
      playerAllTimeLap: steadyLap(100),
    });
    // Eighteen seconds on the 90 s lap.
    expect(liveDelta()).toBeCloseTo(2, 2);
  });

  it('measures against the class reference before the all-time lap', () => {
    useReferenceLapStore.setState({
      persistedLaps: new Map([[PLAYER_CLASS_ID, steadyLap(80)]]),
      playerAllTimeLap: steadyLap(100),
    });
    // Sixteen seconds on the 80 s lap.
    expect(liveDelta()).toBeCloseTo(4, 2);
  });

  it("does not measure against another car's best lap", () => {
    useReferenceLapStore.setState({
      bestLaps: new Map([[7, steadyLap(80)]]),
      persistedLaps: new Map([[2, steadyLap(80)]]),
    });
    expect(liveDelta()).toBeNull();
  });

  it('has nothing to show for a sector not seen from its start', () => {
    useReferenceLapStore.setState({ playerAllTimeLap: steadyLap(100) });
    useSectorTimingStore.setState({ sectorEntryValid: false });
    expect(liveDelta()).toBeNull();
  });
});
