import type { RaceLap, RaceStint } from '@irdashies/types';

/**
 * A lap and a stint of the race history written out by hand, for the specs
 * of what is read from them: everything a spec does not name is the plain
 * case, a clean lap of 100 s on mediums and a stint nobody has ended.
 */

export const lapOf = (lap: number, values: Partial<RaceLap> = {}): RaceLap => ({
  carIdx: 0,
  lap,
  sessionTime: 200 + lap * 100,
  lapTime: 100,
  sectors: [30, 40, 30],
  position: 1,
  classPosition: 1,
  classGap: 0,
  flags: 0,
  driver: 'Ada',
  energy: null,
  energyIsVirtual: false,
  compounds: [1, 1, 1, 1],
  ...values,
});

export const stintOf = (
  ordinal: number,
  values: Partial<RaceStint> = {}
): RaceStint => ({
  carIdx: 0,
  ordinal,
  driver: 'Ada',
  openedBy: ordinal === 1 ? 'start' : 'stop',
  closedBy: null,
  firstLap: null,
  lastLap: null,
  startTime: 200,
  endTime: null,
  laps: 0,
  cleanLaps: 0,
  avgLap: null,
  bestLap: null,
  stop: null,
  ...values,
});

/** A stint a stop ended, over a run of laps. */
export const stoppedStint = (
  ordinal: number,
  firstLap: number,
  lastLap: number,
  values: Partial<RaceStint> = {}
): RaceStint =>
  stintOf(ordinal, {
    closedBy: 'stop',
    firstLap,
    lastLap,
    laps: lastLap - firstLap + 1,
    stop: { laneTime: 60, standingTime: 40, driverChanged: false },
    ...values,
  });
