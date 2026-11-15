import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_PLAYER_STINT,
  LEDGER_LAP_IN_LAP,
  LEDGER_LAP_OUT_LAP,
  LEDGER_LAP_SERVICED,
  LEDGER_LAP_VOIDED,
  TrackLocation,
} from '@irdashies/types';
import type {
  LapLogSnapshot,
  LedgerLap,
  PlayerLedgerSnapshot,
  PlayerStintSnapshot,
} from '@irdashies/types';
import { sampleLedger } from '@irdashies/domain/ledger/ledgerSample';

let snapshot: LapLogSnapshot;
let ledger: PlayerLedgerSnapshot | undefined;
let stint: PlayerStintSnapshot | undefined;
let drivers: { CarIdx: number; CarPath: string; CarModel?: string }[];
const getPersonalBest = vi.fn<(track: string, car: string) => undefined>();
const setPersonalBest =
  vi.fn<(track: string, car: string, time: number) => void>();

vi.mock('@irdashies/context', () => ({
  useLapLogSnapshot: () => snapshot,
  usePlayerLedgerSnapshot: () => ledger,
  usePlayerStintSnapshot: () => stint,
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
  ledger = undefined;
  stint = undefined;
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

/**
 * Three laps of an LMU stint as the ledger rows them, newest first, each
 * with the flags the ledger gathered for it.
 */
const rowsOf = (flags: readonly [number, number, number]): LedgerLap[] => {
  const { laps } = sampleLedger({
    stints: [{ laps: 3 }],
    sessionNum: 0,
    fromStart: false,
  }).ledger;
  return laps.map((lap, index) => ({ ...lap, flags: flags[index] }));
};

const withRows = (flags: readonly [number, number, number]) => {
  ledger = { laps: rowsOf(flags), stints: [], sessionNum: 0, version: 1 };
};

describe('Lap Timer under an LMU lap void', () => {
  beforeEach(() => {
    drivers = [{ CarIdx: 0, CarPath: 'testcar' }];
  });

  it('marks a lap LMU voided as not clean', () => {
    // A track cut: no incident and no off-track surface to show for it. The
    // ledger has the sim's word for the lap, and the row carries it.
    withRows([0, LEDGER_LAP_VOIDED, 0]);

    const { result } = renderHook(() => useLapTimeLog());

    expect(result.current.history.map((entry) => entry.dirty)).toEqual([
      false,
      true,
      false,
    ]);
    expect(result.current.history[1]).toMatchObject({ lap: 2, dirty: true });
  });

  it('does not carry a void still set after the line into the next lap', () => {
    // The sim's flag is still the old lap's for a few frames into the new
    // one. The ledger gave it to the lap it belonged to, so the lap under
    // way is clean whatever the lap log's own flag still says.
    withRows([LEDGER_LAP_VOIDED, 0, 0]);
    snapshot = { ...snapshot, lapInvalidated: true, lapDistPct: 0.02 };
    stint = { ...EMPTY_PLAYER_STINT, available: true, sessionNum: 0 };

    const { result } = renderHook(() => useLapTimeLog());

    expect(result.current.history[0]).toMatchObject({ lap: 3, dirty: true });
    expect(result.current.dirty).toBe(false);
  });

  it('leaves a clean lap clean', () => {
    withRows([0, 0, 0]);

    const { result } = renderHook(() => useLapTimeLog());

    expect(result.current.history.map((entry) => entry.dirty)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('is not measured against when it was the quickest', () => {
    // The voided lap is the quickest of the three, and is no best lap.
    withRows([0, LEDGER_LAP_VOIDED, 0]);
    const rows = (ledger as PlayerLedgerSnapshot).laps;
    ledger = {
      ...(ledger as PlayerLedgerSnapshot),
      laps: [rows[0], { ...rows[1], simLapTime: 80, lapTime: 80 }, rows[2]],
    };

    const [newest, voided, oldest] = renderHook(() => useLapTimeLog()).result
      .current.history;

    expect(voided.delta).toBeCloseTo(80 - oldest.time, 6);
    expect(newest.delta).toBeCloseTo(newest.time - oldest.time, 6);
  });
});

describe('Lap Timer pit laps', () => {
  beforeEach(() => {
    drivers = [{ CarIdx: 0, CarPath: 'testcar' }];
  });

  it('marks the lap into the pit lane and the lap out of it', () => {
    withRows([LEDGER_LAP_OUT_LAP | LEDGER_LAP_SERVICED, LEDGER_LAP_IN_LAP, 0]);

    const { result } = renderHook(() => useLapTimeLog());

    expect(result.current.history.map((entry) => entry.pitted)).toEqual([
      true,
      true,
      false,
    ]);
    // A stop is not a dirty lap.
    expect(result.current.history.some((entry) => entry.dirty)).toBe(false);
  });
});
