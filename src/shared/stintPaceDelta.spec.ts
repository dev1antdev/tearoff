import { describe, expect, it } from 'vitest';
import {
  carStintPaceDelta,
  STINT_PACE_MIN_CLEAN_LAPS,
  stintPaceDelta,
  type StintPaceSummary,
} from './stintPaceDelta';

describe('stintPaceDelta', () => {
  it('is this stint less the one it is held against: negative is quicker', () => {
    expect(stintPaceDelta(113.9, 5, 114.28)).toBeCloseTo(-0.38, 9);
    expect(stintPaceDelta(114.7, 5, 114.28)).toBeCloseTo(0.42, 9);
    expect(stintPaceDelta(114.28, 5, 114.28)).toBe(0);
  });

  it('waits for three clean laps in the stint, and takes no fewer', () => {
    expect(STINT_PACE_MIN_CLEAN_LAPS).toBe(3);
    expect(stintPaceDelta(113.9, 0, 114.28)).toBeNull();
    expect(stintPaceDelta(113.9, 1, 114.28)).toBeNull();
    expect(stintPaceDelta(113.9, 2, 114.28)).toBeNull();
    expect(stintPaceDelta(113.9, 3, 114.28)).toBeCloseTo(-0.38, 9);
    expect(stintPaceDelta(113.9, 31, 114.28)).toBeCloseTo(-0.38, 9);
  });

  it('has nothing to say without an earlier stint that has a pace', () => {
    // -1 is how the summary writes "none".
    expect(stintPaceDelta(113.9, 8, -1)).toBeNull();
    expect(stintPaceDelta(113.9, 8, 0)).toBeNull();
    expect(stintPaceDelta(113.9, 8, undefined)).toBeNull();
    expect(stintPaceDelta(113.9, 8, Number.NaN)).toBeNull();
  });

  it('has nothing to say while the stint itself has no pace', () => {
    expect(stintPaceDelta(-1, 0, 114.28)).toBeNull();
    expect(stintPaceDelta(undefined, 4, 114.28)).toBeNull();
    // A count with no mean beside it is not a pace either.
    expect(stintPaceDelta(-1, 4, 114.28)).toBeNull();
    expect(stintPaceDelta(113.9, undefined, 114.28)).toBeNull();
    expect(stintPaceDelta(113.9, Number.NaN, 114.28)).toBeNull();
  });
});

describe('carStintPaceDelta', () => {
  /**
   * Car 0 is in its third stint, the second half of a double stint: the
   * stint before was its own, the one before that a team-mate's.
   * Car 1 has stopped once and has two clean laps since.
   * Car 2 has not stopped.
   */
  const summary: StintPaceSummary = {
    stintAvgLap: [114.0, 115.1, 113.2],
    stintCleanLaps: [6, 2, 14],
    previousStintAvgLap: [114.5, 115.0, -1],
    previousDriverStintAvgLap: [113.6, -1, -1],
  };

  it('holds the stint against the one before it', () => {
    expect(carStintPaceDelta(summary, 0, 'stint')).toBeCloseTo(-0.5, 9);
  });

  it('holds it against the last stint by another driver when asked to', () => {
    // Quicker than their own first half, slower than the driver before.
    expect(carStintPaceDelta(summary, 0, 'driver')).toBeCloseTo(0.4, 9);
  });

  it('gives nothing for a car short of three clean laps since its stop', () => {
    expect(carStintPaceDelta(summary, 1, 'stint')).toBeNull();
  });

  it('gives nothing where nobody else has driven the car', () => {
    expect(carStintPaceDelta(summary, 1, 'driver')).toBeNull();
    expect(carStintPaceDelta(summary, 2, 'driver')).toBeNull();
  });

  it('gives nothing for a car that has not stopped', () => {
    expect(carStintPaceDelta(summary, 2, 'stint')).toBeNull();
  });

  it('gives nothing for a car the summary does not hold, and with no summary', () => {
    expect(carStintPaceDelta(summary, 7, 'stint')).toBeNull();
    expect(carStintPaceDelta(summary, -1, 'driver')).toBeNull();
    expect(carStintPaceDelta(undefined, 0, 'stint')).toBeNull();
  });
});
