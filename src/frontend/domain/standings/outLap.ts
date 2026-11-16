/** What the out-lap rule reads of a car's row in the standings. */
export interface OutLapInput {
  onPitRoad?: boolean;
  /** The lap the car was on when it was last on pit road. */
  lastPitLap?: number;
  /** The lap the car is on now. */
  lastLap?: number;
  /**
   * The pit exit is in the last 15 % of the lap, so the line comes very
   * shortly after it: the lap the car leaves on is then counted one further.
   */
  pitExitAfterSF?: boolean;
  /** The car's track surface; -1 is a car that is not in the world. */
  carTrackSurface?: number;
}

/**
 * Whether a car is on the lap it left the pit lane on: out of the lane, in
 * the world, and still on the lap it was on when it was last in the lane.
 *
 * One rule for the standings' OUT badge and for any other table that marks
 * an out-lap, so that no two of them disagree about which lap that is.
 */
export const isOnOutLap = ({
  onPitRoad,
  lastPitLap,
  lastLap,
  pitExitAfterSF,
  carTrackSurface,
}: OutLapInput): boolean =>
  !onPitRoad &&
  !!lastPitLap &&
  (lastPitLap === lastLap ||
    (!!pitExitAfterSF && lastPitLap + 1 === lastLap)) &&
  carTrackSurface !== -1;
