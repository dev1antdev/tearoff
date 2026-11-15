import { describe, expect, it } from 'vitest';
import type { ReferenceLap } from '@irdashies/types';
import {
  driveAtLimitS,
  lapFractionBetween,
  median,
  parsePitSpeedLimitMs,
  pitEntryFrom,
  pitExitFrom,
  pitLaneLengthM,
  PitSpeedLimitMeter,
  trackTimeBetweenS,
  withSpeedLimit,
  withStopSample,
  type LimiterSample,
  type LineCrossing,
} from './pitLaneModel';

/** A lap of 100 points driven at one speed, 90 s long. */
const evenLap = (lapTime = 90, pointsCount = 100): ReferenceLap => {
  const pointPos = new Float32Array(pointsCount);
  const times = new Float32Array(pointsCount);
  const tangents = new Float32Array(pointsCount);
  for (let index = 0; index < pointsCount; index += 1) {
    pointPos[index] = index / pointsCount;
    times[index] = (index / pointsCount) * lapTime;
    tangents[index] = lapTime;
  }
  return {
    pointPos,
    times,
    tangents,
    interval: 1 / pointsCount,
    pointsCount,
    startTime: 0,
    finishTime: lapTime,
    lastTrackedPct: 1,
    isCleanLap: true,
  };
};

describe('the pit lane model', () => {
  it('measures a lane that spans the start line', () => {
    const length = pitLaneLengthM(0.95, 0.03, 3590.4);
    expect(length).toBeCloseTo(287.2, 1);
    expect(driveAtLimitS(length, 16.667)).toBeCloseTo(17.2, 1);
  });

  it('measures a lane that does not', () => {
    expect(pitLaneLengthM(0.2, 0.3, 5000)).toBeCloseTo(500, 6);
    expect(lapFractionBetween(0.2, 0.3)).toBeCloseTo(0.1, 9);
    expect(lapFractionBetween(0.3, 0.2)).toBeCloseTo(0.9, 9);
  });

  it('gives nothing while a line, the track length or the limit is missing', () => {
    expect(pitLaneLengthM(null, 0.03, 3590.4)).toBeNull();
    expect(pitLaneLengthM(0.95, null, 3590.4)).toBeNull();
    expect(pitLaneLengthM(0.95, 0.03, 0)).toBeNull();
    expect(driveAtLimitS(null, 16.667)).toBeNull();
    expect(driveAtLimitS(287.2, null)).toBeNull();
    expect(driveAtLimitS(287.2, 0)).toBeNull();
  });

  it('takes the middle of what was measured', () => {
    expect(median([])).toBeNull();
    expect(median([24])).toBe(24);
    expect(median([31, 40, 33])).toBe(33);
    expect(median([22, 26, 24, 30])).toBe(25);
  });

  it('reads the session limit in either unit', () => {
    expect(parsePitSpeedLimitMs('60.00 kph')).toBeCloseTo(16.667, 3);
    expect(parsePitSpeedLimitMs('45 mph')).toBeCloseTo(20.117, 3);
    expect(parsePitSpeedLimitMs('')).toBeNull();
    expect(parsePitSpeedLimitMs(undefined)).toBeNull();
    expect(parsePitSpeedLimitMs('0 kph')).toBeNull();
  });
});

describe('what the lane costs on the racing line', () => {
  it("is the stretch's share of the lap at the pace, without a reference lap", () => {
    expect(trackTimeBetweenS(0.95, 0.03, 86.7, null)).toBeCloseTo(6.936, 3);
  });

  it('is read off the reference lap and scaled to the pace', () => {
    // A 90 s lap at one speed: 8 % of it is 7.2 s, and 86.7 / 90 of that at
    // the pace of the day.
    const seconds = trackTimeBetweenS(0.95, 0.03, 86.7, evenLap());
    expect(seconds).toBeCloseTo(7.2 * (86.7 / 90), 2);
  });

  it('reads a stretch that does not cross the line as it stands', () => {
    expect(trackTimeBetweenS(0.2, 0.5, 90, evenLap())).toBeCloseTo(27, 2);
  });

  it('gives nothing without a pace', () => {
    expect(trackTimeBetweenS(0.95, 0.03, null, evenLap())).toBeNull();
    expect(trackTimeBetweenS(0.95, 0.03, 0, null)).toBeNull();
  });
});

describe('reading the pit speed limit off the limiter', () => {
  const sample = (
    sessionTime: number,
    values: Partial<LimiterSample> = {}
  ): LimiterSample => ({
    sessionTime,
    onPitRoad: true,
    limiterOn: true,
    throttle: 1,
    brake: 0,
    speed: 16.6,
    ...values,
  });

  const feed = (
    values: Partial<LimiterSample>,
    count = 5
  ): (number | null)[] => {
    const meter = new PitSpeedLimitMeter();
    return Array.from({ length: count }, (_, index) =>
      meter.sample(sample(100 + index * 0.2, values))
    );
  };

  it('accepts five samples in a row held flat out on the limiter', () => {
    expect(feed({})).toEqual([null, null, null, null, 16.6]);
  });

  it.each([
    ['the brake is on', { brake: 0.05 }],
    ['the throttle is not flat', { throttle: 0.9 }],
    ['the limiter is off', { limiterOn: false }],
    ['the car is not on pit road', { onPitRoad: false }],
    ['the car is hardly moving', { speed: 0.5 }],
  ])('accepts nothing while %s', (_, values) => {
    expect(feed(values, 10)).toEqual(Array(10).fill(null));
  });

  it('starts again when the speed is still rising', () => {
    const meter = new PitSpeedLimitMeter();
    const speeds = [14, 15, 16, 16.5, 16.58, 16.6, 16.6, 16.6, 16.6];
    const results = speeds.map((speed, index) =>
      meter.sample(sample(100 + index * 0.2, { speed }))
    );
    // The run that counts opens at 16.5, the first sample the next one is
    // within a tenth of.
    expect(results).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      16.6,
      null,
    ]);
  });

  it('starts again after a gap in the samples', () => {
    const meter = new PitSpeedLimitMeter();
    const times = [100, 100.2, 100.4, 100.6, 103, 103.2, 103.4, 103.6, 103.8];
    const results = times.map((time) => meter.sample(sample(time)));
    expect(results.slice(0, 8)).toEqual(Array(8).fill(null));
    expect(results[8]).toBe(16.6);
  });

  it('takes no limit outside 8 to 40 m/s', () => {
    expect(feed({ speed: 5 })).toEqual(Array(5).fill(null));
    expect(feed({ speed: 45 })).toEqual(Array(5).fill(null));
  });
});

describe('learning where the two lines are', () => {
  const crossing = (values: Partial<LineCrossing>): LineCrossing => ({
    wasOnPitRoad: false,
    isOnPitRoad: true,
    wasInStall: false,
    previousPct: 0.948,
    currentPct: 0.952,
    ...values,
  });

  it('places the entry between the two frames either side of it', () => {
    expect(pitEntryFrom(crossing({}))).toBeCloseTo(0.95, 6);
  });

  it('does not take a car leaving its stall for an entry', () => {
    expect(pitEntryFrom(crossing({ wasInStall: true }))).toBeNull();
  });

  it('drops an entry seen only after the lap wrapped', () => {
    expect(
      pitEntryFrom(crossing({ previousPct: 0.01, currentPct: 0.02 }))
    ).toBeNull();
  });

  it('keeps the frame before the start line for an entry that straddles it', () => {
    expect(
      pitEntryFrom(crossing({ previousPct: 0.998, currentPct: 0.002 }))
    ).toBe(0.998);
  });

  it('places the exit the same way', () => {
    const leaving = { wasOnPitRoad: true, isOnPitRoad: false };
    expect(
      pitExitFrom(
        crossing({ ...leaving, previousPct: 0.028, currentPct: 0.032 })
      )
    ).toBeCloseTo(0.03, 6);
    expect(
      pitExitFrom(
        crossing({ ...leaving, previousPct: 0.999, currentPct: 0.003 })
      )
    ).toBe(0.003);
  });

  it('reads no line off a car that crossed neither', () => {
    expect(pitEntryFrom(crossing({ wasOnPitRoad: true }))).toBeNull();
    expect(pitExitFrom(crossing({}))).toBeNull();
    expect(pitEntryFrom(crossing({ currentPct: -1 }))).toBeNull();
  });
});

describe('keeping what a stop measured', () => {
  it('starts a track with its first stop', () => {
    expect(withStopSample(undefined, 'Ferrari 296', 24.04, 18.004)).toEqual({
      speedLimitMs: null,
      driveS: [24.04],
      standingS: { 'Ferrari 296': [18] },
    });
  });

  it('keeps the last five drive times and the last five stops of a car', () => {
    let timing = withStopSample(undefined, 'car', 20, 30);
    for (let stop = 1; stop <= 6; stop += 1) {
      timing = withStopSample(timing, 'car', 20 + stop, 30 + stop);
    }
    expect(timing.driveS).toEqual([22, 23, 24, 25, 26]);
    expect(timing.standingS.car).toEqual([32, 33, 34, 35, 36]);
  });

  it('keeps the twelve cars that stopped last', () => {
    let timing = withStopSample(undefined, 'car 0', 20, 30);
    for (let car = 1; car <= 12; car += 1) {
      timing = withStopSample(timing, `car ${car}`, 20, 30);
    }
    // The first car to stop is the one that goes; one that stops again
    // moves to the back of the queue.
    expect(Object.keys(timing.standingS)).toHaveLength(12);
    expect(timing.standingS['car 0']).toBeUndefined();
    timing = withStopSample(timing, 'car 1', 20, 31);
    timing = withStopSample(timing, 'car 13', 20, 30);
    expect(timing.standingS['car 1']).toEqual([30, 31]);
    expect(timing.standingS['car 2']).toBeUndefined();
  });

  it('leaves what it was given as it was', () => {
    const before = withStopSample(undefined, 'car', 20, 30);
    const after = withStopSample(before, 'car', 21, 31);
    expect(before.driveS).toEqual([20]);
    expect(after).not.toBe(before);
    expect(withSpeedLimit(before, 16.6)).toEqual({
      ...before,
      speedLimitMs: 16.6,
    });
    expect(before.speedLimitMs).toBeNull();
  });

  it('keeps a stop of a car it cannot name against the track only', () => {
    expect(withStopSample(undefined, null, 24, 18)).toEqual({
      speedLimitMs: null,
      driveS: [24],
      standingS: {},
    });
  });
});
