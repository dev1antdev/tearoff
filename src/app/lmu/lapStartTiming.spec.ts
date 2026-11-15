import { describe, expect, it } from 'vitest';
import {
  createLmuLapStartState,
  lmuLastLapTimes,
  observeLmuLapStarts,
  resetLmuLapStartState,
} from './lapStartTiming';

const observe = (
  state: ReturnType<typeof createLmuLapStartState>,
  lapStartETs: number[],
  lapDistPcts = lapStartETs.map(() => 0.5),
  estimatedLapTimes?: number[]
) =>
  observeLmuLapStarts(state, { lapStartETs, lapDistPcts, estimatedLapTimes });

describe('lap times from lap starts', () => {
  it('times a lap from the start of it to the start of the next', () => {
    const state = createLmuLapStartState();
    observe(state, [100, 103.5]);
    observe(state, [100, 103.5]);
    expect(state.measured).toEqual([-1, -1]);

    observe(state, [191.25, 103.5]);
    expect(state.measured[0]).toBeCloseTo(91.25, 9);
    expect(state.measured[1]).toBe(-1);

    observe(state, [191.25, 196.1]);
    expect(state.measured[1]).toBeCloseTo(92.6, 9);
  });

  it('gives the sim’s time where it has one and the measured lap where it has not', () => {
    // Car 0's lap counted and car 1's did not: a track limit. Both crossed
    // the line; only one has a time from the sim.
    const state = createLmuLapStartState();
    observe(state, [100, 101]);
    observe(state, [190, 193.4]);
    expect(lmuLastLapTimes(state, [89.912, -1])).toEqual([89.912, 92.4]);
    // A zero is no time either.
    expect(lmuLastLapTimes(state, [89.912, 0])[1]).toBeCloseTo(92.4, 9);
  });

  it('has no time for a lap it did not see start', () => {
    const state = createLmuLapStartState();
    observe(state, [500]);
    expect(lmuLastLapTimes(state, [-1])).toEqual([-1]);
  });

  it('does not measure across a session that started again', () => {
    const state = createLmuLapStartState();
    observe(state, [3000]);
    observe(state, [12]);
    expect(state.measured[0]).toBe(-1);
    observe(state, [101]);
    expect(state.measured[0]).toBeCloseTo(89, 9);
  });

  it('takes no lap from a start time that only jitters', () => {
    const state = createLmuLapStartState();
    observe(state, [100]);
    observe(state, [100.004]);
    expect(state.measured[0]).toBe(-1);
    observe(state, [190]);
    expect(state.measured[0]).toBeCloseTo(90, 9);
  });

  it('does not call a spell in the garage a lap', () => {
    // Twenty minutes between two starts, against a lap of ninety seconds.
    const state = createLmuLapStartState();
    observe(state, [100], [0.5], [90]);
    observe(state, [1300], [0.5], [90]);
    expect(state.measured[0]).toBe(-1);
    // The lap after it is one again.
    observe(state, [1392], [0.5], [90]);
    expect(state.measured[0]).toBeCloseTo(92, 9);
  });

  it('forgets a car whose slot has emptied', () => {
    const state = createLmuLapStartState();
    observe(state, [100, 100]);
    observe(state, [190, 190]);
    observe(state, [190, 190], [0.5, -1]);
    expect(state.measured).toEqual([90, -1]);
    // Whoever takes the slot next starts from nothing.
    observe(state, [190, 400], [0.5, 0.2]);
    expect(state.measured[1]).toBe(-1);
  });

  it('holds nothing over a reset, and needs no state to pass times through', () => {
    const state = createLmuLapStartState();
    observe(state, [100]);
    observe(state, [190]);
    resetLmuLapStartState(state);
    expect(lmuLastLapTimes(state, [-1])).toEqual([-1]);
    expect(lmuLastLapTimes(undefined, [88.1, -1, 0])).toEqual([88.1, -1, -1]);
    expect(lmuLastLapTimes(undefined, undefined)).toEqual([]);
  });
});
