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
  /** SessionTime; left out, the frame carries no clock. */
  time?: number;
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
  time,
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
  if (time !== undefined) out.SessionTime = { value: [time] };
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

  describe('with a team-mate driving the car', () => {
    /**
     * What the mapper publishes from the block of a car the user is not in:
     * the brakes, the tread where the car is simulated on this machine, the
     * compound from the per-car array, and no tyre temperature or pressure.
     */
    const watched = (wear?: number[]): Telemetry => {
      const out: Record<string, { value: unknown[] }> = {
        SessionNum: { value: [0] },
        PlayerCarIdx: { value: [1] },
        LmuBrakeTemp: { value: [400.04, 410, 300, 310] },
        LmuCarIdxWheelCompounds: { value: [0, 0, 0, 0, 2, 2, 1, 1] },
      };
      ['LF', 'RF', 'LR', 'RR'].forEach((corner, index) => {
        if (wear) out[`${corner}wearM`] = { value: [wear[index]] };
      });
      return out as unknown as Telemetry;
    };

    it('publishes the brakes, the tread and the compound, and no tyre reading', () => {
      processor.onFrame(watched([0.96412, 0.96, 0.95, 0.94]));
      const snapshot = processor.snapshot();

      expect(snapshot.available).toBe(true);
      expect(snapshot.wheels[0]).toEqual({
        surfaceTempC: null,
        innerLayerTempC: null,
        carcassTempC: null,
        optimalTempC: null,
        pressureKpa: null,
        // No pressure to average, so no offset from the highest either.
        pressureDeviationKpa: null,
        treadRemaining: 0.964,
        brakeTempC: 400,
        compound: 2,
      });
      expect(snapshot.wheels.map((wheel) => wheel.brakeTempC)).toEqual([
        400, 410, 300, 310,
      ]);
      expect(snapshot.wheels[3].compound).toBe(1);
    });

    it('publishes no tread where the sim’s figure for the car is withheld', () => {
      processor.onFrame(watched());
      const snapshot = processor.snapshot();

      expect(snapshot.available).toBe(true);
      expect(snapshot.wheels.map((wheel) => wheel.treadRemaining)).toEqual([
        null,
        null,
        null,
        null,
      ]);
      expect(snapshot.wheels[1].brakeTempC).toBe(410);
    });

    it('drops the tyre readings as the user leaves the car, and takes them up again', () => {
      processor.onFrame(frame());
      expect(processor.snapshot().wheels[0].surfaceTempC).not.toBeNull();

      processor.onFrame(watched());
      expect(processor.snapshot().available).toBe(true);
      expect(processor.snapshot().wheels[0].surfaceTempC).toBeNull();
      expect(processor.snapshot().wheels[0].pressureKpa).toBeNull();

      processor.onFrame(frame());
      expect(processor.snapshot().wheels[0].surfaceTempC).toEqual([80, 85, 90]);
      expect(processor.snapshot().wheels[0].pressureKpa).toBe(171.2);
    });
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

  describe('how far each pressure sits below the highest', () => {
    const deviations = () =>
      processor.snapshot().wheels.map((wheel) => wheel.pressureDeviationKpa);

    /** Feeds the same pressures five times a second for `seconds`. */
    const hold = (pressure: number[], from: number, seconds: number) => {
      const ticks = Math.round(seconds * 5);
      for (let tick = 1; tick <= ticks; tick += 1) {
        processor.onFrame(frame({ pressure, time: from + tick / 5 }));
      }
      return from + ticks / 5;
    };

    it('reads the offsets from the first tick, not from an average of zero', () => {
      processor.onFrame(frame({ pressure: [170, 172, 169, 171], time: 100 }));

      expect(deviations()).toEqual([2, 0, 3, 1]);
    });

    it('holds them while the pressures hold', () => {
      processor.onFrame(frame({ pressure: [170, 172, 169, 171], time: 100 }));
      const { version } = processor.snapshot();

      hold([170, 172, 169, 171], 100, 30);

      expect(deviations()).toEqual([2, 0, 3, 1]);
      expect(processor.snapshot().version).toBe(version);
    });

    it('follows a pressure that moves over five seconds, not at once', () => {
      const at = hold([170, 172, 169, 171], 100, 30);

      // The highest wheel gains 6 kPa: a warm corner, not a tyre change.
      processor.onFrame(
        frame({ pressure: [170, 178, 169, 171], time: at + 0.2 })
      );
      // One tick in, the average has barely moved.
      expect(deviations()).toEqual([2.2, 0, 3.2, 1.2]);

      hold([170, 178, 169, 171], at + 0.2, 4.8);

      // 63 % of the 6 kPa after one time constant: 3.8 more on each of the
      // other three, and still nothing on the highest.
      expect(deviations()).toEqual([5.8, 0, 6.8, 4.8]);
    });

    it('starts again from the new readings when a tyre is changed', () => {
      const at = hold([170, 172, 169, 171], 100, 30);

      // 172 to 140 in one tick is a fresh, cold tyre.
      processor.onFrame(
        frame({ pressure: [170, 140, 169, 171], time: at + 0.2 })
      );

      expect(deviations()).toEqual([1, 31, 2, 0]);
    });

    it('does not take a pressure that climbs steadily for a tyre change', () => {
      let at = hold([140, 140, 140, 140], 100, 1);
      // An out-lap: 2 kPa a tick on one wheel, 30 kPa in three seconds.
      for (let step = 1; step <= 15; step += 1) {
        at += 0.2;
        processor.onFrame(
          frame({ pressure: [140 + step * 2, 140, 140, 140], time: at })
        );
      }

      // Averaged, so well short of the 30 kPa the readings now differ by.
      const [, behind] = deviations();
      expect(behind).toBeGreaterThan(5);
      expect(behind).toBeLessThan(12);
    });

    it('moves nothing while the sim is paused', () => {
      processor.onFrame(frame({ pressure: [170, 172, 169, 171], time: 100 }));

      processor.onFrame(frame({ pressure: [170, 178, 169, 171], time: 100 }));

      expect(deviations()).toEqual([2, 0, 3, 1]);
    });

    it('starts again when the clock goes backwards', () => {
      hold([170, 172, 169, 171], 100, 30);

      processor.onFrame(frame({ pressure: [170, 178, 169, 171], time: 20 }));

      expect(deviations()).toEqual([8, 0, 9, 7]);
    });

    it('counts a tick without a clock for a fifth of a second', () => {
      processor.onFrame(frame({ pressure: [170, 172, 169, 171] }));
      processor.onFrame(frame({ pressure: [170, 178, 169, 171] }));

      // 1 - exp(-0.2 / 5) of the 6 kPa.
      expect(deviations()).toEqual([2.2, 0, 3.2, 1.2]);
    });

    it('says nothing until all four wheels have read', () => {
      const partial = frame({ pressure: [170, 172, 169, 171], time: 100 });
      delete (partial as Record<string, unknown>).RRcoldPressure;
      processor.onFrame(partial);

      expect(deviations()).toEqual([null, null, null, null]);
      expect(processor.snapshot().wheels[0].pressureKpa).toBe(170);
      expect(processor.snapshot().wheels[3].pressureKpa).toBeNull();
    });

    it('clears them when the player leaves the car, and starts again after', () => {
      const at = hold([170, 172, 169, 171], 100, 30);

      processor.onFrame(emptyFrame());
      expect(deviations()).toEqual([null, null, null, null]);

      // Back in on different tyres, within what a tick may move by: the old
      // averages must not be what these are measured against.
      processor.onFrame(
        frame({ pressure: [160, 165, 162, 164], time: at + 60 })
      );
      expect(deviations()).toEqual([5, 0, 3, 1]);
    });

    it.each(['sessionNumChange', 'disconnect'] as const)(
      'drops the averages on %s',
      (type) => {
        const at = hold([170, 172, 169, 171], 100, 30);

        processor.onLifecycle({ type });
        expect(deviations()).toEqual([null, null, null, null]);

        processor.onFrame(
          frame({ pressure: [160, 165, 162, 164], time: at + 0.2 })
        );
        expect(deviations()).toEqual([5, 0, 3, 1]);
      }
    );

    it('republishes when a deviation moves and the pressures do not', () => {
      const at = hold([170, 172, 169, 171], 100, 30);
      processor.onFrame(
        frame({ pressure: [170, 178, 169, 171], time: at + 0.2 })
      );
      const { version } = processor.snapshot();

      // The same readings a second later: only the averages have moved.
      hold([170, 178, 169, 171], at + 0.2, 1);

      expect(processor.snapshot().version).toBeGreaterThan(version);
    });
  });
});
