import { describe, expect, it } from 'vitest';
import type { RaceStint } from '@irdashies/types';
import { stopUnderWay } from './raceStop';

const stint = (values: Partial<RaceStint>): RaceStint => ({
  carIdx: 0,
  ordinal: 1,
  driver: 'Driver 0',
  openedBy: 'start',
  closedBy: 'stop',
  firstLap: 1,
  lastLap: 20,
  startTime: 100,
  endTime: 2100,
  laps: 20,
  cleanLaps: 18,
  avgLap: 100,
  bestLap: 99,
  stop: { laneTime: null, standingTime: 12, driverChanged: false },
  ...values,
});

/** The stint a stop opens, as the recorder keeps it. */
const after = (values: Partial<RaceStint>): RaceStint =>
  stint({
    ordinal: 2,
    openedBy: 'stop',
    closedBy: null,
    firstLap: null,
    lastLap: null,
    endTime: null,
    laps: 0,
    cleanLaps: 0,
    avgLap: null,
    bestLap: null,
    stop: null,
    ...values,
  });

describe('stopUnderWay', () => {
  it('is while the stint the stop opened has not started later than the one it ended', () => {
    // In the lane: the next stint has the moment the stop began.
    expect(stopUnderWay(stint({}), after({ startTime: 2100 }))).toBe(true);
    // Out again: its start is the pit exit.
    expect(stopUnderWay(stint({}), after({ startTime: 2148 }))).toBe(false);
  });

  it('is over for a stop whose entry was not seen, once the car has left', () => {
    // Its lane time stays unknown for good. The car is out and has not a
    // lap yet, which a reader going by laps took for a car still in.
    const unseen = stint({
      stop: { laneTime: null, standingTime: 9, driverChanged: false },
    });
    expect(stopUnderWay(unseen, after({ startTime: 2130, laps: 0 }))).toBe(
      false
    );
    expect(stopUnderWay(unseen, after({ startTime: 2130, laps: 1 }))).toBe(
      false
    );
  });

  it('is still on for a car that completes a lap in the lane before it leaves', () => {
    expect(
      stopUnderWay(stint({}), after({ startTime: 2100, laps: 1, firstLap: 21 }))
    ).toBe(true);
  });

  it('is over once the lane has been timed, whatever follows', () => {
    const timed = stint({
      stop: { laneTime: 48, standingTime: 12, driverChanged: false },
    });
    expect(stopUnderWay(timed, after({ startTime: 2100 }))).toBe(false);
  });

  it('is not one for a stint that no stop ended, or with nothing after it', () => {
    expect(
      stopUnderWay(
        stint({ closedBy: 'garage', stop: null }),
        after({ openedBy: 'garage', startTime: 2100 })
      )
    ).toBe(false);
    expect(stopUnderWay(stint({}), undefined)).toBe(false);
    // The stint after it is itself over: that stop is long past.
    expect(
      stopUnderWay(
        stint({}),
        after({ startTime: 2100, closedBy: 'stop', endTime: 4000 })
      )
    ).toBe(false);
  });
});
