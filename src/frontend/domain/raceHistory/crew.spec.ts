import { describe, expect, it } from 'vitest';
import type { RaceLap } from '@irdashies/types';
import type { CarRaceRecord } from './carRecord';
import {
  crewView,
  driveTime,
  formatDriven,
  formatLapTime,
  formatOwed,
  formatSectorTime,
  formatShare,
  stintEndText,
  stintEnergyPerLap,
  stintSeconds,
  stopText,
} from './crew';
import { lapOf, stintOf, stoppedStint } from './recordFixture';

/** Laps with what the car had left at each line. */
const withEnergy = (
  from: number,
  energies: readonly (number | null)[],
  virtual = true
): RaceLap[] =>
  energies.map((energy, index) =>
    lapOf(from + index, { energy, energyIsVirtual: virtual })
  );

describe('stintSeconds', () => {
  it('runs from where the stint began to where it ended', () => {
    const stint = stoppedStint(1, 1, 30, { startTime: 200, endTime: 3800 });
    expect(stintSeconds(stint, [], 9000)).toBe(3600);
  });

  it('runs the stint under way to the clock', () => {
    const stint = stintOf(2, { startTime: 4000, laps: 3 });
    expect(stintSeconds(stint, [], 4600)).toBe(600);
  });

  it('runs it to its last line crossing where the clock is not known', () => {
    const stint = stintOf(2, { startTime: 4000, firstLap: 5, lastLap: 6 });
    const laps = [
      lapOf(5, { sessionTime: 4110 }),
      lapOf(6, { sessionTime: 4215 }),
    ];
    expect(stintSeconds(stint, laps, null)).toBe(215);
    // With no lap either, nothing has been seen to be driven.
    expect(stintSeconds(stint, [], null)).toBe(0);
  });

  it('counts a stint that began in the garage from its first line crossing', () => {
    // In the garage from 5000 s, out again nobody knows when, over the
    // line at 6200 s and 6300 s.
    const stint = stintOf(3, {
      openedBy: 'garage',
      startTime: 5000,
      firstLap: 40,
      lastLap: 41,
      laps: 2,
    });
    const laps = [
      lapOf(40, { sessionTime: 6200 }),
      lapOf(41, { sessionTime: 6300 }),
    ];
    expect(stintSeconds(stint, laps, 6360)).toBe(160);
    // Still in the garage: none of it is at the wheel.
    expect(stintSeconds({ ...stint, laps: 0 }, [], 9000)).toBe(0);
  });

  it('is never negative', () => {
    const stint = stintOf(2, { startTime: 4000 });
    expect(stintSeconds(stint, [], 3990)).toBe(0);
  });
});

describe('stintEnergyPerLap', () => {
  it('is the mean of the drops between one lap’s line and the next', () => {
    const energy = stintEnergyPerLap(withEnergy(1, [0.9, 0.88, 0.85, 0.83]));
    expect(energy?.perLap).toBeCloseTo(0.07 / 3, 10);
    expect(energy?.virtual).toBe(true);
  });

  it('says which budget it is', () => {
    expect(stintEnergyPerLap(withEnergy(1, [0.9, 0.86], false))?.virtual).toBe(
      false
    );
  });

  it('is not known for one lap, or where the sim publishes nothing', () => {
    expect(stintEnergyPerLap(withEnergy(1, [0.9]))).toBeNull();
    expect(stintEnergyPerLap(withEnergy(1, [null, null, null]))).toBeNull();
    expect(stintEnergyPerLap([])).toBeNull();
  });

  it('leaves out a lap the car ended with more than it began', () => {
    // A refill in the middle is not a lap's use.
    const energy = stintEnergyPerLap(withEnergy(1, [0.5, 0.48, 0.99, 0.97]));
    expect(energy?.perLap).toBeCloseTo(0.02, 10);
  });

  it('compares only two laps one after the other', () => {
    const laps = [
      lapOf(1, { energy: 0.9, energyIsVirtual: true }),
      lapOf(2, { energy: 0.88, energyIsVirtual: true }),
      // Laps 3 and 4 are not held: lap 5 says nothing of one lap's use.
      lapOf(5, { energy: 0.8, energyIsVirtual: true }),
      lapOf(6, { energy: 0.77, energyIsVirtual: true }),
    ];
    expect(stintEnergyPerLap(laps)?.perLap).toBeCloseTo(0.025, 10);
  });

  it('skips a lap whose reading is missing, either side of it', () => {
    const energy = stintEnergyPerLap(withEnergy(1, [0.9, null, 0.84, 0.81]));
    expect(energy?.perLap).toBeCloseTo(0.03, 10);
  });
});

/**
 * Three drivers over five stints: Ada drives two and is in the car again,
 * Grace one, Edsger one. Stints of an hour, each ending at a stop.
 */
const record = (): CarRaceRecord => {
  const stints = [
    stoppedStint(1, 1, 10, {
      driver: 'Ada Lovelace',
      startTime: 0,
      endTime: 3600,
      cleanLaps: 9,
      avgLap: 100,
      bestLap: 99,
      stop: { laneTime: 60, standingTime: 40.2, driverChanged: false },
    }),
    stoppedStint(2, 11, 20, {
      driver: 'Ada Lovelace',
      startTime: 3700,
      endTime: 7300,
      cleanLaps: 3,
      avgLap: 104,
      bestLap: 98.5,
      stop: { laneTime: 80, standingTime: 62.4, driverChanged: true },
    }),
    stoppedStint(3, 21, 30, {
      driver: 'Grace Hopper',
      startTime: 7400,
      endTime: 11000,
      cleanLaps: 8,
      avgLap: 101,
      bestLap: 100.2,
      stop: { laneTime: 75, standingTime: 58, driverChanged: true },
    }),
    stoppedStint(4, 31, 40, {
      driver: 'Edsger Dijkstra',
      startTime: 11100,
      endTime: 14700,
      cleanLaps: 0,
      avgLap: null,
      bestLap: null,
      stop: { laneTime: 75, standingTime: 57.6, driverChanged: true },
    }),
    stintOf(5, {
      driver: 'Ada Lovelace',
      startTime: 14800,
      firstLap: 41,
      lastLap: 42,
      laps: 2,
      cleanLaps: 1,
      avgLap: 99.5,
      bestLap: 99.5,
    }),
  ];
  const laps = Array.from({ length: 42 }, (_, index) => {
    const lap = index + 1;
    // Refilled on the first lap of each stint; hards from the third stint.
    const inStint = (lap - 1) % 10;
    return lapOf(lap, {
      sessionTime: lap * 360,
      energy: 1 - inStint * 0.03,
      energyIsVirtual: true,
      compounds: lap > 20 ? [2, 2, 2, 2] : [1, 1, 1, 1],
    });
  });
  return { laps, missingLaps: [], stints };
};

describe('crewView', () => {
  it('lists each driver once, in the order they first drove', () => {
    const { drivers } = crewView(record(), 15400);
    expect(drivers.map((driver) => [driver.name, driver.index])).toEqual([
      ['Ada Lovelace', 0],
      ['Grace Hopper', 1],
      ['Edsger Dijkstra', 2],
    ]);
  });

  it('adds up each driver’s stints, laps and time at the wheel', () => {
    const [ada, grace, edsger] = crewView(record(), 15400).drivers;
    // Two stints of an hour and ten minutes of the one under way.
    expect(ada).toMatchObject({ stints: 3, laps: 22, seconds: 7800 });
    expect(grace).toMatchObject({ stints: 1, laps: 10, seconds: 3600 });
    expect(edsger).toMatchObject({ stints: 1, laps: 10, seconds: 3600 });
  });

  it('means a driver’s clean laps, not the means of their stints', () => {
    const [ada, , edsger] = crewView(record(), 15400).drivers;
    // Nine laps at 100, three at 104 and one at 99.5.
    expect(ada.avgLap).toBeCloseTo((900 + 312 + 99.5) / 13, 10);
    expect(ada.bestLap).toBe(98.5);
    // No clean lap: no mean and no best, never a zero.
    expect(edsger.avgLap).toBeNull();
    expect(edsger.bestLap).toBeNull();
  });

  it('says who is at the wheel now', () => {
    const { drivers } = crewView(record(), 15400);
    expect(drivers.map((driver) => driver.driving)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('lists the stints newest first, each with how it ended', () => {
    const { stints } = crewView(record(), 15400);
    expect(stints.map((stint) => stint.ordinal)).toEqual([5, 4, 3, 2, 1]);
    expect(stints.map((stint) => stintEndText(stint.end))).toEqual([
      'under way',
      // Refilled, and Ada back in the car.
      '58 s: energy, driver',
      '58 s: energy, driver',
      // Mediums before, hards after.
      '62 s: energy, tyres, driver',
      '40 s: energy',
    ]);
  });

  it('gives each stint its time, its pace and what a lap of it used', () => {
    const { stints, energyIsVirtual } = crewView(record(), 15400);
    const [underWay, , , , first] = stints;
    expect(underWay).toMatchObject({
      driver: 'Ada Lovelace',
      driverIndex: 0,
      laps: 2,
      seconds: 600,
      avgLap: 99.5,
    });
    expect(first.energy?.perLap).toBeCloseTo(0.03, 10);
    expect(energyIsVirtual).toBe(true);
  });

  it('has no mean for a stint without a clean lap', () => {
    const fourth = crewView(record(), 15400).stints[1];
    expect(fourth.avgLap).toBeNull();
    expect(fourth.bestLap).toBeNull();
  });

  it('leaves out the stint a parked car has open', () => {
    const base = record();
    const parked: CarRaceRecord = {
      ...base,
      stints: [
        ...base.stints.slice(0, 4),
        { ...base.stints[4], closedBy: 'garage', endTime: 15000 },
        stintOf(6, {
          driver: 'Ada Lovelace',
          openedBy: 'garage',
          startTime: 15000,
        }),
      ],
    };
    const view = crewView(parked, 30000);
    expect(view.stints.map((stint) => stint.ordinal)).toEqual([5, 4, 3, 2, 1]);
    expect(stintEndText(view.stints[0].end)).toBe('to the garage');
    // Four hours in the garage are not at the wheel.
    expect(view.drivers[0]).toMatchObject({ stints: 3, driving: false });
    expect(view.drivers[0].seconds).toBe(7400);
  });

  it('says so where the laps after a stint were not recorded', () => {
    const base = record();
    const view = crewView(
      {
        ...base,
        stints: [
          { ...base.stints[0], closedBy: 'gap', stop: null },
          ...base.stints.slice(1),
        ],
      },
      15400
    );
    expect(stintEndText(view.stints[4].end)).toBe('laps after it not recorded');
  });

  it('keeps the stints nobody was named for apart', () => {
    const view = crewView(
      {
        laps: [],
        missingLaps: [],
        stints: [
          stoppedStint(1, 1, 5, { driver: '' }),
          stintOf(2, { driver: 'Ada Lovelace', laps: 1 }),
        ],
      },
      1000
    );
    expect(view.drivers.map((driver) => driver.name)).toEqual([
      '',
      'Ada Lovelace',
    ]);
  });

  it('does not know the budget of a car the sim publishes none for', () => {
    const view = crewView(
      { laps: [lapOf(1)], missingLaps: [], stints: [stintOf(1, { laps: 1 })] },
      1000
    );
    expect(view.energyIsVirtual).toBeNull();
    expect(view.stints[0].energy).toBeNull();
  });

  it('is empty for a car with nothing recorded', () => {
    expect(crewView({ laps: [], missingLaps: [], stints: [] }, 100)).toEqual({
      drivers: [],
      stints: [],
      energyIsVirtual: null,
    });
  });
});

describe('driveTime', () => {
  const limits = { maxS: 4 * 3600, minS: 90 * 60 };

  it('is the share of the maximum driven, with the minimum along it', () => {
    expect(driveTime(2 * 3600, limits)).toEqual({
      fill: 0.5,
      minAt: 0.375,
      owedS: 0,
      leftS: 2 * 3600,
      overS: 0,
    });
  });

  it('says what a driver still owes to the minimum', () => {
    expect(driveTime(59 * 60, limits)).toMatchObject({ owedS: 31 * 60 });
    expect(driveTime(0, limits)).toMatchObject({ fill: 0, owedS: 90 * 60 });
  });

  it('says how far past the maximum a driver is, with the bar full', () => {
    expect(driveTime(4 * 3600 + 300, limits)).toMatchObject({
      fill: 1,
      leftS: 0,
      overS: 300,
    });
  });

  it('has no mark without a minimum', () => {
    expect(driveTime(600, { maxS: 3600, minS: 0 })).toMatchObject({
      minAt: null,
      owedS: 0,
    });
  });

  it('does not divide by a maximum of nothing', () => {
    expect(driveTime(600, { maxS: 0, minS: 0 }).fill).toBe(1);
  });
});

describe('how the figures are written', () => {
  it('writes time done in hours and minutes, the minute under way not done', () => {
    expect(formatDriven(0)).toBe('0:00');
    expect(formatDriven(59)).toBe('0:00');
    expect(formatDriven(2 * 3600 + 57 * 60 + 59)).toBe('2:57');
  });

  it('writes time owed rounded up', () => {
    expect(formatOwed(90 * 60)).toBe('1:30');
    expect(formatOwed(30 * 60 + 1)).toBe('0:31');
    expect(formatOwed(0)).toBe('0:00');
  });

  it('writes a lap to the thousandth and a mean to the hundredth', () => {
    expect(formatLapTime(114.498)).toBe('1:54.498');
    expect(formatLapTime(114.4975, 2)).toBe('1:54.50');
    expect(formatLapTime(59.9996)).toBe('1:00.000');
    expect(formatLapTime(180.795)).toBe('3:00.795');
  });

  it('writes no lap time for none', () => {
    expect(formatLapTime(null)).toBe('--');
    expect(formatLapTime(undefined)).toBe('--');
    expect(formatLapTime(0)).toBe('--');
    expect(formatLapTime(-1)).toBe('--');
  });

  it('writes a sector in seconds, and in minutes from a minute up', () => {
    expect(formatSectorTime(36.412)).toBe('36.412');
    expect(formatSectorTime(89.062)).toBe('1:29.062');
    expect(formatSectorTime(null)).toBe('--');
  });

  it('writes a share of a budget in percent to a tenth', () => {
    expect(formatShare(0.0246)).toBe('2.5 %');
    expect(formatShare(0)).toBe('0.0 %');
    expect(formatShare(null)).toBe('--');
    expect(formatShare(undefined)).toBe('--');
  });

  it('writes a stop as its standing time and what it did', () => {
    const stop = {
      standingS: 57.6,
      inPits: false,
      refilled: 'fuel' as const,
      tyres: true,
      driver: true,
    };
    expect(stopText(stop)).toBe('58 s: fuel, tyres, driver');
    expect(stopText(stop, 'driver change')).toBe(
      '58 s: fuel, tyres, driver change'
    );
    expect(
      stopText({ ...stop, refilled: null, tyres: false, driver: false })
    ).toBe('58 s');
    expect(stopText({ ...stop, inPits: true })).toBe('in the pits');
  });
});
