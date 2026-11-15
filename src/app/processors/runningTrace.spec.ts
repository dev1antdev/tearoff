import { describe, expect, it } from 'vitest';
import { RunningTrace } from './runningTrace';

describe('a car’s running against the clock', () => {
  it('says when the car was at a place, between the readings either side', () => {
    const trace = new RunningTrace();
    // A hundredth of a lap a second, read every second from 100 s.
    for (let second = 0; second <= 10; second += 1) {
      trace.push(100 + second, 2 + second * 0.01);
    }

    expect(trace.length).toBe(11);
    expect(trace.timeAt(2.05)).toBeCloseTo(105, 10);
    expect(trace.timeAt(2.055)).toBeCloseTo(105.5, 10);
    expect(trace.progressAt(107.25)).toBeCloseTo(2.0725, 10);
    expect(trace.firstTime).toBe(100);
    expect(trace.firstProgress).toBe(2);
  });

  it('answers nothing outside what is on record', () => {
    const trace = new RunningTrace();
    expect(trace.timeAt(1)).toBeNull();
    expect(Number.isNaN(trace.firstProgress)).toBe(true);
    trace.push(10, 1);
    // One reading is a place, not a stretch.
    expect(trace.timeAt(1)).toBeNull();
    trace.push(11, 1.01);

    expect(trace.timeAt(0.99)).toBeNull();
    expect(trace.timeAt(1.02)).toBeNull();
    expect(trace.progressAt(9)).toBeNull();
    expect(trace.progressAt(12)).toBeNull();
    expect(trace.timeAt(1.01)).toBeCloseTo(11, 10);
  });

  it('drops a reading that is not further on, so a stop is one long step', () => {
    const trace = new RunningTrace();
    trace.push(10, 1);
    trace.push(11, 1.01);
    // Standing for five seconds, and a roll backwards.
    trace.push(12, 1.01);
    trace.push(14, 1.005);
    trace.push(16, 1.01);
    trace.push(17, 1.02);

    expect(trace.length).toBe(3);
    // The stop lies between the two readings round it.
    expect(trace.timeAt(1.015)).toBeCloseTo(14, 10);
  });

  it('overwrites its oldest reading when it is full', () => {
    const trace = new RunningTrace(4);
    for (let second = 0; second < 6; second += 1) {
      trace.push(second, second * 0.1);
    }

    expect(trace.length).toBe(4);
    expect(trace.firstTime).toBe(2);
    expect(trace.timeAt(0.1)).toBeNull();
    expect(trace.timeAt(0.45)).toBeCloseTo(4.5, 10);
    expect(trace.progressAt(2.5)).toBeCloseTo(0.25, 10);

    trace.clear();
    expect(trace.length).toBe(0);
    expect(trace.timeAt(0.45)).toBeNull();
  });
});
