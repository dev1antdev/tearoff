import { describe, expect, it } from 'vitest';
import type { Gap, Standings } from './createStandings';
import { buildOverallStandings, type OverallTiming } from './overallStandings';

/** A car as the Standings list it. What is left out is a car on track. */
const car = (
  carIdx: number,
  classId: number,
  over: Partial<Standings> = {}
): Standings => ({
  carIdx,
  position: carIdx + 1,
  classPosition: 1,
  isPlayer: false,
  driver: {
    name: `Driver ${carIdx}`,
    carNum: `${carIdx}`,
    license: '',
    rating: 0,
  },
  fastestTime: 100,
  hasFastestTime: false,
  lastTime: 101,
  onPitRoad: false,
  tireCompound: 0,
  onTrack: true,
  carClass: {
    id: classId,
    color: 0,
    name: `Class ${classId}`,
    relativeSpeed: 10 - classId,
    estLapTime: 100,
  },
  dnf: false,
  repair: false,
  penalty: false,
  slowdown: false,
  relativePct: 0,
  currentSessionType: 'Race',
  ...over,
});

/** Every car on the lap and at the place on it that `progress` says. */
const timing = (progress: readonly number[]): OverallTiming => ({
  carIdxLap: progress.map((value) => Math.floor(value)),
  carIdxLapDistPct: progress.map((value) => value - Math.floor(value)),
  carIdxOnPitRoad: progress.map(() => false),
  carIdxEstTime: progress.map(() => 0),
});

const gapOf = (row: Standings) => row.gap as Gap;

describe('the whole field as one list, in a race', () => {
  /**
   * Two classes on the road together. Slots 0 and 2 are prototypes, 1 and 3
   * GT cars; overall they run 0, 2, 1, 3. `delta` is each car's time behind
   * the leader of the race, as the standings rows carry it in a race.
   */
  const groups: [string, Standings[]][] = [
    [
      '1',
      [
        car(0, 1, { position: 1, classPosition: 1, delta: 0 }),
        car(2, 1, { position: 2, classPosition: 2, delta: 12.4 }),
      ],
    ],
    [
      '2',
      [
        car(1, 2, { position: 3, classPosition: 1, delta: 48.0 }),
        car(3, 2, { position: 4, classPosition: 2, delta: 61.5 }),
      ],
    ],
  ];
  const onTheSameLap = timing([10.9, 10.5, 10.8, 10.4]);

  it('puts the cars in overall order, whatever their class', () => {
    const rows = buildOverallStandings(groups, onTheSameLap, 'Race');

    expect(rows.map((row) => row.carIdx)).toEqual([0, 2, 1, 3]);
    // Each row is still the car it was: its class and its place in it.
    expect(rows.map((row) => row.carClass.id)).toEqual([1, 1, 2, 2]);
    expect(rows.map((row) => row.classPosition)).toEqual([1, 2, 1, 2]);
  });

  it('measures every gap from the leader of the race, not of the class', () => {
    const rows = buildOverallStandings(groups, onTheSameLap, 'Race');

    expect(gapOf(rows[0]).value).toBeUndefined();
    expect(gapOf(rows[1]).value).toBeCloseTo(12.4, 9);
    // The leading GT car is 48 s behind the race leader, where its class
    // gap is nothing.
    expect(gapOf(rows[2]).value).toBeCloseTo(48.0, 9);
    expect(gapOf(rows[3]).value).toBeCloseTo(61.5, 9);
    expect(rows.map((row) => gapOf(row).laps)).toEqual([0, 0, 0, 0]);
  });

  it('measures the interval to the car one place ahead overall', () => {
    const rows = buildOverallStandings(groups, onTheSameLap, 'Race');

    expect(rows[0].interval).toBeUndefined();
    expect(rows[1].interval).toBeCloseTo(12.4, 9);
    // Across the classes: the first GT car behind the last prototype.
    expect(rows[2].interval).toBeCloseTo(35.6, 9);
    expect(rows[3].interval).toBeCloseTo(13.5, 9);
  });

  it('counts laps once a car is more than a lap behind', () => {
    // The GT cars are two and three laps down on the leader.
    const rows = buildOverallStandings(
      groups,
      timing([10.9, 8.5, 10.8, 7.4]),
      'Race'
    );

    expect(rows.map((row) => gapOf(row).laps)).toEqual([0, 0, -2, -3]);
    // The last car is a lap behind the one ahead of it as well.
    expect(rows[3].interval).toEqual({ value: undefined, laps: -1 });
  });

  it('gives a car that is not on the track no gap, and keeps its place', () => {
    const away = groups.map(
      ([classId, rows]) =>
        [
          classId,
          rows.map((row) =>
            row.carIdx === 1 ? { ...row, onTrack: false } : row
          ),
        ] as [string, Standings[]]
    );

    const rows = buildOverallStandings(away, onTheSameLap, 'Race');

    expect(rows.map((row) => row.carIdx)).toEqual([0, 2, 1, 3]);
    expect(gapOf(rows[2]).value).toBeUndefined();
  });

  it('lists the cars with no place after the others, in the order given', () => {
    const unplaced = [
      ['1', [car(0, 1, { position: undefined }), car(2, 1, { position: 1 })]],
      ['2', [car(1, 2, { position: undefined }), car(3, 2, { position: 2 })]],
    ] as [string, Standings[]][];

    const rows = buildOverallStandings(unplaced, onTheSameLap, 'Race');

    expect(rows.map((row) => row.carIdx)).toEqual([2, 3, 0, 1]);
  });

  it('is empty for an empty field', () => {
    expect(buildOverallStandings([], timing([]), 'Race')).toEqual([]);
    expect(buildOverallStandings([['1', []]], timing([]), 'Race')).toEqual([]);
  });
});

describe('the whole field as one list, outside a race', () => {
  /**
   * Practice. A row's own figure is against the best lap of its class, so
   * the quickest GT car carries none; overall it is 9.5 s off the best lap
   * of the session.
   */
  const practice = (over: Partial<Standings>) => ({
    currentSessionType: 'Practice',
    ...over,
  });
  const groups: [string, Standings[]][] = [
    [
      '1',
      [
        car(0, 1, practice({ position: 1, fastestTime: 93.4 })),
        car(2, 1, practice({ position: 2, fastestTime: 93.9, delta: 0.5 })),
      ],
    ],
    [
      '2',
      [
        car(1, 2, practice({ position: 3, fastestTime: 102.9 })),
        car(3, 2, practice({ position: 4, fastestTime: 103.3, delta: 0.4 })),
        car(4, 2, practice({ position: 5, fastestTime: -1 })),
      ],
    ],
  ];
  const parked = timing([0, 0, 0, 0, 0]);

  it('measures every gap between best laps, against the best of the field', () => {
    const rows = buildOverallStandings(groups, parked, 'Practice');

    expect(rows.map((row) => row.carIdx)).toEqual([0, 2, 1, 3, 4]);
    expect(gapOf(rows[0]).value).toBeUndefined();
    expect(gapOf(rows[1]).value).toBeCloseTo(0.5, 9);
    expect(gapOf(rows[2]).value).toBeCloseTo(9.5, 9);
    expect(gapOf(rows[3]).value).toBeCloseTo(9.9, 9);
  });

  it('gives a car without a lap no gap and no interval', () => {
    const rows = buildOverallStandings(groups, parked, 'Practice');

    expect(gapOf(rows[4]).value).toBeUndefined();
    expect(rows[4].interval).toBeUndefined();
  });

  it('measures the interval between the best laps of two rows', () => {
    const rows = buildOverallStandings(groups, parked, 'Practice');

    expect(rows[1].interval).toBeCloseTo(0.5, 9);
    expect(rows[2].interval).toBeCloseTo(9.0, 9);
    expect(rows[3].interval).toBeCloseTo(0.4, 9);
  });

  it('leaves the rows it was given as they were', () => {
    const before = structuredClone(groups);

    buildOverallStandings(groups, parked, 'Practice');

    expect(groups).toEqual(before);
  });
});
