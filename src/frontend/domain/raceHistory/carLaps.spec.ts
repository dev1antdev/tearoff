import { describe, expect, it } from 'vitest';
import {
  LEDGER_LAP_BLUE,
  LEDGER_LAP_CAUTION,
  LEDGER_LAP_FROM_START,
  LEDGER_LAP_IN_LAP,
  LEDGER_LAP_OUT_LAP,
  LEDGER_LAP_VOIDED,
  LEDGER_LAP_YELLOW,
  type RaceLap,
} from '@irdashies/types';
import {
  carLapsView,
  missingLapsText,
  type CarLapRow,
  type CarLapsRow,
} from './carLaps';
import type { CarRaceRecord } from './carRecord';
import { lapOf, stintOf, stoppedStint } from './recordFixture';

const lapRows = (rows: readonly CarLapsRow[]): CarLapRow[] =>
  rows.filter((row): row is CarLapRow => row.kind === 'lap');

const rowOf = (rows: readonly CarLapsRow[], lap: number): CarLapRow => {
  const row = lapRows(rows).find((entry) => entry.lap === lap);
  if (!row) throw new Error(`no row for lap ${lap}`);
  return row;
};

/** One stint under way over the laps given. */
const oneStint = (laps: RaceLap[]): CarRaceRecord => ({
  laps,
  missingLaps: [],
  stints: [
    stintOf(1, {
      firstLap: laps[0]?.lap ?? null,
      lastLap: laps[laps.length - 1]?.lap ?? null,
      laps: laps.length,
    }),
  ],
});

describe('the rows of a car’s laps', () => {
  it('lists them newest first', () => {
    const { rows } = carLapsView(
      oneStint([lapOf(1), lapOf(2), lapOf(3)]),
      null
    );
    expect(lapRows(rows).map((row) => row.lap)).toEqual([3, 2, 1]);
  });

  it('is empty for a car with no lap', () => {
    expect(
      carLapsView({ laps: [], missingLaps: [], stints: [] }, null)
    ).toEqual({
      rows: [],
      hasSectors: false,
      hasEnergy: false,
      energyIsVirtual: null,
    });
  });

  it('says whether the sim times the sectors and publishes the energy', () => {
    const plain = carLapsView(
      oneStint([lapOf(1, { sectors: [null, null, null] })]),
      null
    );
    expect(plain).toMatchObject({
      hasSectors: false,
      hasEnergy: false,
      energyIsVirtual: null,
    });
    const lmu = carLapsView(
      oneStint([lapOf(1, { energy: 0.9, energyIsVirtual: true })]),
      null
    );
    expect(lmu).toMatchObject({
      hasSectors: true,
      hasEnergy: true,
      energyIsVirtual: true,
    });
  });
});

describe('what a lap used', () => {
  const energies = (values: readonly (number | null)[]): CarLapsRow[] =>
    carLapsView(
      oneStint(
        values.map((energy, index) =>
          lapOf(index + 1, { energy, energyIsVirtual: true })
        )
      ),
      null
    ).rows;

  it('is what the car had less at this line than at the last', () => {
    const rows = energies([0.9, 0.876, 0.851]);
    expect(rowOf(rows, 3).energyUsed).toBeCloseTo(0.025, 10);
    expect(rowOf(rows, 2).energyUsed).toBeCloseTo(0.024, 10);
  });

  it('is not known for the first lap held', () => {
    expect(rowOf(energies([0.9, 0.88]), 1)).toMatchObject({
      energyUsed: null,
      refilled: false,
    });
  });

  it('reads refilled for a lap the car ended with more than it began', () => {
    expect(rowOf(energies([0.3, 0.99]), 2)).toMatchObject({
      energyUsed: null,
      refilled: true,
    });
  });

  it('is not known where a reading is missing, or the lap before is', () => {
    expect(rowOf(energies([0.9, null, 0.85]), 3).energyUsed).toBeNull();
    const gap = carLapsView(
      {
        laps: [
          lapOf(1, { energy: 0.9, energyIsVirtual: true }),
          lapOf(3, { energy: 0.85, energyIsVirtual: true }),
        ],
        missingLaps: [2],
        stints: [],
      },
      null
    ).rows;
    // Two laps' use is not one lap's.
    expect(rowOf(gap, 3).energyUsed).toBeNull();
  });
});

describe('the best lap of a stint', () => {
  const times = (values: readonly (number | null)[], flags: number[] = []) =>
    carLapsView(
      oneStint(
        values.map((lapTime, index) =>
          lapOf(index + 1, { lapTime, flags: flags[index] ?? 0 })
        )
      ),
      null
    ).rows;

  it('is its quickest clean lap, in green', () => {
    const rows = times([101, 99.5, 100]);
    expect(rowOf(rows, 2)).toMatchObject({
      tone: 'stintBest',
      note: 'best of the stint',
    });
    expect(rowOf(rows, 1).tone).toBe('plain');
    expect(rowOf(rows, 3).note).toBe('');
  });

  it('is not named while the stint has one clean lap', () => {
    // The only clean lap of a stint is its best and says nothing by it.
    const rows = times([130, 100], [LEDGER_LAP_OUT_LAP]);
    expect(rowOf(rows, 2).tone).toBe('plain');
    expect(rowOf(rows, 2).note).toBe('');
  });

  it('is never a lap that is not clean, however quick', () => {
    const rows = times([90, 100, 101], [LEDGER_LAP_CAUTION]);
    expect(rowOf(rows, 1).tone).toBe('quiet');
    expect(rowOf(rows, 2).tone).toBe('stintBest');
  });

  it('is found for each stint by itself', () => {
    const laps = [100, 99, 101, 98, 97.5, 99].map((lapTime, index) =>
      lapOf(index + 1, { lapTime })
    );
    const { rows } = carLapsView(
      {
        laps,
        missingLaps: [],
        stints: [
          stoppedStint(1, 1, 3),
          stintOf(2, { firstLap: 4, lastLap: 6, laps: 3 }),
        ],
      },
      null
    );
    expect(
      lapRows(rows)
        .filter((row) => row.tone === 'stintBest')
        .map((row) => row.lap)
    ).toEqual([5, 2]);
  });

  it('marks the best of each sector over the stint’s clean laps', () => {
    const { rows } = carLapsView(
      oneStint([
        lapOf(1, { lapTime: 100, sectors: [30.5, 40, 29.5] }),
        lapOf(2, { lapTime: 99.6, sectors: [30, 40.1, 29.5] }),
        // In the pits: its sectors are nobody's best.
        lapOf(3, {
          lapTime: 140,
          sectors: [29, 39, 72],
          flags: LEDGER_LAP_IN_LAP,
        }),
      ]),
      null
    );
    expect(rowOf(rows, 1).sectorBest).toEqual([false, true, true]);
    expect(rowOf(rows, 2).sectorBest).toEqual([true, false, true]);
    expect(rowOf(rows, 3).sectorBest).toEqual([false, false, false]);
  });
});

describe('the best lap of the class', () => {
  const record = oneStint([
    lapOf(1, { lapTime: 100.2 }),
    lapOf(2, { lapTime: 99.412 }),
    lapOf(3, { lapTime: 99.9 }),
  ]);

  it('is purple where a lap of the car is it', () => {
    const { rows } = carLapsView(record, 99.412);
    expect(rowOf(rows, 2)).toMatchObject({
      tone: 'classBest',
      note: 'best of the class',
    });
  });

  it('is nobody’s here where another car holds it', () => {
    const { rows } = carLapsView(record, 98.9);
    expect(rowOf(rows, 2).tone).toBe('stintBest');
    expect(lapRows(rows).some((row) => row.tone === 'classBest')).toBe(false);
  });

  it('is left out where the class best is not known', () => {
    const { rows } = carLapsView(record, null);
    expect(lapRows(rows).some((row) => row.tone === 'classBest')).toBe(false);
  });
});

describe('the note on a lap', () => {
  const noteOf = (flags: number, values: Partial<RaceLap> = {}): string =>
    rowOf(carLapsView(oneStint([lapOf(1, { flags, ...values })]), null).rows, 1)
      .note;

  it('says an in lap, an out lap, and a pass through the pit lane', () => {
    expect(noteOf(LEDGER_LAP_IN_LAP)).toBe('in lap');
    expect(noteOf(LEDGER_LAP_OUT_LAP)).toBe('out lap');
    expect(noteOf(LEDGER_LAP_IN_LAP | LEDGER_LAP_OUT_LAP)).toBe(
      'through the pit lane'
    );
  });

  it('says a yellow, and a full-course yellow instead where both are set', () => {
    expect(noteOf(LEDGER_LAP_YELLOW)).toBe('yellow');
    expect(noteOf(LEDGER_LAP_CAUTION)).toBe('full-course yellow');
    expect(noteOf(LEDGER_LAP_CAUTION | LEDGER_LAP_YELLOW)).toBe(
      'full-course yellow'
    );
  });

  it('says the lap from the grid', () => {
    expect(noteOf(LEDGER_LAP_FROM_START)).toBe('from the grid');
  });

  it('says a lap the sim gave no time', () => {
    expect(noteOf(LEDGER_LAP_VOIDED, { lapTime: null })).toBe(
      'no time from the sim'
    );
    // A time that has not come yet is not a time that never will.
    expect(noteOf(0, { lapTime: null })).toBe('');
  });

  it('says nothing of a clean lap, nor of a blue flag', () => {
    expect(noteOf(0)).toBe('');
    expect(noteOf(LEDGER_LAP_BLUE)).toBe('');
  });

  it('writes a lap that is not clean quieter', () => {
    const tone = (flags: number, lapTime: number | null = 100) =>
      rowOf(carLapsView(oneStint([lapOf(1, { flags, lapTime })]), null).rows, 1)
        .tone;
    expect(tone(0)).toBe('plain');
    expect(tone(LEDGER_LAP_YELLOW)).toBe('plain');
    expect(tone(LEDGER_LAP_OUT_LAP)).toBe('quiet');
    expect(tone(LEDGER_LAP_CAUTION)).toBe('quiet');
    expect(tone(0, null)).toBe('quiet');
  });

  it('puts several on one lap, apart', () => {
    expect(noteOf(LEDGER_LAP_OUT_LAP | LEDGER_LAP_CAUTION)).toBe(
      'out lap · full-course yellow'
    );
  });
});

describe('the lap of a stop', () => {
  /**
   * A stop after lap 3. `stopLap` is the lap the car stood still on, with
   * the flags the record gives it for where the pit boxes are.
   */
  const withStop = (
    stopLapFlags: number,
    nextFlags: number,
    stop = { laneTime: 75, standingTime: 57.6, driverChanged: true }
  ): CarLapsRow[] =>
    carLapsView(
      {
        laps: [
          lapOf(1, { energy: 0.3, energyIsVirtual: true }),
          lapOf(2, { energy: 0.27, energyIsVirtual: true }),
          lapOf(3, { energy: 0.24, energyIsVirtual: true }),
          lapOf(4, {
            energy: 0.99,
            energyIsVirtual: true,
            flags: stopLapFlags,
            lapTime: 180,
            driver: 'Grace',
            compounds: [2, 2, 2, 2],
          }),
          lapOf(5, {
            energy: 0.96,
            energyIsVirtual: true,
            flags: nextFlags,
            driver: 'Grace',
            compounds: [2, 2, 2, 2],
          }),
        ],
        missingLaps: [],
        stints: [
          stoppedStint(1, 1, 3, { stop }),
          stintOf(2, { driver: 'Grace', firstLap: 4, lastLap: 5, laps: 2 }),
        ],
      },
      null
    ).rows;

  it('is the lap after the last of the stint the stop ended, and says what was done', () => {
    // Boxes before the line: in on that lap, out on the next.
    const rows = withStop(LEDGER_LAP_IN_LAP, LEDGER_LAP_OUT_LAP);
    expect(rowOf(rows, 4)).toMatchObject({
      note: 'stop 58 s: energy, tyres, driver change',
      tone: 'quiet',
      refilled: true,
    });
    expect(rowOf(rows, 5).note).toBe('out lap');
    expect(rowOf(rows, 3).note).toBe('');
  });

  it('is the same lap where the car came in and went out on it', () => {
    const rows = withStop(LEDGER_LAP_IN_LAP | LEDGER_LAP_OUT_LAP, 0);
    expect(rowOf(rows, 4).note).toBe('stop 58 s: energy, tyres, driver change');
    expect(rowOf(rows, 5).note).toBe('');
  });

  it('is the out-lap where the boxes are after the line', () => {
    // The lap before ended in the pit lane and is the stint's last.
    const rows = carLapsView(
      {
        laps: [
          lapOf(1),
          lapOf(2, { flags: LEDGER_LAP_IN_LAP }),
          lapOf(3, { flags: LEDGER_LAP_OUT_LAP, lapTime: 170 }),
          lapOf(4),
        ],
        missingLaps: [],
        stints: [
          stoppedStint(1, 1, 2, {
            stop: { laneTime: 70, standingTime: 41, driverChanged: false },
          }),
          stintOf(2, { firstLap: 3, lastLap: 4, laps: 2 }),
        ],
      },
      null
    ).rows;
    expect(rowOf(rows, 2).note).toBe('in lap');
    expect(rowOf(rows, 3).note).toBe('stop 41 s');
    expect(rowOf(rows, 4).note).toBe('');
  });

  it('says the car is in the pits while the stop lasts', () => {
    // The lap was completed in the lane, and the car is not out of it yet:
    // how long it stands is not final.
    const { rows } = carLapsView(
      {
        laps: [lapOf(1), lapOf(2), lapOf(3), lapOf(4)],
        missingLaps: [],
        stints: [
          stoppedStint(1, 1, 3, {
            stop: { laneTime: null, standingTime: 4, driverChanged: false },
          }),
          stintOf(2, { firstLap: 4, lastLap: 4, laps: 1 }),
        ],
      },
      null
    );
    expect(rowOf(rows, 4).note).toBe('in the pits');
  });

  it('has no note for a stop whose lap is not held', () => {
    const rows = carLapsView(
      {
        laps: [lapOf(1), lapOf(2), lapOf(3), lapOf(6)],
        missingLaps: [4, 5],
        stints: [
          stoppedStint(1, 1, 3),
          stintOf(2, { firstLap: 6, lastLap: 6, laps: 1 }),
        ],
      },
      null
    ).rows;
    expect(lapRows(rows).every((row) => !row.note.includes('stop'))).toBe(true);
  });
});

describe('a driver change with no stop seen', () => {
  it('is said on the first lap of the stint it began', () => {
    const { rows } = carLapsView(
      {
        laps: [lapOf(1), lapOf(2), lapOf(3, { driver: 'Grace' })],
        missingLaps: [],
        stints: [
          stintOf(1, {
            closedBy: 'driver',
            firstLap: 1,
            lastLap: 2,
            laps: 2,
          }),
          stintOf(2, {
            openedBy: 'driver',
            driver: 'Grace',
            firstLap: 3,
            lastLap: 3,
            laps: 1,
          }),
        ],
      },
      null
    );
    expect(rowOf(rows, 3).note).toBe('driver change, no stop seen');
    expect(rowOf(rows, 2).note).toBe('');
  });
});

describe('laps that were not recorded', () => {
  it('are one quiet row for each run of them, where they would have been', () => {
    const { rows } = carLapsView(
      {
        laps: [1, 2, 6, 7, 9].map((lap) => lapOf(lap)),
        missingLaps: [3, 4, 5, 8],
        stints: [],
      },
      null
    );
    expect(
      rows.map((row) =>
        row.kind === 'missing' ? `${row.from}-${row.to}` : row.lap
      )
    ).toEqual([9, '8-8', 7, 6, '3-5', 2, 1]);
  });

  it('are said in a line', () => {
    expect(missingLapsText({ kind: 'missing', from: 41, to: 47 })).toBe(
      'laps 41 to 47 were not recorded'
    );
    expect(missingLapsText({ kind: 'missing', from: 8, to: 8 })).toBe(
      'lap 8 was not recorded'
    );
  });

  it('are listed for a car picked up part-way, before its first lap held', () => {
    const { rows } = carLapsView(
      {
        laps: [lapOf(4), lapOf(5)],
        missingLaps: [1, 2, 3],
        stints: [],
      },
      null
    );
    expect(rows[rows.length - 1]).toEqual({ kind: 'missing', from: 1, to: 3 });
  });

  it('are listed for laps completed since the last one held', () => {
    const { rows } = carLapsView(
      { laps: [lapOf(1)], missingLaps: [2, 3], stints: [] },
      null
    );
    expect(rows[0]).toEqual({ kind: 'missing', from: 2, to: 3 });
  });
});
