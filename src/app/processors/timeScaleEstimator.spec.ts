import { describe, expect, it } from 'vitest';
import { createTimeScaleEstimator } from './timeScaleEstimator';

type Estimator = ReturnType<typeof createTimeScaleEstimator>;

/** Feeds both clocks every `step` seconds from `from` to `to`. */
const run = (
  estimator: Estimator,
  from: number,
  to: number,
  timeOfDayAt: (sessionTime: number) => number,
  step = 0.2
): (number | undefined)[] => {
  const seen: (number | undefined)[] = [];
  const steps = Math.round((to - from) / step);
  for (let index = 0; index <= steps; index += 1) {
    const sessionTime = from + index * step;
    seen.push(estimator.update(sessionTime, timeOfDayAt(sessionTime)));
  }
  return seen;
};

describe('createTimeScaleEstimator', () => {
  it('measures a day running twice as fast as the session clock', () => {
    const estimator = createTimeScaleEstimator();
    expect(estimator.update(0, 100)).toBeUndefined();
    expect(estimator.update(6, 112)).toBe(2);
    expect(estimator.value()).toBe(2);
    expect(estimator.lastRatio()).toBe(2);
  });

  it('measures a day running at the speed of the session clock', () => {
    const estimator = createTimeScaleEstimator();
    estimator.update(0, 100);
    expect(estimator.update(6, 106)).toBe(1);
  });

  it('says nothing before a window of five seconds has passed', () => {
    const estimator = createTimeScaleEstimator();
    const seen = run(estimator, 0, 5, (time) => 100 + time * 2);
    expect(seen.every((scale) => scale === undefined)).toBe(true);
    expect(estimator.lastRatio()).toBeUndefined();
    // The window began on the first reading that had moved, at 0.2 s, and
    // closes on the first one more than five seconds after it.
    expect(estimator.update(5.4, 110.8)).toBe(2);
  });

  it('carries on across midnight instead of reading a stopped clock', () => {
    const estimator = createTimeScaleEstimator();
    estimator.update(0, 86_395);
    expect(estimator.update(10, 5)).toBe(1);
  });

  it('keeps measuring through midnight in a scaled session', () => {
    const estimator = createTimeScaleEstimator();
    // Thirty times real time, starting two minutes before midnight.
    const seen = run(estimator, 0, 30, (time) => (86_280 + time * 30) % 86_400);
    const measured = seen.filter((scale) => scale !== undefined);
    expect(measured.length).toBeGreaterThan(0);
    expect(new Set(measured)).toEqual(new Set([30]));
  });

  it('reads a time of day that stands still as zero', () => {
    const estimator = createTimeScaleEstimator();
    estimator.update(0, 43_200);
    expect(estimator.update(5.2, 43_200)).toBe(0);
    // And goes on saying so, window after window.
    const seen = run(estimator, 5.4, 20, () => 43_200);
    expect(new Set(seen)).toEqual(new Set([0]));
  });

  it('reads a time of day that steps backwards as zero', () => {
    const estimator = createTimeScaleEstimator();
    estimator.update(0, 43_200);
    expect(estimator.update(6, 43_100)).toBe(0);
  });

  it('starts a new window when the session clock steps back, and keeps the last scale until it closes', () => {
    const estimator = createTimeScaleEstimator();
    estimator.update(100, 1_000);
    expect(estimator.update(106, 1_012)).toBe(2);
    // A restart: the clock is behind the reference.
    expect(estimator.update(0, 2_000)).toBe(2);
    expect(estimator.update(3, 2_000)).toBe(2);
    // The new window closes on the new session's own pace.
    expect(estimator.update(6, 2_006)).toBe(1);
  });

  it('gives no scale for an advance no sim offers', () => {
    const estimator = createTimeScaleEstimator();
    estimator.update(0, 100);
    expect(estimator.update(6, 112)).toBe(2);
    // 400 s of clock in 5.1 s is 78 times real time: a jump, not a scale.
    expect(estimator.update(11.1, 512)).toBeUndefined();
    expect(estimator.value()).toBeUndefined();
    // And the window after it measures again.
    expect(estimator.update(17.1, 524)).toBe(2);
  });

  it('accepts the fastest day a sim offers, and a hair over it as that', () => {
    const exact = createTimeScaleEstimator();
    exact.update(0, 0);
    expect(exact.update(6, 360)).toBe(60);

    // 60.6 a second: the fastest day, measured with one reading a little old.
    const over = createTimeScaleEstimator();
    over.update(0, 0);
    expect(over.update(6, 363.6)).toBe(60);
    expect(over.lastRatio()).toBeCloseTo(60.6, 6);

    const beyond = createTimeScaleEstimator();
    beyond.update(0, 0);
    expect(beyond.update(6, 372)).toBeUndefined();
  });

  it('forgets everything on reset', () => {
    const estimator = createTimeScaleEstimator();
    estimator.update(0, 100);
    estimator.update(6, 112);
    estimator.reset();
    expect(estimator.value()).toBeUndefined();
    expect(estimator.lastRatio()).toBeUndefined();
    expect(estimator.update(100, 5_000)).toBeUndefined();
    expect(estimator.update(106, 5_006)).toBe(1);
  });

  describe('with a time of day published less often than the session clock', () => {
    /**
     * Le Mans Ultimate's two clocks: the session clock read 64 times a
     * second, the time of day written five times a second and so up to a
     * fifth of a second old at any reading.
     */
    const steppedDay =
      (scale: number, phase = 0.07) =>
      (sessionTime: number) =>
        30_000 +
        (Math.floor((sessionTime - phase) / 0.2) * 0.2 + phase) * scale;

    it.each([1, 2, 15, 30, 45])(
      'reads %s times real time as that in every window',
      (scale) => {
        const estimator = createTimeScaleEstimator();
        const seen = run(estimator, 100, 400, steppedDay(scale), 1 / 64);
        const measured = new Set(seen.filter((value) => value !== undefined));
        expect(measured).toEqual(new Set([scale]));
      }
    );

    it('does not lose the fastest day to a reading taken a frame late', () => {
      const estimator = createTimeScaleEstimator();
      // Read 25 times a second, as a processor is, so that a move of the
      // time of day is seen up to 40 ms after it happened.
      const seen = run(estimator, 100, 700, steppedDay(60), 1 / 25);
      const measured = seen.filter((value) => value !== undefined);
      expect(measured.length).toBeGreaterThan(0);
      // Never blank, and never further out than one below.
      expect(measured.every((value) => value === 60 || value === 59)).toBe(
        true
      );
      expect(measured.filter((value) => value === 60).length).toBeGreaterThan(
        measured.length * 0.9
      );
    });
  });
});
