import type { RaceStint } from '@irdashies/types';

/**
 * Whether the stop that ended `stint` is still under way: the car has not
 * left the pit lane.
 *
 * A stop's `laneTime` cannot say. It is null while the car is in the lane,
 * and null for good where the car was not seen to drive in, so that the
 * visit could not be timed. What does say is the stint the stop opened:
 * it is given the moment the stop began as its start, the same moment the
 * stint before it ended at, and that start is moved to the pit exit when
 * the car leaves. So the stop is under way exactly while the stint after it
 * has not started later than the one it ended.
 *
 * @param next The car's stint after `stint`, where there is one. With none
 *   held (the app was started with the car already gone from its stop) the
 *   stop is not taken to be under way.
 */
export const stopUnderWay = (
  stint: Pick<RaceStint, 'closedBy' | 'endTime' | 'stop'>,
  next: Pick<RaceStint, 'closedBy' | 'startTime'> | undefined
): boolean =>
  stint.closedBy === 'stop' &&
  stint.stop !== null &&
  stint.stop.laneTime === null &&
  stint.endTime !== null &&
  next !== undefined &&
  next.closedBy === null &&
  next.startTime <= stint.endTime;
