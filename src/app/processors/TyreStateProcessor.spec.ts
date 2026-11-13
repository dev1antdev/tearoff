import { beforeEach, describe, expect, it } from 'vitest';
import type { Session, Telemetry } from '@irdashies/types';
import { TyreStateProcessor } from './TyreStateProcessor';

interface WheelInput {
  surface?: number[];
  innerLayer?: number[];
  carcass?: number[];
  optimal?: number[];
  brakes?: number[];
  pressure?: number[];
  wear?: number[];
  compounds?: number[];
  playerCarIdx?: number;
  sessionNum?: number;
}

/** Twelve zone readings: the same three per wheel, offset by the wheel. */
const zones = (outer: number, middle: number, inner: number): number[] =>
  [0, 1, 2, 3].flatMap((wheel) => [
    outer + wheel,
    middle + wheel,
    inner + wheel,
  ]);

/**
 * A frame as the LMU mapper publishes it. A channel the sim did not provide is
 * absent from the frame entirely, not present and empty.
 */
const frame = ({
  surface = zones(80, 85, 90),
  innerLayer = zones(82, 86, 91),
  carcass = [84, 85, 86, 87],
  optimal = [92, 92, 92, 92],
  brakes = [400, 410, 300, 310],
  pressure = [171.24, 171.11, 171.3, 171.04],
  wear = [0.98384, 0.98371, 0.98291, 0.98302],
  compounds,
  playerCarIdx = 1,
  sessionNum = 0,
}: WheelInput = {}): Telemetry => {
  const out: Record<string, { value: unknown[] }> = {
    SessionNum: { value: [sessionNum] },
    PlayerCarIdx: { value: [playerCarIdx] },
    LmuTyreSurfaceTemp: { value: surface },
    LmuTyreInnerLayerTemp: { value: innerLayer },
    LmuTyreCarcassTemp: { value: carcass },
    LmuTyreOptimalTemp: { value: optimal },
    LmuBrakeTemp: { value: brakes },
  };
  ['LF', 'RF', 'LR', 'RR'].forEach((corner, index) => {
    out[`${corner}coldPressure`] = { value: [pressure[index]] };
    out[`${corner}wearM`] = { value: [wear[index]] };
  });
  if (compounds) out.LmuCarIdxWheelCompounds = { value: compounds };
  return out as unknown as Telemetry;
};

/** A frame from a sim, or a moment, with no wheel data at all. */
const emptyFrame = (sessionNum = 0): Telemetry =>
  ({ SessionNum: { value: [sessionNum] } }) as unknown as Telemetry;

const start = () => {
  const processor = new TyreStateProcessor();
  processor.init({} as Session);
  processor.onLifecycle({ type: 'enter', replay: false });
  return processor;
};

describe('TyreStateProcessor', () => {
  let processor: TyreStateProcessor;

  beforeEach(() => {
    processor = start();
  });

  it('starts with nothing to show', () => {
    const snapshot = processor.snapshot();

    expect(snapshot.available).toBe(false);
    expect(snapshot.wheels).toHaveLength(4);
    expect(snapshot.wheels[0].surfaceTempC).toBeNull();
    expect(snapshot.wheels[0].compound).toBe(-1);
  });

  it('publishes each wheel in LF, RF, LR, RR order', () => {
    processor.onFrame(frame());
    const { wheels, available } = processor.snapshot();

    expect(available).toBe(true);
    expect(wheels[0].surfaceTempC).toEqual([80, 85, 90]);
    expect(wheels[3].surfaceTempC).toEqual([83, 88, 93]);
    expect(wheels[1].innerLayerTempC).toEqual([83, 87, 92]);
    expect(wheels.map((wheel) => wheel.carcassTempC)).toEqual([84, 85, 86, 87]);
    expect(wheels.map((wheel) => wheel.optimalTempC)).toEqual([92, 92, 92, 92]);
    expect(wheels.map((wheel) => wheel.brakeTempC)).toEqual([
      400, 410, 300, 310,
    ]);
  });

  it('rounds to what the widget can show', () => {
    processor.onFrame(frame());
    const [frontLeft] = processor.snapshot().wheels;

    expect(frontLeft.pressureKpa).toBe(171.2);
    expect(frontLeft.treadRemaining).toBe(0.984);
  });

  it('reads the compound of each of the player wheels', () => {
    // Four entries per car slot; the player is in slot 1.
    processor.onFrame(
      frame({ compounds: [9, 9, 9, 9, 0, 0, 1, 1], playerCarIdx: 1 })
    );

    expect(processor.snapshot().wheels.map((wheel) => wheel.compound)).toEqual([
      0, 0, 1, 1,
    ]);
  });

  it('reports no compound when the sim gives none', () => {
    processor.onFrame(frame());

    expect(processor.snapshot().wheels.map((wheel) => wheel.compound)).toEqual([
      -1, -1, -1, -1,
    ]);
  });

  it('does not republish for noise below the displayed precision', () => {
    processor.onFrame(frame());
    const { version } = processor.snapshot();

    processor.onFrame(
      frame({
        surface: zones(80.01, 85.02, 89.98),
        pressure: [171.21, 171.11, 171.3, 171.04],
      })
    );

    expect(processor.snapshot().version).toBe(version);
  });

  it('republishes when a reading moves', () => {
    processor.onFrame(frame());
    const { version } = processor.snapshot();

    processor.onFrame(frame({ brakes: [450, 410, 300, 310] }));

    expect(processor.snapshot().version).toBe(version + 1);
    expect(processor.snapshot().wheels[0].brakeTempC).toBe(450);
  });

  it('drops the readings when the player leaves the car', () => {
    // A temperature from before the driver got out is not a reading of
    // anything, so it must not stay on screen as if it were.
    processor.onFrame(frame());
    const { version } = processor.snapshot();

    processor.onFrame(emptyFrame());
    const snapshot = processor.snapshot();

    expect(snapshot.available).toBe(false);
    expect(snapshot.wheels[0].surfaceTempC).toBeNull();
    expect(snapshot.wheels[0].brakeTempC).toBeNull();
    expect(snapshot.version).toBe(version + 1);
  });

  it('stays quiet while there is still nothing to show', () => {
    processor.onFrame(emptyFrame());
    const { version } = processor.snapshot();

    processor.onFrame(emptyFrame());

    expect(processor.snapshot().version).toBe(version);
  });

  it('keeps a wheel whose zones are incomplete from showing half a tyre', () => {
    const surface = zones(80, 85, 90);
    surface[1] = Number.NaN;
    processor.onFrame(frame({ surface }));
    const { wheels } = processor.snapshot();

    expect(wheels[0].surfaceTempC).toBeNull();
    expect(wheels[1].surfaceTempC).toEqual([81, 86, 91]);
  });

  it('clears on disconnect', () => {
    processor.onFrame(frame());

    processor.onLifecycle({ type: 'disconnect' });
    const snapshot = processor.snapshot();

    expect(snapshot.available).toBe(false);
    expect(snapshot.sessionNum).toBeNull();
    expect(snapshot.wheels[0].pressureKpa).toBeNull();
  });

  it('follows the session number', () => {
    processor.onFrame(frame({ sessionNum: 2 }));

    expect(processor.snapshot().sessionNum).toBe(2);
  });
});
