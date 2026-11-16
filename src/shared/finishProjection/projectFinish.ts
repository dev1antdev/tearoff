import type {
  FinishProjectionSnapshot,
  FinishRefuelLine,
  FinishRival,
  LmuPitService,
} from '@irdashies/types';

/**
 * Where a race ends for a car that loses a given time in the pits.
 *
 * One rule for every kind of race, the one `fuel.projection` applies to a
 * car that does not stop, with the stops put in:
 *
 * 1. The flag falls when the leader finishes. On a clock, that is the
 *    leader's first line crossing after the clock runs out; on a lap count,
 *    the crossing that completes it; with both, whichever comes first.
 * 2. Every other car finishes at its own next crossing after that.
 * 3. What a car needs aboard is the laps it still has to cover times what a
 *    lap costs it.
 *
 * A stop is a time lost against staying out -- the pit lane less the same
 * stretch on the racing line, plus the standing -- and is taken off the
 * time a car has to cover ground in.
 *
 * Here, where both sides can reach it: the main process counts the laps a
 * rival has left by the same rule, and the columns of the widget are a
 * setting, so they are worked out by whoever draws them.
 */

/**
 * Taken off a projected finish before it is rounded up, so that a car
 * exactly on the line is on that lap and not on the next. The sums that put
 * a leading car on the leader's own lap must not read as another lap.
 */
export const FINISH_ROUNDING_LAPS = 1e-9;

/** The lap a projected finish lands on: the next whole one. */
export const finishLapOf = (projected: number): number =>
  Math.ceil(projected - FINISH_ROUNDING_LAPS);

/** A car as the rule reads it. */
export interface FinishRunner {
  /** Seconds a lap. */
  paceS: number;
  /** Laps completed plus the fraction of the lap under way. */
  progress: number;
}

/** What ends the race. */
export interface RaceEnd {
  /** Seconds on the race clock; null without one. */
  timeLeftS: number | null;
  /** Null without a lap limit. */
  lapLimit: number | null;
}

export interface FlagTime {
  /** Seconds from now until the leader takes the flag. */
  tFlagS: number;
  /** The lap the leader finishes on. */
  finishLap: number;
  /**
   * How long after the clock runs out the leader takes the flag, s. Null
   * where the lap count ends the race first, or there is no clock.
   */
  afterClockS: number | null;
}

/**
 * When the flag falls for a leader that loses `lossS` to stops on the way.
 * Null with nothing to end the race by, or a leader without a pace.
 */
export const flagTime = (
  leader: FinishRunner,
  { timeLeftS, lapLimit }: RaceEnd,
  lossS = 0
): FlagTime | null => {
  if (!(leader.paceS > 0)) return null;
  const loss = Math.max(0, lossS);
  let byClock: FlagTime | null = null;
  if (timeLeftS !== null) {
    const timeLeft = Math.max(0, timeLeftS);
    const atClock =
      leader.progress + Math.max(timeLeft - loss, 0) / leader.paceS;
    const finishLap = finishLapOf(atClock);
    const tFlagS = loss + (finishLap - leader.progress) * leader.paceS;
    byClock = { tFlagS, finishLap, afterClockS: tFlagS - timeLeft };
  }
  if (lapLimit === null) return byClock;
  const byLaps: FlagTime = {
    tFlagS: loss + Math.max(0, lapLimit - leader.progress) * leader.paceS,
    finishLap: lapLimit,
    afterClockS: null,
  };
  return byClock !== null && byClock.tFlagS < byLaps.tFlagS ? byClock : byLaps;
};

/**
 * Which way a finish that hangs on a few seconds would go. `more`: a little
 * quicker and there is one more lap to drive. `fewer`: a little slower and
 * there is one lap fewer.
 */
export type FinishMarginSide = 'more' | 'fewer';

export interface CarFinish {
  finishLap: number;
  lapsToGo: number;
  /**
   * The smaller of two times, s: how long before the flag the car last
   * crosses the line, and how long after it the next crossing is. Null
   * where no few seconds change the lap count.
   */
  marginS: number | null;
  marginSide: FinishMarginSide | null;
}

/**
 * Where a car that is not the leader finishes, having lost `lossS` to
 * stops, when the flag falls `tFlagS` from now.
 */
export const carFinish = (
  car: FinishRunner,
  tFlagS: number,
  lossS: number,
  lapLimit: number | null
): CarFinish | null => {
  if (!(car.paceS > 0)) return null;
  const atFlag =
    car.progress + Math.max(tFlagS - Math.max(0, lossS), 0) / car.paceS;
  const lap = finishLapOf(atFlag);
  if (lapLimit !== null && lap >= lapLimit) {
    // Nobody drives further than the distance. A car that is short of it at
    // the flag still had to start its last lap in time.
    const startedS = (atFlag - (lapLimit - 1)) * car.paceS;
    const short = atFlag < lapLimit - FINISH_ROUNDING_LAPS;
    return {
      finishLap: lapLimit,
      lapsToGo: Math.max(0, lapLimit - car.progress),
      marginS: short ? Math.max(0, startedS) : null,
      marginSide: short ? 'fewer' : null,
    };
  }
  const sinceLineS = (atFlag - (lap - 1)) * car.paceS;
  const untilLineS = (lap - atFlag) * car.paceS;
  return {
    finishLap: lap,
    lapsToGo: Math.max(0, lap - car.progress),
    marginS: Math.min(sinceLineS, untilLineS),
    marginSide: sinceLineS < untilLineS ? 'fewer' : 'more',
  };
};

/**
 * Where the leader itself finishes: on the flag's own lap. Its lap count
 * hangs on the clock, not on another car: across the line a few seconds
 * before the clock runs out there is another lap, a few seconds after there
 * is not.
 */
export const leaderFinish = (
  leader: FinishRunner,
  flag: FlagTime
): CarFinish => {
  const afterS = flag.afterClockS;
  const beforeS = afterS === null ? null : leader.paceS - afterS;
  return {
    finishLap: flag.finishLap,
    lapsToGo: Math.max(0, flag.finishLap - leader.progress),
    marginS:
      afterS === null || beforeS === null
        ? null
        : Math.max(0, Math.min(afterS, beforeS)),
    marginSide:
      afterS === null || beforeS === null
        ? null
        : beforeS < afterS
          ? 'fewer'
          : 'more',
  };
};

/**
 * Whole stops a car still has to make: none while what is aboard covers the
 * laps left, else one for every stint, or part of one, beyond it.
 */
export const stopsOwedFor = (
  lapsLeft: number,
  lapsInHand: number,
  stintLaps: number
): number => {
  if (!(lapsLeft > lapsInHand) || !(stintLaps > 0)) return 0;
  return Math.ceil((lapsLeft - lapsInHand) / stintLaps - FINISH_ROUNDING_LAPS);
};

/** A full budget of virtual energy, in the percent it is counted in. */
const ENERGY_PERCENT = 100;

/** The rates a session states for refuelling. */
export type RefuelRates = Pick<
  LmuPitService,
  | 'fuelFillRate'
  | 'fuelInsert'
  | 'fuelRemove'
  | 'virtualEnergyFillRate'
  | 'virtualEnergyInsert'
  | 'virtualEnergyRemove'
>;

/** A hose on and off again, or null where the sim does not state both. */
const hoseS = (
  insert: number | undefined,
  remove: number | undefined
): number | null =>
  typeof insert === 'number' && typeof remove === 'number'
    ? insert + remove
    : null;

/**
 * The hose of a car that stops on its tank, per litre. Null where the
 * session does not state the rate and both ends of the hose: a stop costed
 * without them would be a stop too short.
 */
export const fuelRefuelLine = (
  rates: RefuelRates | undefined
): FinishRefuelLine | null => {
  const rate = rates?.fuelFillRate;
  const hose = hoseS(rates?.fuelInsert, rates?.fuelRemove);
  if (!(rate && rate > 0) || hose === null) return null;
  return { fixedS: hose, perUnitS: 1 / rate };
};

/**
 * The two hoses of a car on virtual energy, per percent of its budget: the
 * energy, and the fuel that goes in with it at `litresPerPercent`. Null
 * where a rate of either is missing.
 *
 * @param tankShortL Litres the tank is short of what the energy aboard
 *   calls for, which the fuel hose makes up as well. 0 for a car whose
 *   tank is not read: its fuel is then taken to have gone with its energy.
 */
export const energyRefuelLines = (
  rates: RefuelRates | undefined,
  litresPerPercent: number | null,
  tankShortL: number
): FinishRefuelLine[] | null => {
  const fuel = fuelRefuelLine(rates);
  const energyRate = rates?.virtualEnergyFillRate;
  const energyHose = hoseS(
    rates?.virtualEnergyInsert,
    rates?.virtualEnergyRemove
  );
  if (
    !fuel ||
    !(energyRate && energyRate > 0) ||
    energyHose === null ||
    litresPerPercent === null ||
    !(litresPerPercent > 0)
  ) {
    return null;
  }
  return [
    { fixedS: energyHose, perUnitS: 1 / (energyRate * ENERGY_PERCENT) },
    {
      fixedS: fuel.fixedS + tankShortL * fuel.perUnitS,
      perUnitS: litresPerPercent * fuel.perUnitS,
    },
  ];
};

/**
 * How long the car stands to take on `amount` of its budget: the longest
 * of the hoses, which go in side by side. Nothing to add is no hose at all.
 */
export const refuelStandingS = (
  lines: readonly FinishRefuelLine[],
  amount: number
): number => {
  if (!(amount > 0)) return 0;
  let longest = 0;
  for (const line of lines) {
    longest = Math.max(longest, line.fixedS + amount * line.perUnitS);
  }
  return longest;
};

/**
 * Where a car is on its lap as the clock runs out, 0..1, having stood for
 * `lossS` on the way: the figure TinyPedal's table is made of. It leaves
 * the comparison of two cars to the reader; the laps to go above make it.
 * Null in a race with no clock.
 */
export const fractionAtClock = (
  car: FinishRunner,
  timeLeftS: number | null,
  lossS = 0
): number | null => {
  if (timeLeftS === null || !(car.paceS > 0)) return null;
  const laps =
    car.progress + (Math.max(0, timeLeftS) - Math.max(0, lossS)) / car.paceS;
  return laps - Math.floor(laps);
};

/** What a column of the table stands for. */
export type FinishColumnKind =
  'now' | 'scenario' | 'planned' | 'toFinish' | 'last';

export interface FinishColumn {
  kind: FinishColumnKind;
  /** The seconds a `scenario` column was asked for; null for the others. */
  scenarioS: number | null;
  /** Seconds the player and the leader lose to stops in this column. */
  playerLossS: number;
  leaderLossS: number;
  /**
   * How long after the clock the leader takes the flag, s. Null when the
   * player leads and when the lap count ends the race.
   */
  leaderMarginS: number | null;
  /** The leader crosses the line within the near range of the clock's end. */
  leaderNear: boolean;
  lapsToGo: number;
  /** Seconds the player's lap count hangs on; null where it does not. */
  marginS: number | null;
  /** Set while that margin is inside the near range. */
  near: FinishMarginSide | null;
  /** The whole amount the laps to go need; null without a usage. */
  needed: number | null;
  /** What is missing of it, signed: negative is to spare. */
  toAdd: number | null;
  /** The same two for the extra laps. */
  neededExtra: number | null;
  toAddExtra: number | null;
  /** More than the car holds: one stop does not cover it. */
  overCapacity: boolean;
  overCapacityExtra: boolean;
  /**
   * Where the leader and the player are on their lap as the clock runs
   * out, 0..1. Null without a clock, and the leader's when the player
   * leads.
   */
  leaderFraction: number | null;
  playerFraction: number | null;
}

export interface FinishProjectionOptions {
  /** Seconds lost in the pits, one fixed column each. */
  scenarios: readonly number[];
  /** Whether the leader loses the same time in a fixed column. */
  leaderStops: 'same' | 'none';
  showPlanned: boolean;
  showToFinish: boolean;
  showLast: boolean;
  /** Added to every stop that is worked out, s. */
  extraTimeS: number;
  /** A margin under this is near, s; never more than a third of the lap. */
  nearRangeS: number;
  /** Laps added for the second refuel figure. */
  extraLaps: number;
}

export interface FinishProjection {
  columns: readonly FinishColumn[];
  /**
   * The share of a lap the player loses to the leader every lap; null when
   * the player leads or is not the slower of the two.
   */
  lapLostPerLap: number | null;
}

const NO_PROJECTION: FinishProjection = { columns: [], lapLostPerLap: null };

/** The widest a near range gets: beyond it every finish would be "near". */
const NEAR_RANGE_MAX_LAP_SHARE = 1 / 3;
/** How far the published laps to go may sit from the sums and be the same lap. */
const SAME_LAP_TOLERANCE = 0.5;
/** Passes of the stop that adds what its own laps to go need. */
const TO_FINISH_PASSES = 2;

type Snapshot = Pick<
  FinishProjectionSnapshot,
  | 'valid'
  | 'timeLeftS'
  | 'lapLimit'
  | 'leader'
  | 'player'
  | 'lapsToGo'
  | 'energy'
  | 'laneLossS'
  | 'plannedStandingS'
  | 'refuelLines'
  | 'separateS'
  | 'overlapS'
>;

/**
 * The table of the finish projection: a column for no stop, one for each
 * stop length asked for, and the planned stop, the stop that adds exactly
 * what is needed and the last stop made, where there is one to show.
 */
export const projectFinish = (
  snapshot: Snapshot | undefined,
  options: FinishProjectionOptions
): FinishProjection => {
  const player = snapshot?.player;
  if (!snapshot?.valid || !player) return NO_PROJECTION;
  const { leader, energy } = snapshot;
  const end: RaceEnd = {
    timeLeftS: snapshot.timeLeftS,
    lapLimit: snapshot.lapLimit,
  };
  const nearOf = (paceS: number): number =>
    Math.min(Math.max(0, options.nearRangeS), paceS * NEAR_RANGE_MAX_LAP_SHARE);
  const extraLaps = Math.max(0, options.extraLaps);

  const column = (
    kind: FinishColumnKind,
    playerLossS: number,
    leaderLossS: number,
    scenarioS: number | null = null
  ): FinishColumn | null => {
    // With nobody ahead the flag falls for the player, on the player's own
    // stop.
    const flag = flagTime(
      leader ?? player,
      end,
      leader ? leaderLossS : playerLossS
    );
    if (!flag) return null;
    const finish = leader
      ? carFinish(player, flag.tFlagS, playerLossS, end.lapLimit)
      : leaderFinish(player, flag);
    if (!finish) return null;

    const leaderMarginS = leader ? flag.afterClockS : null;
    const leaderRange = leader ? nearOf(leader.paceS) : 0;
    const needed = energy ? finish.lapsToGo * energy.perLap : null;
    const neededExtra = energy
      ? (finish.lapsToGo + extraLaps) * energy.perLap
      : null;
    const capacity = energy?.capacity ?? null;
    return {
      kind,
      scenarioS,
      playerLossS,
      leaderLossS: leader ? leaderLossS : playerLossS,
      leaderMarginS,
      leaderNear:
        leader !== null &&
        leaderMarginS !== null &&
        (leaderMarginS < leaderRange ||
          leader.paceS - leaderMarginS < leaderRange),
      lapsToGo: finish.lapsToGo,
      marginS: finish.marginS,
      near:
        finish.marginS !== null && finish.marginS < nearOf(player.paceS)
          ? finish.marginSide
          : null,
      needed,
      toAdd: needed !== null && energy ? needed - energy.aboard : null,
      neededExtra,
      toAddExtra:
        neededExtra !== null && energy ? neededExtra - energy.aboard : null,
      overCapacity: needed !== null && capacity !== null && needed > capacity,
      overCapacityExtra:
        neededExtra !== null && capacity !== null && neededExtra > capacity,
      leaderFraction: leader
        ? fractionAtClock(leader, end.timeLeftS, leaderLossS)
        : null,
      playerFraction: fractionAtClock(player, end.timeLeftS, playerLossS),
    };
  };

  const now = column('now', 0, 0);
  if (!now) return NO_PROJECTION;
  const columns: FinishColumn[] = [withPublishedLaps(now, snapshot, extraLaps)];

  for (const seconds of options.scenarios) {
    if (!Number.isFinite(seconds) || seconds < 0) continue;
    const made = column(
      'scenario',
      seconds,
      options.leaderStops === 'same' ? seconds : 0,
      seconds
    );
    if (made) columns.push(made);
  }

  const { laneLossS, plannedStandingS, refuelLines } = snapshot;
  if (options.showPlanned && laneLossS !== null && plannedStandingS !== null) {
    // A pass down the lane with nothing to stand for is given no extra.
    const planned = column(
      'planned',
      laneLossS +
        plannedStandingS +
        (plannedStandingS > 0 ? options.extraTimeS : 0),
      0
    );
    if (planned) columns.push(planned);
  }

  if (options.showToFinish && refuelLines && laneLossS !== null && energy) {
    // The laps to go depend on the stop and the stop on the laps to go, so
    // it is taken in passes from the column with no stop.
    let toFinish = now;
    for (let pass = 0; pass < TO_FINISH_PASSES; pass += 1) {
      const amount = toFinish.toAdd ?? 0;
      // Enough aboard already: no stop, and the column says so.
      const lossS =
        amount > 0
          ? laneLossS +
            Math.max(refuelStandingS(refuelLines, amount), snapshot.overlapS) +
            snapshot.separateS +
            options.extraTimeS
          : 0;
      toFinish = column('toFinish', lossS, 0) ?? toFinish;
    }
    columns.push({ ...toFinish, kind: 'toFinish' });
  }

  if (options.showLast) {
    const playerLastS = player.lastStopLossS;
    const leaderLastS = leader?.lastStopLossS ?? 0;
    if (playerLastS > 0 || leaderLastS > 0) {
      const last = column('last', playerLastS, leaderLastS);
      if (last) columns.push(last);
    }
  }

  return {
    columns,
    lapLostPerLap:
      leader && player.paceS > leader.paceS
        ? (player.paceS - leader.paceS) / player.paceS
        : null,
  };
};

/**
 * The column with no stop, on the laps to go `fuel.projection` publishes.
 *
 * That figure holds a finishing lap it has once given until the sums fall
 * short of it by more than the doubt in the pace, so the fuel calculator
 * and this table never disagree. Where it stands a lap above the sums, the
 * lap in hand is the one in doubt: a little slower and it is not driven.
 */
const withPublishedLaps = (
  now: FinishColumn,
  snapshot: Snapshot,
  extraLaps: number
): FinishColumn => {
  const published = snapshot.lapsToGo;
  if (published === null || !(published > 0)) return now;
  if (Math.abs(published - now.lapsToGo) < SAME_LAP_TOLERANCE) return now;
  const { energy } = snapshot;
  const needed = energy ? published * energy.perLap : null;
  const neededExtra = energy ? (published + extraLaps) * energy.perLap : null;
  const capacity = energy?.capacity ?? null;
  return {
    ...now,
    lapsToGo: published,
    near: published > now.lapsToGo ? 'fewer' : now.near,
    needed,
    toAdd: needed !== null && energy ? needed - energy.aboard : null,
    neededExtra,
    toAddExtra:
      neededExtra !== null && energy ? neededExtra - energy.aboard : null,
    overCapacity: needed !== null && capacity !== null && needed > capacity,
    overCapacityExtra:
      neededExtra !== null && capacity !== null && neededExtra > capacity,
  };
};

/**
 * The gap to a rival once both cars have made the stops they owe, as the
 * reader's settings have it: the player's stops with the extra time each is
 * given, and the difference in pace over the laps left where that is asked
 * for. Seconds behind the player; negative for a rival that ends ahead.
 */
export const rivalProjectedGapS = (
  rival: Pick<FinishRival, 'projectedGapS' | 'paceDeltaS'>,
  playerStopsOwed: number,
  extraTimeS: number,
  includePace: boolean
): number | null =>
  rival.projectedGapS === null
    ? null
    : rival.projectedGapS -
      playerStopsOwed * extraTimeS +
      (includePace ? rival.paceDeltaS : 0);
