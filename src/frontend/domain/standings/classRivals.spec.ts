import { describe, expect, it } from 'vitest';
import {
  CAR_PIT_IN_LANE,
  CAR_PIT_ON_TRACK,
  LMU_FINISH_STATUS,
  TrackLocation,
  type CarPitSnapshot,
  type Driver,
  type LapHistorySnapshot,
  type RelativeGapsSnapshot,
  type SessionResults,
} from '@irdashies/types';
import {
  buildClassRivals,
  catchForecast,
  chooseRivalGap,
  classGridChange,
  classIdsByCar,
  classNeighbours,
  classPositionsByCar,
  gapTrend,
  lineGapSeries,
  overallGridChange,
  raceInterval,
  raceProgress,
  type ClassRivalsSnapshot,
  type LineGap,
} from './classRivals';

const GT3 = 30;
const LMP2 = 20;

const car = (
  carIdx: number,
  classId: number,
  overrides: Partial<Driver> = {}
): Driver =>
  ({
    CarIdx: carIdx,
    UserName: `Driver ${carIdx}`,
    CarNumber: `${carIdx + 10}`,
    CarID: 100 + carIdx,
    CarClassID: classId,
    CarClassColor: classId,
    CarIsPaceCar: 0,
    IsSpectator: 0,
    ...overrides,
  }) as Driver;

/**
 * Six cars in slot order: three GT3 (slots 1, 3, 5) with two LMP2 between
 * them (slots 0 and 2) and a third (slot 4). The GT3s run 1st, 2nd and 3rd
 * in class: slot 3 leads, slot 1 (the focus car) follows, slot 5 is last.
 */
const grid: Driver[] = [
  car(0, LMP2),
  car(1, GT3),
  car(2, LMP2),
  car(3, GT3),
  car(4, LMP2),
  car(5, GT3),
];
const FOCUS = 1;
const AHEAD = 3;
const BEHIND = 5;

const snapshot = (
  overrides: Partial<ClassRivalsSnapshot> = {}
): ClassRivalsSnapshot => ({
  focusCarIdx: FOCUS,
  //             0     1     2     3     4     5
  carIdxF2Time: [0, 49.6, 4.1, 31.2, 9.0, 52.1],
  carIdxClassPosition: [1, 2, 2, 1, 3, 3],
  carIdxBestLapTime: [92.1, 101.9, 92.4, 101.2, 92.9, 102.4],
  carIdxLastLapTime: [92.6, 102.3, 92.4, 101.2, 93.3, 103.0],
  carIdxOnPitRoad: grid.map(() => false),
  carIdxLap: [11, 10, 11, 10, 11, 10],
  carIdxLapDistPct: [0.2, 0.3, 0.15, 0.5, 0.1, 0.27],
  carIdxTrackSurface: grid.map(() => TrackLocation.OnTrack),
  carIdxTireCompound: grid.map(() => 0),
  carIdxWheelCompounds: [],
  carIdxTrackLimitsPoints: [],
  carIdxEnergyRemaining: [],
  carIdxEnergyIsVirtual: [],
  carIdxPenalties: [],
  carIdxPenaltyKind: [],
  carIdxPenaltySeconds: [],
  carIdxFinishStatus: [],
  carIdxLastLapInvalid: [],
  carIdxInGarage: [],
  carIdxPitStops: [],
  carIdxPitState: [],
  lastPitLap: [],
  penaltySeconds: undefined,
  trackLimitsPointsMax: 0,
  liveClassPosition: [],
  ...overrides,
});

/** A lap history in which car `i` completed lap `n` at `times[i][n - 1]`. */
const historyOf = (times: number[][], firstLap = 1): LapHistorySnapshot => {
  const capacity = 8;
  const size = times.length * capacity;
  const lap = new Array<number>(size).fill(0);
  const sessionTime = new Array<number>(size).fill(0);
  times.forEach((carTimes, carIdx) =>
    carTimes.forEach((time, index) => {
      lap[carIdx * capacity + index] = firstLap + index;
      sessionTime[carIdx * capacity + index] = time;
    })
  );
  return {
    carCount: times.length,
    capacity,
    count: times.map((carTimes) => carTimes.length),
    start: times.map(() => 0),
    lap,
    sessionTime,
    classPosition: new Array<number>(size).fill(0),
    flags: new Array<number>(size).fill(0),
    sessionNum: 0,
    version: 1,
  };
};

/** Line crossings a hundred seconds apart, offset by each lap's gap. */
const crossings = (gaps: number[], base = 1000): [number[], number[]] => [
  gaps.map((_, lap) => base + lap * 100),
  gaps.map((gap, lap) => base + lap * 100 + gap),
];

const lineGaps = (seconds: number[]): LineGap[] =>
  seconds.map((value, index) => ({ lap: index + 1, seconds: value }));

describe('classNeighbours', () => {
  const classes = classIdsByCar(grid);

  it('finds the class cars either side, with other classes interleaved', () => {
    expect(
      classNeighbours(FOCUS, classes, snapshot().carIdxClassPosition)
    ).toEqual({ ahead: AHEAD, behind: BEHIND, leader: AHEAD });
  });

  it('has nobody ahead of the class leader', () => {
    expect(
      classNeighbours(AHEAD, classes, snapshot().carIdxClassPosition)
    ).toEqual({ ahead: -1, behind: FOCUS, leader: AHEAD });
  });

  it('has nobody behind the last car of the class', () => {
    expect(
      classNeighbours(BEHIND, classes, snapshot().carIdxClassPosition)
    ).toEqual({ ahead: FOCUS, behind: -1, leader: AHEAD });
  });

  it('takes a live position over the one the sim gives', () => {
    // The focus car has just passed the class leader on the road; the sim's
    // order has not caught up.
    const live: (number | undefined)[] = [];
    live[FOCUS] = 1;
    live[AHEAD] = 2;
    live[BEHIND] = 3;
    const positions = classPositionsByCar(
      snapshot({ liveClassPosition: live })
    );

    expect(classNeighbours(FOCUS, classes, positions)).toEqual({
      ahead: -1,
      behind: AHEAD,
      leader: FOCUS,
    });
    // The LMP2s, which the live order does not list here, keep the sim's.
    expect(positions[0]).toBe(1);
  });

  it('never matches a car with no place', () => {
    // The car that would be behind has place 0: not classified yet.
    expect(classNeighbours(FOCUS, classes, [1, 2, 2, 1, 3, 0])).toEqual({
      ahead: AHEAD,
      behind: -1,
      leader: AHEAD,
    });
    // And a focus car with no place has no neighbours, only a leader.
    expect(classNeighbours(FOCUS, classes, [1, 0, 2, 1, 3, 3])).toEqual({
      ahead: -1,
      behind: -1,
      leader: AHEAD,
    });
  });

  it('skips the pace car and a spectator, even on a place in the class', () => {
    const withPaceCar = classIdsByCar([
      ...grid.slice(0, 3),
      car(3, GT3, { CarIsPaceCar: 1 }),
      grid[4],
      car(5, GT3, { IsSpectator: 1 }),
    ]);

    expect(
      classNeighbours(FOCUS, withPaceCar, snapshot().carIdxClassPosition)
    ).toEqual({ ahead: -1, behind: -1, leader: -1 });
  });

  it('has no neighbours for a car with no class', () => {
    expect(classNeighbours(9, classes, [1, 2, 2, 1, 3, 3])).toEqual({
      ahead: -1,
      behind: -1,
      leader: -1,
    });
  });
});

describe('raceInterval', () => {
  it('is the difference of the times behind the leader on the same lap', () => {
    const interval = raceInterval(AHEAD, FOCUS, snapshot(), true);

    expect(interval.laps).toBe(0);
    expect(interval.seconds).toBeCloseTo(18.4, 10);
  });

  it('counts whole laps once more than a lap separates the two', () => {
    // The car behind is 2.03 laps of progress back.
    const interval = raceInterval(
      FOCUS,
      BEHIND,
      snapshot({ carIdxLap: [11, 10, 11, 10, 11, 8] }),
      true
    );

    expect(interval.laps).toBe(2);
  });

  it('has no seconds for a car with no lap fraction', () => {
    const inGarage = snapshot({
      carIdxLapDistPct: [0.2, 0.3, 0.15, -1, 0.1, 0.27],
    });

    expect(raceInterval(AHEAD, FOCUS, inGarage, true)).toEqual({
      laps: 0,
      seconds: null,
    });
    expect(raceProgress(inGarage, AHEAD)).toBeNull();
  });

  it('is the difference of the best laps outside a race', () => {
    const interval = raceInterval(AHEAD, FOCUS, snapshot(), false);

    expect(interval.laps).toBe(0);
    expect(interval.seconds).toBeCloseTo(0.7, 10);
  });

  it('has no seconds outside a race until both cars have a lap', () => {
    const noLap = snapshot({
      carIdxBestLapTime: [92.1, 0, 92.4, 101.2, 92.9, 102.4],
    });

    expect(raceInterval(AHEAD, FOCUS, noLap, false).seconds).toBeNull();
  });

  it('is nothing without two cars', () => {
    expect(raceInterval(-1, FOCUS, snapshot(), true)).toEqual({
      laps: 0,
      seconds: null,
    });
  });
});

describe('chooseRivalGap', () => {
  it('shows the live delta within half a lap', () => {
    expect(chooseRivalGap({ laps: 0, seconds: 1.31 }, 0.2, 1.23, 2)).toEqual({
      text: '1.23',
      seconds: 1.23,
      source: 'live',
    });
    // The delta is signed from the focus car; the gap is not.
    expect(chooseRivalGap({ laps: 0, seconds: 1.31 }, 0.2, -1.23, 2).text).toBe(
      '1.23'
    );
  });

  it('shows the race interval beyond half a lap, not the short way round', () => {
    // 0.7 of a lap ahead: the relative wraps and reads 27 s behind.
    expect(chooseRivalGap({ laps: 0, seconds: 60.2 }, 0.7, -27.4, 2)).toEqual({
      text: '1:00',
      seconds: 60.2,
      source: 'interval',
    });
  });

  it('shows laps once more than a lap apart, whatever else reads', () => {
    expect(chooseRivalGap({ laps: 2, seconds: 171.3 }, 2.2, 14.1, 2)).toEqual({
      text: '2L',
      seconds: null,
      source: 'laps',
    });
  });

  it('falls back to the interval with no live delta, and to nothing with neither', () => {
    expect(
      chooseRivalGap({ laps: 0, seconds: 0.487 }, 0.01, null, 3).text
    ).toBe('0.487');
    expect(chooseRivalGap({ laps: 0, seconds: null }, null, null, 2)).toEqual({
      text: '',
      seconds: null,
      source: 'none',
    });
  });

  it('does not take the live delta while the order and the road disagree', () => {
    // The car listed ahead is a few metres behind on the road: just passed.
    expect(
      chooseRivalGap({ laps: 0, seconds: 0.12 }, -0.002, 0.09, 2).source
    ).toBe('interval');
  });
});

describe('lineGapSeries', () => {
  it('pairs the two cars by lap, newest last', () => {
    const [ahead, behind] = crossings([2.0, 1.6, 1.3]);

    expect(lineGapSeries(historyOf([ahead, behind]), 0, 1)).toEqual([
      { lap: 1, seconds: 2 },
      { lap: 2, seconds: expect.closeTo(1.6, 10) },
      { lap: 3, seconds: expect.closeTo(1.3, 10) },
    ]);
  });

  it('keeps the last four laps at most', () => {
    const [ahead, behind] = crossings([5, 4, 3, 2.5, 2, 1.5]);
    const series = lineGapSeries(historyOf([ahead, behind]), 0, 1);

    expect(series.map((sample) => sample.lap)).toEqual([3, 4, 5, 6]);
  });

  it('waits for the car behind: the lap only the car ahead has finished is not a gap', () => {
    const [ahead, behind] = crossings([2.0, 1.6, 1.3]);
    const series = lineGapSeries(historyOf([ahead, behind.slice(0, 2)]), 0, 1);

    expect(series.map((sample) => sample.lap)).toEqual([1, 2]);
  });

  it('reads the race gap of two cars most of a lap apart', () => {
    // 62 s apart on a 100 s lap: the short way round would say 38.
    const [ahead, behind] = crossings([62.0, 62.4]);
    const series = lineGapSeries(historyOf([ahead, behind]), 0, 1);

    expect(series.at(-1)?.seconds).toBeCloseTo(62.4, 10);
  });

  it('is negative where the order was the other way round on that lap', () => {
    const [ahead, behind] = crossings([-0.4, 0.3]);
    const series = lineGapSeries(historyOf([ahead, behind]), 0, 1);

    expect(series[0].seconds).toBeCloseTo(-0.4, 10);
    expect(series[1].seconds).toBeCloseTo(0.3, 10);
  });

  it('stops at a lap one of the two has no crossing for', () => {
    // The car ahead's ring holds laps 3 to 5; the car behind's 1 to 5.
    const history = historyOf([
      [1200, 1300, 1400],
      [1002, 1102, 1202.5, 1302.2, 1401.9],
    ]);
    const lap = [...history.lap];
    lap.splice(0, 3, 3, 4, 5);
    const series = lineGapSeries({ ...history, lap }, 0, 1);

    expect(series.map((sample) => sample.lap)).toEqual([3, 4, 5]);
  });

  it('is empty without a history or a shared lap', () => {
    expect(lineGapSeries(undefined, 0, 1)).toEqual([]);
    expect(lineGapSeries(historyOf([[1000], []]), 0, 1)).toEqual([]);
    expect(lineGapSeries(historyOf([[1000], [1001]]), -1, 1)).toEqual([]);
  });
});

describe('gapTrend', () => {
  it('is the mean change a lap over the last three laps', () => {
    expect(gapTrend(lineGaps([4.0, 3.6, 3.3, 2.8]))).toEqual({
      perLap: expect.closeTo(-0.4, 10),
      laps: 3,
      closingLaps: 3,
    });
  });

  it('reads one change from two crossings, and nothing from one', () => {
    expect(gapTrend(lineGaps([2.0, 2.5]))).toEqual({
      perLap: 0.5,
      laps: 1,
      closingLaps: 0,
    });
    expect(gapTrend(lineGaps([2.0]))).toBeNull();
    expect(gapTrend([])).toBeNull();
  });

  it('looks no further back than three laps', () => {
    // A stint ago the gap was 20 s; that is not how it is moving now.
    const trend = gapTrend(lineGaps([20, 12, 5.0, 4.9, 4.8, 4.7]));

    expect(trend?.laps).toBe(3);
    expect(trend?.perLap).toBeCloseTo(-0.1, 10);
  });
});

describe('catchForecast', () => {
  const closing = { perLap: -0.5, laps: 3, closingLaps: 3 };

  it('is the gap over the rate it has been closing at, in whole laps', () => {
    expect(catchForecast(3.1, closing)).toBe(6);
    expect(catchForecast(0.2, closing)).toBe(1);
  });

  it('is withheld until three lap-to-lap changes are behind it', () => {
    expect(catchForecast(3.1, { ...closing, laps: 2, closingLaps: 2 })).toBe(
      null
    );
    expect(catchForecast(3.1, { ...closing, laps: 1, closingLaps: 1 })).toBe(
      null
    );
    expect(catchForecast(3.1, null)).toBeNull();
  });

  it('is withheld when the gap closed on one lap of the three', () => {
    // A rival's one slow lap: +0.1, +0.1, -2.0 averages to a "pace" that is
    // not one.
    const trend = gapTrend(lineGaps([4.0, 4.1, 4.2, 2.2]));

    expect(trend?.perLap).toBeCloseTo(-0.6, 10);
    expect(trend?.closingLaps).toBe(1);
    expect(catchForecast(2.2, trend)).toBeNull();
  });

  it('is withheld while the gap holds or opens', () => {
    expect(catchForecast(3, { perLap: 0.3, laps: 3, closingLaps: 0 })).toBe(
      null
    );
    expect(catchForecast(3, { perLap: -0.03, laps: 3, closingLaps: 2 })).toBe(
      null
    );
  });

  it('is withheld more than fifty laps out, and with no gap to close', () => {
    expect(catchForecast(30, { perLap: -0.1, laps: 3, closingLaps: 3 })).toBe(
      null
    );
    expect(catchForecast(5, { perLap: -0.1, laps: 3, closingLaps: 3 })).toBe(
      50
    );
    expect(catchForecast(null, closing)).toBeNull();
    expect(catchForecast(0, closing)).toBeNull();
  });
});

describe('grid changes', () => {
  /** Class positions from 0, overall from 1, as both sims publish them. */
  const results = (base = 1): SessionResults[] =>
    [
      { CarIdx: 0, Position: 0, ClassPosition: 0 },
      { CarIdx: 3, Position: 1, ClassPosition: 0 },
      { CarIdx: 2, Position: 2, ClassPosition: 1 },
      { CarIdx: 5, Position: 3, ClassPosition: 1 },
      { CarIdx: 4, Position: 4, ClassPosition: 2 },
      { CarIdx: 1, Position: 5, ClassPosition: 2 },
    ].map((entry) => ({
      ...entry,
      Position: entry.Position + base,
    })) as SessionResults[];

  it('is the class grid place less the place now', () => {
    // Started third in class, now second: up one.
    expect(classGridChange(results(), FOCUS, 2)).toBe(1);
    expect(classGridChange(results(), AHEAD, 3)).toBe(-2);
    expect(classGridChange(results(), BEHIND, 2)).toBe(0);
  });

  it('gives the same overall change whatever the list counts from', () => {
    expect(overallGridChange(results(1), FOCUS, 4)).toBe(2);
    expect(overallGridChange(results(0), FOCUS, 4)).toBe(2);
  });

  it('is undefined with no grid entry, and with no place', () => {
    expect(classGridChange(results(), 9, 2)).toBeUndefined();
    expect(classGridChange(undefined, FOCUS, 2)).toBeUndefined();
    expect(classGridChange(results(), FOCUS, 0)).toBeUndefined();
    expect(overallGridChange(results(), 9, 2)).toBeUndefined();
    expect(overallGridChange(results(), FOCUS, undefined)).toBeUndefined();
  });
});

describe('buildClassRivals', () => {
  const carPit = (): CarPitSnapshot => ({
    where: grid.map(() => CAR_PIT_ON_TRACK),
    laneTimeS: grid.map(() => 0),
    standingS: grid.map(() => 0),
    stops: grid.map(() => 0),
    lastPitLap: grid.map(() => -1),
    lastStopLap: grid.map(() => -1),
    stintLaps: [10, 9, 10, 9, 10, 9],
    longestStintLaps: grid.map(() => 0),
    usedLastLap: grid.map(() => -1),
    usedAverage: grid.map(() => -1),
    lapsLeft: grid.map(() => -1),
    requested: grid.map(() => false),
    counts: {
      onTrack: 6,
      inLane: 0,
      standingInLane: 0,
      requested: 0,
      inGarage: 0,
    },
    sessionNum: 0,
    version: 1,
  });

  const relativeGaps = (deltas: (number | null)[]): RelativeGapsSnapshot => ({
    focusCarIdx: FOCUS,
    relativePcts: deltas.map(() => 0),
    deltas,
    sessionNum: 0,
    version: 1,
  });

  /** Four laps of line crossings for every slot; only three are GT3. */
  const history = (aheadGaps: number[], behindGaps: number[]) => {
    const focusTimes = aheadGaps.map((_, lap) => 1000 + lap * 100);
    const times: number[][] = grid.map(() => []);
    times[FOCUS] = focusTimes;
    times[AHEAD] = focusTimes.map((time, lap) => time - aheadGaps[lap]);
    times[BEHIND] = focusTimes.map((time, lap) => time + behindGaps[lap]);
    // Laps 6 to 9: the cars are on lap 10.
    return historyOf(times, 6);
  };

  const build = (
    overrides: Partial<Parameters<typeof buildClassRivals>[0]> = {}
  ) =>
    buildClassRivals({
      standings: snapshot(),
      drivers: grid,
      isRace: true,
      ...overrides,
    });

  it('builds the car ahead, the focus car and the car behind', () => {
    const rivals = build();

    expect(rivals.focusCarIdx).toBe(FOCUS);
    expect(rivals.ahead?.carIdx).toBe(AHEAD);
    expect(rivals.focus?.carIdx).toBe(FOCUS);
    expect(rivals.behind?.carIdx).toBe(BEHIND);
    expect(rivals.focus).toMatchObject({
      isFocus: true,
      classPosition: 2,
      name: 'Driver 1',
      carNumber: '11',
      lastTime: 102.3,
      bestTime: 101.9,
    });
    expect(rivals.ahead?.isFocus).toBe(false);
  });

  it('gives each rival its race interval, in the right direction', () => {
    const rivals = build();

    // Ahead by 18.4 s, behind by 2.5 s: both by the times behind the leader.
    expect(rivals.ahead?.interval.seconds).toBeCloseTo(18.4, 10);
    expect(rivals.behind?.interval.seconds).toBeCloseTo(2.5, 10);
    expect(rivals.ahead?.gap.text).toBe('18.40');
    expect(rivals.behind?.gap.text).toBe('2.50');
  });

  it('prefers the live delta for a rival within half a lap', () => {
    const deltas: (number | null)[] = grid.map(() => null);
    deltas[AHEAD] = 18.11;
    deltas[BEHIND] = -2.37;
    const rivals = build({ relativeGaps: relativeGaps(deltas) });

    expect(rivals.ahead?.gap).toMatchObject({ text: '18.11', source: 'live' });
    expect(rivals.behind?.gap).toMatchObject({ text: '2.37', source: 'live' });
  });

  it('marks the class best lap, and a last lap that is a best', () => {
    const rivals = build();

    // Slot 3 holds the class best, 101.2, and has just set it.
    expect(rivals.ahead).toMatchObject({
      bestIsClassBest: true,
      lastTimeState: 'session-fastest',
    });
    expect(rivals.focus).toMatchObject({
      bestIsClassBest: false,
      lastTimeState: undefined,
    });
    // A lap equal to the car's own best, which is not the class's.
    const personal = build({
      standings: snapshot({
        carIdxLastLapTime: [92.6, 101.9, 92.4, 101.5, 93.3, 103.0],
      }),
    });
    expect(personal.focus?.lastTimeState).toBe('personal-best');
  });

  it('forecasts the catch from three laps of a closing gap', () => {
    // The car ahead: 20.0, 19.5, 19.1, 18.6 over the line: 0.47 a lap.
    // The car behind: 4.0, 3.5, 3.1, 2.6: closing on the focus car as fast.
    const rivals = build({
      lapHistory: history([20.0, 19.5, 19.1, 18.6], [4.0, 3.5, 3.1, 2.6]),
    });

    expect(rivals.ahead?.previousLineGap).toBeCloseTo(18.6, 10);
    expect(rivals.ahead?.trend).toMatchObject({ laps: 3, closingLaps: 3 });
    expect(rivals.ahead?.trend?.perLap).toBeCloseTo(-0.4667, 3);
    // 18.4 s at 0.47 a lap: about 39 laps.
    expect(rivals.ahead?.forecastLaps).toBe(39);
    // 2.5 s at 0.47 a lap: about 5 laps until the car behind is there.
    expect(rivals.behind?.forecastLaps).toBe(5);
  });

  it('withholds the forecast with too few laps, and keeps the trend', () => {
    const rivals = build({
      lapHistory: history([19.1, 18.6], [3.1, 2.6]),
    });

    expect(rivals.ahead?.trend).toMatchObject({ laps: 1, closingLaps: 1 });
    expect(rivals.ahead?.forecastLaps).toBeNull();
    expect(rivals.behind?.forecastLaps).toBeNull();
  });

  it('has no forecast for a rival that is falling back', () => {
    const rivals = build({
      lapHistory: history([17.0, 17.5, 18.0, 18.6], [1.0, 1.5, 2.0, 2.6]),
    });

    expect(rivals.ahead?.trend?.perLap).toBeGreaterThan(0.5);
    expect(rivals.ahead?.forecastLaps).toBeNull();
    expect(rivals.behind?.forecastLaps).toBeNull();
  });

  it('reads a lapped rival in laps, with no trend and no forecast', () => {
    const rivals = build({
      standings: snapshot({ carIdxLap: [11, 10, 11, 10, 11, 8] }),
      lapHistory: history([20.0, 19.5, 19.1, 18.6], [4.0, 3.5, 3.1, 2.6]),
    });

    expect(rivals.behind?.interval.laps).toBe(2);
    expect(rivals.behind?.gap).toEqual({
      text: '2L',
      seconds: null,
      source: 'laps',
    });
    expect(rivals.behind?.trend).toBeNull();
    expect(rivals.behind?.previousLineGap).toBeNull();
    expect(rivals.behind?.forecastLaps).toBeNull();
    // The car ahead is untouched by it.
    expect(rivals.ahead?.forecastLaps).toBe(39);
  });

  it('shows a rival in the pit lane, and forecasts nothing from its stop', () => {
    const where = grid.map(() => CAR_PIT_ON_TRACK);
    where[AHEAD] = CAR_PIT_IN_LANE;
    const laneTimeS = grid.map(() => 0);
    laneTimeS[AHEAD] = 12.3;
    const rivals = build({
      standings: snapshot({
        carIdxOnPitRoad: grid.map((_, carIdx) => carIdx === AHEAD),
      }),
      carPit: { ...carPit(), where, laneTimeS },
      lapHistory: history([20.0, 19.5, 19.1, 18.6], [4.0, 3.5, 3.1, 2.6]),
    });

    expect(rivals.ahead).toMatchObject({
      inPitLane: true,
      inGarage: false,
      onOutLap: false,
      pitLaneSeconds: 12.3,
    });
    // The gap is still the race's; what it is doing is not a pace.
    expect(rivals.ahead?.gap.text).toBe('18.40');
    expect(rivals.ahead?.trend).toBeNull();
    expect(rivals.ahead?.forecastLaps).toBeNull();
    expect(rivals.behind?.forecastLaps).toBe(5);
  });

  it('marks the out-lap, and starts the trend again after the stop', () => {
    // The car ahead pitted on lap 9 and is back out, still on lap 10's...
    const lastPitLap: (number | undefined)[] = [];
    lastPitLap[AHEAD] = 10;
    const laneTimeS = grid.map(() => 0);
    laneTimeS[AHEAD] = 41.2;
    const outLap = build({
      standings: snapshot({ lastPitLap }),
      carPit: { ...carPit(), laneTimeS },
      lapHistory: history([20.0, 19.5, 19.1, 18.6], [4.0, 3.5, 3.1, 2.6]),
    });

    expect(outLap.ahead).toMatchObject({
      inPitLane: false,
      onOutLap: true,
      pitLaneSeconds: 41.2,
    });
    // ...so no line gap since the stop is clear of it yet.
    expect(outLap.ahead?.trend).toBeNull();
    expect(outLap.ahead?.forecastLaps).toBeNull();

    // A stop on lap 7: the gaps at the end of laps 7, 8 and 9 are clear of
    // it, which is two changes, one short of a forecast.
    lastPitLap[AHEAD] = 7;
    const later = build({
      standings: snapshot({ lastPitLap }),
      carPit: carPit(),
      lapHistory: history([60.0, 19.5, 19.1, 18.6], [4.0, 3.5, 3.1, 2.6]),
    });
    expect(later.ahead?.onOutLap).toBe(false);
    expect(later.ahead?.trend).toMatchObject({ laps: 2, closingLaps: 2 });
    expect(later.ahead?.forecastLaps).toBeNull();
  });

  it('carries the stint, the stops and the energy where the sim publishes them', () => {
    const lapsLeft = grid.map(() => -1);
    lapsLeft[AHEAD] = 14.6;
    lapsLeft[FOCUS] = 17.2;
    const usedLastLap = grid.map(() => -1);
    usedLastLap[AHEAD] = 0.0238;
    const pitState = grid.map(() => 0);
    pitState[BEHIND] = 1;
    const rivals = build({
      standings: snapshot({
        carIdxPitStops: [1, 1, 1, 2, 1, 0],
        carIdxPitState: pitState,
        carIdxEnergyRemaining: [0.6, 0.41, 0.6, 0.35, 0.6, -1],
        carIdxEnergyIsVirtual: [false, true, false, true, false, true],
        carIdxTrackLimitsPoints: [0, 0.25, 0, 1.5, 0, -1],
        trackLimitsPointsMax: 5,
      }),
      carPit: { ...carPit(), lapsLeft, usedLastLap },
    });

    expect(rivals.available).toEqual({
      pitStops: true,
      energy: true,
      trackLimits: true,
    });
    expect(rivals.trackLimitsPointsMax).toBe(5);
    expect(rivals.ahead).toMatchObject({
      pitStops: 2,
      pitRequested: false,
      stintLaps: 9,
      // Nine laps in, fourteen whole laps of energy left.
      stintEstimate: 23,
      energyRemaining: 0.35,
      energyIsVirtual: true,
      usedLastLap: 0.0238,
      trackLimitsPoints: 1.5,
    });
    expect(rivals.focus).toMatchObject({ stintLaps: 9, stintEstimate: 26 });
    // No reading is not zero: the car behind has neither figure.
    expect(rivals.behind).toMatchObject({
      pitStops: 0,
      pitRequested: true,
      stintEstimate: undefined,
      energyRemaining: undefined,
      trackLimitsPoints: undefined,
    });
  });

  it('drops what iRacing does not publish, and keeps the rest', () => {
    const rivals = build({ carPit: carPit() });

    expect(rivals.available).toEqual({
      pitStops: false,
      energy: false,
      trackLimits: false,
    });
    expect(rivals.ahead).toMatchObject({
      pitStops: undefined,
      energyRemaining: undefined,
      lastLapInvalid: undefined,
      stintLaps: 9,
    });
  });

  it('gives the class leader no car ahead and the last car none behind', () => {
    const leader = build({ standings: snapshot({ focusCarIdx: AHEAD }) });
    expect(leader.ahead).toBeUndefined();
    expect(leader.focus?.carIdx).toBe(AHEAD);
    expect(leader.behind?.carIdx).toBe(FOCUS);

    const last = build({ standings: snapshot({ focusCarIdx: BEHIND }) });
    expect(last.ahead?.carIdx).toBe(FOCUS);
    expect(last.behind).toBeUndefined();
  });

  it('follows the camera: the rivals are the watched car’s', () => {
    // The camera on the leading LMP2: its class, its neighbours.
    const watching = build({ standings: snapshot({ focusCarIdx: 0 }) });

    expect(watching.focus?.carIdx).toBe(0);
    expect(watching.ahead).toBeUndefined();
    expect(watching.behind?.carIdx).toBe(2);
    expect(watching.behind?.interval.seconds).toBeCloseTo(4.1, 10);
  });

  it('measures by best laps outside a race, with no grid change', () => {
    const results = [
      { CarIdx: AHEAD, Position: 1, ClassPosition: 0 },
      { CarIdx: FOCUS, Position: 2, ClassPosition: 2 },
    ] as SessionResults[];
    const practice = build({ isRace: false, qualifyingResults: results });

    expect(practice.ahead?.gap).toMatchObject({
      text: '0.70',
      source: 'interval',
    });
    expect(practice.focus?.positionChange).toBeUndefined();
    expect(practice.ahead?.forecastLaps).toBeNull();

    const race = build({ qualifyingResults: results });
    expect(race.focus?.positionChange).toBe(1);
    expect(race.ahead?.positionChange).toBe(0);
    // No grid entry for the car behind.
    expect(race.behind?.positionChange).toBeUndefined();
  });

  it('names a finished and a retired rival', () => {
    const finish = grid.map(() => LMU_FINISH_STATUS.none as number);
    finish[AHEAD] = LMU_FINISH_STATUS.finished;
    finish[BEHIND] = LMU_FINISH_STATUS.dnf;
    const rivals = build({
      standings: snapshot({ carIdxFinishStatus: finish }),
    });

    expect(rivals.ahead?.finishState).toBe('FINISHED');
    expect(rivals.behind?.finishState).toBe('DNF');
    expect(rivals.focus?.finishState).toBeUndefined();
  });

  it('is empty before a snapshot, and for a focus car that is not racing', () => {
    expect(build({ standings: undefined })).toMatchObject({
      focusCarIdx: undefined,
      ahead: undefined,
      focus: undefined,
      behind: undefined,
    });
    expect(
      build({ standings: snapshot({ focusCarIdx: null }) }).focus
    ).toBeUndefined();
    // A slot the session does not list.
    const unknown = build({ standings: snapshot({ focusCarIdx: 9 }) });
    expect(unknown.focus).toBeUndefined();
    expect(unknown.ahead).toBeUndefined();
  });
});
