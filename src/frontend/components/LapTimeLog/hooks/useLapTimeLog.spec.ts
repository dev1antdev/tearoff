import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_PLAYER_LEDGER,
  EMPTY_PLAYER_STINT,
  LEDGER_LAP_INCIDENT,
  LEDGER_LAP_IN_LAP,
  LEDGER_LAP_VOIDED,
  LEDGER_LAP_YELLOW,
  TrackLocation,
} from '@irdashies/types';
import type { LapLogSnapshot, PlayerStintSnapshot } from '@irdashies/types';

let snapshot: LapLogSnapshot;
let stint: PlayerStintSnapshot | undefined;

vi.mock('@irdashies/context', () => ({
  useLapLogSnapshot: () => snapshot,
  usePlayerLedgerSnapshot: () => EMPTY_PLAYER_LEDGER,
  usePlayerStintSnapshot: () => stint,
  useDriverCarIdx: () => 0,
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({
      session: {
        WeekendInfo: { TrackID: 1 },
        DriverInfo: { Drivers: [{ CarIdx: 0, CarPath: 'testcar' }] },
      },
    }),
  usePersonalBestStore: (selector: (state: unknown) => unknown) =>
    selector({
      getPersonalBest: () => undefined,
      setPersonalBest: () => undefined,
    }),
  useGeneralSettings: () => undefined,
}));

vi.mock('./useLapTimeLogSettings', () => ({
  useLapTimeLogSettings: () => undefined,
}));

import { useLapTimeLog } from './useLapTimeLog';

const lapLog: LapLogSnapshot = {
  lapCompleted: 4,
  currentLapTime: 30,
  lastLapTime: 91,
  bestLapTime: 90,
  ownBestLapTime: 90,
  carIdxBestLapTime: [],
  sessionNum: 0,
  sessionTime: 400,
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

/** The stint under way, with the lap being driven as the ledger has it. */
const driving = (
  lap: Partial<PlayerStintSnapshot['lap']> = {}
): PlayerStintSnapshot => ({
  ...EMPTY_PLAYER_STINT,
  available: true,
  state: 'running',
  sessionNum: 0,
  lap: {
    lapNumber: 5,
    stintLap: 3,
    fuelUsed: 0.8,
    energyUsed: null,
    treadUsed: [0.002, 0.002, 0.001, 0.001],
    flags: 0,
    ...lap,
  },
});

/**
 * What the hook says of the lap under way. It no longer watches the track
 * surface, the incident count and the sim's void flag itself: the ledger in
 * the main process does, for every lap whether or not this widget is on
 * screen, and publishes what it has seen so far with the stint under way.
 */
describe('the lap under way', () => {
  beforeEach(() => {
    snapshot = { ...lapLog };
    stint = driving();
  });

  const dirtyWith = (flags: number) => {
    stint = driving({ flags });
    return renderHook(() => useLapTimeLog()).result.current.dirty;
  };

  it('is clean until the ledger says otherwise', () => {
    expect(dirtyWith(0)).toBe(false);
  });

  it('is dirty once the sim has voided it', () => {
    expect(dirtyWith(LEDGER_LAP_VOIDED)).toBe(true);
  });

  it('is dirty after an incident or an off-track', () => {
    expect(dirtyWith(LEDGER_LAP_INCIDENT)).toBe(true);
  });

  it('is not dirty for a yellow flag or a visit to the pit lane', () => {
    expect(dirtyWith(LEDGER_LAP_YELLOW | LEDGER_LAP_IN_LAP)).toBe(false);
  });

  it('follows the ledger, not the void flag the lap log still carries', () => {
    // The sim's flag lingers past the line; the ledger knows whose it is.
    snapshot = { ...snapshot, lapInvalidated: true, incidentCount: 4 };

    expect(dirtyWith(0)).toBe(false);
  });

  it('is clean while the ledger has not been heard from', () => {
    stint = undefined;

    const { result } = renderHook(() => useLapTimeLog());

    expect(result.current.dirty).toBe(false);
    expect(result.current.currentRow).toBeUndefined();
  });

  it('is a row of the history, with what it has used so far', () => {
    stint = driving({ flags: LEDGER_LAP_YELLOW });

    const { result } = renderHook(() => useLapTimeLog());

    expect(result.current.currentRow).toMatchObject({
      lap: 5,
      stintLap: 3,
      fuelUsed: 0.8,
      energyUsed: null,
      wear: expect.closeTo(0.0015, 6),
      yellow: true,
      dirty: false,
    });
  });

  it('is no row with no player car', () => {
    stint = { ...driving(), available: false };

    expect(
      renderHook(() => useLapTimeLog()).result.current.currentRow
    ).toBeUndefined();
  });

  it('is still timed from the lap log', () => {
    const { result, rerender } = renderHook(() => useLapTimeLog());
    expect(result.current.current).toBe(30);

    snapshot = { ...snapshot, currentLapTime: 31.5 };
    rerender();

    expect(result.current).toMatchObject({
      current: 31.5,
      lastlap: 91,
      bestlap: 90,
    });
  });
});
