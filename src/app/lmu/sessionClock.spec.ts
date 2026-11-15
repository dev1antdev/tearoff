import { describe, expect, it } from 'vitest';
import {
  createLmuSessionClockState,
  lmuClockReading,
  lmuRaceGreenTime,
  lmuSessionClock,
  resetLmuSessionClockState,
} from './sessionClock';

describe('lmuClockReading', () => {
  it('reads the player’s own clock where there is one', () => {
    expect(
      lmuClockReading({
        elapsedTime: 320.153,
        vehElapsedTime: [320.15, 320.141],
        currentET: 320,
      })
    ).toBe(320.153);
  });

  it('reads the latest of the other cars’ clocks with no player car', () => {
    expect(
      lmuClockReading({
        vehElapsedTime: [0, 320.141, 320.15, 319.9],
        vehTelemetryAvailable: [0, 1, 1, 1],
        currentET: 320,
      })
    ).toBe(320.15);
  });

  it('leaves out a slot with no telemetry block, whatever it holds', () => {
    expect(
      lmuClockReading({
        vehElapsedTime: [999, 320.141],
        vehTelemetryAvailable: [0, 1],
        currentET: 320,
      })
    ).toBe(320.141);
  });

  it('falls back to scoring with no telemetry on the grid at all', () => {
    expect(
      lmuClockReading({
        vehElapsedTime: [0, 0, 0],
        vehTelemetryAvailable: [0, 0, 0],
        currentET: 320,
      })
    ).toBe(320);
    expect(lmuClockReading({ currentET: 12.4 })).toBe(12.4);
  });

  it('does not take a negative player clock for a reading', () => {
    expect(lmuClockReading({ elapsedTime: -1, currentET: 5 })).toBe(5);
  });
});

describe('lmuSessionClock', () => {
  it('runs on with the player in the car', () => {
    const state = createLmuSessionClockState();
    expect(lmuSessionClock(state, { elapsedTime: 100, currentET: 99.9 })).toBe(
      100
    );
    expect(
      lmuSessionClock(state, { elapsedTime: 100.01, currentET: 100 })
    ).toBe(100.01);
  });

  it('does not step back when the player leaves the car', () => {
    // The moment recorded at the monitor: the player's clock at 320.153, and
    // scoring, which is all that is left without the other cars, at 320.0.
    const state = createLmuSessionClockState();
    lmuSessionClock(state, { elapsedTime: 320.153, currentET: 320 });
    expect(lmuSessionClock(state, { currentET: 320 })).toBe(320.153);
    expect(lmuSessionClock(state, { currentET: 320 })).toBe(320.153);
    // Scoring catches up and the clock runs again.
    expect(lmuSessionClock(state, { currentET: 320.2 })).toBe(320.2);
  });

  it('carries straight on from the other cars’ clocks', () => {
    const state = createLmuSessionClockState();
    lmuSessionClock(state, { elapsedTime: 320.153, currentET: 320 });
    // A few milliseconds behind the player's, then past it a frame later.
    expect(
      lmuSessionClock(state, { vehElapsedTime: [0, 320.148], currentET: 320 })
    ).toBe(320.153);
    expect(
      lmuSessionClock(state, { vehElapsedTime: [0, 320.158], currentET: 320 })
    ).toBe(320.158);
  });

  it('does not step back when the player gets back in', () => {
    const state = createLmuSessionClockState();
    lmuSessionClock(state, { vehElapsedTime: [0, 500.02], currentET: 500 });
    expect(
      lmuSessionClock(state, { elapsedTime: 500.015, currentET: 500 })
    ).toBe(500.02);
    expect(
      lmuSessionClock(state, { elapsedTime: 500.025, currentET: 500 })
    ).toBe(500.025);
  });

  it('starts again with a new session', () => {
    const state = createLmuSessionClockState();
    lmuSessionClock(state, { elapsedTime: 3500, currentET: 3499.9 });
    expect(lmuSessionClock(state, { elapsedTime: 1.2, currentET: 1.1 })).toBe(
      1.2
    );
    expect(lmuSessionClock(state, { elapsedTime: 1.21, currentET: 1.2 })).toBe(
      1.21
    );
  });

  it('holds nothing over a reset', () => {
    const state = createLmuSessionClockState();
    lmuSessionClock(state, { elapsedTime: 100, currentET: 100 });
    resetLmuSessionClockState(state);
    expect(lmuSessionClock(state, { elapsedTime: 99.5, currentET: 99.4 })).toBe(
      99.5
    );
  });
});

describe('lmuRaceGreenTime', () => {
  const race = (gamePhase: number) => ({ isRace: true, gamePhase });

  it('is the moment a race seen from the grid goes green', () => {
    const state = createLmuSessionClockState();
    expect(lmuRaceGreenTime(state, race(2), 10)).toBeNull();
    expect(lmuRaceGreenTime(state, race(4), 120)).toBeNull();
    expect(lmuRaceGreenTime(state, race(5), 135.2)).toBe(135.2);
    // And stays that moment through the race, cautions included.
    expect(lmuRaceGreenTime(state, race(6), 900)).toBe(135.2);
    expect(lmuRaceGreenTime(state, race(5), 1500)).toBe(135.2);
  });

  it('is unknown in a race joined after its start', () => {
    const state = createLmuSessionClockState();
    expect(lmuRaceGreenTime(state, race(5), 600)).toBeNull();
    expect(lmuRaceGreenTime(state, race(5), 601)).toBeNull();
  });

  it('is nothing outside a race, and forgotten on the way out of one', () => {
    const state = createLmuSessionClockState();
    lmuRaceGreenTime(state, race(4), 100);
    lmuRaceGreenTime(state, race(5), 130);
    expect(
      lmuRaceGreenTime(state, { isRace: false, gamePhase: 5 }, 200)
    ).toBeNull();
    expect(lmuRaceGreenTime(state, race(5), 300)).toBeNull();
  });

  it('does not carry one race’s start into the next', () => {
    const state = createLmuSessionClockState();
    lmuSessionClock(state, { elapsedTime: 100, currentET: 100 });
    lmuRaceGreenTime(state, race(4), 100);
    lmuSessionClock(state, { elapsedTime: 130, currentET: 130 });
    lmuRaceGreenTime(state, race(5), 130);
    // The server starts the race again: the clock is back near zero.
    const clock = lmuSessionClock(state, { elapsedTime: 2, currentET: 2 });
    expect(lmuRaceGreenTime(state, race(5), clock)).toBeNull();
  });
});
