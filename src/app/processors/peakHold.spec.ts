import { describe, expect, it } from 'vitest';
import { PeakHold } from './peakHold';

describe('PeakHold without a runner-up', () => {
  it('holds the highest value offered', () => {
    const hold = new PeakHold(5);
    hold.offer(1.2, 0);
    hold.offer(2.0, 1);
    hold.offer(1.5, 2);

    expect(hold.peak).toBe(2.0);
    expect(hold.runnerUp).toBe(0);
  });

  it('keeps the peak for the length of the hold and no longer', () => {
    const hold = new PeakHold(5);
    hold.offer(2.0, 10);

    hold.expire(15);
    expect(hold.peak).toBe(2.0);

    hold.expire(15.01);
    expect(hold.peak).toBe(0);
  });

  it('restarts the hold with each new peak', () => {
    const hold = new PeakHold(5);
    hold.offer(1.0, 0);
    hold.offer(2.0, 4);

    hold.expire(8.9);
    expect(hold.peak).toBe(2.0);
    hold.expire(9.1);
    expect(hold.peak).toBe(0);
  });

  it('does not restart the hold for a value below the peak', () => {
    const hold = new PeakHold(5);
    hold.offer(2.0, 0);
    hold.offer(1.9, 4);

    hold.expire(5.1);
    expect(hold.peak).toBe(0);
  });

  it('builds again from the value offered after it expires', () => {
    const hold = new PeakHold(5);
    hold.offer(2.0, 0);

    hold.expire(6);
    hold.offer(1.0, 6);

    expect(hold.peak).toBe(1.0);
  });

  it('holds nothing at or below zero', () => {
    const hold = new PeakHold(5);
    hold.offer(0, 0);
    hold.offer(-3, 1);

    expect(hold.peak).toBe(0);
  });
});

describe('PeakHold with a runner-up', () => {
  it('makes the old peak the runner-up when it is beaten', () => {
    const hold = new PeakHold(60, true);
    hold.offer(1.6, 0);
    hold.offer(2.3, 10);

    expect(hold.peak).toBe(2.3);
    expect(hold.runnerUp).toBe(1.6);
  });

  it('takes a value between the two as the new runner-up', () => {
    const hold = new PeakHold(60, true);
    hold.offer(1.6, 0);
    hold.offer(2.3, 10);
    hold.offer(2.2, 20);

    expect(hold.peak).toBe(2.3);
    expect(hold.runnerUp).toBe(2.2);
  });

  it('leaves both alone for a value below the runner-up or equal to the peak', () => {
    const hold = new PeakHold(60, true);
    hold.offer(1.6, 0);
    hold.offer(2.3, 10);
    hold.offer(1.2, 20);
    hold.offer(2.3, 30);

    expect(hold.peak).toBe(2.3);
    expect(hold.runnerUp).toBe(1.6);
    // Neither restarted the clock: the peak falls sixty seconds after it
    // was set, not sixty after the last value offered.
    hold.expire(70.1);
    expect(hold.peak).toBe(1.6);
  });

  it('falls back to the runner-up, then to nothing', () => {
    const hold = new PeakHold(60, true);
    hold.offer(1.6, 0);
    hold.offer(2.3, 10);
    hold.offer(2.2, 20);

    // Sixty seconds from the runner-up, which restarted the clock.
    hold.expire(80);
    expect(hold.peak).toBe(2.3);
    hold.expire(80.5);
    expect(hold.peak).toBe(2.2);
    expect(hold.runnerUp).toBe(0);

    hold.expire(140);
    expect(hold.peak).toBe(2.2);
    hold.expire(141);
    expect(hold.peak).toBe(0);
  });

  it('restarts the hold when the clock goes back', () => {
    const hold = new PeakHold(60, true);
    hold.offer(2.0, 500);

    hold.expire(3);
    expect(hold.peak).toBe(2.0);
    hold.expire(62);
    expect(hold.peak).toBe(2.0);
    hold.expire(64);
    expect(hold.peak).toBe(0);
  });

  it('forgets everything on reset', () => {
    const hold = new PeakHold(60, true);
    hold.offer(1.6, 0);
    hold.offer(2.3, 10);

    hold.reset();

    expect(hold.peak).toBe(0);
    expect(hold.runnerUp).toBe(0);
  });
});
