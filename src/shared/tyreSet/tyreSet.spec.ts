import { describe, expect, it } from 'vitest';
import type { RaceLap, RaceStint } from '@irdashies/types';
import { LEDGER_LAP_IN_LAP, LEDGER_LAP_OUT_LAP } from '../../types/ledger';
import {
  NO_TYRE_STOP_RULES,
  tyreSetOf,
  tyresChangedAcross,
  tyreStopVerdict,
  type TyreStopRules,
} from './tyreSet';

/**
 * Hand-built records throughout: no recording has a pit stop. What is
 * checked is the rule, not what a sim writes.
 */

const MEDIUM = [1, 1, 1, 1];
const HARD = [2, 2, 2, 2];
/** A lap costs 3 % of a full budget. */
const USAGE = 0.03;

/** Rates as Le Mans Ultimate states them for the recorded LMGT3. */
const RULES: TyreStopRules = {
  tyreChangeS: 12,
  tyresAlongside: false,
  // 2.5 % of a full budget a second.
  refillS: (gain) => (gain > 0 ? gain / 0.025 : 0),
  driverChangeS: 25,
  driverAlongside: true,
};

const lap = (number: number, values: Partial<RaceLap> = {}): RaceLap => ({
  carIdx: 0,
  lap: number,
  sessionTime: 200 + number * 100,
  lapTime: 100,
  sectors: [null, null, null],
  position: 1,
  classPosition: 1,
  classGap: 0,
  flags: 0,
  driver: 'Ada',
  energy: null,
  energyIsVirtual: true,
  compounds: MEDIUM,
  ...values,
});

const stint = (
  ordinal: number,
  firstLap: number | null,
  lastLap: number | null,
  values: Partial<RaceStint> = {}
): RaceStint => ({
  carIdx: 0,
  ordinal,
  driver: 'Ada',
  openedBy: ordinal === 1 ? 'start' : 'stop',
  closedBy: null,
  firstLap,
  lastLap,
  startTime: 200 + ((firstLap ?? 1) - 1) * 100,
  endTime: null,
  laps: firstLap === null || lastLap === null ? 0 : lastLap - firstLap + 1,
  cleanLaps: 0,
  avgLap: null,
  bestLap: null,
  stop: null,
  ...values,
});

/** A stint a stop ended, the car standing for `standingS`. */
const stopped = (
  ordinal: number,
  firstLap: number,
  lastLap: number,
  standingS: number,
  values: Partial<RaceStint> = {}
): RaceStint =>
  stint(ordinal, firstLap, lastLap, {
    closedBy: 'stop',
    // The pit entry, a little before the car stood still.
    endTime: 200 + lastLap * 100 + 80,
    stop: {
      laneTime: standingS + 30,
      standingTime: standingS,
      driverChanged: false,
    },
    ...values,
  });

/**
 * Laps `from` to `to` of a car that burns USAGE a lap from `startEnergy`.
 * The energy is what it has left at the end of each lap.
 */
const run = (
  from: number,
  to: number,
  startEnergy: number,
  values: Partial<RaceLap> = {}
): RaceLap[] =>
  Array.from({ length: to - from + 1 }, (_, index) =>
    lap(from + index, {
      energy: Math.round((startEnergy - USAGE * (index + 1)) * 1e6) / 1e6,
      ...values,
    })
  );

/**
 * A car that ran 20 laps from the start, stopped, and has run laps 21 to
 * 26 since: the pit boxes are past the line, so lap 20 ended in the pit
 * lane and lap 21 is the lap out of it. It took on `gain` of a full budget.
 */
const oneStop = (
  standingS: number,
  gain: number,
  after: Partial<RaceLap> = {},
  stop: Partial<RaceStint> = {}
) => {
  const before = run(1, 20, 0.9);
  const left = before[before.length - 1].energy ?? 0;
  const laps = [
    ...before,
    ...run(21, 26, left + gain, after).map((entry, index) =>
      index === 0 ? { ...entry, flags: LEDGER_LAP_OUT_LAP } : entry
    ),
  ];
  const stints = [
    stopped(1, 1, 20, standingS, stop),
    stint(2, 21, 26, { startTime: 2400 }),
  ];
  return { laps, stints, now: { lapsCompleted: 26 } };
};

describe('tyresChangedAcross', () => {
  it('says so when a wheel carries another compound', () => {
    expect(tyresChangedAcross(MEDIUM, HARD)).toBe(true);
    expect(tyresChangedAcross(MEDIUM, [1, 1, 1, 2])).toBe(true);
    expect(tyresChangedAcross(MEDIUM, MEDIUM)).toBe(false);
  });

  it('does not take a wheel that was not read for a change', () => {
    expect(tyresChangedAcross([-1, -1, -1, -1], HARD)).toBe(false);
    expect(tyresChangedAcross(MEDIUM, [-1, -1, -1, -1])).toBe(false);
    expect(tyresChangedAcross(MEDIUM, [1, 1])).toBe(false);
  });
});

describe('tyreStopVerdict', () => {
  const facts = { compoundsChanged: false, underWay: false };

  it('takes a compound that changed over everything else', () => {
    expect(
      tyreStopVerdict(
        { compoundsChanged: true, underWay: true, standingS: 2, explainedS: 2 },
        NO_TYRE_STOP_RULES
      )
    ).toBe('changed');
  });

  it('says nothing of a stop that is not over', () => {
    expect(
      tyreStopVerdict(
        { ...facts, underWay: true, standingS: 5, explainedS: 0 },
        RULES
      )
    ).toBe('unknown');
  });

  it('says nothing where nobody says what four tyres take', () => {
    expect(
      tyreStopVerdict(
        { ...facts, standingS: 60, explainedS: 30 },
        { ...RULES, tyreChangeS: null }
      )
    ).toBe('unknown');
  });

  it('rules a change out when the car stood for less than four tyres take', () => {
    expect(
      tyreStopVerdict({ ...facts, standingS: 11.9, explainedS: null }, RULES)
    ).toBe('none');
  });

  it('holds the rest of the standing time against what four tyres take', () => {
    const verdict = (standingS: number) =>
      tyreStopVerdict({ ...facts, standingS, explainedS: 30 }, RULES);
    expect(verdict(42)).toBe('likely');
    expect(verdict(41.9)).toBe('unknown');
    expect(verdict(36)).toBe('unknown');
    expect(verdict(35.9)).toBe('none');
  });

  it('says nothing of a long stop it cannot account for', () => {
    expect(
      tyreStopVerdict({ ...facts, standingS: 50, explainedS: null }, RULES)
    ).toBe('unknown');
  });

  it('says nothing of a long stop where tyres go on during the refill', () => {
    expect(
      tyreStopVerdict(
        { ...facts, standingS: 50, explainedS: 30 },
        { ...RULES, tyresAlongside: true }
      )
    ).toBe('unknown');
  });
});

describe('tyreSetOf', () => {
  it('holds nothing of a car with no stint', () => {
    expect(tyreSetOf([], [], RULES, { lapsCompleted: 4 })).toBeNull();
  });

  it('counts from the start for a car seen before its first lap', () => {
    const laps = run(1, 12, 0.9);
    expect(
      tyreSetOf([stint(1, 1, 12)], laps, RULES, { lapsCompleted: 12 })
    ).toEqual({ sinceLap: 0, sure: 'seen' });
  });

  it('counts a car first seen with laps behind it as at least that old', () => {
    const laps = run(31, 40, 0.9);
    expect(
      tyreSetOf([stint(1, 31, 40, { openedBy: 'joined' })], laps, RULES, {
        lapsCompleted: 40,
      })
    ).toEqual({ sinceLap: 30, sure: 'atLeast' });
    // Before it has completed a lap in sight: nothing is behind the set.
    expect(
      tyreSetOf([stint(1, null, null, { openedBy: 'joined' })], [], RULES, {
        lapsCompleted: 30,
      })
    ).toEqual({ sinceLap: 30, sure: 'atLeast' });
  });

  describe('a stop that was seen to change the tyres', () => {
    it('counts from the stop when another compound is on after it', () => {
      const { laps, stints, now } = oneStop(33, 0.8, { compounds: HARD });
      expect(tyreSetOf(stints, laps, RULES, now)).toEqual({
        sinceLap: 20,
        sure: 'seen',
      });
    });

    it('needs no rates for that', () => {
      const { laps, stints, now } = oneStop(33, 0.8, { compounds: HARD });
      expect(tyreSetOf(stints, laps, NO_TYRE_STOP_RULES, now)).toEqual({
        sinceLap: 20,
        sure: 'seen',
      });
    });

    it('does not count the lap the car stood on, where the box is before the line', () => {
      // Lap 21 is completed as the car leaves its box: driven on the set
      // that came off, and marked as the lap into the pits.
      const { laps, stints, now } = oneStop(33, 0.8, { compounds: HARD });
      laps[20] = { ...laps[20], flags: LEDGER_LAP_IN_LAP };
      laps[21] = { ...laps[21], flags: LEDGER_LAP_OUT_LAP };
      expect(tyreSetOf(stints, laps, RULES, now)).toEqual({
        sinceLap: 21,
        sure: 'seen',
      });
    });

    it('sees it from the compounds on the car before the next lap is completed', () => {
      const laps = run(1, 20, 0.9);
      const stints = [
        stopped(1, 1, 20, 14, {
          stop: { laneTime: null, standingTime: 14, driverChanged: false },
        }),
        stint(2, null, null),
      ];
      // Still on the set it came in on: nothing can be said yet.
      expect(
        tyreSetOf(stints, laps, RULES, { lapsCompleted: 20, compounds: MEDIUM })
      ).toEqual({ sinceLap: 20, sure: 'atLeast' });
      expect(
        tyreSetOf(stints, laps, RULES, { lapsCompleted: 20, compounds: HARD })
      ).toEqual({ sinceLap: 20, sure: 'seen' });
    });
  });

  describe('a stop judged by how long the car stood', () => {
    it('is a likely change when it stood four tyres longer than its refill', () => {
      // 0.8 of a budget takes 32 s at 2.5 % a second.
      const { laps, stints, now } = oneStop(45, 0.8);
      expect(tyreSetOf(stints, laps, RULES, now)).toEqual({
        sinceLap: 20,
        sure: 'likely',
      });
    });

    it('reads what the car took on whichever side of the line its box is', () => {
      // Box before the line: the stint ends on lap 19, the car burns most
      // of lap 20 before it stops, and crosses the line as it leaves.
      const before = run(1, 19, 0.9);
      const left = (before[18].energy ?? 0) - USAGE;
      const laps = [
        ...before,
        lap(20, { energy: left + 0.8, flags: LEDGER_LAP_IN_LAP }),
        ...run(21, 26, left + 0.8),
      ];
      const stints = [stopped(1, 1, 19, 45), stint(2, 20, 26)];
      expect(tyreSetOf(stints, laps, RULES, { lapsCompleted: 26 })).toEqual({
        sinceLap: 20,
        sure: 'likely',
      });
    });

    it('carries the set on, as likely, when the refill explains the stop', () => {
      const { laps, stints, now } = oneStop(33, 0.8);
      expect(tyreSetOf(stints, laps, RULES, now)).toEqual({
        sinceLap: 0,
        sure: 'likely',
      });
    });

    it('says at least the laps since, when the stop is neither', () => {
      // Eight seconds to spare: too long for a refill, too short for tyres.
      const { laps, stints, now } = oneStop(40, 0.8);
      expect(tyreSetOf(stints, laps, RULES, now)).toEqual({
        sinceLap: 20,
        sure: 'atLeast',
      });
    });

    it('rules a change out of a short stop without any reading of the car', () => {
      const { laps, stints, now } = oneStop(8, 0.2, { energy: null });
      const unread = laps.map((entry) => ({ ...entry, energy: null }));
      expect(tyreSetOf(stints, unread, RULES, now)).toEqual({
        sinceLap: 0,
        sure: 'likely',
      });
    });

    it('says at least the laps since, where nobody says what four tyres take', () => {
      const { laps, stints, now } = oneStop(45, 0.8);
      expect(tyreSetOf(stints, laps, NO_TYRE_STOP_RULES, now)).toEqual({
        sinceLap: 20,
        sure: 'atLeast',
      });
    });

    it('says at least the laps since, where tyres go on during the refill', () => {
      const { laps, stints, now } = oneStop(45, 0.8);
      expect(
        tyreSetOf(stints, laps, { ...RULES, tyresAlongside: true }, now)
      ).toEqual({ sinceLap: 20, sure: 'atLeast' });
    });

    it('does not reckon a refill from a reading that never moves', () => {
      // What a rival has left is withheld online: the same figure all race.
      const { laps, stints, now } = oneStop(45, 0);
      const withheld = laps.map((entry) => ({ ...entry, energy: 0 }));
      expect(tyreSetOf(stints, withheld, RULES, now)).toEqual({
        sinceLap: 20,
        sure: 'atLeast',
      });
    });

    it('does not reckon a refill across two kinds of reading', () => {
      const { laps, stints, now } = oneStop(45, 0.8);
      const mixed = laps.map((entry) =>
        entry.lap > 20 ? { ...entry, energyIsVirtual: false } : entry
      );
      expect(tyreSetOf(stints, mixed, RULES, now)).toEqual({
        sinceLap: 20,
        sure: 'atLeast',
      });
    });

    it('waits for the lap after the stop before it reckons the refill', () => {
      const { laps, stints } = oneStop(45, 0.8);
      const sofar = laps.filter((entry) => entry.lap <= 20);
      const open = [stints[0], stint(2, null, null)];
      expect(tyreSetOf(open, sofar, RULES, { lapsCompleted: 20 })).toEqual({
        sinceLap: 20,
        sure: 'atLeast',
      });
    });

    it('says nothing of a stop the car has not left', () => {
      const laps = run(1, 20, 0.9);
      const stints = [
        stopped(1, 1, 20, 4, {
          stop: { laneTime: null, standingTime: 4, driverChanged: false },
        }),
        stint(2, null, null),
      ];
      // Four seconds so far: it may yet stand for a set of tyres.
      expect(tyreSetOf(stints, laps, RULES, { lapsCompleted: 20 })).toEqual({
        sinceLap: 20,
        sure: 'atLeast',
      });
    });
  });

  describe('a driver change at the stop', () => {
    it('is time the car stood for something other than tyres', () => {
      // A small refill, 0.2 of a budget in 8 s, and a driver change of
      // 25 s alongside it: 28 s is explained by the two, not by tyres.
      const { laps, stints, now } = oneStop(
        28,
        0.2,
        {},
        {
          stop: { laneTime: 58, standingTime: 28, driverChanged: true },
        }
      );
      expect(tyreSetOf(stints, laps, RULES, now)).toEqual({
        sinceLap: 0,
        sure: 'likely',
      });
    });

    it('is read from the names where the record does not say', () => {
      const { laps, stints, now } = oneStop(28, 0.2);
      stints[1] = { ...stints[1], driver: 'Grace' };
      expect(tyreSetOf(stints, laps, RULES, now)).toEqual({
        sinceLap: 0,
        sure: 'likely',
      });
    });

    it('adds to the refill where the two may not overlap', () => {
      const { laps, stints, now } = oneStop(
        45,
        0.8,
        {},
        {
          stop: { laneTime: 75, standingTime: 45, driverChanged: true },
        }
      );
      // Alongside: 32 s of refill covers the change, and 13 s are spare.
      expect(tyreSetOf(stints, laps, RULES, now)?.sure).toBe('likely');
      // One after the other they take 57 s: the stop was too short for both
      // and tyres, so no set went on.
      expect(
        tyreSetOf(stints, laps, { ...RULES, driverAlongside: false }, now)
      ).toEqual({ sinceLap: 0, sure: 'likely' });
    });

    it('leaves the stop unjudged where nobody says what one takes', () => {
      const { laps, stints, now } = oneStop(
        45,
        0.8,
        {},
        {
          stop: { laneTime: 75, standingTime: 45, driverChanged: true },
        }
      );
      expect(
        tyreSetOf(stints, laps, { ...RULES, driverChangeS: null }, now)
      ).toEqual({ sinceLap: 20, sure: 'atLeast' });
    });
  });

  describe('more than one stop', () => {
    /** Stops after laps 20 and 40, the car now on lap 47. */
    const twoStops = (first: number, second: number, hardFrom?: number) => {
      const one = run(1, 20, 0.9);
      const two = run(21, 40, (one[19].energy ?? 0) + 0.6);
      const three = run(41, 46, (two[19].energy ?? 0) + 0.6);
      const laps = [...one, ...two, ...three].map((entry) =>
        hardFrom !== undefined && entry.lap >= hardFrom
          ? { ...entry, compounds: HARD }
          : entry
      );
      const stints = [
        stopped(1, 1, 20, first),
        stopped(2, 21, 40, second),
        stint(3, 41, 46),
      ];
      return { laps, stints, now: { lapsCompleted: 46 } };
    };

    it('counts from the newest stop that changed them', () => {
      // 0.6 of a budget is 24 s: 40 s is a likely change both times.
      const { laps, stints, now } = twoStops(40, 40);
      expect(tyreSetOf(stints, laps, RULES, now)).toEqual({
        sinceLap: 40,
        sure: 'likely',
      });
    });

    it('goes back past a stop that did not, to the one that did', () => {
      const { laps, stints, now } = twoStops(40, 25);
      expect(tyreSetOf(stints, laps, RULES, now)).toEqual({
        sinceLap: 20,
        sure: 'likely',
      });
    });

    it('is no surer of a change that was seen than of the stops after it', () => {
      // Hards from lap 21, and a second stop the refill explains.
      const { laps, stints, now } = twoStops(40, 25, 21);
      expect(tyreSetOf(stints, laps, RULES, now)).toEqual({
        sinceLap: 20,
        sure: 'likely',
      });
    });

    it('stops at a stop it cannot judge', () => {
      const { laps, stints, now } = twoStops(40, 32, 21);
      expect(tyreSetOf(stints, laps, RULES, now)).toEqual({
        sinceLap: 40,
        sure: 'atLeast',
      });
    });
  });

  describe('what is not a stop', () => {
    it('says at least the laps since a spell in the garage', () => {
      const laps = [...run(1, 10, 0.9), ...run(11, 15, 0.9)];
      const stints = [
        stint(1, 1, 10, { closedBy: 'garage', endTime: 1250 }),
        stint(2, 11, 15, { openedBy: 'garage' }),
      ];
      expect(tyreSetOf(stints, laps, RULES, { lapsCompleted: 15 })).toEqual({
        sinceLap: 10,
        sure: 'atLeast',
      });
    });

    it('sees a change of compound made in the garage', () => {
      const laps = [
        ...run(1, 10, 0.9),
        ...run(11, 15, 0.9, { compounds: HARD }),
      ];
      const stints = [
        stint(1, 1, 10, { closedBy: 'garage', endTime: 1250 }),
        stint(2, 11, 15, { openedBy: 'garage' }),
      ];
      expect(tyreSetOf(stints, laps, RULES, { lapsCompleted: 15 })).toEqual({
        sinceLap: 10,
        sure: 'seen',
      });
    });

    it('says at least the laps since the car was seen again, after laps nobody saw', () => {
      const laps = [...run(1, 10, 0.9), ...run(31, 36, 0.9)];
      const stints = [
        stint(1, 1, 10, { closedBy: 'gap', endTime: 1200 }),
        stint(2, 31, 36, { openedBy: 'joined' }),
      ];
      expect(tyreSetOf(stints, laps, RULES, { lapsCompleted: 36 })).toEqual({
        sinceLap: 30,
        sure: 'atLeast',
      });
    });

    it('says at least, from now, of a car with laps behind it that are not held', () => {
      // Three laps completed while nothing was recording, and the lap
      // after them not yet completed: the record still looks unbroken.
      const laps = run(1, 10, 0.9);
      expect(
        tyreSetOf([stint(1, 1, 10)], laps, RULES, { lapsCompleted: 13 })
      ).toEqual({
        sinceLap: 13,
        sure: 'atLeast',
      });
    });

    it('carries the set through another driver being named with no stop', () => {
      const laps = run(1, 15, 0.9);
      const stints = [
        stint(1, 1, 10, { closedBy: 'driver', endTime: 1200 }),
        stint(2, 11, 15, { openedBy: 'driver', driver: 'Grace' }),
      ];
      expect(tyreSetOf(stints, laps, RULES, { lapsCompleted: 15 })).toEqual({
        sinceLap: 0,
        sure: 'seen',
      });
    });
  });

  describe('a car whose wear is watched', () => {
    it('knows no set went on at a stop it watched', () => {
      // By its length the stop cannot be judged; the wear did not go up.
      const { laps, stints, now } = oneStop(40, 0.8);
      expect(
        tyreSetOf(stints, laps, RULES, now, {
          since: 100,
          changedAt: Number.NaN,
          changeLap: -1,
        })
      ).toEqual({ sinceLap: 0, sure: 'seen' });
    });

    it('counts from a change it saw, whatever the stop looked like', () => {
      // The refill explains the stop, and a new set of the same compound
      // went on all the same.
      const { laps, stints, now } = oneStop(33, 0.8);
      expect(
        tyreSetOf(stints, laps, RULES, now, {
          since: 100,
          changedAt: 2290,
          changeLap: 20,
        })
      ).toEqual({ sinceLap: 20, sure: 'seen' });
    });

    it('falls back on the records for a stop before it began to watch', () => {
      const { laps, stints, now } = oneStop(45, 0.8);
      expect(
        tyreSetOf(stints, laps, RULES, now, {
          since: 2500,
          changedAt: Number.NaN,
          changeLap: -1,
        })
      ).toEqual({ sinceLap: 20, sure: 'likely' });
    });

    it('keeps a change it saw after it has lost sight of the car', () => {
      const { laps, stints, now } = oneStop(33, 0.8);
      expect(
        tyreSetOf(stints, laps, RULES, now, {
          since: Number.NaN,
          changedAt: 2290,
          changeLap: 20,
        })
      ).toEqual({ sinceLap: 20, sure: 'seen' });
    });

    it('carries the set through laps nobody recorded, where its wear was watched', () => {
      // Our own car: its ledger never stops watching, whatever the race
      // history was doing.
      const laps = run(1, 10, 0.9);
      const watched = { since: 100, changedAt: Number.NaN, changeLap: -1 };
      expect(
        tyreSetOf(
          [stint(1, 1, 10)],
          laps,
          RULES,
          { lapsCompleted: 13 },
          watched
        )
      ).toEqual({ sinceLap: 0, sure: 'seen' });
      // And a change it saw on one of them is a change seen.
      expect(
        tyreSetOf(
          [stint(1, 1, 10)],
          laps,
          RULES,
          { lapsCompleted: 13 },
          {
            since: 100,
            changedAt: 1450,
            changeLap: 12,
          }
        )
      ).toEqual({ sinceLap: 12, sure: 'seen' });
      // Watching that began after the last lap held covers none of them.
      expect(
        tyreSetOf(
          [stint(1, 1, 10)],
          laps,
          RULES,
          { lapsCompleted: 13 },
          {
            since: 1300,
            changedAt: Number.NaN,
            changeLap: -1,
          }
        )
      ).toEqual({ sinceLap: 13, sure: 'atLeast' });
    });

    it('counts from a change seen with no stop in the record', () => {
      const laps = run(1, 12, 0.9);
      expect(
        tyreSetOf(
          [stint(1, 1, 12)],
          laps,
          RULES,
          { lapsCompleted: 12 },
          {
            since: 100,
            changedAt: 900,
            changeLap: 7,
          }
        )
      ).toEqual({ sinceLap: 7, sure: 'seen' });
    });
  });
});
