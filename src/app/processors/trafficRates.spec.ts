import { describe, expect, it } from 'vitest';
import {
  ClosingAverages,
  INTERVAL_WINDOW_S,
  IntervalWindow,
  lapsToContact,
  meetsThisLap,
  wrapGaps,
} from './trafficRates';

/** Feeds a gap that changes by the same amount every second. */
const steady = (
  averages: ClosingAverages,
  from: number,
  closingPerSecond: number,
  seconds: number
): number => {
  let gap = from;
  for (let second = 0; second < seconds; second += 1) {
    averages.sample(gap);
    gap -= closingPerSecond;
  }
  return gap;
};

describe('the two gaps to a car', () => {
  it('wraps a car ahead and a car behind round a 90 s lap', () => {
    expect(wrapGaps(5, 90)).toEqual({ aheadS: 5, behindS: 85 });
    expect(wrapGaps(-3, 90)).toEqual({ aheadS: 87, behindS: 3 });
  });
});

describe('the closing averages', () => {
  it('read a steady rate from the first sample on', () => {
    const averages = new ClosingAverages();
    // Two readings make the first change.
    steady(averages, 30, 0.02, 2);
    expect(averages.samples).toBe(1);
    expect(averages.longRate).toBeCloseTo(0.02, 10);

    steady(averages, 30 - 2 * 0.02, 0.02, 59);
    expect(averages.samples).toBe(60);
    expect(averages.longRate).toBeCloseTo(0.02, 10);
    // Uncorrected, the long average would read 45 % of it by now, and
    // still short of it after two hundred samples.
    expect(0.02 * (1 - 0.99 ** 60)).toBeCloseTo(0.0091, 4);
    expect(0.02 * (1 - 0.99 ** 200)).toBeCloseTo(0.0173, 4);

    steady(averages, 30 - 61 * 0.02, 0.02, 140);
    expect(averages.samples).toBe(200);
    expect(averages.longRate).toBeCloseTo(0.02, 10);
    expect(averages.middleRate).toBeCloseTo(0.02, 10);
    expect(averages.shortRate).toBeCloseTo(0.02, 10);
  });

  it('leaves out a jump of 3 s or more, which is two cars swapping places', () => {
    const averages = new ClosingAverages();
    averages.sample(10);
    averages.sample(9.9);
    averages.sample(5.9);
    averages.sample(5.8);

    // The 4 s step is not a reading; the two either side of it are.
    expect(averages.samples).toBe(2);
    expect(averages.longRate).toBeCloseTo(0.1, 10);
  });

  it('scales a reading taken a little late to one second', () => {
    const averages = new ClosingAverages();
    averages.sample(10);
    averages.sample(9.76, 1.2);
    expect(averages.shortRate).toBeCloseTo(0.2, 10);
  });

  it('pulls the slower averages to the quicker one when a rate steps far', () => {
    const averages = new ClosingAverages();
    const gap = steady(averages, 100, 0, 121);
    expect(averages.longRate).toBeCloseTo(0, 10);

    // A step to 1.5 s a second. Five seconds on the short average is 0.27
    // from the middle one and nothing is pulled.
    steady(averages, gap, 1.5, 6);
    expect(averages.shortRate - averages.middleRate).toBeGreaterThan(0.25);
    expect(averages.shortRate - averages.middleRate).toBeLessThan(0.3);
    // A second later it is more than 0.3 from it: the middle one is set to
    // it, and the long one to the middle one.
    averages.sample(gap - 6 * 1.5);
    expect(averages.shortRate).toBeGreaterThan(0.45);
    expect(averages.middleRate).toBeCloseTo(averages.shortRate, 10);
    expect(averages.longRate).toBeCloseTo(averages.shortRate, 10);
  });

  it('does not pull for a step of 0.5: the averages never get 0.3 apart', () => {
    // The spec's own example. With weights of 0.065, 0.02 and 0.01 the
    // widest the short and middle averages come apart after a step of 0.5
    // is 0.21, so nothing is pulled and each catches up at its own pace.
    const averages = new ClosingAverages();
    let gap = steady(averages, 500, 0, 301);
    let widest = 0;
    for (let second = 0; second < 120; second += 1) {
      gap -= 0.5;
      averages.sample(gap);
      widest = Math.max(widest, averages.shortRate - averages.middleRate);
    }
    expect(widest).toBeGreaterThan(0.2);
    expect(widest).toBeLessThan(0.22);
    expect(averages.shortRate).toBeGreaterThan(0.49);
    expect(averages.middleRate).toBeLessThan(0.46);
    expect(averages.longRate).toBeLessThan(0.4);
  });

  it('starts again from nothing', () => {
    const averages = new ClosingAverages();
    steady(averages, 30, 0.1, 20);
    averages.restart();
    expect(averages.samples).toBe(0);
    expect(averages.longRate).toBe(0);
    // The next gap is a first reading, not a change from the last one.
    averages.sample(80);
    expect(averages.samples).toBe(0);
  });
});

describe('laps to contact', () => {
  it('is the gap over the closing rate over the lap time', () => {
    expect(lapsToContact(5, 0.05, 90, 50)).toBeCloseTo(1.11, 2);
    expect(lapsToContact(40, 0.5, 90, 50)).toBeCloseTo(0.89, 2);
  });

  it('is nothing for a gap that is opening, without a lap time, or 50 laps off', () => {
    expect(lapsToContact(5, -0.05, 90, 50)).toBeNull();
    expect(lapsToContact(5, 0, 90, 50)).toBeNull();
    expect(lapsToContact(5, 0.05, null, 50)).toBeNull();
    // 40 s at 0.005 s a second is 8,000 s: 89 laps.
    expect(lapsToContact(40, 0.005, 90, 50)).toBeNull();
  });

  it('falls inside the lap under way when no more of it is left', () => {
    expect(meetsThisLap(0.3, 0.6)).toBe(true);
    expect(meetsThisLap(0.3, 0.8)).toBe(false);
    expect(meetsThisLap(null, 0.1)).toBe(false);
  });
});

describe('the interval window', () => {
  const filled = (seconds: number, closing: (second: number) => number) => {
    const window = new IntervalWindow();
    let gap = 20;
    for (let second = 0; second <= seconds; second += 1) {
      window.push(100 + second, gap);
      gap -= closing(second);
    }
    return window;
  };

  it('reads the fall of the interval over its last seconds', () => {
    const window = filled(20, () => 0.2);
    expect(window.measuredS).toBe(20);
    expect(window.closingOver(20)).toBeCloseTo(0.2, 10);
    expect(window.closingOver(6)).toBeCloseTo(0.2, 10);
    // More than there is: all there is.
    expect(window.closingOver(60)).toBeCloseTo(0.2, 10);
  });

  it('tells the newer half from the older half', () => {
    // Closing at 0.3 s a second for ten seconds, then at 0.1.
    const window = filled(20, (second) => (second < 10 ? 0.3 : 0.1));
    expect(window.closingBetween(20, 10)).toBeCloseTo(0.3, 10);
    expect(window.closingBetween(10, 0)).toBeCloseTo(0.1, 10);
    expect(window.closingOver(20)).toBeCloseTo(0.2, 10);
  });

  it('keeps a minute and no more', () => {
    const window = filled(90, () => 0.1);
    expect(window.measuredS).toBe(INTERVAL_WINDOW_S);
    expect(window.closingOver(INTERVAL_WINDOW_S)).toBeCloseTo(0.1, 10);
  });

  it('starts again at a jump and at a clock that did not move', () => {
    const window = filled(10, () => 0.2);
    window.push(111, 14);
    expect(window.measuredS).toBe(0);
    window.push(112, 13.8);
    expect(window.measuredS).toBe(1);
    window.push(112, 13.6);
    expect(window.measuredS).toBe(0);
  });

  it('has no rate before two readings', () => {
    const window = new IntervalWindow();
    expect(window.closingOver(20)).toBe(0);
    window.push(1, 5);
    expect(window.measuredS).toBe(0);
    expect(window.closingOver(20)).toBe(0);
    window.clear();
    expect(window.measuredS).toBe(0);
  });
});
