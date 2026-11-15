import { describe, expect, it } from 'vitest';
import type { LedgerLap, LedgerStint } from '@irdashies/types';
import {
  LEDGER_LAP_IN_LAP,
  LEDGER_LAP_VOIDED,
  LEDGER_LAP_WET,
} from '@irdashies/types';
import {
  cleanLapsOf,
  hasLapFlag,
  lapsOfSession,
  lapsOfStint,
  shownLapTime,
  stintTotals,
} from './ledgerRows';

const lap = (overrides: Partial<LedgerLap> = {}): LedgerLap =>
  ({
    id: 0,
    stintId: 'run:1:1',
    sessionNum: 1,
    lapNumber: 1,
    lapTime: 90,
    simLapTime: null,
    flags: 0,
    ...overrides,
  }) as LedgerLap;

const stint = (overrides: Partial<LedgerStint> = {}): LedgerStint =>
  ({
    id: 'run:1:1',
    startTime: 100,
    endTime: 1900,
    startFuel: 60,
    endFuel: 12.5,
    startEnergy: 0.98,
    endEnergy: 0.06,
    startTread: [1, 1, 1, 1],
    endTread: [0.9, 0.91, 0.93, null],
    startBrake: [36, 36, 32, 32],
    endBrake: [35.9, 35.9, 31.95, 31.95],
    ...overrides,
  }) as LedgerStint;

describe('ledger rows', () => {
  // Newest first, as the channel carries them.
  const laps = [
    lap({ lapNumber: 5, stintId: 'run:1:2', flags: LEDGER_LAP_WET }),
    lap({ lapNumber: 4, stintId: 'run:1:2', flags: LEDGER_LAP_IN_LAP }),
    lap({ lapNumber: 3, flags: LEDGER_LAP_VOIDED }),
    lap({ lapNumber: 2 }),
    lap({ lapNumber: 9, sessionNum: 0, stintId: 'run:0:1' }),
    lap({ lapNumber: 8, sessionNum: 0, stintId: '' }),
  ];
  const numbers = (rows: LedgerLap[]) => rows.map((row) => row.lapNumber);

  it('picks out the rows of a session', () => {
    expect(numbers(lapsOfSession(laps, 1))).toEqual([5, 4, 3, 2]);
    expect(numbers(lapsOfSession(laps, 0))).toEqual([9, 8]);
    expect(lapsOfSession(laps, null)).toEqual([]);
  });

  it('picks out the rows of a stint, and none for a lap driven outside any', () => {
    expect(numbers(lapsOfStint(laps, 'run:1:2'))).toEqual([5, 4]);
    expect(numbers(lapsOfStint(laps, 'run:1:1'))).toEqual([3, 2]);
    expect(lapsOfStint(laps, '')).toEqual([]);
  });

  it('keeps the clean rows, wet or dry', () => {
    expect(numbers(cleanLapsOf(lapsOfSession(laps, 1)))).toEqual([5, 2]);
  });

  it('tests a row for a flag', () => {
    expect(hasLapFlag(laps[1], LEDGER_LAP_IN_LAP)).toBe(true);
    expect(hasLapFlag(laps[1], LEDGER_LAP_VOIDED)).toBe(false);
  });

  it("shows the sim's lap time when it gave one, and the app's otherwise", () => {
    expect(shownLapTime(lap({ lapTime: 86.671, simLapTime: 86.66 }))).toBe(
      86.66
    );
    expect(shownLapTime(lap({ lapTime: 86.671 }))).toBe(86.671);
  });

  it('takes what a stint used from its two ends', () => {
    const totals = stintTotals(stint());

    expect(totals.time).toBe(1800);
    expect(totals.fuel).toBeCloseTo(47.5, 9);
    expect(totals.energy).toBeCloseTo(0.92, 9);
    expect(totals.tread[0]).toBeCloseTo(0.1, 9);
    expect(totals.tread[2]).toBeCloseTo(0.07, 9);
    // A wheel without a reading at one end has no figure, not a nought.
    expect(totals.tread[3]).toBeNull();
    expect(totals.brake[2]).toBeCloseTo(0.05, 9);
  });

  it('has no totals for what was never read', () => {
    const totals = stintTotals(
      stint({ endTime: null, startEnergy: null, endEnergy: null })
    );

    expect(totals.time).toBeNull();
    expect(totals.energy).toBeNull();
    expect(totals.fuel).toBeCloseTo(47.5, 9);
  });
});
