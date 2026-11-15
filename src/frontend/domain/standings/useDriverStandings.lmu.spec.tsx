import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { StandingsWidgetSettings } from '@irdashies/types';
import { getWidgetDefaultConfig } from '@irdashies/types';
import { formatGap } from '@irdashies/utils/time';
import { mountFixture } from '../../../testing/renderWithFixture';
import type { ReplayFixture } from '../../../testing/replayFixture';
import lmuRace from '../../../../test-data/fixtures/lmu-race-laguna-seca.json';
import lmuPractice from '../../../../test-data/fixtures/lmu-practice-laguna-seca.json';
import { useDriverStandings } from './useDriverStandings';
import { useDriverStandings as useRelativeRows } from './useDriverPositions';
import type { Standings } from './createStandings';

/**
 * The standings rows on a recorded Le Mans Ultimate session, cut from the
 * curated tape by `npm run lmu:replay:fixture`: a race at Laguna Seca, 38
 * cars in three classes, early in its third lap, and the same recording
 * replayed as a practice session.
 */
const race = lmuRace as unknown as ReplayFixture;
const practice = lmuPractice as unknown as ReplayFixture;

/** The lap time the sim measures every car's time into the lap against. */
const ESTIMATED_LAP_SECONDS = 84.233;

/** The class the player's LMGT3 runs in, by the id the addon gives it. */
const GT_CLASS = 1;

/**
 * Gap column off, interval on and shown as a time, positions as the sim
 * scores them: the settings the intervals were reported missing under.
 */
const config = (
  overrides: Partial<StandingsWidgetSettings['config']> = {}
): StandingsWidgetSettings['config'] =>
  ({
    ...(getWidgetDefaultConfig(
      'standings'
    ) as StandingsWidgetSettings['config']),
    useLivePosition: false,
    gap: { enabled: false, reference: 'classLeader', decimalPlaces: 1 },
    interval: { enabled: true, decimalPlaces: 1, displayMode: 'time' },
    ...overrides,
  }) as StandingsWidgetSettings['config'];

const standingsOf = (
  fixture: ReplayFixture,
  settings = config()
): [string, Standings[]][] => {
  const harness = mountFixture(fixture);
  const { result } = renderHook(
    () => useDriverStandings(settings, { showAll: true }),
    { wrapper: harness.wrapper }
  );
  return result.current;
};

const lastFrame = (fixture: ReplayFixture) =>
  fixture.frames[fixture.frames.length - 1];

const numbers = (value: unknown): number[] => value as number[];

/**
 * The same race with every car outside one class two laps further on, as
 * the bridge publishes it: those cars' lap counts two higher, and the class
 * left behind two laps of time further from the overall leader.
 */
const withClassLappedTwice = (
  fixture: ReplayFixture,
  classId: number
): ReplayFixture => ({
  ...fixture,
  frames: fixture.frames.map((frame) => {
    const classes = numbers(frame.CarIdxClass);
    const inClass = (carIdx: number) => classes[carIdx] === classId;
    return {
      ...frame,
      CarIdxLap: numbers(frame.CarIdxLap).map((laps, carIdx) =>
        laps < 0 || inClass(carIdx) ? laps : laps + 2
      ),
      CarIdxLapCompleted: numbers(frame.CarIdxLapCompleted).map(
        (laps, carIdx) => (laps < 0 || inClass(carIdx) ? laps : laps + 2)
      ),
      CarIdxF2Time: numbers(frame.CarIdxF2Time).map((time, carIdx) =>
        inClass(carIdx) ? time + 2 * ESTIMATED_LAP_SECONDS : time
      ),
    };
  }),
});

/**
 * The same race with one car some laps down, as the bridge publishes a
 * lapped car: its lap counts lower, and that many reference laps of time
 * further from the overall leader.
 */
const withCarLapsDown = (
  fixture: ReplayFixture,
  slot: number,
  laps: number
): ReplayFixture => ({
  ...fixture,
  frames: fixture.frames.map((frame) => ({
    ...frame,
    CarIdxLap: numbers(frame.CarIdxLap).map((lap, carIdx) =>
      carIdx === slot ? lap - laps : lap
    ),
    CarIdxLapCompleted: numbers(frame.CarIdxLapCompleted).map((lap, carIdx) =>
      carIdx === slot ? lap - laps : lap
    ),
    CarIdxF2Time: numbers(frame.CarIdxF2Time).map((time, carIdx) =>
      carIdx === slot ? time + laps * ESTIMATED_LAP_SECONDS : time
    ),
  })),
});

describe('standings on a recorded LMU race', () => {
  it('groups the grid into its three classes, every car once', () => {
    const grouped = standingsOf(race);
    expect(grouped.map(([, drivers]) => drivers.length).sort()).toEqual([
      10, 14, 14,
    ]);
    const carIdxs = grouped.flatMap(([, drivers]) =>
      drivers.map((driver) => driver.carIdx)
    );
    expect(new Set(carIdxs).size).toBe(38);
  });

  it('orders each class by the sim’s own running order', () => {
    const places = numbers(lastFrame(race).CarIdxPosition);
    for (const [, drivers] of standingsOf(race)) {
      expect(drivers.map((driver) => driver.classPosition)).toEqual(
        drivers.map((_, index) => index + 1)
      );
      const overall = drivers.map((driver) => places[driver.carIdx]);
      expect(overall).toEqual([...overall].sort((a, b) => a - b));
    }
  });

  it('gives every car behind its class leader an interval', () => {
    const behindLeader = numbers(lastFrame(race).CarIdxF2Time);
    for (const [, drivers] of standingsOf(race)) {
      // The class leader has nobody to be behind.
      expect(drivers[0].interval).toBeUndefined();
      for (let index = 1; index < drivers.length; index += 1) {
        const driver = drivers[index];
        const ahead = drivers[index - 1];
        expect(typeof driver.interval).toBe('number');
        // The time between this car and the one ahead of it.
        expect(driver.interval as number).toBeCloseTo(
          Math.abs(behindLeader[driver.carIdx] - behindLeader[ahead.carIdx]),
          3
        );
      }
    }
  });

  it('reads sensible intervals: a field strung out over a lap', () => {
    const intervals = standingsOf(race)
      .flatMap(([, drivers]) => drivers.slice(1))
      .map((driver) => driver.interval as number);
    expect(intervals).toHaveLength(35);
    // Nose to tail in places, and nothing like a lap between two cars.
    expect(Math.min(...intervals)).toBeGreaterThan(0);
    expect(Math.max(...intervals)).toBeLessThan(5);
    expect(
      intervals.filter((interval) => interval < 1.5).length
    ).toBeGreaterThan(25);
  });

  it('keeps a class its intervals once the leader has lapped it', () => {
    // What a multi-class race is from its first quarter of an hour: the
    // prototypes more than a lap up the road from every GT car. The time
    // between two GT cars is what it was.
    const before = standingsOf(race).find(
      ([, drivers]) => drivers[0].carClass.id === GT_CLASS
    )?.[1];
    const after = standingsOf(withClassLappedTwice(race, GT_CLASS)).find(
      ([, drivers]) => drivers[0].carClass.id === GT_CLASS
    )?.[1];
    expect(before).toHaveLength(14);
    expect(after).toHaveLength(14);
    if (!before || !after) return;

    expect(after.map((driver) => driver.carIdx)).toEqual(
      before.map((driver) => driver.carIdx)
    );
    expect(after[0].interval).toBeUndefined();
    for (let index = 1; index < after.length; index += 1) {
      expect(typeof after[index].interval).toBe('number');
      expect(after[index].interval as number).toBeCloseTo(
        before[index].interval as number,
        3
      );
    }
  });

  it('shows the gap to the class leader when that column is on', () => {
    const grouped = standingsOf(
      race,
      config({
        gap: { enabled: true, reference: 'classLeader', decimalPlaces: 1 },
      })
    );
    for (const [, drivers] of grouped) {
      expect(drivers[0].gap?.value).toBeUndefined();
      const gaps = drivers.slice(1).map((driver) => driver.gap?.value);
      expect(gaps.every((gap) => typeof gap === 'number')).toBe(true);
      // Further down the class is further behind its leader.
      expect(gaps).toEqual([...gaps].sort((a, b) => Number(a) - Number(b)));
    }
  });

  it('shows a class the prototypes have lapped in laps, against the player (staged)', () => {
    // Staged: nobody is lapped on the recording. With the gap measured from
    // the player's LMGT3, every prototype is a lap or two up the road and
    // every car of the player's own class is still on its lap.
    const rows = standingsOf(
      withClassLappedTwice(race, GT_CLASS),
      config({ gap: { enabled: true, reference: 'player', decimalPlaces: 1 } })
    ).flatMap(([, drivers]) => drivers);
    const prototypes = rows.filter((row) => row.carClass.id !== GT_CLASS);
    const ownClass = rows.filter(
      (row) => row.carClass.id === GT_CLASS && !row.isPlayer
    );
    expect(prototypes).toHaveLength(24);
    expect(ownClass).toHaveLength(13);

    // Negative: ahead of the player. Two laps for a prototype that was ahead
    // on the road, one for a car that was behind and is 1.x laps up.
    for (const row of prototypes) {
      expect(row.gap?.laps === -1 || row.gap?.laps === -2).toBe(true);
    }
    expect(prototypes.some((row) => row.gap?.laps === -2)).toBe(true);
    for (const row of ownClass) {
      expect(row.gap?.laps).toBe(0);
      expect(typeof row.gap?.value).toBe('number');
    }
  });

  it('keeps a lapped class its seconds against its own leader (staged)', () => {
    // The same staging read from the class leader: no LMGT3 car is a lap
    // behind another, so nothing in the class turns to laps, in either mode.
    for (const displayMode of ['laps', 'time'] as const) {
      const gt = standingsOf(
        withClassLappedTwice(race, GT_CLASS),
        config({
          gap: { enabled: true, reference: 'classLeader', decimalPlaces: 1 },
          interval: { enabled: true, decimalPlaces: 1, displayMode },
        })
      ).find(([, drivers]) => drivers[0].carClass.id === GT_CLASS)?.[1];
      expect(gt).toHaveLength(14);
      for (const row of gt?.slice(1) ?? []) {
        expect(row.gap?.laps).toBe(0);
        expect(typeof row.gap?.value).toBe('number');
        expect(typeof row.interval).toBe('number');
      }
    }
  });

  it('reads a car two laps behind the one ahead as -2L by default, and as a time when asked (staged)', () => {
    // Staged: the last LMGT3 with two laps taken off it, as the bridge would
    // publish a car two laps down: its lap count two lower and two reference
    // laps of time further from the leader.
    const before = standingsOf(race).find(
      ([, drivers]) => drivers[0].carClass.id === GT_CLASS
    )?.[1];
    const last = before?.[before.length - 1];
    expect(last).toBeDefined();
    if (!before || !last) return;
    const lapped = withCarLapsDown(race, last.carIdx, 2);

    // The manifest's default, which is what a new dashboard gets.
    const defaults = getWidgetDefaultConfig(
      'standings'
    ) as StandingsWidgetSettings['config'];
    expect(defaults.interval.displayMode).toBe('laps');
    const inLaps = standingsOf(lapped, {
      ...defaults,
      interval: { ...defaults.interval, enabled: true },
      gap: { ...defaults.gap, enabled: true },
    }).find(([, drivers]) => drivers[0].carClass.id === GT_CLASS)?.[1];
    const rowInLaps = inLaps?.find((row) => row.carIdx === last.carIdx);
    expect(rowInLaps?.interval).toEqual({ value: undefined, laps: -2 });
    // The gap to the class leader switches at the same instant.
    expect(rowInLaps?.gap?.laps).toBe(-2);
    // The cars ahead of it are untouched: still seconds.
    for (const row of inLaps?.slice(1, -1) ?? []) {
      expect(typeof row.interval).toBe('number');
      expect(row.gap?.laps).toBe(0);
    }

    const inTime = standingsOf(
      lapped,
      config({
        interval: { enabled: true, decimalPlaces: 1, displayMode: 'time' },
      })
    ).find(([, drivers]) => drivers[0].carClass.id === GT_CLASS)?.[1];
    const rowInTime = inTime?.find((row) => row.carIdx === last.carIdx);
    // Two reference laps of 84.23 s on top of what it was: about 2:48.
    expect(rowInTime?.interval as number).toBeCloseTo(
      (last.interval as number) + 2 * ESTIMATED_LAP_SECONDS,
      3
    );
    expect(formatGap(rowInTime?.interval as number, 1)).toMatch(
      /^2:(4[89]|5\d)$/
    );
  });

  it('marks no last lap: the sim timed every lap of the recording', () => {
    // The fixture was cut before the flag was published, so the array is
    // empty and the rows carry no statement at all.
    const rows = standingsOf(race).flatMap(([, drivers]) => drivers);
    expect(rows.every((row) => !row.lastLapInvalid)).toBe(true);
  });

  it('marks the last lap of a car the sim gave no time (staged)', () => {
    // Staged: the flag LMU's mapper publishes, set for one car.
    const marked = 5;
    const withFlag: ReplayFixture = {
      ...race,
      frames: race.frames.map((frame) => ({
        ...frame,
        LmuCarIdxLastLapInvalid: numbers(frame.CarIdxLap).map(
          (_, carIdx) => carIdx === marked
        ),
      })),
    };
    const rows = standingsOf(withFlag).flatMap(([, drivers]) => drivers);

    expect(rows).toHaveLength(38);
    expect(
      rows.filter((row) => row.lastLapInvalid).map((row) => row.carIdx)
    ).toEqual([marked]);
    // Every other car has a statement too: its last lap counted.
    expect(rows.filter((row) => row.lastLapInvalid === false)).toHaveLength(37);

    // The Relative builds its rows by another path and carries the same.
    const harness = mountFixture(withFlag);
    const { result } = renderHook(() => useRelativeRows(), {
      wrapper: harness.wrapper,
    });
    expect(
      result.current
        .filter((row) => row.lastLapInvalid)
        .map((row) => row.carIdx)
    ).toEqual([marked]);
  });

  it('names the session a race and the player’s row its own', () => {
    const rows = standingsOf(race).flatMap(([, drivers]) => drivers);
    expect(rows.every((row) => row.currentSessionType === 'Race')).toBe(true);
    const player = rows.filter((row) => row.isPlayer);
    expect(player).toHaveLength(1);
    expect(player[0].carIdx).toBe(race.session?.DriverInfo?.DriverCarIdx);
    expect(player[0].carClass.id).toBe(GT_CLASS);
  });
});

describe('standings on the same recording as a practice session', () => {
  it('orders each class by best lap', () => {
    for (const [, drivers] of standingsOf(practice)) {
      const best = drivers.map((driver) => driver.fastestTime);
      expect(best.every((time) => time > 60)).toBe(true);
      expect(best).toEqual([...best].sort((a, b) => a - b));
    }
  });

  it('gives the interval as the best lap lost to the car ahead', () => {
    for (const [, drivers] of standingsOf(practice)) {
      expect(drivers[0].interval).toBeUndefined();
      for (let index = 1; index < drivers.length; index += 1) {
        const driver = drivers[index];
        const ahead = drivers[index - 1];
        expect(typeof driver.interval).toBe('number');
        expect(driver.interval as number).toBeCloseTo(
          driver.fastestTime - ahead.fastestTime,
          3
        );
      }
    }
  });
});
