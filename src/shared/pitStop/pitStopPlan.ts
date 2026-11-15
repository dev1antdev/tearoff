import type { PitLaneModel, PitStopSnapshot } from '@irdashies/types';

/**
 * What a pit stop costs and where it puts the car, worked out from
 * `pit-stop.snapshot` and a reader's own settings.
 *
 * Not in the channel, because every figure here depends on a setting: the
 * extra time added to a stop, and which cars a position counts. The channel
 * carries what the sim and the track say; this is what is made of it. And
 * here, where both sides can reach it, because more than the widget has to
 * cost a stop the same way: a loss is always the time in the pits less what
 * the same stretch takes on the racing line.
 *
 * Everything is a projection. It assumes no rival stops in the meantime,
 * and under Le Mans Ultimate the race gaps between classes are approximate,
 * so a position counted over the whole field is rougher than one in class.
 */

/**
 * How close a car may rejoin before the position is called a close call:
 * with a lane that has been timed, and with one that is only reckoned.
 */
export const REJOIN_MARGIN_MEASURED_S = 2;
export const REJOIN_MARGIN_RECKONED_S = 4;

type Timer = PitStopSnapshot['timer'];
type Rejoin = NonNullable<PitStopSnapshot['rejoin']>;
type Estimate = PitStopSnapshot['estimate'];

/**
 * The time to drive the lane for a stop that stands this long.
 *
 * A stop that stands is driven as the player's own stops were: braking into
 * the box and pulling away. A visit with nothing to stand for, a
 * drive-through, is the lane at the limit.
 */
export const pitDriveTimeS = (
  lane: PitLaneModel,
  standingS: number | null
): number | null =>
  standingS !== null && standingS > 0
    ? (lane.driveMeasuredS ?? lane.driveAtLimitS)
    : lane.driveAtLimitS;

/** Whether that time was measured, or is only the lane length over a limit. */
export const isPitDriveMeasured = (
  lane: PitLaneModel,
  standingS: number | null
): boolean =>
  standingS !== null && standingS > 0 && lane.driveMeasuredS !== null;

/**
 * Line to line: the drive, the standing time, and the extra a stop that
 * stands is given for reactions and the crew. Null until the lane is known.
 */
export const timeInPitsS = (
  lane: PitLaneModel,
  standingS: number | null,
  extraTimeS: number
): number | null => {
  const drive = pitDriveTimeS(lane, standingS);
  if (drive === null) return null;
  const standing = standingS ?? 0;
  return drive + standing + (standing > 0 ? extraTimeS : 0);
};

/**
 * What the visit costs against staying out: the time in the pits less what
 * the same stretch takes on the racing line. Never below zero; null without
 * a lane or a pace.
 */
export const pitLossS = (
  lane: PitLaneModel,
  standingS: number | null,
  extraTimeS: number
): number | null => {
  const inPits = timeInPitsS(lane, standingS, extraTimeS);
  if (inPits === null || lane.trackTimeS === null) return null;
  return Math.max(0, inPits - lane.trackTimeS);
};

export interface RejoinCar {
  carIdx: number;
  /** Seconds between the two cars after the stop; never negative. */
  gapS: number;
}

export interface RejoinProjection {
  /** In the scope asked for: in class, or overall. */
  positionNow: number;
  positionAfter: number;
  /** The car that will be ahead on rejoining, and by how much. */
  ahead: RejoinCar | null;
  /** The car that will be behind, and by how much. */
  behind: RejoinCar | null;
  /**
   * Cars close enough to get past that are in the pits themselves now.
   * They are not counted: where they come out is not known.
   */
  inPits: number;
  /** A car rejoins within the margin: the position could go either way. */
  closeCall: boolean;
}

/**
 * Where the car rejoins after losing `lossS`.
 *
 * Every car behind that is closer than the loss gets past, in the scope
 * asked for. Cars in the pits now are counted apart. Null outside a race,
 * where there are no race gaps to measure against, and without a loss.
 */
export const projectRejoin = (
  rejoin: Rejoin | null,
  lossS: number | null,
  scope: 'class' | 'overall',
  marginS = REJOIN_MARGIN_MEASURED_S
): RejoinProjection | null => {
  if (!rejoin || lossS === null || rejoin.ladder.length === 0) return null;
  const positionNow =
    scope === 'class' ? rejoin.classPosition : rejoin.position;
  if (!(positionNow > 0)) return null;

  let passed = 0;
  let inPits = 0;
  let nearestAhead: RejoinCar | null = null;
  let ahead: RejoinCar | null = null;
  let behind: RejoinCar | null = null;
  // The ladder runs by gap, so the last car ahead seen is the nearest, the
  // last car passed is the one that ends up ahead, and the first not passed
  // is the one behind.
  for (const rival of rejoin.ladder) {
    if (scope === 'class' && !rival.sameClass) continue;
    if (rival.gapS < 0) {
      nearestAhead = { carIdx: rival.carIdx, gapS: lossS - rival.gapS };
      continue;
    }
    if (rival.inPit) {
      if (rival.gapS < lossS) inPits += 1;
      continue;
    }
    if (rival.gapS < lossS) {
      passed += 1;
      ahead = { carIdx: rival.carIdx, gapS: lossS - rival.gapS };
    } else if (behind === null) {
      behind = { carIdx: rival.carIdx, gapS: rival.gapS - lossS };
    }
  }
  ahead ??= nearestAhead;
  return {
    positionNow,
    positionAfter: positionNow + passed,
    ahead,
    behind,
    inPits,
    closeCall:
      (passed > 0 && ahead !== null && ahead.gapS < marginS) ||
      (behind !== null && behind.gapS < marginS),
  };
};

/** Seconds at rest on this visit so far, the stretch under way included. */
export const standingSoFarS = (timer: Timer, sessionTime: number): number =>
  timer.standingS +
  (timer.stoppedAt === null ? 0 : Math.max(0, sessionTime - timer.stoppedAt));

/**
 * Seconds of the planned standing time still to go; negative once the stop
 * has overrun. Null without a plan to count against.
 */
export const standingToGoS = (
  snapshot: PitStopSnapshot,
  sessionTime: number
): number | null => {
  const planned = snapshot.planned?.standingS ?? null;
  if (planned === null) return null;
  return planned - standingSoFarS(snapshot.timer, sessionTime);
};

/** Seconds since the entry line, held at the exit; null without an anchor. */
export const laneTimerS = (timer: Timer, sessionTime: number): number | null =>
  timer.enteredAt === null
    ? null
    : Math.max(0, (timer.exitedAt ?? sessionTime) - timer.enteredAt);

/**
 * What a visit under way still costs against staying out, for the rejoin to
 * keep counting against: the standing still to do, and the lane still to
 * drive less what that much of it takes on the racing line.
 */
export const remainingPitLossS = (
  snapshot: PitStopSnapshot,
  sessionTime: number,
  extraTimeS: number
): number | null => {
  const { lane, rejoin, timer } = snapshot;
  const toExit = rejoin?.driveToExitS ?? null;
  if (toExit === null || lane.trackTimeS === null) return null;
  const toGo = standingToGoS(snapshot, sessionTime);
  // The extra is for a stop that has not begun: once the car is at rest
  // what it adds is in the time already stood.
  const stood = standingSoFarS(timer, sessionTime) > 0;
  const standing =
    toGo === null
      ? 0
      : Math.max(0, toGo) + (toGo > 0 && !stood ? extraTimeS : 0);
  const share =
    lane.driveAtLimitS !== null && lane.driveAtLimitS > 0
      ? Math.min(Math.max(toExit / lane.driveAtLimitS, 0), 1)
      : 0;
  return Math.max(0, standing + toExit - lane.trackTimeS * share);
};

/**
 * The standing time the plan is made with: none for a drive-through to
 * serve, the estimate otherwise.
 */
export const plannedStandingS = (estimate: Estimate): number | null =>
  estimate.penalty === 'DT' ? 0 : estimate.standingS;
