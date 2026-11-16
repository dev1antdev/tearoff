import { cleanup, render, screen } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  EMPTY_PLAYER_STINT,
  LEDGER_LAP_CAUTION,
  TrackLocation,
} from '@irdashies/types';
import type {
  LapLogSnapshot,
  LapTimeLogConfig,
  PlayerLedgerSnapshot,
  PlayerStintSnapshot,
} from '@irdashies/types';
import {
  ENDURANCE_SAMPLE_STINTS,
  sampleLedger,
  type SampleStint,
} from '@irdashies/domain/ledger/ledgerSample';

let snapshot: LapLogSnapshot;
let ledger: PlayerLedgerSnapshot | undefined;
let stint: PlayerStintSnapshot | undefined;
let config: LapTimeLogConfig;
const ledgerEnabled = vi.fn<(enabled?: boolean) => void>();

vi.mock('@irdashies/context', () => ({
  useLapLogSnapshot: () => snapshot,
  usePlayerLedgerSnapshot: (enabled?: boolean) => {
    ledgerEnabled(enabled);
    return ledger;
  },
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

const settings = (
  history: Partial<LapTimeLogConfig['history']> = {},
  overrides: Partial<LapTimeLogConfig> = {}
): LapTimeLogConfig =>
  ({
    background: { opacity: 80 },
    foreground: { opacity: 70 },
    scale: 100,
    alignment: 'top',
    reverse: false,
    showCurrentLap: false,
    showPredictedLap: false,
    showLastLap: false,
    showBestLap: false,
    showAllTimeLap: false,
    delta: { enabled: false, method: 'bestlap' },
    history: { enabled: true, count: 20, ...history },
    sessionVisibility: {
      race: true,
      loneQualify: true,
      openQualify: true,
      practice: true,
      offlineTesting: true,
    },
    showOnlyWhenOnTrack: false,
    ...overrides,
  }) as LapTimeLogConfig;

vi.mock('./useLapTimeLogSettings', () => ({
  useLapTimeLogSettings: () => config,
}));

import { useLapTimeLog } from './useLapTimeLog';
import { LapTimeLogDisplay } from '../LapTimeLog';

const lapLog: LapLogSnapshot = {
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

/** The laps the history holds, newest first. */
const lapsOf = (result: { current: ReturnType<typeof useLapTimeLog> }) =>
  result.current.history.map((entry) => entry.lap);

beforeEach(() => {
  snapshot = { ...lapLog };
  config = settings();
  ledgerEnabled.mockClear();
  // An endurance race two stops in: stints of 12, 13 and 11 laps, and five
  // laps into the fourth.
  ({ ledger, live: stint } = sampleLedger({
    stints: ENDURANCE_SAMPLE_STINTS,
    sessionNum: 0,
  }));
});

afterEach(cleanup);

/**
 * The history is the player's ledger, which the main process keeps for every
 * lap whether or not this widget is on screen. The hook holds none of it: it
 * turns the ledger's rows of the current session into the list's entries.
 */
describe('the lap history', () => {
  it('lists every lap of the session the ledger holds, newest first', () => {
    const { result } = renderHook(() => useLapTimeLog());

    expect(lapsOf(result)).toHaveLength(41);
    expect(lapsOf(result).slice(0, 3)).toEqual([41, 40, 39]);
    expect(result.current.history[0]).toMatchObject({
      stintLap: 5,
      dirty: false,
      pitted: false,
    });
  });

  it('has the laps driven before the widget was shown', () => {
    // Nothing was seen by the hook: it mounts with the race half run.
    const first = renderHook(() => useLapTimeLog());
    const seen = lapsOf(first.result);
    first.unmount();

    // And again after the overlay window reloads.
    const { result } = renderHook(() => useLapTimeLog());

    expect(lapsOf(result)).toEqual(seen);
  });

  it('gains a row when the ledger does, and loses none', () => {
    const { result, rerender } = renderHook(() => useLapTimeLog());
    const next = sampleLedger({
      stints: [
        ...ENDURANCE_SAMPLE_STINTS.slice(0, 3),
        { ...ENDURANCE_SAMPLE_STINTS[3], laps: 6 },
      ],
      sessionNum: 0,
    });

    ({ ledger, live: stint } = next);
    rerender();

    expect(lapsOf(result).slice(0, 2)).toEqual([42, 41]);
    expect(lapsOf(result)).toHaveLength(42);
  });

  it('shows the laps of the current session only', () => {
    // The ledger keeps practice and qualifying while the race is on.
    const race = ledger as PlayerLedgerSnapshot;
    ledger = { ...race, sessionNum: 1 };

    expect(lapsOf(renderHook(() => useLapTimeLog()).result)).toEqual([]);
  });

  it('is empty until the ledger has been heard from', () => {
    ledger = undefined;
    stint = undefined;

    expect(lapsOf(renderHook(() => useLapTimeLog()).result)).toEqual([]);
  });

  it('marks a lap driven under a full-course caution, from its row', () => {
    const race = ledger as PlayerLedgerSnapshot;
    const cautions = race.laps
      .filter((lap) => (lap.flags & LEDGER_LAP_CAUTION) !== 0)
      .map((lap) => lap.lapNumber);
    expect(cautions).toEqual([21, 20]);

    const { result } = renderHook(() => useLapTimeLog());

    expect(
      result.current.history
        .filter((entry) => entry.caution)
        .map((entry) => entry.lap)
    ).toEqual([21, 20]);
  });

  it('measures each lap against the best before it, or the lap before it', () => {
    const best = renderHook(() => useLapTimeLog()).result.current.history;
    config = settings({}, { delta: { enabled: true, method: 'lastlap' } });
    const last = renderHook(() => useLapTimeLog()).result.current.history;

    // The newest lap against the lap before it.
    expect(last[0].delta).toBeCloseTo(last[0].time - last[1].time, 6);
    // And against the quickest clean lap of the race so far.
    const quickest = Math.min(
      ...best
        .slice(1)
        .filter((entry) => !entry.dirty && !entry.pitted && !entry.caution)
        .filter((entry) => !entry.fromStart)
        .map((entry) => entry.time)
    );
    expect(best[0].delta).toBeCloseTo(best[0].time - quickest, 6);
  });

  it('keeps to the stint under way when asked to', () => {
    config = settings({ thisStintOnly: true });

    const { result } = renderHook(() => useLapTimeLog());

    expect(lapsOf(result)).toEqual([41, 40, 39, 38, 37]);
  });

  it("keeps to the user's last stint once it is over", () => {
    // Back in the garage: no stint is under way, and the list is still the
    // stint just driven.
    config = settings({ thisStintOnly: true });
    stint = { ...EMPTY_PLAYER_STINT, available: true, sessionNum: 0 };

    const { result } = renderHook(() => useLapTimeLog());

    expect(lapsOf(result)).toEqual([41, 40, 39, 38, 37]);
  });

  it('does not ask for the ledger with the history switched off', () => {
    config = settings({ enabled: false });

    renderHook(() => useLapTimeLog());

    expect(ledgerEnabled).toHaveBeenLastCalledWith(false);
  });

  /**
   * The display leaves laps out before it takes the configured number of
   * them, so the ledger has to hold more than the display shows: 120 rows,
   * where the widget's own list held 60 and, before that, 20.
   */
  it('fills the display when pit laps are hidden', () => {
    // A 40 lap race stopping every fifth lap: eight in-laps and seven
    // out-laps among the 40.
    const fiveLaps: SampleStint = {
      laps: 5,
      closedBy: 'service',
      stop: { fuelAdded: 10, energyAdded: 0.1 },
    };
    ({ ledger, live: stint } = sampleLedger({
      stints: Array.from({ length: 8 }, () => fiveLaps),
      sessionNum: 0,
    }));
    const { result } = renderHook(() => useLapTimeLog());

    const clean = result.current.history.filter((entry) => !entry.pitted);
    expect(result.current.history).toHaveLength(40);
    expect(clean.length).toBeGreaterThanOrEqual(20);
    expect(result.current.history.filter((entry) => entry.pitted)).toHaveLength(
      15
    );

    render(
      <LapTimeLogDisplay
        {...result.current}
        settings={settings({ hidePittedLaps: true })}
      />
    );

    expect(screen.getAllByText(/^LAP \d+$/)).toHaveLength(20);
    // Every lap the display shows is a green one, and the newest clean lap
    // leads: a filter applied after the slice would have shown fewer rows.
    expect(screen.queryByText('LAP 40')).not.toBeInTheDocument();
    expect(screen.getByText('LAP 39')).toBeInTheDocument();
    for (const pitted of [36, 35, 31, 30, 25]) {
      expect(screen.queryByText(`LAP ${pitted}`)).not.toBeInTheDocument();
    }
  });
});
