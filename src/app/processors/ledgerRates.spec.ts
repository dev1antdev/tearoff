import { describe, expect, it } from 'vitest';
import type { LapLibraryLap, LedgerLap } from '@irdashies/types';
import { LEDGER_LAP_IN_LAP, LEDGER_LAP_YELLOW } from '@irdashies/types';
import { baselineFrom, LedgerRateBook, medianOf } from './ledgerRates';

const MEDIUMS = ['Medium', 'Medium', 'Medium', 'Medium'];

let number = 0;
const lap = (overrides: Partial<LedgerLap> = {}): LedgerLap =>
  ({
    stintId: 'run:1:1',
    sessionNum: 1,
    lapNumber: (number += 1),
    lapTime: 90,
    flags: 0,
    fuelUsed: 2.4,
    energyUsed: 0.02,
    treadUsed: [0.005, 0.005, 0.004, 0.004],
    brakeUsed: [0.002, 0.002, 0.001, 0.001],
    ...overrides,
  }) as LedgerLap;

/** Newest first, as the ledger keeps its rows. */
const newestFirst = (...laps: LedgerLap[]): LedgerLap[] => laps.reverse();

const stored = (
  fuelUsed: number,
  lapTime: number,
  compounds: string[] = MEDIUMS,
  treadUsed: (number | null)[] = [0.004, 0.004, 0.003, 0.003]
): LapLibraryLap =>
  ({
    lapTime,
    fuelUsed,
    energyUsed: null,
    ledger: { compounds, treadUsed, brakeUsed: [0.002, 0.002, null, null] },
  }) as unknown as LapLibraryLap;

describe('ledger rates', () => {
  it('takes the median, so one odd lap does not move it', () => {
    expect(medianOf([])).toBeNull();
    expect(medianOf([3])).toBe(3);
    expect(medianOf([2.4, 9, 2.5])).toBe(2.5);
    expect(medianOf([2, 4, 3, 1])).toBe(2.5);
  });

  it('takes the rates from the last five clean laps of the open stint', () => {
    const book = new LedgerRateBook();
    const laps = newestFirst(
      lap({ fuelUsed: 9, lapTime: 99 }),
      lap({ fuelUsed: 2.3, lapTime: 91 }),
      lap({ fuelUsed: 2.4, lapTime: 90 }),
      lap({ fuelUsed: 2.5, lapTime: 92 }),
      // Not clean: an in-lap is no measure of anything.
      lap({ fuelUsed: 1, lapTime: 120, flags: LEDGER_LAP_IN_LAP }),
      lap({ fuelUsed: 2.6, lapTime: 93 }),
      // A local yellow does not make a lap unclean.
      lap({ fuelUsed: 2.7, lapTime: 94, flags: LEDGER_LAP_YELLOW })
    );

    const rates = book.rates(laps, 'run:1:1', 1, MEDIUMS);

    // The first lap is the sixth clean one back, and out of the window.
    expect(rates).toMatchObject({ source: 'stint', fuel: 2.5, lapTime: 92 });
    expect(rates.energy).toBe(0.02);
    expect(rates.brake).toEqual([0.002, 0.002, 0.001, 0.001]);
  });

  it('falls back to the session, then to the baseline, then to nothing', () => {
    const book = new LedgerRateBook();
    const laps = newestFirst(
      lap({ stintId: 'run:1:1', fuelUsed: 2.2 }),
      lap({ stintId: 'run:1:1', sessionNum: 0, fuelUsed: 3 })
    );

    // A new stint without a clean lap yet: the session's.
    expect(book.rates(laps, 'run:1:2', 1, MEDIUMS)).toMatchObject({
      source: 'session',
      fuel: 2.2,
    });
    // Another session without one either: nothing, until there is a baseline.
    expect(book.rates(laps, 'run:2:1', 2, MEDIUMS)).toMatchObject({
      source: null,
      fuel: null,
      lapTime: null,
    });
    book.setBaseline(baselineFrom([stored(2.6, 91), stored(2.8, 93)]));
    expect(book.rates(laps, 'run:2:1', 2, MEDIUMS)).toMatchObject({
      source: 'baseline',
      fuel: 2.7,
      lapTime: 92,
      energy: null,
      brake: [0.002, 0.002, null, null],
      tread: [0.004, 0.004, 0.003, 0.003],
    });
  });

  it('takes tread from the laps on the tyre that is on the car, stint or no stint', () => {
    const book = new LedgerRateBook();
    const first = lap({ treadUsed: [0.006, 0.006, 0.004, 0.004] });
    const second = lap({ treadUsed: [0.008, 0.008, 0.004, 0.004] });
    book.noteLap(first);
    book.noteLap(second);
    // An unclean lap is not a measure of tread either.
    book.noteLap(lap({ treadUsed: [0.1, 0.1, 0.1, 0.1], flags: 1 }));
    const laps = newestFirst(first, second);

    // Double-stinting the tyres: a new stint, the same rubber.
    expect(book.rates(laps, 'run:1:2', 1, MEDIUMS).tread).toEqual([
      0.007, 0.007, 0.004, 0.004,
    ]);

    // New fronts: their laps are gone, and the session's stand in until
    // the new ones have a lap of their own.
    book.noteTyreChange(0b0011);
    expect(book.rates(laps, 'run:1:2', 1, MEDIUMS).tread).toEqual([
      0.007, 0.007, 0.004, 0.004,
    ]);
    expect(book.rates([], 'run:1:2', 1, MEDIUMS).tread).toEqual([
      null,
      null,
      0.004,
      0.004,
    ]);
    book.noteLap(lap({ treadUsed: [0.003, 0.003, 0.004, 0.004] }));
    expect(book.rates([], 'run:1:2', 1, MEDIUMS).tread).toEqual([
      0.003, 0.003, 0.004, 0.004,
    ]);
  });

  it('keeps a baseline of tread for each compound by name', () => {
    const hards = ['Hard', 'Hard', 'Medium', 'Medium'];
    const baseline = baselineFrom([
      stored(2.5, 90, MEDIUMS, [0.005, 0.005, 0.004, 0.004]),
      stored(2.5, 90, hards, [0.003, 0.003, 0.004, 0.004]),
      stored(2.5, 90, MEDIUMS, [0.007, 0.007, 0.006, null]),
      // A lap stored before the ledger existed has nothing to add.
      { lapTime: 80, fuelUsed: 1, ledger: null } as unknown as LapLibraryLap,
    ]);

    expect(baseline?.laps).toBe(3);
    expect(baseline?.treadByCompound.Medium).toEqual([
      0.006, 0.006, 0.004, 0.004,
    ]);
    expect(baseline?.treadByCompound.Hard).toEqual([0.003, 0.003, null, null]);
    expect(baselineFrom([])).toBeNull();

    const book = new LedgerRateBook();
    book.setBaseline(baseline);
    expect(book.rates([], '', 1, hards).tread).toEqual([
      0.003, 0.003, 0.004, 0.004,
    ]);
  });
});
