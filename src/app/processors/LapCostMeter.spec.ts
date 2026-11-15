import { describe, expect, it } from 'vitest';
import {
  createMeterReading,
  LapCostMeter,
  type MeterReading,
} from './LapCostMeter';

/**
 * The level bookkeeping on its own: readings handed straight to the meter,
 * a tenth of a second apart unless a case says otherwise.
 */
const setup = (liveTread = true) => {
  const meter = new LapCostMeter({ liveTread });
  const reading = createMeterReading();
  reading.speed = 50;
  reading.fuel = 50;
  reading.tread = [1, 1, 1, 1];
  reading.brake = [36, 36, 32, 32];
  reading.compound = [0, 0, 0, 0];
  /** Applies a change, moves the clock on and hands the reading over. */
  const feed = (change: Partial<MeterReading> = {}, dt = 0.1) => {
    Object.assign(reading, change);
    reading.sessionTime += dt;
    meter.update(reading);
  };
  feed();
  return { meter, reading, feed };
};

/** Standing in the pit lane. */
const BOX = { inPits: true, speed: 0 } as const;
/** Back on the road. */
const TRACK = { inPits: false, speed: 50 } as const;

describe('LapCostMeter', () => {
  describe('fuel and energy', () => {
    it('takes what a lap burned from the level at its two ends', () => {
      const { meter, feed } = setup();
      meter.openLap();
      for (let step = 1; step <= 24; step += 1) feed({ fuel: 50 - step * 0.1 });

      const cost = meter.closeLap(false);
      expect(cost.fuelUsed).toBeCloseTo(2.4, 9);
      expect(cost.fuelAtLine).toBeCloseTo(47.6, 9);
      expect(cost.fuelAdded).toBe(0);
      expect(cost.serviced).toBe(false);
    });

    it('counts a refuel at a standstill in the pits as added, never as use', () => {
      const { meter, feed } = setup();
      meter.openLap();
      feed({ fuel: 49 });
      meter.beginVisit();
      feed({ ...BOX });
      // Thirty litres over ten seconds.
      for (let step = 1; step <= 100; step += 1)
        feed({ fuel: 49 + step * 0.3 });
      feed({ ...TRACK, fuel: 78.5 });

      const cost = meter.closeLap(false);
      expect(cost.fuelAdded).toBeCloseTo(30, 6);
      expect(cost.fuelUsed).toBeCloseTo(1.5, 6);
      expect(cost.serviced).toBe(true);
      expect(meter.visit().fuelAdded).toBeCloseTo(30, 6);
    });

    it("lets a stop's rises count only once they add up to more than noise", () => {
      const { meter, feed } = setup();
      meter.openLap();
      meter.beginVisit();
      feed({ ...BOX });
      // A sensor that wanders by a hundredth of a litre.
      feed({ fuel: 50.01 });
      feed({ fuel: 50 });
      feed({ fuel: 50.02 });
      expect(meter.visit().fuelAdded).toBe(0);
      expect(meter.lapWasServiced()).toBe(false);

      // Once over the gate, what led up to it is counted too.
      feed({ fuel: 50.03 });
      feed({ fuel: 50.06 });
      expect(meter.visit().fuelAdded).toBeCloseTo(0.07, 9);
      feed({ fuel: 50.5 });
      expect(meter.visit().fuelAdded).toBeCloseTo(0.51, 9);
    });

    it('forgets rises that never reached the gate when the car leaves', () => {
      const { meter, feed } = setup();
      meter.beginVisit();
      feed({ ...BOX });
      feed({ fuel: 50.04 });
      feed({ ...TRACK });
      meter.beginVisit();
      feed({ ...BOX });
      feed({ fuel: 50.08 });

      expect(meter.visit().fuelAdded).toBe(0);
    });

    it('treats a rise while moving as negative use, not as a refuel', () => {
      const { meter, feed } = setup();
      meter.openLap();
      feed({ fuel: 49 });
      feed({ fuel: 49.4, inPits: true, speed: 15 });
      feed({ fuel: 49.4, ...TRACK });

      const cost = meter.closeLap(false);
      expect(cost.fuelAdded).toBe(0);
      expect(cost.fuelUsed).toBeCloseTo(0.6, 9);
      expect(cost.serviced).toBe(false);
    });

    it('counts fuel taken out at a standstill as negative added', () => {
      const { meter, feed } = setup();
      meter.openLap();
      meter.beginVisit();
      for (let step = 0; step < 10; step += 1) feed({ ...BOX });
      // A litre a second for ten seconds. The first step is measured over
      // the second the level stood still before it, and is not counted.
      for (let step = 1; step <= 101; step += 1)
        feed({ fuel: 50 - step * 0.1 });

      expect(meter.visit().fuelAdded).toBeCloseTo(-10, 6);
      expect(meter.closeLap(false).fuelUsed).toBeCloseTo(0.1, 6);
    });

    it('does not take an engine idling in the box for fuel being taken out', () => {
      const { meter, feed } = setup();
      meter.beginVisit();
      feed({ ...BOX });
      for (let step = 1; step <= 100; step += 1) {
        feed({ fuel: 50 - step * 0.001 });
      }

      expect(meter.visit().fuelAdded).toBe(0);
    });

    it('keeps the same account for virtual energy, on its own scale', () => {
      const { meter, feed } = setup();
      feed({ energy: 0.5 });
      meter.openLap();
      for (let step = 1; step <= 20; step += 1) {
        feed({ energy: 0.5 - step * 0.001 });
      }
      meter.beginVisit();
      feed({ ...BOX });
      for (let step = 1; step <= 50; step += 1) {
        feed({ energy: 0.48 + step * 0.01 });
      }
      feed({ ...TRACK });

      const cost = meter.closeLap(false);
      expect(cost.energyUsed).toBeCloseTo(0.02, 9);
      expect(cost.energyAdded).toBeCloseTo(0.5, 9);
      expect(cost.energyAtLine).toBeCloseTo(0.98, 9);
      expect(meter.visit().energyAdded).toBeCloseTo(0.5, 9);
      expect(meter.visit().fuelAdded).toBe(0);
    });

    it('has no figure without a reading at both ends', () => {
      const { meter, feed } = setup();
      feed({ fuel: null, energy: null });
      meter.openLap();
      feed({ fuel: 40 });

      const cost = meter.closeLap(false);
      expect(cost.fuelUsed).toBeNull();
      expect(cost.energyUsed).toBeNull();
      expect(cost.energyAtLine).toBeNull();
    });
  });

  describe('tread and discs', () => {
    it('adds up what each reading lost on track', () => {
      const { meter, feed } = setup();
      meter.openLap();
      for (let step = 1; step <= 10; step += 1) {
        feed({
          tread: [1 - step * 0.0005, 1 - step * 0.0006, 1, 1 - step * 0.0001],
          brake: [36 - step * 0.0002, 36, 32, 32],
        });
      }

      const cost = meter.closeLap(false);
      expect(cost.treadUsed[0]).toBeCloseTo(0.005, 9);
      expect(cost.treadUsed[1]).toBeCloseTo(0.006, 9);
      expect(cost.treadUsed[2]).toBe(0);
      expect(cost.treadUsed[3]).toBeCloseTo(0.001, 9);
      expect(cost.brakeUsed[0]).toBeCloseTo(0.002, 9);
      [0.995, 0.994, 1, 0.999].forEach((left, wheel) =>
        expect(cost.treadAtLine[wheel]).toBeCloseTo(left, 9)
      );
    });

    it('marks a tyre whose tread rises in the pits as changed, and leaves the wear alone', () => {
      const { meter, feed } = setup();
      meter.openLap();
      feed({ tread: [0.6, 0.6, 0.6, 0.6] });
      const worn = meter.closeLap(false).treadUsed;
      meter.openLap();
      meter.beginVisit();
      feed({ ...BOX });
      feed({ tread: [1, 1, 0.6, 0.6] });
      feed({ ...TRACK });

      worn.forEach((used) => expect(used).toBeCloseTo(0.4, 9));
      expect(meter.visit().tyresChanged).toBe(0b0011);
      expect(meter.takeTyreChanges()).toBe(0b0011);
      expect(meter.takeTyreChanges()).toBe(0);
      const cost = meter.closeLap(false);
      expect(cost.treadUsed).toEqual([0, 0, 0, 0]);
      expect(cost.serviced).toBe(true);
    });

    it('marks a used tyre fitted in the pits, and a change of compound', () => {
      const { meter, feed } = setup();
      meter.beginVisit();
      feed({ ...BOX });
      // The right rear comes back with less tread than it left with.
      feed({ tread: [1, 1, 1, 0.9] });
      // The left front is the same tread, another compound.
      feed({ compound: [1, 0, 0, 0] });

      expect(meter.visit().tyresChanged).toBe(0b1001);
    });

    it('does not take wear at pit speed for a tyre change', () => {
      const { meter, feed } = setup();
      meter.beginVisit();
      feed({ inPits: true, speed: 15 });
      feed({ tread: [0.9995, 0.9995, 0.9996, 0.9996] });

      expect(meter.visit().tyresChanged).toBe(0);
    });

    it('ignores a compound that changes out on the track', () => {
      const { meter, feed } = setup();
      feed({ compound: [1, 1, 1, 1] });

      expect(meter.takeTyreChanges()).toBe(0);
    });

    it('marks the brakes changed when a disc comes back thicker', () => {
      const { meter, feed } = setup();
      meter.openLap();
      feed({ brake: [30, 30, 28, 28] });
      meter.beginVisit();
      feed({ ...BOX });
      // The fronts only; a reading that drifts up a hair is not a change.
      feed({ brake: [36, 36, 28.05, 28] });

      expect(meter.visit().brakesChanged).toBe(true);
      expect(meter.visit().tyresChanged).toBe(0);
      expect(meter.closeLap(false).brakeUsed).toEqual([6, 6, 4, 4]);
    });

    it('has no tread per lap where the sim refreshes it only in the pits', () => {
      // iRacing: the reading stands still on track and drops at the stop.
      const { meter, feed } = setup(false);
      meter.openLap();
      feed({ tyresUsed: [1, 1, 1, 1] });
      meter.beginVisit();
      feed({ ...BOX });
      feed({ tread: [0.9, 0.9, 0.92, 0.92] });
      expect(meter.visit().tyresChanged).toBe(0);
      // The sim's own count of tyres used says which corners were changed.
      feed({ tyresUsed: [2, 2, 1, 1] });

      expect(meter.visit().tyresChanged).toBe(0b0011);
      const cost = meter.closeLap(false);
      expect(cost.treadUsed).toEqual([null, null, null, null]);
      expect(cost.treadAtLine).toEqual([0.9, 0.9, 0.92, 0.92]);
    });

    it('leaves a wheel without a reading empty rather than at nought', () => {
      // A sim that reads no discs, and a car without a battery.
      const meter = new LapCostMeter({ liveTread: true });
      const reading = createMeterReading();
      reading.tread = [1, 1, 1, 1];
      meter.update(reading);
      meter.openLap();
      reading.sessionTime += 60;
      reading.tread = [0.99, 0.99, 0.99, 0.99];
      meter.update(reading);

      const cost = meter.closeLap(false);
      expect(cost.brakeUsed).toEqual([null, null, null, null]);
      expect(cost.brakeAtLine).toEqual([null, null, null, null]);
      expect(cost.batteryDrainPct).toBeNull();
      expect(cost.batteryRegenPct).toBeNull();
      cost.treadUsed.forEach((used) => expect(used).toBeCloseTo(0.01, 9));
    });
  });

  describe('the battery', () => {
    it('adds up what was spent and what was recovered', () => {
      const { meter, feed } = setup();
      feed({ battery: 0.8 });
      meter.openLap();
      feed({ battery: 0.7 });
      feed({ battery: 0.75 });
      feed({ battery: 0.6 });
      feed({ battery: 0.9 });

      const cost = meter.closeLap(false);
      expect(cost.batteryDrainPct).toBeCloseTo(25, 9);
      expect(cost.batteryRegenPct).toBeCloseTo(35, 9);
    });

    it('leaves out the steps that are the sim resetting the figure', () => {
      const { meter, feed } = setup();
      feed({ battery: 0.5 });
      meter.openLap();
      // A fall that lands on 0, a step away from 0, a rise that lands on full.
      feed({ battery: 0 });
      feed({ battery: 0.6 });
      feed({ battery: 1 });
      // And two readings too far apart to be neighbours.
      feed({ battery: 0.4 }, 5);

      const cost = meter.closeLap(false);
      expect(cost.batteryDrainPct).toBe(0);
      expect(cost.batteryRegenPct).toBe(0);
    });
  });

  describe('the wear curve', () => {
    it('keeps the cumulative wear of the last lap fit to be a reference', () => {
      const { meter, feed } = setup();
      meter.setCurvePoints(4);
      expect(meter.referenceCurves()).toBeNull();
      meter.openLap();
      for (let point = 0; point < 4; point += 1) {
        feed({
          bucket: point,
          tread: [1 - (point + 1) * 0.001, 1, 1, 1],
          brake: [36 - (point + 1) * 0.01, 36, 32, 32],
        });
      }
      meter.closeLap(true);
      // A pit lap after it does not take its place.
      meter.openLap();
      feed({ bucket: 0, tread: [0.9, 1, 1, 1] });
      meter.closeLap(false);

      const curves = meter.referenceCurves();
      expect(curves?.points).toBe(4);
      expect(Array.from(curves?.sampled ?? [])).toEqual([1, 1, 1, 1]);
      [0.001, 0.002, 0.003, 0.004].forEach((used, point) =>
        expect(curves?.tread[point]).toBeCloseTo(used, 6)
      );
      expect(curves?.brake[3]).toBeCloseTo(0.04, 5);
      // The second wheel's curve is flat.
      expect(curves?.tread[4]).toBe(0);
    });
  });

  it('measures nothing from a frame the sim has stopped writing', () => {
    const { meter, feed } = setup();
    meter.openLap();
    feed({ frozen: true, fuel: 10, tread: [0.5, 0.5, 0.5, 0.5] });
    feed({ frozen: false, fuel: 50, tread: [1, 1, 1, 1] });

    const cost = meter.closeLap(false);
    expect(cost.fuelUsed).toBe(0);
    expect(cost.treadUsed).toEqual([0, 0, 0, 0]);
  });

  it('forgets everything on a reset', () => {
    const { meter, feed } = setup();
    meter.openLap();
    feed({ fuel: 40, battery: 0.5 });
    meter.reset();

    expect(meter.fuelLevel()).toBeNull();
    expect(meter.treadLevels()).toEqual([null, null, null, null]);
    expect(meter.lapFuelUsed()).toBeNull();
    expect(meter.compoundIndices()).toEqual([-1, -1, -1, -1]);
  });
});
