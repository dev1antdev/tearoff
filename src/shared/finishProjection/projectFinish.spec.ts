import { describe, expect, it } from 'vitest';
import type { FinishCar, FinishProjectionSnapshot } from '@irdashies/types';
import {
  carFinish,
  finishLapOf,
  flagTime,
  fractionAtClock,
  leaderFinish,
  projectFinish,
  refuelStandingS,
  rivalProjectedGapS,
  stopsOwedFor,
  type FinishColumn,
  type FinishProjectionOptions,
} from './projectFinish';

const car = (
  carIdx: number,
  paceS: number,
  progress: number,
  lastStopLossS = 0
): FinishCar => ({ carIdx, paceS, progress, lastStopLossS });

type Snapshot = NonNullable<Parameters<typeof projectFinish>[0]>;

/**
 * A timed race with ten minutes on the clock: the leader a quarter of the
 * way round its eleventh lap at 90 s a lap, the player four fifths of the
 * way round its tenth at 100 s.
 */
const snapshot = (
  values: Partial<FinishProjectionSnapshot> = {}
): Snapshot => ({
  valid: true,
  timeLeftS: 600,
  lapLimit: null,
  leader: car(1, 90, 10.25),
  player: car(0, 100, 9.8),
  lapsToGo: null,
  energy: null,
  laneLossS: null,
  plannedStandingS: null,
  refuelLines: null,
  separateS: 0,
  overlapS: 0,
  ...values,
});

const options = (
  values: Partial<FinishProjectionOptions> = {}
): FinishProjectionOptions => ({
  scenarios: [],
  leaderStops: 'same',
  showPlanned: false,
  showToFinish: false,
  showLast: false,
  extraTimeS: 0,
  nearRangeS: 20,
  extraLaps: 1,
  ...values,
});

const columnsOf = (
  values: Partial<FinishProjectionSnapshot> = {},
  settings: Partial<FinishProjectionOptions> = {}
): readonly FinishColumn[] =>
  projectFinish(snapshot(values), options(settings)).columns;

describe('finishLapOf', () => {
  it('rounds a finish up to the next line', () => {
    expect(finishLapOf(15.875)).toBe(16);
    expect(finishLapOf(16.0001)).toBe(17);
  });

  it('leaves a car that is on the line on that lap', () => {
    expect(finishLapOf(16)).toBe(16);
    // The sums that put a car on a line land a hair either side of it.
    expect(finishLapOf(16 + 1e-12)).toBe(16);
    expect(finishLapOf(16 - 1e-12)).toBe(16);
  });
});

describe('flagTime', () => {
  const leader = { paceS: 90, progress: 10.25 };

  it('falls at the leader’s first crossing after the clock', () => {
    // 10.25 + 600 / 90 = 16.92 laps when the clock ends: the flag is on
    // lap 17, 6.75 laps of 90 s from now.
    expect(flagTime(leader, { timeLeftS: 600, lapLimit: null })).toEqual({
      tFlagS: 607.5,
      finishLap: 17,
      afterClockS: 7.5,
    });
  });

  it('takes the leader’s stop off the time it has to cover ground in', () => {
    // 560 s of running puts it at 16.47: still lap 17, forty seconds later.
    expect(flagTime(leader, { timeLeftS: 600, lapLimit: null }, 40)).toEqual({
      tFlagS: 647.5,
      finishLap: 17,
      afterClockS: 47.5,
    });
  });

  it('falls when the leader completes the distance of a lap race', () => {
    expect(
      flagTime({ paceS: 90, progress: 20.5 }, { timeLeftS: null, lapLimit: 30 })
    ).toEqual({ tFlagS: 855, finishLap: 30, afterClockS: null });
  });

  it('takes whichever comes first in a race run to laps and time', () => {
    const runner = { paceS: 90, progress: 20.5 };
    // 855 s to cover the distance. With 900 s on the clock the laps end it.
    expect(flagTime(runner, { timeLeftS: 900, lapLimit: 30 })).toEqual({
      tFlagS: 855,
      finishLap: 30,
      afterClockS: null,
    });
    // With 800 s the clock does: at 29.39 laps, so on lap 30 all the same,
    // but reached as the crossing after the clock. With 700 s it is lap 29.
    expect(flagTime(runner, { timeLeftS: 800, lapLimit: 30 })).toEqual({
      tFlagS: 855,
      finishLap: 30,
      afterClockS: null,
    });
    expect(flagTime(runner, { timeLeftS: 700, lapLimit: 30 })).toEqual({
      tFlagS: 765,
      finishLap: 29,
      afterClockS: 65,
    });
  });

  it('is the next crossing once the clock has run out', () => {
    expect(flagTime(leader, { timeLeftS: 0, lapLimit: null })).toEqual({
      tFlagS: 67.5,
      finishLap: 11,
      afterClockS: 67.5,
    });
  });

  it('has nothing to say without a pace or an end', () => {
    expect(
      flagTime({ paceS: 0, progress: 3 }, { timeLeftS: 600, lapLimit: null })
    ).toBeNull();
    expect(flagTime(leader, { timeLeftS: null, lapLimit: null })).toBeNull();
  });
});

describe('carFinish', () => {
  const player = { paceS: 100, progress: 9.8 };

  it('finishes the player at the next crossing after the flag', () => {
    // 9.80 + 607.5 / 100 = 15.875: lap 16, 6.2 laps from here, and the
    // crossing is 12.5 s after the flag.
    const finish = carFinish(player, 607.5, 0, null);
    expect(finish?.finishLap).toBe(16);
    expect(finish?.lapsToGo).toBeCloseTo(6.2, 9);
    expect(finish?.marginS).toBeCloseTo(12.5, 9);
    expect(finish?.marginSide).toBe('more');
  });

  it('puts a stop of the player’s own into the same lap, further from a line', () => {
    // Forty seconds lost: 15.475, still lap 16, and now 47.5 s past the
    // line when the flag falls.
    const finish = carFinish(player, 607.5, 40, null);
    expect(finish?.finishLap).toBe(16);
    expect(finish?.marginS).toBeCloseTo(47.5, 9);
    expect(finish?.marginSide).toBe('fewer');
  });

  it('never drives further than the distance of a lap race', () => {
    // 19.9 + 855 / 92 = 29.19: lap 30, which is the distance.
    const onTheLeadLap = carFinish({ paceS: 92, progress: 19.9 }, 855, 0, 30);
    expect(onTheLeadLap?.finishLap).toBe(30);
    expect(onTheLeadLap?.lapsToGo).toBeCloseTo(10.1, 9);
    // It started that last lap 17.8 s before the flag: slower by that and
    // the leader would have lapped it first.
    expect(onTheLeadLap?.marginS).toBeCloseTo(17.8, 1);
    expect(onTheLeadLap?.marginSide).toBe('fewer');

    // A car two laps down is flagged on lap 28.
    const lapped = carFinish({ paceS: 92, progress: 18.4 }, 855, 0, 30);
    expect(lapped?.finishLap).toBe(28);
    expect(lapped?.lapsToGo).toBeCloseTo(9.6, 9);
  });

  it('does not hang a car that has covered the distance on a margin', () => {
    const finish = carFinish({ paceS: 90, progress: 20.6 }, 855, 0, 30);
    expect(finish).toMatchObject({
      finishLap: 30,
      marginS: null,
      marginSide: null,
    });
  });
});

describe('leaderFinish', () => {
  it('hangs the leader’s own lap count on the clock', () => {
    const leader = { paceS: 90, progress: 10.25 };
    const flag = flagTime(leader, { timeLeftS: 600, lapLimit: null });
    if (!flag) throw new Error('no flag');
    // Across the line 7.5 s after the clock: 7.5 s quicker and there is
    // another lap.
    expect(leaderFinish(leader, flag)).toEqual({
      finishLap: 17,
      lapsToGo: 6.75,
      marginS: 7.5,
      marginSide: 'more',
    });

    // Across the line 5 s before the clock, so a lap more: 5 s slower and
    // there is not.
    const late = flagTime(leader, { timeLeftS: 612.5, lapLimit: null });
    if (!late) throw new Error('no flag');
    expect(late.finishLap).toBe(18);
    expect(leaderFinish(leader, late)).toMatchObject({
      marginS: 5,
      marginSide: 'fewer',
    });
  });

  it('has no margin in a race the laps end', () => {
    const leader = { paceS: 90, progress: 20.5 };
    const flag = flagTime(leader, { timeLeftS: null, lapLimit: 30 });
    if (!flag) throw new Error('no flag');
    expect(leaderFinish(leader, flag)).toEqual({
      finishLap: 30,
      lapsToGo: 9.5,
      marginS: null,
      marginSide: null,
    });
  });
});

describe('fractionAtClock', () => {
  it('gives the fractions TinyPedal shows for the same race', () => {
    // 16.92 for the leader and 15.80 for the player as the clock ends.
    expect(fractionAtClock({ paceS: 90, progress: 10.25 }, 600)).toBeCloseTo(
      0.92,
      2
    );
    expect(fractionAtClock({ paceS: 100, progress: 9.8 }, 600)).toBeCloseTo(
      0.8,
      9
    );
    // A stop of 40 s is 0.4 of the player's lap.
    expect(fractionAtClock({ paceS: 100, progress: 9.8 }, 600, 40)).toBeCloseTo(
      0.4,
      9
    );
  });

  it('has none without a clock', () => {
    expect(fractionAtClock({ paceS: 90, progress: 10.25 }, null)).toBeNull();
  });
});

describe('stopsOwedFor', () => {
  it('owes a stop for every stint, or part of one, beyond what is aboard', () => {
    expect(stopsOwedFor(40, 12, 30)).toBe(1);
    expect(stopsOwedFor(75, 12, 30)).toBe(3);
    expect(stopsOwedFor(42, 12, 30)).toBe(1);
    expect(stopsOwedFor(42.01, 12, 30)).toBe(2);
  });

  it('owes none while what is aboard covers the laps left', () => {
    expect(stopsOwedFor(12, 12, 30)).toBe(0);
    expect(stopsOwedFor(8, 12, 30)).toBe(0);
  });

  it('owes none it cannot count: a stint of unknown length', () => {
    expect(stopsOwedFor(40, 12, 0)).toBe(0);
  });
});

describe('refuelStandingS', () => {
  /** The recorded car's hoses: energy, and the fuel that goes with it. */
  const LINES = [
    { fixedS: 0, perUnitS: 0.4 },
    { fixedS: 2.42, perUnitS: 0.303 },
  ];

  it('stands for the longer of the hoses, which go in side by side', () => {
    // 5.3 %: 2.12 s of energy against 2.42 + 1.61 s of fuel.
    expect(refuelStandingS(LINES, 5.3)).toBeCloseTo(4.03, 2);
    // Past 25 % the energy hose is the longer.
    expect(refuelStandingS(LINES, 40)).toBeCloseTo(16, 9);
  });

  it('connects no hose for nothing to add', () => {
    expect(refuelStandingS(LINES, 0)).toBe(0);
    expect(refuelStandingS(LINES, -3)).toBe(0);
  });
});

describe('projectFinish', () => {
  it('gives the column with no stop', () => {
    const [now] = columnsOf();
    expect(now).toMatchObject({
      kind: 'now',
      playerLossS: 0,
      leaderLossS: 0,
      leaderMarginS: 7.5,
      // Inside twenty seconds of the clock's end.
      leaderNear: true,
      near: 'more',
      needed: null,
      toAdd: null,
    });
    expect(now.lapsToGo).toBeCloseTo(6.2, 9);
    expect(now.marginS).toBeCloseTo(12.5, 9);
    expect(now.leaderFraction).toBeCloseTo(0.92, 2);
    expect(now.playerFraction).toBeCloseTo(0.8, 9);
  });

  it('loses the scenario’s seconds for both cars, or for the player alone', () => {
    const both = columnsOf({}, { scenarios: [40] })[1];
    // The flag forty seconds later and the player forty seconds short of
    // it: the same 15.875.
    expect(both).toMatchObject({
      kind: 'scenario',
      scenarioS: 40,
      playerLossS: 40,
      leaderLossS: 40,
      leaderMarginS: 47.5,
      leaderNear: false,
      near: 'more',
    });
    expect(both.lapsToGo).toBeCloseTo(6.2, 9);

    const alone = columnsOf({}, { scenarios: [40], leaderStops: 'none' })[1];
    expect(alone).toMatchObject({
      playerLossS: 40,
      leaderLossS: 0,
      leaderMarginS: 7.5,
      near: null,
    });
    expect(alone.lapsToGo).toBeCloseTo(6.2, 9);
    expect(alone.marginS).toBeCloseTo(47.5, 9);
  });

  it('caps the near range at a third of the lap', () => {
    // A range of a minute would call every finish near; a third of the
    // player's 100 s lap is 33.3 s, and 47.5 s is outside it.
    const [, alone] = columnsOf(
      {},
      { scenarios: [40], leaderStops: 'none', nearRangeS: 60 }
    );
    expect(alone.near).toBeNull();
    expect(columnsOf({}, { nearRangeS: 0 })[0].near).toBeNull();
  });

  it('marks a leader that crossed the line just before the clock ran out', () => {
    // 612.5 s: the leader starts lap 18 with 5 s on the clock, so the flag
    // is 85 s after it. Five seconds slower and the race is a lap shorter.
    const [now] = columnsOf({ timeLeftS: 612.5 });
    expect(now.leaderMarginS).toBeCloseTo(85, 9);
    expect(now.leaderNear).toBe(true);
  });

  it('counts what has to go in, and for the extra laps', () => {
    const [now] = columnsOf({
      energy: {
        isVirtualEnergy: true,
        perLap: 2.3,
        aboard: 9,
        capacity: 100,
      },
    });
    // 6.2 laps at 2.3 % a lap against 9 % aboard, and one lap more.
    expect(now.needed).toBeCloseTo(14.26, 9);
    expect(now.toAdd).toBeCloseTo(5.26, 9);
    expect(now.neededExtra).toBeCloseTo(16.56, 9);
    expect(now.toAddExtra).toBeCloseTo(7.56, 9);
    expect(now.overCapacity).toBe(false);

    const [twoMore] = columnsOf(
      {
        energy: {
          isVirtualEnergy: true,
          perLap: 2.3,
          aboard: 9,
          capacity: 100,
        },
      },
      { extraLaps: 2 }
    );
    expect(twoMore.toAddExtra).toBeCloseTo(9.86, 9);
  });

  it('flags a need beyond what the car holds', () => {
    const [now] = columnsOf({
      energy: { isVirtualEnergy: false, perLap: 3, aboard: 4, capacity: 20 },
    });
    // 18.6 L for the laps to go fit; 21.6 L for one lap more do not.
    expect(now.overCapacity).toBe(false);
    expect(now.overCapacityExtra).toBe(true);
  });

  it('shows the planned stop where the sim gives one and a lane is known', () => {
    const planned = columnsOf(
      { laneLossS: 17.2, plannedStandingS: 14.2 },
      { showPlanned: true, extraTimeS: 2 }
    );
    expect(planned.map((column) => column.kind)).toEqual(['now', 'planned']);
    expect(planned[1].playerLossS).toBeCloseTo(33.4, 9);
    expect(planned[1].leaderLossS).toBe(0);

    // A drive-through stands for nothing and is given no extra.
    expect(
      columnsOf(
        { laneLossS: 17.2, plannedStandingS: 0 },
        { showPlanned: true, extraTimeS: 2 }
      )[1].playerLossS
    ).toBeCloseTo(17.2, 9);

    expect(
      columnsOf({ plannedStandingS: 14.2 }, { showPlanned: true })
    ).toHaveLength(1);
    expect(columnsOf({ laneLossS: 17.2 }, { showPlanned: true })).toHaveLength(
      1
    );
    expect(columnsOf({ laneLossS: 17.2, plannedStandingS: 14.2 })).toHaveLength(
      1
    );
  });

  describe('the stop that adds what its own laps to go need', () => {
    const recorded = {
      energy: {
        isVirtualEnergy: true,
        perLap: 2.3,
        aboard: 9,
        capacity: 100,
      },
      laneLossS: 17.2,
      refuelLines: [
        { fixedS: 0, perUnitS: 0.4 },
        { fixedS: 2.42, perUnitS: 0.303 },
      ],
    };

    it('stands for the refuel it needs', () => {
      const columns = columnsOf(recorded, {
        showToFinish: true,
        extraTimeS: 2,
      });
      expect(columns.map((column) => column.kind)).toEqual(['now', 'toFinish']);
      const toFinish = columns[1];
      // 5.26 % to add stands for 4.01 s; with the lane and the extra the
      // stop costs 23.2 s, which leaves the player on lap 16.
      expect(toFinish.playerLossS).toBeCloseTo(
        17.2 + 2 + 2.42 + 0.303 * 5.26,
        6
      );
      expect(toFinish.leaderLossS).toBe(0);
      expect(toFinish.lapsToGo).toBeCloseTo(6.2, 9);
      expect(toFinish.toAdd).toBeCloseTo(5.26, 9);
    });

    it('settles in two passes when the stop costs a lap', () => {
      // A player ten seconds past a line at the flag: 16.1 with no stop,
      // so lap 17. The stop for that takes 23.8 s and drops the car to
      // lap 16, and the smaller refuel of a lap fewer is the one the stop
      // is then costed with.
      const values = { ...recorded, player: car(0, 100, 10.025) };
      const settings = { showToFinish: true, extraTimeS: 2 };
      const [now, toFinish] = columnsOf(values, settings);
      expect(now.lapsToGo).toBeCloseTo(6.975, 9);
      expect(toFinish.lapsToGo).toBeCloseTo(5.975, 9);
      expect(toFinish.toAdd).toBeCloseTo(5.975 * 2.3 - 9, 9);
      expect(toFinish.playerLossS).toBeCloseTo(
        17.2 + 2 + 2.42 + 0.303 * (5.975 * 2.3 - 9),
        6
      );

      // Costed again from its own answer it does not move.
      const again = carFinish(
        { paceS: 100, progress: 10.025 },
        607.5,
        toFinish.playerLossS,
        null
      );
      expect(again?.lapsToGo).toBeCloseTo(toFinish.lapsToGo, 9);
    });

    it('stands longer for work that may not overlap, and no shorter for work that may', () => {
      const [, withTyres] = columnsOf(
        { ...recorded, separateS: 12, overlapS: 3 },
        { showToFinish: true }
      );
      // The driver change fits inside the 4 s of refuelling; the tyres do
      // not.
      expect(withTyres.playerLossS).toBeCloseTo(
        17.2 + 2.42 + 0.303 * 5.26 + 12,
        6
      );
      const [, withDriver] = columnsOf(
        { ...recorded, overlapS: 25 },
        { showToFinish: true }
      );
      expect(withDriver.playerLossS).toBeCloseTo(17.2 + 25, 6);
    });

    it('is no stop at all with enough aboard', () => {
      const [now, toFinish] = columnsOf(
        { ...recorded, energy: { ...recorded.energy, aboard: 30 } },
        { showToFinish: true, extraTimeS: 2 }
      );
      expect(toFinish.playerLossS).toBe(0);
      expect(toFinish.lapsToGo).toBe(now.lapsToGo);
      expect(toFinish.toAdd).toBeCloseTo(14.26 - 30, 9);
    });

    it('is absent without the rates, a lane or a usage', () => {
      const settings = { showToFinish: true };
      expect(
        columnsOf({ ...recorded, refuelLines: null }, settings)
      ).toHaveLength(1);
      expect(
        columnsOf({ ...recorded, laneLossS: null }, settings)
      ).toHaveLength(1);
      expect(columnsOf({ ...recorded, energy: null }, settings)).toHaveLength(
        1
      );
      expect(columnsOf(recorded)).toHaveLength(1);
    });
  });

  it('shows the last stop once either car has made one', () => {
    expect(columnsOf({}, { showLast: true })).toHaveLength(1);

    const [, last] = columnsOf(
      { leader: car(1, 90, 10.25, 31.5), player: car(0, 100, 9.8, 38.2) },
      { showLast: true }
    );
    expect(last).toMatchObject({
      kind: 'last',
      playerLossS: 38.2,
      leaderLossS: 31.5,
    });

    const [, leaderOnly] = columnsOf(
      { leader: car(1, 90, 10.25, 31.5) },
      { showLast: true }
    );
    expect(leaderOnly).toMatchObject({ playerLossS: 0, leaderLossS: 31.5 });
    expect(
      columnsOf({ player: car(0, 100, 9.8, 38.2) }, { showLast: false })
    ).toHaveLength(1);
  });

  it('orders the columns: now, the scenarios, planned, to finish, last', () => {
    const columns = columnsOf(
      {
        leader: car(1, 90, 10.25, 31.5),
        energy: {
          isVirtualEnergy: true,
          perLap: 2.3,
          aboard: 9,
          capacity: 100,
        },
        laneLossS: 17.2,
        plannedStandingS: 14.2,
        refuelLines: [{ fixedS: 0, perUnitS: 0.4 }],
      },
      {
        scenarios: [30, 40, -5, Number.NaN, 60],
        showPlanned: true,
        showToFinish: true,
        showLast: true,
      }
    );
    expect(columns.map((column) => column.scenarioS ?? column.kind)).toEqual([
      'now',
      30,
      40,
      60,
      'planned',
      'toFinish',
      'last',
    ]);
  });

  describe('with the player in the lead', () => {
    const leading = { leader: null, player: car(0, 90, 10.25) };

    it('drops the flag for the player, on the player’s own stop', () => {
      const [now, stop] = columnsOf(leading, { scenarios: [40] });
      expect(now).toMatchObject({
        leaderMarginS: null,
        leaderNear: false,
        leaderFraction: null,
        // 7.5 s after the clock: that much quicker and there is a lap more.
        near: 'more',
      });
      expect(now.lapsToGo).toBeCloseTo(6.75, 9);
      expect(now.marginS).toBeCloseTo(7.5, 9);
      // The same lap with a stop of 40 s, and well clear of the clock.
      expect(stop.lapsToGo).toBeCloseTo(6.75, 9);
      expect(stop.marginS).toBeCloseTo(42.5, 9);
      expect(stop.near).toBeNull();
      expect(stop.leaderLossS).toBe(40);
    });

    it('says nothing of a lap lost to the leader', () => {
      expect(
        projectFinish(snapshot(leading), options()).lapLostPerLap
      ).toBeNull();
    });
  });

  it('gives the share of a lap lost to the leader every lap', () => {
    // Ten seconds a lap on a lap of a hundred.
    expect(projectFinish(snapshot(), options()).lapLostPerLap).toBeCloseTo(
      0.1,
      9
    );
    expect(
      projectFinish(snapshot({ player: car(0, 88, 9.8) }), options())
        .lapLostPerLap
    ).toBeNull();
  });

  describe('the laps to go the fuel projection publishes', () => {
    const energy = {
      isVirtualEnergy: true,
      perLap: 2.3,
      aboard: 9,
      capacity: 100,
    };

    it('stand in the first column when they are the same lap', () => {
      const [now] = columnsOf({ lapsToGo: 6.21, energy });
      expect(now.lapsToGo).toBeCloseTo(6.2, 9);
      expect(now.near).toBe('more');
    });

    it('win when they hold a lap the sums have given up', () => {
      // With 500 s left the leader finishes on lap 16 and the player is
      // 2.5 s short of a line as the flag falls: the sums say lap 15, and
      // the published figure is still holding lap 16.
      const values = { timeLeftS: 500, lapsToGo: 6.2, energy };
      const [now, stop] = columnsOf(values, { scenarios: [30] });
      expect(now.lapsToGo).toBe(6.2);
      // The lap in hand is the one in doubt.
      expect(now.near).toBe('fewer');
      expect(now.toAdd).toBeCloseTo(6.2 * 2.3 - 9, 9);
      expect(now.toAddExtra).toBeCloseTo(7.2 * 2.3 - 9, 9);
      // The other columns are the sums.
      expect(stop.lapsToGo).toBeCloseTo(5.2, 9);
    });
  });

  it('is empty while there is nothing to project', () => {
    expect(projectFinish(undefined, options())).toEqual({
      columns: [],
      lapLostPerLap: null,
    });
    expect(
      projectFinish(snapshot({ valid: false }), options()).columns
    ).toEqual([]);
    expect(
      projectFinish(snapshot({ player: null }), options()).columns
    ).toEqual([]);
  });

  it('projects a race run to laps, where the leader has no margin', () => {
    const [now] = columnsOf({
      timeLeftS: null,
      lapLimit: 30,
      leader: car(1, 90, 20.5),
      player: car(0, 92, 19.9),
    });
    expect(now.lapsToGo).toBeCloseTo(10.1, 9);
    expect(now.leaderMarginS).toBeNull();
    expect(now.leaderNear).toBe(false);
    expect(now.near).toBe('fewer');
    expect(now.playerFraction).toBeNull();
  });
});

describe('rivalProjectedGapS', () => {
  const rival = { projectedGapS: -46, paceDeltaS: 6.4 };

  it('takes the extra time off for each stop the player owes', () => {
    expect(rivalProjectedGapS(rival, 2, 2, false)).toBe(-50);
    expect(rivalProjectedGapS(rival, 0, 2, false)).toBe(-46);
  });

  it('adds what the pace does over the laps left, when asked', () => {
    expect(rivalProjectedGapS(rival, 0, 0, true)).toBeCloseTo(-39.6, 9);
  });

  it('stays unknown where the stops could not be costed', () => {
    expect(
      rivalProjectedGapS({ projectedGapS: null, paceDeltaS: 6.4 }, 1, 2, true)
    ).toBeNull();
  });
});
