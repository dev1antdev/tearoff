import { describe, expect, it, vi } from 'vitest';

import {
  FuelProjectionEngine,
  type FuelEngineFrame,
} from './FuelProjectionEngine';

const greenFlag = 0x80000000;
const frame = (overrides: Partial<FuelEngineFrame> = {}): FuelEngineFrame => ({
  fuelLevel: 50,
  lap: 1,
  lapDistPct: 0.1,
  onPitRoad: false,
  playerCarTowTime: 0,
  sessionFlags: greenFlag,
  sessionNum: 0,
  sessionTime: 10,
  ...overrides,
});

const createEngine = (now = 1234) =>
  new FuelProjectionEngine({ now: () => now }, { debug: vi.fn() });

const history = { getRecentLaps: () => [] };
const validLap = () => true;
const isGreen = (flags: number) => flags === greenFlag;

/**
 * An engine that has watched the car come up to the line and cross it onto
 * lap 1 at ten seconds, with 50 aboard. A lap is only recorded when it was
 * seen from the line, so this is where a spec about a lap starts.
 */
const engineFromTheLine = (now = 1234) => {
  const engine = createEngine(now);
  for (const each of [
    frame({ lap: 0, lapDistPct: 0.98, sessionTime: 9 }),
    frame({ lapDistPct: 0.01 }),
  ]) {
    engine.onFrame(each, history, validLap, isGreen, { persistLaps: false });
  }
  return engine;
};

describe('FuelProjectionEngine', () => {
  it('emits deterministic commands at a lap crossing', () => {
    const engine = engineFromTheLine();

    const commands = engine.onFrame(
      frame({ fuelLevel: 47, lap: 2, lapDistPct: 0.01, sessionTime: 100 }),
      history,
      validLap,
      isGreen,
      { persistLaps: true }
    );

    expect(commands).toEqual([
      {
        type: 'lapCompleted',
        lap: {
          lapNumber: 1,
          fuelUsed: 3,
          lapTime: 90,
          isGreenFlag: true,
          isValidForCalc: true,
          isOutLap: false,
          isInLap: false,
          wasTowed: false,
          timestamp: 1234,
          sessionNum: 0,
        },
      },
      {
        type: 'saveLap',
        lap: expect.objectContaining({ lapNumber: 1, timestamp: 1234 }),
      },
    ]);
  });

  it('keeps storage outside the engine', () => {
    const engine = engineFromTheLine();
    const commands = engine.onFrame(
      frame({ fuelLevel: 47, lap: 2, sessionTime: 100 }),
      history,
      validLap,
      isGreen,
      { persistLaps: false }
    );

    expect(commands.map(({ type }) => type)).toEqual(['lapCompleted']);
  });

  it('does not leak adapter state into snapshots', () => {
    const engine = new FuelProjectionEngine(
      { now: () => 1234 },
      { debug: vi.fn() },
      {
        lastLap: 2,
        lapHistory: new Map(),
      } as Partial<import('./FuelProjectionEngine').FuelEngineState> & {
        lapHistory: Map<never, never>;
      }
    );

    expect(engine.snapshot()).toEqual({
      accumulatedRefuel: 0,
      isLapDistPctReset: false,
      lapCrossingTime: 0,
      lapStartFuel: 0,
      lastLap: 2,
      lastLapDistPct: 0,
      lastSessionFlags: 0,
      wasOnPitRoad: false,
    });
    expect(engine.snapshot()).not.toHaveProperty('lapHistory');
  });

  it('accounts for refuelling without producing negative consumption', () => {
    const engine = engineFromTheLine();
    engine.onFrame(
      frame({ fuelLevel: 48, lapDistPct: 0.5, sessionTime: 50 }),
      history,
      validLap,
      isGreen,
      { persistLaps: false }
    );
    engine.onFrame(
      frame({ fuelLevel: 53, lapDistPct: 0.6, sessionTime: 60 }),
      history,
      validLap,
      isGreen,
      { persistLaps: false }
    );
    const commands = engine.onFrame(
      frame({ fuelLevel: 50, lap: 2, lapDistPct: 0.01, sessionTime: 100 }),
      history,
      validLap,
      isGreen,
      { persistLaps: false }
    );

    expect(commands[0]).toMatchObject({
      type: 'lapCompleted',
      lap: { fuelUsed: 5 },
    });
  });

  it('produces identical projections for identical inputs', () => {
    const input = {
      avgConsumption: 3,
      currentFuel: 48.5,
      currentLapUsage: 1.5,
      lap: 2,
      lapDistPct: 0.5,
      lapStartFuel: 50,
      lastLapUsage: 3.1,
      qualifyConsumption: null,
    };
    const first = createEngine();
    const second = createEngine();

    expect([first.project(input), first.project(input)]).toEqual([
      second.project(input),
      second.project(input),
    ]);
  });
});

describe('FuelProjectionEngine lap validity', () => {
  it('ignores a crossing too fast to be a real lap', () => {
    // A stutter or a reset can move lapDistPct past the line without a lap
    // having been driven. Counting it would poison the consumption average
    // with a fraction of a lap's fuel.
    const engine = engineFromTheLine();
    engine.onFrame(
      frame({ lapDistPct: 0.95, sessionTime: 11 }),
      history,
      validLap,
      isGreen,
      { persistLaps: true }
    );

    const commands = engine.onFrame(
      frame({ fuelLevel: 49.9, lap: 1, lapDistPct: 0.01, sessionTime: 12 }),
      history,
      validLap,
      isGreen,
      { persistLaps: true }
    );

    expect(commands.some((c) => c.type === 'lapCompleted')).toBe(false);
    // Nor does it start the lap again: the one under way is still measured
    // from the line it was seen to cross.
    expect(engine.snapshot().lapCrossingTime).toBe(10);
  });

  it('accepts a crossing that took a plausible lap time', () => {
    const engine = engineFromTheLine();
    engine.onFrame(
      frame({ lapDistPct: 0.95, sessionTime: 95 }),
      history,
      validLap,
      isGreen,
      { persistLaps: true }
    );

    const commands = engine.onFrame(
      frame({ fuelLevel: 47, lap: 2, lapDistPct: 0.01, sessionTime: 100 }),
      history,
      validLap,
      isGreen,
      { persistLaps: true }
    );

    expect(commands.some((c) => c.type === 'lapCompleted')).toBe(true);
  });
});

describe('FuelProjectionEngine laps it did not see start', () => {
  const settings = { persistLaps: true };
  const run = (engine: FuelProjectionEngine, frames: FuelEngineFrame[]) =>
    frames.flatMap((each) =>
      engine.onFrame(each, history, validLap, isGreen, settings)
    );

  it('does not record the rest of a lap it was started part-way round', () => {
    // Started at 45 % of lap 3: what is left of that lap is not a lap. It
    // burned 1.6 where a whole one burns 3, and counted it would nearly
    // halve the average the tank is filled by.
    const engine = createEngine();
    const partial = run(engine, [
      frame({ fuelLevel: 40, lap: 3, lapDistPct: 0.45, sessionTime: 500 }),
      frame({ fuelLevel: 39, lap: 3, lapDistPct: 0.8, sessionTime: 530 }),
      frame({ fuelLevel: 38.4, lap: 4, lapDistPct: 0.01, sessionTime: 549 }),
    ]);
    expect(partial).toEqual([]);

    // The next lap was seen from the line, and counts.
    const whole = run(engine, [
      frame({ fuelLevel: 36.9, lap: 4, lapDistPct: 0.5, sessionTime: 594 }),
      frame({ fuelLevel: 35.4, lap: 5, lapDistPct: 0.01, sessionTime: 639 }),
    ]);
    expect(whole).toEqual([
      {
        type: 'lapCompleted',
        lap: expect.objectContaining({
          lapNumber: 4,
          fuelUsed: expect.closeTo(3, 9),
          lapTime: 90,
          isValidForCalc: true,
        }),
      },
      { type: 'saveLap', lap: expect.objectContaining({ lapNumber: 4 }) },
    ]);
  });

  it('takes a lap found just past the line as the whole lap', () => {
    // Frames come a few times a second, so this is how every lap is first
    // seen, the one the engine is started on included.
    const engine = createEngine();
    const commands = run(engine, [
      frame({ fuelLevel: 40, lap: 3, lapDistPct: 0.015, sessionTime: 500 }),
      frame({ fuelLevel: 37, lap: 4, lapDistPct: 0.01, sessionTime: 590 }),
    ]);

    expect(commands[0]).toMatchObject({
      type: 'lapCompleted',
      lap: { lapNumber: 3, fuelUsed: 3, lapTime: 90 },
    });
  });

  it('does not take a first frame on lap 1 for the line', () => {
    // The count going from nothing to 1 looks like a crossing, and is where
    // the first lap used to be measured from wherever the car happened to be.
    const engine = createEngine();
    const commands = run(engine, [
      frame({ fuelLevel: 40, lap: 1, lapDistPct: 0.5, sessionTime: 60 }),
      frame({ fuelLevel: 38.5, lap: 2, lapDistPct: 0.01, sessionTime: 105 }),
    ]);

    expect(commands).toEqual([]);
  });

  it('starts over after a reset, wherever the car is', () => {
    const engine = engineFromTheLine();
    engine.reset();

    const commands = run(engine, [
      frame({ fuelLevel: 49, lap: 1, lapDistPct: 0.4, sessionTime: 46 }),
      frame({ fuelLevel: 47, lap: 2, lapDistPct: 0.01, sessionTime: 100 }),
    ]);

    expect(commands).toEqual([]);
  });

  it('measures a first lap from the line it then sees crossed', () => {
    // A rolling start under Le Mans Ultimate: the count does not move at the
    // line, and the car reaches it seconds after the first frame. That is too
    // soon to be a lap, but it is the line, and the lap is measured from it.
    const engine = createEngine();
    const commands = run(engine, [
      frame({ fuelLevel: 45, lap: 1, lapDistPct: 0.93, sessionTime: 140 }),
      frame({ fuelLevel: 44.9, lap: 1, lapDistPct: 0.01, sessionTime: 146 }),
      frame({ fuelLevel: 42.6, lap: 2, lapDistPct: 0.01, sessionTime: 233 }),
    ]);

    expect(commands).toEqual([
      {
        type: 'lapCompleted',
        lap: expect.objectContaining({ lapNumber: 1, lapTime: 87 }),
      },
      { type: 'saveLap', lap: expect.objectContaining({ lapNumber: 1 }) },
    ]);
    expect(commands[0].lap.fuelUsed).toBeCloseTo(2.3, 9);
  });

  it('does not record a lap that began where the car stood', () => {
    // No position yet, as at the monitor: the lap is restarted every frame
    // until there is one, and then begins in the pit stall, not at the line.
    const engine = createEngine();
    const commands = run(engine, [
      frame({ fuelLevel: 50, lap: 1, lapDistPct: 0, sessionTime: 10 }),
      frame({ fuelLevel: 50, lap: 1, lapDistPct: 0, sessionTime: 11 }),
      frame({ fuelLevel: 50, lap: 1, lapDistPct: 0.3, sessionTime: 12 }),
      frame({ fuelLevel: 48, lap: 2, lapDistPct: 0.01, sessionTime: 75 }),
    ]);

    expect(commands).toEqual([]);
  });

  it('does not record across laps it missed', () => {
    // Three laps counted between two frames. At the next line the fuel and
    // the time since the last one seen are four laps' worth, not one lap's.
    const engine = engineFromTheLine();
    const missed = run(engine, [
      frame({ lapDistPct: 0.95, sessionTime: 95 }),
      frame({ fuelLevel: 41, lap: 4, lapDistPct: 0.3, sessionTime: 307 }),
      frame({ fuelLevel: 39, lap: 4, lapDistPct: 0.95, sessionTime: 365 }),
      frame({ fuelLevel: 38, lap: 5, lapDistPct: 0.01, sessionTime: 370 }),
    ]);
    expect(missed).toEqual([]);

    // That line was seen, so the lap from it is measured again.
    const next = run(engine, [
      frame({ fuelLevel: 35, lap: 6, lapDistPct: 0.01, sessionTime: 460 }),
    ]);
    expect(next[0]).toMatchObject({
      type: 'lapCompleted',
      lap: { lapNumber: 5, fuelUsed: 3, lapTime: 90 },
    });
  });
});

describe('FuelProjectionEngine projection', () => {
  // lapDistPct 0 keeps the in-lap blending path out of it, so these isolate
  // which historical figure the projection is built from.
  const input = (
    overrides: Partial<Parameters<FuelProjectionEngine['project']>[0]> = {}
  ) => ({
    avgConsumption: 0,
    currentFuel: 50,
    currentLapUsage: 0,
    lap: 5,
    lapDistPct: 0,
    lapStartFuel: 50,
    lastLapUsage: 0,
    qualifyConsumption: null,
    ...overrides,
  });

  it('projects the running average when there is nothing closer', () => {
    expect(createEngine().project(input({ avgConsumption: 2.4 }))).toBeCloseTo(
      2.4,
      2
    );
  });

  it('prefers the last lap when it is close to the running average', () => {
    // Within 20% of the average, so the most recent lap is the better guide.
    const projected = createEngine().project(
      input({ avgConsumption: 3.0, lastLapUsage: 3.1 })
    );

    expect(projected).toBeCloseTo(3.1, 2);
    expect(projected).not.toBeCloseTo(3.0, 2);
  });

  it('keeps the average when the last lap is an outlier', () => {
    // A fuel save lap or a safety car lap is not evidence of race consumption.
    const projected = createEngine().project(
      input({ avgConsumption: 3.0, lastLapUsage: 1.0 })
    );

    expect(projected).toBeCloseTo(3.0, 2);
  });

  it('falls back to qualifying consumption before any race laps', () => {
    const projected = createEngine().project(
      input({ qualifyConsumption: 2.75 })
    );

    expect(projected).toBeCloseTo(2.75, 2);
  });

  it('falls back to a nominal figure when nothing is known at all', () => {
    // Better a rough number than zero, which would read as "no fuel needed".
    expect(createEngine().project(input())).toBeCloseTo(3.2, 2);
  });

  it('ignores qualifying once a race average exists', () => {
    const projected = createEngine().project(
      input({ avgConsumption: 4.0, qualifyConsumption: 2.75 })
    );

    expect(projected).toBeCloseTo(4.0, 2);
  });
});
