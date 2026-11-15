import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TrackLocation } from '@irdashies/types';
import type { LapLogSnapshot } from '@irdashies/types';

let snapshot: LapLogSnapshot;
let drivers: { CarIdx: number; CarPath: string; CarModel?: string }[];
const getPersonalBest = vi.fn<(track: string, car: string) => undefined>();
const setPersonalBest =
  vi.fn<(track: string, car: string, time: number) => void>();

vi.mock('@irdashies/context', () => ({
  useLapLogSnapshot: () => snapshot,
  useDriverCarIdx: () => 0,
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({
      session: {
        WeekendInfo: { TrackID: 1 },
        DriverInfo: { Drivers: drivers },
      },
    }),
  usePersonalBestStore: (selector: (state: unknown) => unknown) =>
    selector({ getPersonalBest, setPersonalBest }),
  useGeneralSettings: () => undefined,
}));

vi.mock('./useLapTimeLogSettings', () => ({
  useLapTimeLogSettings: () => undefined,
}));

import { useLapTimeLog } from './useLapTimeLog';

const emptySnapshot: LapLogSnapshot = {
  lapCompleted: 0,
  currentLapTime: 30,
  lastLapTime: 0,
  bestLapTime: 0,
  ownBestLapTime: 0,
  carIdxBestLapTime: [],
  sessionNum: 0,
  sessionTime: 0,
  playerTrackSurface: TrackLocation.OnTrack,
  incidentCount: 0,
  lapDistPct: 0.5,
  deltaToSessionLastLap: 0,
  deltaToSessionLastLapOk: false,
  deltaToSessionBestLap: 0,
  deltaToSessionBestLapOk: false,
  lapInvalidated: false,
  lastLapInvalid: false,
  lastLapUnderCaution: false,
  version: 0,
};

beforeEach(() => {
  snapshot = { ...emptySnapshot };
  getPersonalBest.mockClear();
  setPersonalBest.mockClear();
});

describe('Lap Timer personal best', () => {
  beforeEach(() => {
    drivers = [
      { CarIdx: 0, CarPath: 'AF_LMGT3_23.VEH', CarModel: 'Ferrari 296 LMGT3' },
    ];
  });

  it('is taken from the best lap the user drove', () => {
    const { rerender } = renderHook(() => useLapTimeLog());
    snapshot = { ...snapshot, bestLapTime: 104.2, ownBestLapTime: 104.2 };
    rerender();

    expect(setPersonalBest).toHaveBeenCalledWith(
      '1',
      'Ferrari 296 LMGT3',
      104.2
    );
  });

  it('is not taken from the car’s best lap when a team-mate set it', () => {
    // The car's best of the session moves; the user's own does not.
    const { result, rerender } = renderHook(() => useLapTimeLog());
    snapshot = { ...snapshot, bestLapTime: 103.1, ownBestLapTime: 0 };
    rerender();

    expect(setPersonalBest).not.toHaveBeenCalled();
    // The session's best for the car is still what the widget shows.
    expect(result.current.bestlap).toBe(103.1);
  });

  it('is not replaced by a team-mate’s quicker lap once the user has one', () => {
    const { rerender } = renderHook(() => useLapTimeLog());
    snapshot = { ...snapshot, bestLapTime: 104.2, ownBestLapTime: 104.2 };
    rerender();
    setPersonalBest.mockClear();

    // The team-mate goes quicker in the same car.
    snapshot = { ...snapshot, bestLapTime: 103.1 };
    rerender();

    expect(setPersonalBest).not.toHaveBeenCalled();
  });
});

describe('Lap Timer personal-best key', () => {
  it('keys an LMU car by its model, so a second livery shares the record', () => {
    // CarPath is the livery's .VEH file under LMU.
    drivers = [
      { CarIdx: 0, CarPath: 'AF_LMGT3_23.VEH', CarModel: 'Ferrari 296 LMGT3' },
    ];
    renderHook(() => useLapTimeLog());
    expect(getPersonalBest).toHaveBeenCalledWith('1', 'Ferrari 296 LMGT3');
  });

  it('keeps keying an iRacing car by CarPath, which has no CarModel', () => {
    drivers = [{ CarIdx: 0, CarPath: 'ferrari296gt3' }];
    renderHook(() => useLapTimeLog());
    expect(getPersonalBest).toHaveBeenCalledWith('1', 'ferrari296gt3');
  });
});

describe('Lap Timer under an LMU lap void', () => {
  /** Runs one lap: `during` mid-lap, then the crossing and scoring. */
  const driveLap = (
    rerender: () => void,
    lap: number,
    during: Partial<LapLogSnapshot>,
    atLine: Partial<LapLogSnapshot> = {}
  ) => {
    snapshot = { ...snapshot, lapDistPct: 0.5, ...during };
    rerender();
    snapshot = { ...snapshot, lapDistPct: 0.97, ...during };
    rerender();
    snapshot = {
      ...snapshot,
      lapDistPct: 0.01,
      lapCompleted: lap,
      lastLapTime: 90 + lap,
      ...atLine,
    };
    rerender();
    snapshot = { ...snapshot, lapDistPct: 0.1, lapInvalidated: false };
    rerender();
  };

  beforeEach(() => {
    drivers = [{ CarIdx: 0, CarPath: 'testcar' }];
  });

  it('marks a lap LMU voided as not clean', () => {
    // A track cut: no incident and no off-track surface to show for it.
    const { result, rerender } = renderHook(() => useLapTimeLog());
    driveLap(rerender, 1, { lapInvalidated: true });

    expect(result.current.history[0]).toMatchObject({ lap: 1, dirty: true });
  });

  it('does not carry a void still set after the line into the next lap', () => {
    const { result, rerender } = renderHook(() => useLapTimeLog());
    snapshot = { ...snapshot, lapDistPct: 0.5, lapInvalidated: true };
    rerender();
    snapshot = { ...snapshot, lapDistPct: 0.97 };
    rerender();
    // Lap 1 is scored at the line, and the sim's flag is still the old lap's
    // for a few frames into lap 2.
    snapshot = {
      ...snapshot,
      lapDistPct: 0.01,
      lapCompleted: 1,
      lastLapTime: 91,
    };
    rerender();
    snapshot = { ...snapshot, lapDistPct: 0.02, currentLapTime: 1 };
    rerender();
    snapshot = { ...snapshot, lapDistPct: 0.1, lapInvalidated: false };
    rerender();
    driveLap(rerender, 2, {});

    expect(result.current.history.map((entry) => entry.dirty)).toEqual([
      false,
      true,
    ]);
  });

  it('leaves a clean lap clean', () => {
    const { result, rerender } = renderHook(() => useLapTimeLog());
    driveLap(rerender, 1, {});

    expect(result.current.history[0]).toMatchObject({ lap: 1, dirty: false });
  });
});
