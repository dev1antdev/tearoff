import { describe, expect, it } from 'vitest';
import type {
  RaceForecastCar,
  RaceForecastSnapshot,
  RaceStint,
} from '@irdashies/types';
import {
  drivenBars,
  forecastBars,
  timelineAxis,
  timelineCars,
  timelineModel,
  timelineTicks,
} from './stintTimeline';

const car = (
  carIdx: number,
  classPosition: number,
  values: Partial<RaceForecastCar> = {}
): RaceForecastCar => ({
  carIdx,
  own: false,
  classPosition,
  gapS: 0,
  inPit: false,
  paceS: 100,
  progress: 50.5,
  lapsLeft: 49.5,
  stopsOwed: 2,
  basis: 'energy',
  nextStopLap: 60,
  stintLaps: 20,
  stopLossS: 60,
  netGapS: 0,
  finishGapS: 0,
  finishPosition: classPosition,
  stops: 2,
  lastStopLap: 40,
  lastStopLaneS: 60,
  sinceStopLaps: 10,
  avg5S: 100,
  ...values,
});

/** Seven cars of a class, the own one fourth. */
const CLASS = [
  car(10, 1),
  car(11, 2),
  car(12, 3),
  car(0, 4, { own: true }),
  car(13, 5),
  car(14, 6),
  car(15, 7),
];

const stintOf = (
  ordinal: number,
  values: Partial<RaceStint> = {}
): RaceStint => ({
  carIdx: 0,
  ordinal,
  driver: 'Mikhail Ivanov',
  openedBy: ordinal === 1 ? 'start' : 'stop',
  closedBy: 'stop',
  firstLap: (ordinal - 1) * 20 + 1,
  lastLap: ordinal * 20,
  startTime: 100 + (ordinal - 1) * 2060,
  endTime: 100 + (ordinal - 1) * 2060 + 2000,
  laps: 20,
  cleanLaps: 18,
  avgLap: 100,
  bestLap: 99,
  stop: { laneTime: 60, standingTime: 30, driverChanged: false },
  ...values,
});

/** Two stints done and a third under way, ten laps in. */
const STINTS = [
  stintOf(1),
  stintOf(2, { driver: 'Andrei Petrov' }),
  stintOf(3, {
    closedBy: null,
    endTime: null,
    lastLap: 50,
    laps: 10,
    stop: null,
  }),
];

const forecast = (
  values: Partial<RaceForecastSnapshot> = {}
): RaceForecastSnapshot => ({
  valid: true,
  reason: null,
  raceType: 'time',
  timeLeftS: 4900,
  lapLimit: null,
  sessionTimeS: 5270,
  flagInS: 4950,
  ownCarIdx: 0,
  ownLap: 51,
  ownLastLapS: 100.2,
  ownBestLapS: 99.1,
  cars: CLASS,
  place: null,
  stint: null,
  rejoin: null,
  sessionNum: 0,
  version: 1,
  ...values,
});

describe('timelineCars', () => {
  const picked = (rivals: number) =>
    timelineCars(CLASS, rivals).map((entry) => entry.carIdx);

  it('is the own car alone with no rivals asked for', () => {
    expect(picked(0)).toEqual([0]);
  });

  it('takes the nearest rivals from ahead and behind in turn, the own car first', () => {
    expect(picked(1)).toEqual([0, 12]);
    expect(picked(2)).toEqual([0, 12, 13]);
    expect(picked(3)).toEqual([0, 11, 12, 13]);
    expect(picked(4)).toEqual([0, 11, 12, 13, 14]);
  });

  it('takes from the other side when one runs out', () => {
    const leading = [car(0, 1, { own: true }), car(1, 2), car(2, 3), car(3, 4)];
    expect(timelineCars(leading, 2).map((entry) => entry.carIdx)).toEqual([
      0, 1, 2,
    ]);
    const last = [car(1, 1), car(2, 2), car(3, 3), car(0, 4, { own: true })];
    expect(timelineCars(last, 2).map((entry) => entry.carIdx)).toEqual([
      0, 2, 3,
    ]);
  });

  it('takes no more than there are, and nothing without the own car', () => {
    expect(picked(40)).toHaveLength(CLASS.length);
    expect(timelineCars([car(1, 1), car(2, 2)], 2)).toEqual([]);
  });
});

describe('timelineTicks', () => {
  it('marks whole hours of a long race, strictly inside its ends', () => {
    // Eight hours and four minutes: every two hours.
    expect(timelineTicks('time', 29_040)).toEqual([
      { at: 7200, label: '2 h' },
      { at: 14_400, label: '4 h' },
      { at: 21_600, label: '6 h' },
      { at: 28_800, label: '8 h' },
    ]);
    // Exactly six hours: the flag is not a tick.
    expect(timelineTicks('time', 21_600).map((tick) => tick.label)).toEqual([
      '1 h',
      '2 h',
      '3 h',
      '4 h',
      '5 h',
    ]);
  });

  it('marks minutes of a short one', () => {
    expect(timelineTicks('time', 2700).map((tick) => tick.label)).toEqual([
      '0:10',
      '0:20',
      '0:30',
      '0:40',
    ]);
    expect(timelineTicks('time', 5400).map((tick) => tick.label)).toEqual([
      '0:15',
      '0:30',
      '0:45',
      '1:00',
      '1:15',
    ]);
  });

  it('marks laps of a race to a lap count', () => {
    expect(timelineTicks('laps', 30).map((tick) => tick.label)).toEqual([
      'lap 5',
      'lap 10',
      'lap 15',
      'lap 20',
      'lap 25',
    ]);
    expect(timelineTicks('laps', 250).map((tick) => tick.at)).toEqual([
      50, 100, 150, 200,
    ]);
  });

  it('has none for a scale with no length', () => {
    expect(timelineTicks('time', 0)).toEqual([]);
    expect(timelineTicks('laps', -3)).toEqual([]);
  });
});

describe('timelineAxis', () => {
  it('is the session clock from its start to the flag, for a race with a clock', () => {
    expect(timelineAxis(forecast(), CLASS[3])).toMatchObject({
      kind: 'time',
      end: 10_220,
      now: 5270,
    });
    expect(
      timelineAxis(
        forecast({ raceType: 'lapsAndTime', lapLimit: 120 }),
        CLASS[3]
      )?.kind
    ).toBe('time');
  });

  it('is laps to the lap the own car finishes on, for a race to a lap count', () => {
    const laps = forecast({ raceType: 'laps', lapLimit: 100, timeLeftS: null });
    expect(timelineAxis(laps, CLASS[3])).toMatchObject({
      kind: 'laps',
      end: 100,
      now: 50.5,
    });
    // Lapped by the flag: three laps short of the distance.
    expect(
      timelineAxis(laps, car(0, 4, { own: true, lapsLeft: 46.5 }))
    ).toMatchObject({ end: 97, now: 50.5 });
  });

  it('is nothing while the end is not known', () => {
    expect(timelineAxis(forecast({ flagInS: null }), CLASS[3])).toBeNull();
    expect(timelineAxis(forecast({ sessionTimeS: null }), CLASS[3])).toBeNull();
    expect(
      timelineAxis(forecast({ raceType: 'laps', lapLimit: 100 }), undefined)
    ).toBeNull();
  });
});

describe('drivenBars', () => {
  const time = { kind: 'time' as const, end: 10_220 };
  const laps = { kind: 'laps' as const, end: 100 };

  it('runs each stint from its start to its pit entry on the clock, the one under way to now', () => {
    expect(drivenBars(STINTS, time, 5270)).toEqual([
      {
        from: 100,
        to: 2100,
        kind: 'driven',
        driver: 'Mikhail Ivanov',
        driverIndex: 0,
        driverChanges: 0,
        current: false,
      },
      {
        from: 2160,
        to: 4160,
        kind: 'driven',
        driver: 'Andrei Petrov',
        driverIndex: 1,
        driverChanges: 1,
        current: false,
      },
      {
        from: 4220,
        to: 5270,
        kind: 'driven',
        driver: 'Mikhail Ivanov',
        driverIndex: 0,
        driverChanges: 2,
        current: true,
      },
    ]);
  });

  it('runs each stint over the laps it completed, in laps', () => {
    expect(
      drivenBars(STINTS, laps, 50.5).map(({ from, to }) => [from, to])
    ).toEqual([
      [0, 20],
      [20, 40],
      [40, 50.5],
    ]);
  });

  it('leaves a stint that was not recorded as a gap', () => {
    // The second stint was driven while the app was not running.
    const bars = drivenBars([STINTS[0], STINTS[2]], time, 5270);
    expect(bars.map(({ from, to }) => [from, to])).toEqual([
      [100, 2100],
      [4220, 5270],
    ]);
  });

  it('counts a driver change only between two names', () => {
    const unnamed = [
      stintOf(1, { driver: '' }),
      stintOf(2, { driver: 'Andrei Petrov' }),
      stintOf(3, { driver: '' }),
      stintOf(4, { driver: 'Andrei Petrov' }),
      stintOf(5, { driver: 'Mikhail Ivanov' }),
    ];
    expect(
      drivenBars(unnamed, { kind: 'time', end: 20_000 }, 12_000).map(
        (bar) => bar.driverChanges
      )
    ).toEqual([0, 0, 0, 0, 1]);
  });

  it('drops a stint with no length, and keeps inside the scale', () => {
    const odd = [
      stintOf(1, { startTime: -50, endTime: 2100 }),
      stintOf(2, { startTime: 2160, endTime: 2160 }),
      stintOf(3, { startTime: 9000, endTime: 12_000 }),
    ];
    expect(
      drivenBars(odd, time, 5270).map(({ from, to }) => [from, to])
    ).toEqual([
      [0, 2100],
      [9000, 10_220],
    ]);
  });

  describe('for a car that went to its garage', () => {
    /** One stint driven, then the garage at 2100 s, as the recorder keeps it. */
    const toTheGarage = stintOf(1, { closedBy: 'garage', stop: null });
    const inTheGarage = stintOf(2, {
      openedBy: 'garage',
      closedBy: null,
      startTime: 2100,
      endTime: null,
      firstLap: null,
      lastLap: null,
      laps: 0,
      cleanLaps: 0,
      avgLap: null,
      bestLap: null,
      stop: null,
    });

    it('draws nothing after the stint it left the track on while it has no lap since', () => {
      // An hour later the car is still there. The open stint ran from the
      // moment it left to now, so its bar grew with the clock.
      expect(
        drivenBars([toTheGarage, inTheGarage], time, 5700).map(
          ({ from, to, current }) => [from, to, current]
        )
      ).toEqual([[100, 2100, false]]);
      expect(
        drivenBars([toTheGarage, inTheGarage], laps, 20.4).map(
          ({ from, to }) => [from, to]
        )
      ).toEqual([[0, 20]]);
    });

    it('leaves the time in the garage as a gap once the car is lapping again', () => {
      // Back on the track at 3300 s, twenty minutes later, and three laps on.
      const back = {
        ...inTheGarage,
        startTime: 3300,
        firstLap: 21,
        lastLap: 23,
        laps: 3,
      };
      expect(
        drivenBars([toTheGarage, back], time, 3650).map(
          ({ from, to, current }) => [from, to, current]
        )
      ).toEqual([
        [100, 2100, false],
        [3300, 3650, true],
      ]);
    });
  });

  it('is empty for a car with nothing recorded', () => {
    expect(drivenBars([], time, 5270)).toEqual([]);
  });
});

describe('forecastBars', () => {
  const time = { kind: 'time' as const, end: 10_220, now: 5270 };
  const laps = { kind: 'laps' as const, end: 100, now: 50.5 };

  it('lays the stops owed end to end on the clock, with the stop between', () => {
    // 9.5 laps to the stop at the end of lap 60, then stints of 20 laps at
    // 100 s with a minute lost at each stop.
    expect(forecastBars(CLASS[3], time, 5270)).toEqual([
      { from: 5270, to: 6220, rest: true },
      { from: 6280, to: 8280, rest: false },
      { from: 8340, to: 10_220, rest: false },
    ]);
  });

  it('lays them out in laps, where a stop takes no room', () => {
    expect(forecastBars(CLASS[3], laps, 50.5)).toEqual([
      { from: 50.5, to: 60, rest: true },
      { from: 60, to: 80, rest: false },
      { from: 80, to: 100, rest: false },
    ]);
  });

  it('is one bar to the flag for a car that owes no stop', () => {
    expect(
      forecastBars(car(0, 1, { stopsOwed: 0, nextStopLap: null }), time, 5270)
    ).toEqual([{ from: 5270, to: 10_220, rest: true }]);
  });

  it('is nothing where the stops are not known, or the next cannot be named', () => {
    expect(
      forecastBars(
        car(0, 1, { stopsOwed: null, nextStopLap: null }),
        time,
        5270
      )
    ).toEqual([]);
    expect(forecastBars(car(0, 1, { nextStopLap: null }), time, 5270)).toEqual(
      []
    );
    expect(forecastBars(car(0, 1, { stintLaps: 0 }), time, 5270)).toEqual([]);
  });

  it('starts a whole stint at once for a car whose stop is due now', () => {
    expect(
      forecastBars(car(0, 1, { nextStopLap: 50, stopsOwed: 1 }), time, 5270)
    ).toEqual([{ from: 5330, to: 10_220, rest: false }]);
  });

  it('draws no stop the flag comes before', () => {
    // Two stops owed on the figures, and the second would fall after the
    // flag: the last bar runs to the flag.
    expect(
      forecastBars(car(0, 1, { stintLaps: 45 }), time, 5270).map(
        ({ from, to }) => [from, to]
      )
    ).toEqual([
      [5270, 6220],
      [6280, 10_220],
    ]);
  });

  it('ends a lapped car’s bars at its own finish, in laps', () => {
    expect(
      forecastBars(car(0, 1, { lapsLeft: 46.5 }), laps, 50.5).map(
        ({ from, to }) => [from, to]
      )
    ).toEqual([
      [50.5, 60],
      [60, 80],
      [80, 97],
    ]);
  });

  it('is nothing once the flag is here', () => {
    expect(forecastBars(CLASS[3], time, 10_220)).toEqual([]);
  });
});

describe('timelineModel', () => {
  const stints = new Map<number, readonly RaceStint[]>([[0, STINTS]]);

  it('gives the own car its driven stints and its stints to come, and a rival what is known of it', () => {
    const model = timelineModel(forecast(), stints, 2);
    expect(model?.axis).toMatchObject({ kind: 'time', end: 10_220, now: 5270 });
    expect(model?.rows.map((row) => [row.carIdx, row.own])).toEqual([
      [0, true],
      [12, false],
      [13, false],
    ]);
    const [own, rival] = model?.rows ?? [];
    expect(own.bars.map((bar) => bar.kind)).toEqual([
      'driven',
      'driven',
      'driven',
      'forecast',
      'forecast',
      'forecast',
    ]);
    // What is left of the stint under way is its driver's.
    expect(own.bars[3]).toMatchObject({
      from: 5270,
      to: 6220,
      driver: 'Mikhail Ivanov',
      driverIndex: 0,
      current: true,
    });
    // Who drives the stints after it is not known.
    expect(own.bars[4]).toMatchObject({ driver: '', current: false });
    // Nothing is recorded of the rival: only its stints to come.
    expect(rival.bars.map((bar) => bar.kind)).toEqual([
      'forecast',
      'forecast',
      'forecast',
    ]);
    expect(rival.bars[0].driver).toBe('');
  });

  it('places every car at its own lap in a race to a lap count', () => {
    const cars = CLASS.map((entry) =>
      entry.carIdx === 12 ? { ...entry, progress: 50.9 } : entry
    );
    const model = timelineModel(
      forecast({ raceType: 'laps', lapLimit: 100, timeLeftS: null, cars }),
      stints,
      1
    );
    expect(model?.axis).toMatchObject({ kind: 'laps', end: 100, now: 50.5 });
    expect(model?.rows[0].bars[2]).toMatchObject({ from: 40, to: 50.5 });
    expect(model?.rows[1].bars[0]).toMatchObject({ from: 50.9, to: 60 });
  });

  it('is nothing without a forecast, or an end to draw to', () => {
    expect(timelineModel(undefined, stints, 2)).toBeNull();
    expect(
      timelineModel(forecast({ valid: false, reason: 'notRace' }), stints, 2)
    ).toBeNull();
    expect(timelineModel(forecast({ flagInS: null }), stints, 2)).toBeNull();
    expect(timelineModel(forecast({ cars: [] }), stints, 2)).toBeNull();
  });
});
