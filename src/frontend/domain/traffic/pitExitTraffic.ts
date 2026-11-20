import type { TrafficArrival } from '@irdashies/types';

/**
 * Who the player comes out among: the cars that pass the pit exit just
 * before the player gets there, and the ones that arrive just after.
 *
 * Worked out from positions alone. The traffic channel says how long each
 * car behind needs to reach where the player is now; the pit lane data the
 * Pit Lane Helper learns says where on the lap the pit exit is. From the
 * two, each car's time to the exit line is the time to the player plus the
 * stretch from the player to the exit at the car's speed, and the player's
 * own is that stretch at the speed they are doing. No pit stop timings are
 * read: while the car stands in its box the figures are for leaving now.
 */

/** Seconds a standing start costs against rolling at the pit limit. */
const LAUNCH_S = 2;
/** Slower than this in the lane the car is taken to be standing, m/s. */
const ROLLING_MS = 5;
/** The pit limit where the session states none: 60 km/h. */
const DEFAULT_PIT_LIMIT_MS = 60 / 3.6;
/** A pit lane is never more than this much of a lap. */
const LONGEST_LANE = 0.5;
/** Leeway on the lane's own length for where the two lines were seen. */
const LANE_MARGIN = 0.02;

export type RejoinState = 'clear' | 'caution' | 'danger';

export interface RejoinRow {
  carIdx: number;
  /**
   * Seconds between the player and this car at the place they meet:
   * negative for a car that goes by before the player gets there, positive
   * for one that arrives after.
   */
  offsetS: number;
}

export interface RejoinTraffic {
  /**
   * `exit` in the pit lane and just after it; `rejoin` when slow or off the
   * road.
   */
  mode: 'exit' | 'rejoin';
  /**
   * True when the offsets are measured at the pit exit line. False when
   * they are simply how far behind each car is now: out of the lane, and in
   * it while the track's pit exit has not been seen yet.
   */
  atExit: boolean;
  /** The player's seconds to the exit line; null when `atExit` is false. */
  toExitS: number | null;
  /** The car that will be just ahead; null when none is inside the window. */
  ahead: RejoinRow | null;
  /** The cars arriving behind, nearest first. */
  behind: RejoinRow[];
  state: RejoinState;
}

export interface RejoinInput {
  mode: 'exit' | 'rejoin';
  /** On-track cars behind the player, nearest first. */
  arriving: readonly TrafficArrival[];
  inPitLane: boolean;
  /** The player's lap fraction, 0..1. */
  playerPct: number;
  /** The player's speed, m/s. */
  playerSpeedMs: number;
  /** Where the pit lane starts and ends on the lap; null until seen. */
  pitEntryPct: number | null;
  pitExitPct: number | null;
  trackLengthM: number;
  /** The pit speed limit, m/s; null where the session states none. */
  pitLimitMs: number | null;
  aheadWindow: number;
  behindWindow: number;
  behindCount: number;
  careGap: number;
  dangerGap: number;
}

const wrap01 = (pct: number): number => ((pct % 1) + 1) % 1;
const round1 = (value: number): number => Math.round(value * 10) / 10 + 0;

/**
 * The session's pit speed limit ("60.00 kph", "45.00 mph") in m/s, or null
 * where it states none.
 */
export const parsePitLimitMs = (
  limit: string | null | undefined
): number | null => {
  const match = /^\s*([\d.]+)\s*(kph|km\/h|mph)?/i.exec(limit ?? '');
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return match[2]?.toLowerCase() === 'mph' ? value * 0.44704 : value / 3.6;
};

/**
 * Metres from the player to the pit exit line, or null when that cannot be
 * said: the exit has not been seen, or the player's lap fraction is not
 * inside the lane, as in a garage stall the sim places elsewhere.
 */
export const metresToPitExit = (
  input: Pick<
    RejoinInput,
    'playerPct' | 'pitEntryPct' | 'pitExitPct' | 'trackLengthM'
  >
): number | null => {
  const { pitExitPct, pitEntryPct, trackLengthM } = input;
  if (pitExitPct === null || !(trackLengthM > 0)) return null;
  const ahead = wrap01(pitExitPct - input.playerPct);
  const lane =
    pitEntryPct === null ? LONGEST_LANE : wrap01(pitExitPct - pitEntryPct);
  if (ahead > Math.min(LONGEST_LANE, lane + LANE_MARGIN)) return null;
  return ahead * trackLengthM;
};

const stateOf = (
  nearestBehindS: number | undefined,
  careGap: number,
  dangerGap: number
): RejoinState => {
  if (nearestBehindS === undefined) return 'clear';
  if (nearestBehindS < dangerGap) return 'danger';
  return nearestBehindS < careGap ? 'caution' : 'clear';
};

export const selectRejoinTraffic = (input: RejoinInput): RejoinTraffic => {
  const exitM =
    input.mode === 'exit' && input.inPitLane ? metresToPitExit(input) : null;

  if (exitM === null) {
    // How far behind each car is now: the car arriving behind a player who
    // is slow on the track, or just out of the lane.
    const behind = input.arriving
      .filter((car) => car.gapS <= input.behindWindow)
      .slice(0, input.mode === 'rejoin' ? 1 : input.behindCount)
      .map((car) => ({ carIdx: car.carIdx, offsetS: car.gapS }));
    return {
      mode: input.mode,
      atExit: false,
      toExitS: null,
      ahead: null,
      behind,
      state: stateOf(behind[0]?.offsetS, input.careGap, input.dangerGap),
    };
  }

  const limit = input.pitLimitMs ?? DEFAULT_PIT_LIMIT_MS;
  const rolling = input.playerSpeedMs >= ROLLING_MS;
  // Rolling, at the speed the car is doing; standing, at the limit from a
  // standing start, as if it left its box now.
  const toExitS = rolling
    ? exitM / input.playerSpeedMs
    : exitM / limit + LAUNCH_S;

  let ahead: RejoinRow | null = null;
  const behind: RejoinRow[] = [];
  for (const car of input.arriving) {
    if (!(car.speedMs > 0)) continue;
    const offsetS = round1(car.gapS + exitM / car.speedMs - toExitS);
    if (offsetS < 0) {
      if (
        offsetS >= -input.aheadWindow &&
        (!ahead || offsetS > ahead.offsetS)
      ) {
        ahead = { carIdx: car.carIdx, offsetS };
      }
    } else if (offsetS <= input.behindWindow) {
      behind.push({ carIdx: car.carIdx, offsetS });
    }
  }
  behind.sort((a, b) => a.offsetS - b.offsetS || a.carIdx - b.carIdx);
  behind.length = Math.min(behind.length, input.behindCount);

  return {
    mode: input.mode,
    atExit: true,
    toExitS: round1(toExitS),
    ahead,
    behind,
    state: stateOf(behind[0]?.offsetS, input.careGap, input.dangerGap),
  };
};
