import { describe, expect, it } from 'vitest';
import type { FuelLapData } from '@irdashies/types';
import {
  computeSaverTable,
  saverPerLap,
  savingTone,
  type SaverInput,
} from './saverTable';

const input = (values: Partial<SaverInput> = {}): SaverInput => ({
  level: 10,
  usedThisLap: 0,
  perLap: 2.1,
  reserve: 0,
  pitEntryShare: 0,
  stintLapsDone: 0,
  fewerLaps: 0,
  moreLaps: 3,
  lapsLeftInRace: null,
  capacity: null,
  ...values,
});

const lap = (
  fuelUsed: number,
  values: Partial<FuelLapData> = {}
): FuelLapData => ({
  lapNumber: 1,
  fuelUsed,
  lapTime: 90,
  isGreenFlag: true,
  isValidForCalc: true,
  isOutLap: false,
  timestamp: 0,
  ...values,
});

describe('the saver table', () => {
  it('gives a column for the laps the budget lasts and one for each lap more', () => {
    const { columns } = computeSaverTable(input());

    expect(columns.map((column) => column.laps)).toEqual([4, 5, 6, 7]);
    expect(columns.map((column) => column.isCurrent)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    [2.5, 2.0, 1.667, 1.429].forEach((target, index) =>
      expect(columns[index].target).toBeCloseTo(target, 3)
    );
    [-0.4, 0.1, 0.433, 0.671].forEach((saving, index) =>
      expect(columns[index].saving).toBeCloseTo(saving, 3)
    );
  });

  it('rounds the laps to a tenth before cutting them, so 4.95 is five', () => {
    const { columns } = computeSaverTable(input({ level: 9.9, perLap: 2 }));
    expect(columns[0].laps).toBe(5);
    expect(columns[0].target).toBeCloseTo(1.98, 6);
  });

  it('keeps the reserve back', () => {
    expect(computeSaverTable(input({ level: 10.2, reserve: 0.2 }))).toEqual(
      computeSaverTable(input())
    );
  });

  it('counts from the start of the lap, so the columns stand still through it', () => {
    const during = computeSaverTable(input({ level: 9, usedThisLap: 1 }));
    const atTheLine = computeSaverTable(input());
    expect(during.columns.map((column) => column.laps)).toEqual(
      atTheLine.columns.map((column) => column.laps)
    );
    during.columns.forEach((column, index) =>
      expect(column.target).toBeCloseTo(atTheLine.columns[index].target, 9)
    );
  });

  it('allows for the last lap ending at pit entry', () => {
    // A tenth of a lap is not driven: 0.21 that need not be aboard.
    const { columns } = computeSaverTable(input({ pitEntryShare: 0.1 }));
    expect(columns[0].target * columns[0].laps).toBeCloseTo(10.21, 9);
  });

  it('skips a column that would stand for no laps', () => {
    const { columns } = computeSaverTable(
      input({ level: 4.2, fewerLaps: 2, moreLaps: 1 })
    );
    // Whole laps: 2. Two fewer would be none.
    expect(columns.map((column) => column.laps)).toEqual([1, 2, 3]);
    expect(columns.map((column) => column.isCurrent)).toEqual([
      false,
      true,
      false,
    ]);
  });

  it('captions each column with the stint length it stands for', () => {
    const { columns } = computeSaverTable(input({ stintLapsDone: 12 }));
    expect(columns.map((column) => column.stintLaps)).toEqual([16, 17, 18, 19]);
  });

  it('has no columns without a consumption figure', () => {
    expect(computeSaverTable(input({ perLap: 0 }))).toEqual({
      columns: [],
      stopTarget: null,
    });
    expect(computeSaverTable(input({ perLap: Number.NaN })).columns).toEqual(
      []
    );
  });

  it('has nothing left to give once the budget is under the reserve', () => {
    const { columns } = computeSaverTable(input({ level: 0.1, reserve: 0.2 }));
    expect(columns.map((column) => column.laps)).toEqual([1, 2, 3]);
    expect(columns.every((column) => column.target === 0)).toBe(true);
  });
});

describe('the target that drops a stop', () => {
  const race = (lapsLeftInRace: number, level = 30): SaverInput =>
    input({ level, perLap: 2, lapsLeftInRace, capacity: 100 });

  it('is what the fuel aboard would have to last the race on, with one stop to make', () => {
    const { stopTarget } = computeSaverTable(race(40));
    // 80 needed and 30 aboard: one stop. Without it, 30 over 40 laps.
    expect(stopTarget).toEqual({
      stopsNow: 1,
      target: 0.75,
      saving: 1.25,
      savingShare: 0.625,
    });
  });

  it('is found the same way further from the finish', () => {
    expect(computeSaverTable(race(60)).stopTarget).toMatchObject({
      stopsNow: 1,
      target: 0.5,
    });
  });

  it('counts one tank fewer when two stops are needed', () => {
    const { stopTarget } = computeSaverTable(race(110));
    expect(stopTarget?.stopsNow).toBe(2);
    expect(stopTarget?.target).toBeCloseTo(130 / 110, 9);
  });

  it('takes what is left at the end of the stint off what a stop can add', () => {
    // 31 aboard is 15 laps and a litre over: a stop adds 99, not 100, and
    // 199 are needed.
    const { stopTarget } = computeSaverTable(race(115, 31));
    expect(stopTarget?.stopsNow).toBe(3);
  });

  it('is absent when the fuel aboard already reaches the finish', () => {
    expect(computeSaverTable(race(40, 90)).stopTarget).toBeNull();
  });

  it('is absent without a race estimate or a capacity', () => {
    expect(
      computeSaverTable(input({ perLap: 2, capacity: 100 })).stopTarget
    ).toBeNull();
    expect(
      computeSaverTable(input({ perLap: 2, lapsLeftInRace: 40 })).stopTarget
    ).toBeNull();
    expect(
      computeSaverTable(input({ perLap: 2, lapsLeftInRace: 0, capacity: 100 }))
        .stopTarget
    ).toBeNull();
  });
});

describe('the consumption the targets are compared with', () => {
  const fuel = {
    projectedLapUsage: 2.21,
    lastLapUsage: 2.33,
    lapDistPct: 0.4,
    completedLaps: [
      lap(2.33),
      lap(2.4),
      lap(3.1, { isOutLap: true }),
      lap(2.2, { isInLap: true }),
      lap(9, { isValidForCalc: false }),
      lap(2.3),
      lap(2.5),
    ],
  };

  it('follows the lap under way once it is five per cent done', () => {
    expect(saverPerLap(fuel, 'projected', 5)).toBe(2.21);
    expect(saverPerLap({ ...fuel, lapDistPct: 0.02 }, 'projected', 5)).toBe(
      2.33
    );
  });

  it('falls back to the last lap, then to the average', () => {
    expect(saverPerLap({ ...fuel, projectedLapUsage: 0 }, 'projected', 5)).toBe(
      2.33
    );
    expect(
      saverPerLap(
        { ...fuel, projectedLapUsage: 0, lastLapUsage: 0 },
        'projected',
        2
      )
    ).toBeCloseTo((2.33 + 2.4) / 2, 9);
  });

  it('is the last lap, whatever the lap under way is doing', () => {
    expect(saverPerLap(fuel, 'last', 5)).toBe(2.33);
    expect(saverPerLap({ ...fuel, lastLapUsage: 0 }, 'last', 5)).toBe(0);
  });

  it('averages the last laps that count, leaving out the pits', () => {
    // Four laps count: the out-lap, the in-lap and the outlier do not.
    expect(saverPerLap(fuel, 'average', 5)).toBeCloseTo(
      (2.33 + 2.4 + 2.3 + 2.5) / 4,
      9
    );
    expect(saverPerLap(fuel, 'average', 3)).toBeCloseTo(
      (2.33 + 2.4 + 2.3) / 3,
      9
    );
    expect(saverPerLap({ ...fuel, completedLaps: [] }, 'average', 5)).toBe(0);
  });
});

describe('how a saving reads', () => {
  it('is inside the target at zero or below', () => {
    expect(savingTone(0, 2, 15)).toBe('inside');
    expect(savingTone(-0.4, 2, 15)).toBe('inside');
  });

  it('is within reach up to the share set, and out of reach beyond it', () => {
    expect(savingTone(0.3, 2, 15)).toBe('reachable');
    expect(savingTone(0.31, 2, 15)).toBe('outOfReach');
    expect(savingTone(0.3, 0, 15)).toBe('outOfReach');
  });
});
