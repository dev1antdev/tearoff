import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReferenceLap, Session } from '@irdashies/types';
import { useSessionStore } from '../SessionStore/SessionStore';
import { useReferenceLapStore } from '../ReferenceLapStore/ReferenceLapStore';
import { useSectorTimingStore } from '../SectorTimingStore/SectorTimingStore';
import {
  useGhostReferenceLap,
  useReferenceLapSectorTimes,
} from './useReferenceLapSectorTimes';

vi.mock('@irdashies/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// The sim, which decides whether the player's own lap may stand in for a
// class reference. Le Mans Ultimate unless a test says otherwise.
const sim = vi.hoisted(() => ({ active: 'lmu' as 'lmu' | 'iracing' | null }));
vi.mock('./useActiveSimulator', () => ({
  useActiveSimulator: () => sim.active,
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

const sectorsAt = (...starts: number[]) =>
  starts.map((SectorStartPct, SectorNum) => ({ SectorNum, SectorStartPct }));

beforeEach(() => {
  sim.active = 'lmu';
  useReferenceLapStore.getState().completeSession();
  useSectorTimingStore.getState().reset();
  useSectorTimingStore.setState({ sectors: sectorsAt(0, 0.4, 0.8) });
  useSessionStore.setState({
    session: {
      DriverInfo: {
        DriverCarIdx: PLAYER_CAR_IDX,
        Drivers: [
          { CarIdx: PLAYER_CAR_IDX, CarClassID: PLAYER_CLASS_ID },
          { CarIdx: 7, CarClassID: 2 },
        ],
      },
    } as unknown as Session,
  });
});

describe('the sector ghost', () => {
  it("is the reference of the player's class where the session has one", () => {
    const classBest = steadyLap(90);
    useReferenceLapStore.setState({
      persistedLaps: new Map([[PLAYER_CLASS_ID, classBest]]),
      playerAllTimeLap: steadyLap(100),
    });

    expect(renderHook(() => useGhostReferenceLap()).result.current).toBe(
      classBest
    );
    const { result } = renderHook(() => useReferenceLapSectorTimes());
    expect(result.current.hasReferenceLap).toBe(true);
    expect(result.current.refSectorTimes[0]).toBeCloseTo(36, 3);
    expect(result.current.refSectorTimes[1]).toBeCloseTo(36, 3);
    expect(result.current.refSectorTimes[2]).toBeCloseTo(18, 3);
  });

  it("is the player's own all-time lap where the class has no reference", () => {
    // Le Mans Ultimate has no class references at all. A lap for another
    // class, as iRacing may hold, is not the player's ghost either.
    const allTime = steadyLap(100);
    useReferenceLapStore.setState({
      persistedLaps: new Map([[2, steadyLap(80)]]),
      playerAllTimeLap: allTime,
    });

    expect(renderHook(() => useGhostReferenceLap()).result.current).toBe(
      allTime
    );
    const { result } = renderHook(() => useReferenceLapSectorTimes());
    expect(result.current.hasReferenceLap).toBe(true);
    expect(result.current.refSectorTimes[0]).toBeCloseTo(40, 3);
    expect(result.current.refSectorTimes[1]).toBeCloseTo(40, 3);
    expect(result.current.refSectorTimes[2]).toBeCloseTo(20, 3);
  });

  it('leaves iRacing to its session bests until its class lap arrives', () => {
    // An iRacing class with no stored lap yet gets one during the session.
    // A ghost that was the player's own lap until then would become another
    // car's mid-run, so there the all-time lap does not stand in.
    sim.active = 'iracing';
    useReferenceLapStore.setState({ playerAllTimeLap: steadyLap(100) });

    expect(renderHook(() => useGhostReferenceLap()).result.current).toBeNull();
    const { result } = renderHook(() => useReferenceLapSectorTimes());
    expect(result.current.hasReferenceLap).toBe(false);

    const classBest = steadyLap(90);
    act(() => {
      useReferenceLapStore.setState({
        persistedLaps: new Map([[PLAYER_CLASS_ID, classBest]]),
      });
    });
    expect(result.current.hasReferenceLap).toBe(true);
    expect(result.current.refSectorTimes[0]).toBeCloseTo(36, 3);
  });

  it('is no lap at all with neither, whatever laps the session holds', () => {
    useReferenceLapStore.setState({
      bestLaps: new Map([
        [PLAYER_CAR_IDX, steadyLap(95)],
        [7, steadyLap(85)],
      ]),
    });

    expect(renderHook(() => useGhostReferenceLap()).result.current).toBeNull();
    const { result } = renderHook(() => useReferenceLapSectorTimes());
    expect(result.current).toEqual({
      refSectorTimes: [],
      hasReferenceLap: false,
    });
  });

  it('takes up the all-time lap when the lap library gets one', () => {
    const { result } = renderHook(() => useReferenceLapSectorTimes());
    expect(result.current.hasReferenceLap).toBe(false);

    act(() => {
      useReferenceLapStore.setState({ playerAllTimeLap: steadyLap(100) });
    });
    expect(result.current.hasReferenceLap).toBe(true);
    expect(result.current.refSectorTimes[0]).toBeCloseTo(40, 3);
  });

  it('reads the ghost between the sector starts as they are learned', () => {
    // Thirds until the car has been seen crossing into each sector.
    useSectorTimingStore.setState({ sectors: sectorsAt(0, 1 / 3, 2 / 3) });
    useReferenceLapStore.setState({ playerAllTimeLap: steadyLap(90) });
    const { result } = renderHook(() => useReferenceLapSectorTimes());
    expect(result.current.refSectorTimes[0]).toBeCloseTo(30, 2);

    act(() => {
      useSectorTimingStore.setState({ sectors: sectorsAt(0, 0.39, 0.79) });
    });
    expect(result.current.refSectorTimes[0]).toBeCloseTo(35.1, 2);
    expect(result.current.refSectorTimes[1]).toBeCloseTo(36, 2);
    expect(result.current.refSectorTimes[2]).toBeCloseTo(18.9, 2);
  });

  it('has no ghost for a lap that was never finished', () => {
    useReferenceLapStore.setState({
      playerAllTimeLap: { ...steadyLap(100), startTime: -1, finishTime: -1 },
    });
    const { result } = renderHook(() => useReferenceLapSectorTimes());
    expect(result.current.hasReferenceLap).toBe(false);
  });
});
