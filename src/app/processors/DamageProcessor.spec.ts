import { beforeEach, describe, expect, it } from 'vitest';
import type { Session, Telemetry } from '@irdashies/types';
import {
  DAMAGE_IMPACT_HOLD_SECONDS,
  DAMAGE_MIN_IMPACT_MAGNITUDE,
  DamageProcessor,
  impactBearingRad,
} from './DamageProcessor';

interface Impact {
  time: number;
  /** x to the car's left, y up, z to the rear. */
  position?: number[];
  /** Null leaves the key out, as a build without the export does. */
  magnitude?: number | null;
}

interface FrameInput {
  /** The sim's own order: anticlockwise from the nose. */
  dents?: number[];
  bodyDetached?: boolean;
  overheating?: boolean;
  wheelDetached?: boolean[];
  tyreFlat?: boolean[];
  pressure?: number[];
  wear?: number[];
  /** Null for a REST API that has not answered. */
  suspension?: number[] | null;
  aero?: number | null;
  impact?: Impact;
  sessionTime?: number;
  repairTime?: number | null;
  repairChoice?: string | null;
  pitStopParts?: number[];
  sessionNum?: number;
}

const NO_DENTS = [0, 0, 0, 0, 0, 0, 0, 0];

/**
 * A frame as the LMU mapper publishes it for a car in the race. A channel
 * the sim did not provide is absent from the frame, not present and empty.
 */
const frame = ({
  dents = NO_DENTS,
  bodyDetached = false,
  overheating = false,
  wheelDetached = [false, false, false, false],
  tyreFlat = [false, false, false, false],
  pressure = [171.2, 171.1, 171.3, 171.0],
  wear = [0.98384, 0.98371, 0.98291, 0.98302],
  suspension = [0, 0, 0, 0],
  aero = 0,
  impact = { time: 0, position: [0, 0, 0], magnitude: 0 },
  sessionTime = 200,
  repairTime = 0,
  repairChoice = null,
  pitStopParts,
  sessionNum = 0,
}: FrameInput = {}): Telemetry => {
  const out: Record<string, { value: unknown[] }> = {
    SessionNum: { value: [sessionNum] },
    SessionTime: { value: [sessionTime] },
    LmuDentSeverity: { value: dents },
    LmuBodyDetached: { value: [bodyDetached] },
    LmuOverheating: { value: [overheating] },
    LmuWheelDetached: { value: wheelDetached },
    LmuTyreFlat: { value: tyreFlat },
    LmuLastImpactTime: { value: [impact.time] },
    LmuLastImpactPos: { value: impact.position ?? [0, 0, -2] },
  };
  if (impact.magnitude !== null) {
    out.LmuLastImpactMagnitude = {
      value: [impact.magnitude ?? DAMAGE_MIN_IMPACT_MAGNITUDE * 4],
    };
  }
  ['LF', 'RF', 'LR', 'RR'].forEach((corner, index) => {
    out[`${corner}coldPressure`] = { value: [pressure[index]] };
    out[`${corner}wearM`] = { value: [wear[index]] };
  });
  if (suspension) out.LmuSuspensionDamage = { value: suspension };
  if (aero !== null) out.LmuAeroDamage = { value: [aero] };
  if (repairTime !== null) out.LmuRepairTime = { value: [repairTime] };
  if (repairChoice !== null) out.LmuRepairChoice = { value: [repairChoice] };
  if (pitStopParts) out.LmuPitStopParts = { value: pitStopParts };
  return out as unknown as Telemetry;
};

/** A frame with no player car, or from a sim that publishes none of this. */
const emptyFrame = (sessionNum = 0): Telemetry =>
  ({
    SessionNum: { value: [sessionNum] },
    SessionTime: { value: [200] },
  }) as unknown as Telemetry;

const start = () => {
  const processor = new DamageProcessor();
  processor.init({} as Session);
  processor.onLifecycle({ type: 'enter', replay: false });
  return processor;
};

const degrees = (radians: number | null | undefined): number =>
  ((radians ?? Number.NaN) * 180) / Math.PI;

describe('DamageProcessor', () => {
  let processor: DamageProcessor;

  beforeEach(() => {
    processor = start();
  });

  it('owns the damage channel and sees every frame', () => {
    expect(processor.channel).toBe('damage.snapshot');
    // The sim holds only its last impact, so none may pass between looks.
    expect(processor.tickRateHz).toBe('event');
  });

  it('starts with no car to describe', () => {
    const snapshot = processor.snapshot();

    expect(snapshot.available).toBe(false);
    expect(snapshot.body).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(snapshot.wheels).toHaveLength(4);
    expect(snapshot.aeroIntegrity).toBeNull();
    expect(snapshot.impactBearingRad).toBeNull();
    expect(snapshot.repairChoice).toBeNull();
  });

  describe('the body', () => {
    it('reads a sound car as eight clean zones', () => {
      processor.onFrame(frame());
      const snapshot = processor.snapshot();

      expect(snapshot.available).toBe(true);
      expect(snapshot.body).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
      expect(snapshot.bodyIntegrity).toBe(1);
    });

    it('turns the anticlockwise order of the sim into clockwise from the nose', () => {
      // The sim: front, front left, left, rear left, rear, rear right,
      // right, front right. A dent on the front left and a heavy one on
      // the rear.
      processor.onFrame(frame({ dents: [0, 1, 0, 0, 2, 0, 0, 0] }));
      const snapshot = processor.snapshot();

      expect(snapshot.body).toEqual([0, 0, 0, 0, 2, 0, 0, 1]);
      // 1 - 3/16.
      expect(snapshot.bodyIntegrity).toBe(0.81);
    });

    it('puts each of the eight parts the sim numbers in its own zone', () => {
      const expected = [0, 7, 6, 5, 4, 3, 2, 1];
      expected.forEach((zone, simIndex) => {
        const dents = [...NO_DENTS];
        dents[simIndex] = 1;
        processor.onFrame(frame({ dents }));

        const hit = processor.snapshot().body.indexOf(1);
        expect(hit, `sim part ${simIndex}`).toBe(zone);
      });
    });

    it('reads the recorded dent as the front zone at level 1', () => {
      // The recording's state from 240.73 s on.
      processor.onFrame(
        frame({ dents: [1, 0, 0, 0, 0, 0, 0, 0], aero: 0.0268 })
      );
      const snapshot = processor.snapshot();

      expect(snapshot.body).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
      // 1 - 1/16.
      expect(snapshot.bodyIntegrity).toBe(0.94);
      expect(snapshot.aeroIntegrity).toBe(0.97);
    });

    it('draws a level above 2 as 2', () => {
      processor.onFrame(frame({ dents: [5, 0, 0, 0, 0, 0, 0, 0] }));

      expect(processor.snapshot().body[0]).toBe(2);
    });

    it('marks the rear as gone when the sim says bodywork has come off', () => {
      processor.onFrame(frame({ bodyDetached: true }));
      const snapshot = processor.snapshot();

      expect(snapshot.body).toEqual([0, 0, 0, 0, 3, 0, 0, 0]);
      // 1 - 3/16.
      expect(snapshot.bodyIntegrity).toBe(0.81);
    });

    it('never reports less than no body at all', () => {
      processor.onFrame(
        frame({ dents: [2, 2, 2, 2, 2, 2, 2, 2], bodyDetached: true })
      );

      expect(processor.snapshot().bodyIntegrity).toBe(0);
    });
  });

  describe('the wheels', () => {
    it('reads the four wheels in LF, RF, LR, RR order', () => {
      processor.onFrame(frame({ suspension: [0, 0.1, 0.2, 0.3] }));

      expect(processor.snapshot().wheels).toEqual([
        { detached: false, punctured: false, suspensionDamage: 0 },
        { detached: false, punctured: false, suspensionDamage: 0.1 },
        { detached: false, punctured: false, suspensionDamage: 0.2 },
        { detached: false, punctured: false, suspensionDamage: 0.3 },
      ]);
    });

    it('calls a tyre with no pressure punctured', () => {
      processor.onFrame(frame({ pressure: [0.8, 171, 171, 171] }));
      const { wheels } = processor.snapshot();

      expect(wheels[0].punctured).toBe(true);
      expect(wheels[1].punctured).toBe(false);
    });

    it('calls a tyre the sim flags as flat punctured, whatever its pressure', () => {
      processor.onFrame(
        frame({
          tyreFlat: [false, false, true, false],
          pressure: [171, 171, 150, 171],
        })
      );

      expect(
        processor.snapshot().wheels.map((wheel) => wheel.punctured)
      ).toEqual([false, false, true, false]);
    });

    it('does not call a wheel that has come off punctured', () => {
      processor.onFrame(
        frame({
          wheelDetached: [false, true, false, false],
          tyreFlat: [false, true, false, false],
          pressure: [171, 0, 171, 171],
        })
      );
      const wheel = processor.snapshot().wheels[1];

      expect(wheel.detached).toBe(true);
      expect(wheel.punctured).toBe(false);
    });

    it('leaves the suspension unknown until the REST API has answered', () => {
      processor.onFrame(frame({ suspension: null, aero: null }));
      const snapshot = processor.snapshot();

      expect(snapshot.wheels.map((wheel) => wheel.suspensionDamage)).toEqual([
        null,
        null,
        null,
        null,
      ]);
      expect(snapshot.suspensionIntegrity).toBeNull();
      expect(snapshot.aeroIntegrity).toBeNull();
    });

    it('keeps the steps a wheel changes colour at apart', () => {
      // Rounded finer than the per cent drawn, or 0.019 would become the
      // 0.02 at which a wheel turns amber.
      processor.onFrame(frame({ suspension: [0.019, 0.02, 0.1504, 0.8] }));

      expect(
        processor.snapshot().wheels.map((wheel) => wheel.suspensionDamage)
      ).toEqual([0.019, 0.02, 0.15, 0.8]);
    });
  });

  describe('the four figures', () => {
    it('takes aero integrity from the aero damage the sim states', () => {
      processor.onFrame(frame({ aero: 0.12 }));

      expect(processor.snapshot().aeroIntegrity).toBe(0.88);
    });

    it('takes suspension integrity from the worst wheel', () => {
      processor.onFrame(frame({ suspension: [0, 0, 0.35, 0] }));

      expect(processor.snapshot().suspensionIntegrity).toBe(0.65);
    });

    it('says a car with a wheel off has no suspension left, REST or not', () => {
      processor.onFrame(
        frame({
          suspension: null,
          wheelDetached: [false, false, false, true],
        })
      );

      expect(processor.snapshot().suspensionIntegrity).toBe(0);
    });

    it('takes tyre integrity from the most worn tyre', () => {
      processor.onFrame(frame({ wear: [0.98, 0.98, 0.19, 0.98] }));

      expect(processor.snapshot().tyreIntegrity).toBe(0.19);
    });

    it('passes on the overheating warning', () => {
      processor.onFrame(frame());
      expect(processor.snapshot().overheating).toBe(false);

      processor.onFrame(frame({ overheating: true }));
      expect(processor.snapshot().overheating).toBe(true);
    });
  });

  describe('where an impact came from', () => {
    it('measures clockwise from the nose, seen from above', () => {
      // Forward is minus z, and the right-hand side minus x.
      expect(impactBearingRad([0, 0, -2])).toBe(0);
      expect(degrees(impactBearingRad([-1, 0, 0]))).toBeCloseTo(90, 0);
      expect(degrees(impactBearingRad([0, 0, 2]))).toBeCloseTo(180, 0);
      expect(degrees(impactBearingRad([1, 0, 0]))).toBeCloseTo(270, 0);
    });

    it('places the recorded impacts at the nose, right and left of centre', () => {
      // Within the 0.3 degrees a hundredth of a radian is.
      expect(
        Math.abs(degrees(impactBearingRad([-1.007, -0.139, -2.049])) - 26.2)
      ).toBeLessThan(0.3);
      expect(
        Math.abs(degrees(impactBearingRad([-0.567, -0.153, -2.453])) - 13.0)
      ).toBeLessThan(0.3);
      expect(
        Math.abs(degrees(impactBearingRad([0.523, -0.224, -2.499])) - 348.2)
      ).toBeLessThan(0.3);
      expect(impactBearingRad([-1.007, -0.139, -2.049])).toBe(0.46);
    });

    it('stays inside one turn and ignores the height of the impact', () => {
      const bearing = impactBearingRad([0.001, 5, -2]);

      expect(bearing).toBeGreaterThanOrEqual(0);
      expect(bearing).toBeLessThan(2 * Math.PI);
      expect(impactBearingRad([-1, 9, 0])).toBe(impactBearingRad([-1, 0, 0]));
    });

    it('has no bearing for a position it cannot read', () => {
      expect(impactBearingRad(undefined)).toBeUndefined();
      expect(impactBearingRad([Number.NaN, 0, 1])).toBeUndefined();
      expect(impactBearingRad([1])).toBeUndefined();
    });
  });

  describe('the last impact', () => {
    const hit = (time: number, magnitude?: number | null): Impact => ({
      time,
      position: [-1, 0, 0],
      magnitude,
    });

    it('marks nothing before the first impact', () => {
      // The sim holds zeros until then.
      processor.onFrame(frame({ sessionTime: 5 }));

      expect(processor.snapshot().impactBearingRad).toBeNull();
    });

    it('marks an impact for fifteen seconds', () => {
      expect(DAMAGE_IMPACT_HOLD_SECONDS).toBe(15);
      const impact = hit(100);

      processor.onFrame(frame({ impact, sessionTime: 100 }));
      expect(processor.snapshot().impactBearingRad).toBe(1.57);

      processor.onFrame(frame({ impact, sessionTime: 115 }));
      expect(processor.snapshot().impactBearingRad).toBe(1.57);

      processor.onFrame(frame({ impact, sessionTime: 115.3 }));
      expect(processor.snapshot().impactBearingRad).toBeNull();
    });

    it('does not mark an impact from before the clock it is read on', () => {
      processor.onFrame(frame({ impact: hit(100), sessionTime: 90 }));

      expect(processor.snapshot().impactBearingRad).toBeNull();
    });

    it('restarts the fifteen seconds on a later impact', () => {
      processor.onFrame(frame({ impact: hit(100), sessionTime: 100 }));
      const later: Impact = { time: 110, position: [0, 0, 2] };

      processor.onFrame(frame({ impact: later, sessionTime: 110 }));
      expect(processor.snapshot().impactBearingRad).toBe(3.14);

      processor.onFrame(frame({ impact: later, sessionTime: 124 }));
      expect(processor.snapshot().impactBearingRad).toBe(3.14);

      processor.onFrame(frame({ impact: later, sessionTime: 126 }));
      expect(processor.snapshot().impactBearingRad).toBeNull();
    });

    it('leaves out an impact too light to be a contact', () => {
      // The recording's two brushes at speed read 40 and 63.
      processor.onFrame(frame({ impact: hit(100, 63), sessionTime: 100 }));

      expect(processor.snapshot().impactBearingRad).toBeNull();
    });

    it('marks an impact at the line and one just under it differently', () => {
      processor.onFrame(
        frame({
          impact: hit(100, DAMAGE_MIN_IMPACT_MAGNITUDE - 1),
          sessionTime: 100,
        })
      );
      expect(processor.snapshot().impactBearingRad).toBeNull();

      processor.onFrame(
        frame({
          impact: hit(101, DAMAGE_MIN_IMPACT_MAGNITUDE),
          sessionTime: 101,
        })
      );
      expect(processor.snapshot().impactBearingRad).toBe(1.57);
    });

    it('keeps a marked impact standing through a lighter one after it', () => {
      // As recorded: a knock of 1,233 at 278.34 s, then a brush of 63 from
      // the other side at 285.00 s.
      processor.onFrame(
        frame({ impact: hit(278.34, 1233), sessionTime: 278.35 })
      );
      const brush: Impact = { time: 285, position: [1, 0, 0], magnitude: 63 };

      processor.onFrame(frame({ impact: brush, sessionTime: 285.01 }));
      expect(processor.snapshot().impactBearingRad).toBe(1.57);

      // And it goes out fifteen seconds after the knock, not the brush.
      processor.onFrame(frame({ impact: brush, sessionTime: 293.3 }));
      expect(processor.snapshot().impactBearingRad).toBe(1.57);
      processor.onFrame(frame({ impact: brush, sessionTime: 293.4 }));
      expect(processor.snapshot().impactBearingRad).toBeNull();
    });

    it('marks a light impact that arrives with new damage', () => {
      // A hard hit overwritten by a brush before it was read: the dent it
      // left arrives with the brush, which is all the sim still names.
      processor.onFrame(frame({ sessionTime: 99 }));

      processor.onFrame(
        frame({
          dents: [1, 0, 0, 0, 0, 0, 0, 0],
          impact: hit(100, 40),
          sessionTime: 100.01,
        })
      );

      expect(processor.snapshot().impactBearingRad).toBe(1.57);
    });

    it('marks a light impact when the damage shows a frame after it', () => {
      const brush = hit(100, 40);
      processor.onFrame(frame({ impact: brush, sessionTime: 100.01 }));
      expect(processor.snapshot().impactBearingRad).toBeNull();

      processor.onFrame(
        frame({
          wheelDetached: [true, false, false, false],
          impact: brush,
          sessionTime: 100.02,
        })
      );
      expect(processor.snapshot().impactBearingRad).toBe(1.57);
    });

    it('does not take the damage a car arrives with for a new impact', () => {
      // The first frame seen, with the widget switched on mid-race.
      processor.onFrame(
        frame({
          dents: [1, 0, 0, 0, 0, 0, 0, 0],
          impact: hit(100, 40),
          sessionTime: 104,
        })
      );

      expect(processor.snapshot().impactBearingRad).toBeNull();
    });

    it('marks every impact under a build that does not state the force', () => {
      processor.onFrame(frame({ impact: hit(100, null), sessionTime: 100 }));

      expect(processor.snapshot().impactBearingRad).toBe(1.57);
    });
  });

  describe('the repair', () => {
    it('has no time and no choice on a sound car', () => {
      processor.onFrame(frame());
      const snapshot = processor.snapshot();

      expect(snapshot.repairSeconds).toBe(0);
      expect(snapshot.repairChoice).toBeNull();
    });

    it('passes on the choice as the sim words it', () => {
      // The recording's state once the car is dented: a repair on offer,
      // and the menu on leaving it.
      processor.onFrame(frame({ repairChoice: 'Do Not Repair' }));
      const snapshot = processor.snapshot();

      expect(snapshot.repairChoice).toBe('Do Not Repair');
      expect(snapshot.repairSeconds).toBe(0);
    });

    it('rounds the repair to whole seconds', () => {
      processor.onFrame(
        frame({ repairTime: 35.4, repairChoice: 'Repair Body' })
      );

      expect(processor.snapshot().repairSeconds).toBe(35);
    });

    it('reads the repair from the parts of the stop where it stands alone', () => {
      // Fuel, energy, tyres, damage, driver swap, brakes, ducts, penalties.
      processor.onFrame(
        frame({
          repairTime: null,
          pitStopParts: [4.3, 2.5, 0, 30, 0, 0, 0, 0],
        })
      );

      expect(processor.snapshot().repairSeconds).toBe(30);
    });

    it('says nothing of the repair until the sim does', () => {
      processor.onFrame(frame({ repairTime: null }));

      expect(processor.snapshot().repairSeconds).toBeNull();
    });
  });

  describe('publishing', () => {
    it('does not republish for noise below what is drawn', () => {
      processor.onFrame(frame());
      const { version } = processor.snapshot();

      processor.onFrame(
        frame({
          aero: 0.0004,
          suspension: [0.0002, 0, 0, 0],
          wear: [0.9838, 0.9837, 0.9829, 0.983],
          pressure: [171.9, 170.2, 171.3, 171],
          repairTime: 0.3,
          sessionTime: 200.016,
        })
      );

      expect(processor.snapshot().version).toBe(version);
    });

    it('republishes once when a zone changes, with a new list', () => {
      processor.onFrame(frame());
      const before = processor.snapshot();
      const { version, body, wheels } = before;

      processor.onFrame(frame({ dents: [1, 0, 0, 0, 0, 0, 0, 0] }));
      const after = processor.snapshot();

      expect(after.version).toBe(version + 1);
      expect(after.body).not.toBe(body);
      // What did not change is the object it was.
      expect(after.wheels).toBe(wheels);
    });

    it('republishes when the impact mark goes out', () => {
      const impact: Impact = { time: 100 };
      processor.onFrame(frame({ impact, sessionTime: 100 }));
      const { version } = processor.snapshot();

      processor.onFrame(frame({ impact, sessionTime: 110 }));
      expect(processor.snapshot().version).toBe(version);

      processor.onFrame(frame({ impact, sessionTime: 115.5 }));
      expect(processor.snapshot().version).toBe(version + 1);
    });

    it('follows the session number', () => {
      processor.onFrame(frame({ sessionNum: 2 }));

      expect(processor.snapshot().sessionNum).toBe(2);
    });
  });

  describe('without a car', () => {
    it('drops the picture when the player leaves the car', () => {
      processor.onFrame(
        frame({
          dents: [2, 0, 0, 0, 0, 0, 0, 0],
          aero: 0.2,
          impact: { time: 199 },
          repairChoice: 'Repair Body',
          repairTime: 30,
        })
      );
      const { version } = processor.snapshot();

      processor.onFrame(emptyFrame());
      const snapshot = processor.snapshot();

      expect(snapshot.available).toBe(false);
      expect(snapshot.body).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
      expect(snapshot.aeroIntegrity).toBeNull();
      expect(snapshot.impactBearingRad).toBeNull();
      expect(snapshot.repairSeconds).toBeNull();
      expect(snapshot.repairChoice).toBeNull();
      expect(snapshot.version).toBe(version + 1);
    });

    it('stays quiet while there is still no car', () => {
      processor.onFrame(emptyFrame());
      const { version } = processor.snapshot();

      processor.onFrame(emptyFrame());

      expect(processor.snapshot().version).toBe(version);
    });

    it('stays unavailable under a sim that publishes no dents', () => {
      // iRacing: the tyres' keys exist there, the damage ones do not.
      const iracing = {
        SessionNum: { value: [0] },
        SessionTime: { value: [200] },
        LFwearM: { value: [0.9] },
      } as unknown as Telemetry;
      processor.onFrame(iracing);

      expect(processor.snapshot().available).toBe(false);
      expect(processor.snapshot().tyreIntegrity).toBeNull();
    });

    it('does not mark an impact from before the driver got back in', () => {
      const impact: Impact = { time: 199, magnitude: 40 };
      processor.onFrame(frame({ impact, sessionTime: 199.1 }));
      processor.onFrame(emptyFrame());

      // Back in the car with a dent that was not there: the first frame of
      // a car is where it starts, not something that just happened.
      processor.onFrame(
        frame({
          dents: [1, 0, 0, 0, 0, 0, 0, 0],
          impact,
          sessionTime: 205,
        })
      );

      expect(processor.snapshot().impactBearingRad).toBeNull();
    });
  });

  describe('when the session changes', () => {
    const damaged = () =>
      frame({
        dents: [1, 0, 0, 0, 2, 0, 0, 0],
        bodyDetached: true,
        wheelDetached: [true, false, false, false],
        impact: { time: 199 },
        repairChoice: 'Repair All',
        repairTime: 90,
        sessionNum: 1,
      });

    it('publishes an empty snapshot on a new session', () => {
      processor.onFrame(damaged());
      const { version } = processor.snapshot();

      processor.onLifecycle({ type: 'sessionNumChange' });
      const snapshot = processor.snapshot();

      expect(snapshot.available).toBe(false);
      expect(snapshot.body).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
      expect(snapshot.wheels.every((wheel) => !wheel.detached)).toBe(true);
      expect(snapshot.bodyIntegrity).toBe(1);
      expect(snapshot.impactBearingRad).toBeNull();
      expect(snapshot.repairChoice).toBeNull();
      expect(snapshot.sessionNum).toBeNull();
      expect(snapshot.version).toBe(version + 1);
    });

    it('publishes an empty snapshot on disconnect', () => {
      processor.onFrame(damaged());

      processor.onLifecycle({ type: 'disconnect' });
      const snapshot = processor.snapshot();

      expect(snapshot.available).toBe(false);
      expect(snapshot.repairSeconds).toBeNull();
      expect(snapshot.sessionNum).toBeNull();
    });

    it('forgets the impact it had marked', () => {
      const impact: Impact = { time: 199 };
      processor.onFrame(frame({ impact, sessionTime: 199.5 }));
      expect(processor.snapshot().impactBearingRad).not.toBeNull();

      processor.onLifecycle({ type: 'sessionNumChange' });
      // A new session whose clock starts again, with a sound car.
      processor.onFrame(frame({ sessionTime: 3, sessionNum: 1 }));

      expect(processor.snapshot().impactBearingRad).toBeNull();
    });
  });
});
