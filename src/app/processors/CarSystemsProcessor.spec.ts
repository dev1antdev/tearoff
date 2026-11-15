import { describe, it, expect, beforeEach } from 'vitest';
import { CarSystemsProcessor } from './CarSystemsProcessor';
import type { Session, Telemetry } from '@irdashies/types';

/**
 * Frames are built the way the SDK publishes them: a variable that the car does
 * not expose is absent from the frame entirely, not present-and-null.
 */
const frame = (
  values: Record<string, number | boolean | number[] | undefined>,
  { inCar = true }: { inCar?: boolean } = {}
): Telemetry => {
  const out: Record<string, { value: unknown[] }> = {
    SessionNum: { value: [0] },
    IsOnTrack: { value: [inCar] },
  };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    // An array is a cell that holds several values, as LmuDialMax does.
    out[key] = { value: Array.isArray(value) ? value : [value] };
  }
  return out as unknown as Telemetry;
};

const start = () => {
  const processor = new CarSystemsProcessor();
  processor.init({} as Session);
  processor.onLifecycle({ type: 'enter', replay: false });
  return processor;
};

const byKey = (processor: CarSystemsProcessor, key: string) =>
  processor.snapshot().adjustments.find((a) => a.key === key);

describe('CarSystemsProcessor', () => {
  let processor: CarSystemsProcessor;

  beforeEach(() => {
    processor = start();
  });

  describe('discovery', () => {
    it('reports only the adjustments the car actually exposes', () => {
      // A Formula Vee exposes brake bias and nothing else.
      processor.onFrame(frame({ dcBrakeBias: 48 }));

      expect(processor.snapshot().adjustments.map((a) => a.label)).toEqual([
        'Brake Bias',
      ]);
    });

    it('reports the fuller set a GT3 car exposes', () => {
      processor.onFrame(
        frame({
          dcBrakeBias: 54.5,
          dcABS: 2,
          dcTractionControl: 3,
          dcThrottleShape: 1,
        })
      );

      // The snapshot carries the full label; the widget renders the short form
      // from the shared catalogue, so this is the settings-facing name.
      expect(processor.snapshot().adjustments.map((a) => a.label)).toEqual([
        'Brake Bias',
        'ABS',
        'Traction Control',
        'Throttle Shape',
      ]);
    });

    it('ignores momentary controls that are not settings', () => {
      // dcTractionControlToggle reads false continuously on cars whose traction
      // control is plainly on, so it is not an on/off state and must not appear.
      processor.onFrame(
        frame({
          dcBrakeBias: 50,
          dcTractionControl: 4,
          dcTractionControlToggle: false,
          dcStarter: false,
          dcPitSpeedLimiterToggle: false,
          dcHeadlightFlash: false,
        })
      );

      expect(processor.snapshot().adjustments.map((a) => a.key)).toEqual([
        'dcBrakeBias',
        'dcTractionControl',
      ]);
    });

    /**
     * Values taken from a recorded Dallara IR18 session at Monza: the car
     * publishes no ABS or traction control at all, and its two hybrid dials sat
     * at DeployLevel 1.0 / RegenLevel 0.7 — matching the Hybrid block in the
     * session info for that stint.
     */
    it('reports the hybrid dials an IR18 exposes, and no assists it lacks', () => {
      processor.onFrame(
        frame({
          dcBrakeBias: 46.814,
          dcMGUKDeployFixed: 1,
          dcMGUKRegenGain: 0.7,
        })
      );

      expect(processor.snapshot().adjustments.map((a) => a.label)).toEqual([
        'Brake Bias',
        'Deploy Level',
        'Regen Level',
      ]);
      expect(byKey(processor, 'dcMGUKRegenGain')?.value).toBe(0.7);
      expect(byKey(processor, 'dcMGUKRegenGain')?.isOff).toBe(false);
    });

    /**
     * Non-hybrid cars do not publish these keys at all — checked against
     * recorded Mustang GT3, Ligier JSP320 and Oulton sessions — so discovery
     * leaves the rows out rather than showing every GT3 driver a dead column.
     */
    it('gives a non-hybrid car no hybrid rows', () => {
      processor.onFrame(frame({ dcBrakeBias: 54.5, dcABS: 2 }));

      expect(byKey(processor, 'dcMGUKDeployFixed')).toBeUndefined();
      expect(byKey(processor, 'dcMGUKRegenGain')).toBeUndefined();
    });

    it('marks a regen dial wound fully off as off', () => {
      processor.onFrame(frame({ dcMGUKRegenGain: 0 }));

      expect(byKey(processor, 'dcMGUKRegenGain')?.isOff).toBe(true);
    });

    /**
     * Raised by L061N on #723: both of these appear on the IR18 and neither was
     * covered. dcFuelMixture is confirmed present in the recorded Monza stint;
     * the jacker is there too, sat at 0 all session because a road course setup
     * locks it.
     */
    it('reports the fuel mixture and weight jacker an IR18 exposes', () => {
      processor.onFrame(
        frame({ dcBrakeBias: 46.814, dcFuelMixture: 1, dcWeightJackerRight: 0 })
      );

      expect(processor.snapshot().adjustments.map((a) => a.label)).toEqual([
        'Brake Bias',
        'Fuel Mixture',
        'Weight Jacker',
      ]);
    });

    /**
     * There is no left weight jacker on any car — the device works the right
     * rear only — so it is not in the catalogue and a frame carrying one is not
     * something iRacing produces. Pinned so it cannot creep back in.
     */
    it('offers no left weight jacker row', () => {
      processor.onFrame(
        frame({ dcWeightJackerLeft: 5, dcWeightJackerRight: 3 })
      );

      expect(processor.snapshot().adjustments.map((a) => a.key)).toEqual([
        'dcWeightJackerRight',
      ]);
    });
  });

  /**
   * A scale centred on zero cannot be judged by watching for a negative: the
   * neutral setting is the one the driver sits on, and a road course locks the
   * jacker to 0 for a whole session. Declaring it signed is what stops the
   * middle of the range being reported as "off".
   */
  describe('a scale declared signed', () => {
    it('treats a weight jacker at its neutral setting as a real value', () => {
      processor.onFrame(frame({ dcWeightJackerRight: 0 }));

      expect(byKey(processor, 'dcWeightJackerRight')?.isOff).toBe(false);
    });

    it('does not wait to observe a negative first', () => {
      processor.onFrame(frame({ dcWeightJackerRight: 4 }));
      processor.onFrame(frame({ dcWeightJackerRight: 0 }));

      expect(byKey(processor, 'dcWeightJackerRight')?.isOff).toBe(false);
    });

    it('still reports the value either side of zero', () => {
      processor.onFrame(frame({ dcWeightJackerRight: -12 }));
      expect(byKey(processor, 'dcWeightJackerRight')?.value).toBe(-12);

      processor.onFrame(frame({ dcWeightJackerRight: 15 }));
      expect(byKey(processor, 'dcWeightJackerRight')?.value).toBe(15);
    });

    it('leaves an undeclared scale to be judged by observation', () => {
      processor.onFrame(frame({ dcFuelMixture: 0 }));

      expect(byKey(processor, 'dcFuelMixture')?.isOff).toBe(true);
    });
  });

  describe('discovery, continued', () => {
    it('publishes dcPeakBrakeBias as its own row, not as brake bias', () => {
      // It is not a bias split on either car that publishes it - a rear brake
      // valve on the Clio, brake migration on the W13 - and the W13 publishes
      // it alongside a live dcBrakeBias, so folding the two together showed
      // the migration setting where the bias should be.
      processor.onFrame(frame({ dcBrakeBias: 52, dcPeakBrakeBias: 3 }));

      const rows = processor.snapshot().adjustments;
      expect(rows.map((row) => [row.key, row.value])).toEqual([
        ['dcBrakeBias', 52],
        ['dcPeakBrakeBias', 3],
      ]);
      expect(byKey(processor, 'dcPeakBrakeBias')?.label).toBe(
        'Rear Brake Valve'
      );
    });

    it('does not discover anything from an out-of-car frame', () => {
      // Spectating publishes a reduced set, so nothing seen out of the car can
      // be trusted to describe it. The frame carries real adjustments here on
      // purpose: discovery must be refused because of where it came from, not
      // because there was nothing in it.
      processor.onFrame(frame({ dcBrakeBias: 50, dcABS: 2 }, { inCar: false }));

      expect(processor.snapshot().discovered).toBe(false);
      expect(processor.snapshot().adjustments).toEqual([]);
    });

    it('picks up a variable that starts publishing a frame later', () => {
      processor.onFrame(frame({ dcBrakeBias: 50 }));
      processor.onFrame(frame({ dcBrakeBias: 50, dcABS: 3 }));

      expect(processor.snapshot().adjustments.map((a) => a.key)).toEqual([
        'dcBrakeBias',
        'dcABS',
      ]);
    });

    it('keeps a row whose variable stops appearing in later in-car frames', () => {
      processor.onFrame(frame({ dcBrakeBias: 50, dcABS: 3 }));
      // Still in the car, but ABS is missing from this frame. Dropping the row
      // would make the table flicker as rows come and go.
      processor.onFrame(frame({ dcBrakeBias: 50 }));

      expect(processor.snapshot().adjustments.map((a) => a.key)).toEqual([
        'dcBrakeBias',
        'dcABS',
      ]);
    });

    it('excludes a momentary control even when it reports a number', () => {
      // dcDashPage is a page index, not a setting to read back. Excluding it
      // has to be a decision about what belongs, not a side effect of the
      // boolean controls happening to fail a numeric check.
      processor.onFrame(
        frame({ dcBrakeBias: 50, dcDashPage: 2, dcDashPage2: 1 })
      );

      expect(processor.snapshot().adjustments.map((a) => a.key)).toEqual([
        'dcBrakeBias',
      ]);
    });
  });

  describe('leaving the car', () => {
    it('keeps the last known values rather than emptying the table', () => {
      processor.onFrame(frame({ dcBrakeBias: 54, dcABS: 2 }));
      processor.onFrame(frame({ dcStarter: false }, { inCar: false }));

      const rows = processor.snapshot().adjustments;
      expect(rows.map((a) => a.key)).toEqual(['dcBrakeBias', 'dcABS']);
      expect(byKey(processor, 'dcABS')?.value).toBe(2);
    });
  });

  describe('off detection', () => {
    it('marks a zero as off on an unsigned scale', () => {
      // A BMW M2 Racing sits at 0 for both when the driver switches them off.
      processor.onFrame(frame({ dcABS: 0, dcTractionControl: 0 }));

      expect(byKey(processor, 'dcABS')?.isOff).toBe(true);
      expect(byKey(processor, 'dcTractionControl')?.isOff).toBe(true);
    });

    it('does not mark a non-zero setting as off', () => {
      processor.onFrame(frame({ dcABS: 1, dcTractionControl: 3 }));

      expect(byKey(processor, 'dcABS')?.isOff).toBe(false);
      expect(byKey(processor, 'dcTractionControl')?.isOff).toBe(false);
    });

    it('does not treat zero as off once the scale is known to be signed', () => {
      // The BMW M Hybrid V8 reports ABS between -5 and -3, so zero on that
      // scale is an ordinary setting rather than the system being off.
      processor.onFrame(frame({ dcABS: -5 }));
      processor.onFrame(frame({ dcABS: 0 }));

      expect(byKey(processor, 'dcABS')?.isOff).toBe(false);
    });

    it('judges the scale of each variable independently', () => {
      processor.onFrame(frame({ dcABS: -3, dcTractionControl: 2 }));
      processor.onFrame(frame({ dcABS: 0, dcTractionControl: 0 }));

      expect(byKey(processor, 'dcABS')?.isOff).toBe(false);
      expect(byKey(processor, 'dcTractionControl')?.isOff).toBe(true);
    });
  });

  describe('publishing', () => {
    it('does not bump the version when nothing changed', () => {
      processor.onFrame(frame({ dcBrakeBias: 54, dcABS: 2 }));
      const version = processor.snapshot().version;

      processor.onFrame(frame({ dcBrakeBias: 54, dcABS: 2 }));
      processor.onFrame(frame({ dcBrakeBias: 54, dcABS: 2 }));

      expect(processor.snapshot().version).toBe(version);
    });

    it('bumps the version when the driver turns a dial', () => {
      processor.onFrame(frame({ dcBrakeBias: 54, dcABS: 2 }));
      const version = processor.snapshot().version;

      processor.onFrame(frame({ dcBrakeBias: 54, dcABS: 3 }));

      expect(processor.snapshot().version).toBeGreaterThan(version);
      expect(byKey(processor, 'dcABS')?.value).toBe(3);
    });
  });

  describe('staying on screen', () => {
    /**
     * ProcessorHost calls init() on every session update, and iRacing
     * republishes session data every second or two. Resetting there wiped the
     * discovered set and the values, so the table blinked empty until the next
     * frame refilled it - reported from a PEC qualifying session where it
     * flickered every second or two.
     */
    it('survives the repeated init that a session update triggers', () => {
      processor.onFrame(frame({ dcBrakeBias: 54, dcABS: 2 }));
      const before = processor.snapshot().adjustments;

      processor.init({} as Session);
      processor.init({} as Session);

      expect(processor.snapshot().adjustments).toEqual(before);
      expect(processor.snapshot().discovered).toBe(true);
    });

    it('does not republish when a session update arrives', () => {
      processor.onFrame(frame({ dcBrakeBias: 54, dcABS: 2 }));
      const version = processor.snapshot().version;

      processor.init({} as Session);

      // A version bump makes every subscriber re-render for no change.
      expect(processor.snapshot().version).toBe(version);
    });

    it('keeps its values on a frame that omits SessionNum', () => {
      processor.onFrame(frame({ dcBrakeBias: 54, dcABS: 2 }));

      // No SessionNum, and out of the car so nothing re-discovers within the
      // same frame. That is when a spurious reset is actually visible: the
      // table empties and stays empty. An in-car frame hides the damage by
      // repopulating immediately, which is why this one is deliberately not.
      const noSessionNum = {
        IsOnTrack: { value: [false] },
      } as unknown as Telemetry;
      processor.onFrame(noSessionNum);

      expect(processor.snapshot().adjustments.map((a) => a.key)).toEqual([
        'dcBrakeBias',
        'dcABS',
      ]);
      expect(processor.snapshot().discovered).toBe(true);
    });
  });

  describe('lifecycle', () => {
    it('records nothing during a replay', () => {
      const replaying = new CarSystemsProcessor();
      replaying.init({} as Session);
      replaying.onLifecycle({ type: 'enter', replay: true });

      replaying.onFrame(frame({ dcBrakeBias: 54, dcABS: 2 }));

      expect(replaying.snapshot().adjustments).toEqual([]);
      expect(replaying.snapshot().discovered).toBe(false);
    });

    it('forgets the car when the session changes', () => {
      processor.onFrame(frame({ dcBrakeBias: 54, dcABS: 2 }));

      processor.onLifecycle({ type: 'sessionNumChange' });

      expect(processor.snapshot().adjustments).toEqual([]);
      expect(processor.snapshot().discovered).toBe(false);
    });

    it('forgets the car on disconnect, so the next one starts clean', () => {
      processor.onFrame(frame({ dcBrakeBias: 54, dcABS: 2 }));

      processor.onLifecycle({ type: 'disconnect' });

      expect(processor.snapshot().discovered).toBe(false);
    });
  });

  /**
   * Le Mans Ultimate's dials, as its mapper publishes them: each under a key
   * of its own, with the top of every scale in LmuDialMax in the order of
   * LMU_DIAL_KEYS (ABS, TC, slip, cut, migration, map, front and rear bar).
   */
  describe("Le Mans Ultimate's dials", () => {
    /** The recorded LMGT3: no brake migration, a two-position map. */
    const LMGT3_MAX = [9, 11, 11, 11, 0, 1, 7, 7];
    const lmgt3 = (
      overrides: Record<string, number | boolean | number[] | undefined> = {}
    ) => ({
      dcBrakeBias: 51.75,
      dcABS: 9,
      dcTractionControl: 6,
      LmuTcSlip: 7,
      LmuTcCut: 7,
      LmuMotorMap: 1,
      LmuWiper: 1,
      LmuDialMax: LMGT3_MAX,
      BrakeABSactive: false,
      LmuTcActive: false,
      LmuOutOfCar: false,
      ...overrides,
    });

    it('reports each dial under its own name, in catalogue order', () => {
      processor.onFrame(frame(lmgt3()));

      expect(processor.snapshot().adjustments.map((a) => a.label)).toEqual([
        'Brake Bias',
        'ABS',
        'Traction Control',
        'TC Slip',
        'TC Cut',
        'Map',
        'Wipers',
      ]);
    });

    it('states the top of each scale the sim gives', () => {
      processor.onFrame(frame(lmgt3()));

      expect(byKey(processor, 'dcABS')?.max).toBe(9);
      expect(byKey(processor, 'dcTractionControl')?.max).toBe(11);
      expect(byKey(processor, 'LmuTcSlip')?.max).toBe(11);
      expect(byKey(processor, 'LmuTcCut')?.max).toBe(11);
      expect(byKey(processor, 'LmuMotorMap')?.max).toBe(1);
      // A split and a mode: neither has a scale to state.
      expect(byKey(processor, 'dcBrakeBias')?.max).toBeUndefined();
      expect(byKey(processor, 'LmuWiper')?.max).toBeUndefined();
    });

    it('republishes when the top of a scale changes', () => {
      processor.onFrame(frame(lmgt3()));
      const version = processor.snapshot().version;

      processor.onFrame(
        frame(lmgt3({ LmuDialMax: [12, 11, 11, 11, 0, 1, 7, 7] }))
      );

      expect(byKey(processor, 'dcABS')?.max).toBe(12);
      expect(processor.snapshot().version).toBeGreaterThan(version);
      // The scale moved, not the dial.
      expect(processor.snapshot().lastChange).toBeNull();
    });

    it('states no scale under iRacing, which publishes none', () => {
      processor.onFrame(frame({ dcBrakeBias: 54.5, dcABS: 2 }));

      expect(byKey(processor, 'dcABS')?.max).toBeUndefined();
      expect(byKey(processor, 'dcABS')).not.toHaveProperty('max');
    });

    it('reads position 0 of a migration dial or a map as a setting', () => {
      processor.onFrame(
        frame({
          LmuBrakeMigration: 0,
          LmuMotorMap: 0,
          LmuWiper: 0,
          LmuDialMax: [0, 0, 0, 0, 8, 5, 0, 0],
        })
      );

      expect(byKey(processor, 'LmuBrakeMigration')?.isOff).toBe(false);
      expect(byKey(processor, 'LmuMotorMap')?.isOff).toBe(false);
      expect(byKey(processor, 'LmuWiper')?.isOff).toBe(false);
    });

    it('still reads ABS, traction control, slip and cut at 0 as off', () => {
      processor.onFrame(
        frame(
          lmgt3({ dcABS: 0, dcTractionControl: 0, LmuTcSlip: 0, LmuTcCut: 0 })
        )
      );

      expect(byKey(processor, 'dcABS')?.isOff).toBe(true);
      expect(byKey(processor, 'dcTractionControl')?.isOff).toBe(true);
      expect(byKey(processor, 'LmuTcSlip')?.isOff).toBe(true);
      expect(byKey(processor, 'LmuTcCut')?.isOff).toBe(true);
    });

    it('does not take the car as entered while the player is at the monitor', () => {
      // A car left in its pit stall keeps the pit flags set while the player
      // sits at the monitor, which is what LmuOutOfCar is for.
      processor.onFrame(
        frame(lmgt3({ PlayerCarInPitStall: true, LmuOutOfCar: true }), {
          inCar: false,
        })
      );

      expect(processor.snapshot().discovered).toBe(false);
    });

    it('does not take a team-mate in the pit lane for the user in the car', () => {
      // Through a team-mate's stint the pit flags are the team car's, in
      // and out of the pits, and the mapper says the user is out of it.
      for (const pitFlags of [
        { OnPitRoad: true },
        { OnPitRoad: true, PlayerCarInPitStall: true },
      ]) {
        processor.onFrame(
          frame(lmgt3({ ...pitFlags, LmuOutOfCar: true, IsOnTrack: false }), {
            inCar: false,
          })
        );
      }

      expect(processor.snapshot().discovered).toBe(false);
    });
  });

  describe('a system intervening', () => {
    it('lights ABS from BrakeABSactive, under either sim', () => {
      processor.onFrame(frame({ dcABS: 3, BrakeABSactive: false }));
      expect(byKey(processor, 'dcABS')?.active).toBe(false);

      processor.onFrame(frame({ dcABS: 3, BrakeABSactive: true }));
      expect(byKey(processor, 'dcABS')?.active).toBe(true);
    });

    it('lights traction control from LmuTcActive', () => {
      processor.onFrame(frame({ dcTractionControl: 6, LmuTcActive: true }));

      expect(byKey(processor, 'dcTractionControl')?.active).toBe(true);
    });

    it('has no traction control light under iRacing, which has no flag', () => {
      processor.onFrame(frame({ dcTractionControl: 3, BrakeABSactive: true }));

      expect(byKey(processor, 'dcTractionControl')).not.toHaveProperty(
        'active'
      );
    });

    it('lights no other row', () => {
      processor.onFrame(
        frame({
          dcBrakeBias: 52,
          LmuTcSlip: 7,
          BrakeABSactive: true,
          LmuTcActive: true,
        })
      );

      expect(byKey(processor, 'dcBrakeBias')).not.toHaveProperty('active');
      expect(byKey(processor, 'LmuTcSlip')).not.toHaveProperty('active');
    });

    it('republishes when a light comes on, without calling it a dial moved', () => {
      processor.onFrame(frame({ dcABS: 3, BrakeABSactive: false }));
      processor.onFrame(frame({ dcABS: 3, BrakeABSactive: false }));
      const version = processor.snapshot().version;

      processor.onFrame(frame({ dcABS: 3, BrakeABSactive: true }));

      expect(processor.snapshot().version).toBeGreaterThan(version);
      expect(processor.snapshot().lastChange).toBeNull();
    });

    it('puts the light out when the car stops being read', () => {
      processor.onFrame(frame({ dcABS: 3, BrakeABSactive: true }));
      // Out of the car iRacing stops publishing the dial. The reading is
      // kept; a light kept with it would stay on for as long as it was.
      processor.onFrame(frame({ BrakeABSactive: true }, { inCar: false }));

      expect(byKey(processor, 'dcABS')?.value).toBe(3);
      expect(byKey(processor, 'dcABS')?.active).toBe(false);
    });
  });

  describe('a dial the driver moves', () => {
    it('reports the dial, where it was and where it is now', () => {
      processor.onFrame(frame({ dcTractionControl: 6 }));
      processor.onFrame(frame({ dcTractionControl: 7 }));

      expect(processor.snapshot().lastChange).toEqual({
        key: 'dcTractionControl',
        from: 6,
        to: 7,
        seq: 1,
      });
    });

    it('numbers each movement, so the same step twice is two changes', () => {
      processor.onFrame(frame({ dcTractionControl: 6 }));
      processor.onFrame(frame({ dcTractionControl: 7 }));
      processor.onFrame(frame({ dcTractionControl: 8 }));

      expect(processor.snapshot().lastChange).toEqual({
        key: 'dcTractionControl',
        from: 7,
        to: 8,
        seq: 2,
      });
    });

    it('keeps the last movement while nothing else moves', () => {
      processor.onFrame(frame({ dcTractionControl: 6, dcABS: 2 }));
      processor.onFrame(frame({ dcTractionControl: 7, dcABS: 2 }));
      processor.onFrame(frame({ dcTractionControl: 7, dcABS: 2 }));

      expect(processor.snapshot().lastChange?.seq).toBe(1);
    });

    it('says nothing on the first tick in the car', () => {
      processor.onFrame(frame({ dcTractionControl: 6, dcABS: 2 }));

      expect(processor.snapshot().lastChange).toBeNull();
    });

    it('says nothing for a value that differs after time out of the car', () => {
      // A setup loaded in the garage, or another driver's settings: the
      // value is different, and nobody turned a dial to make it so.
      processor.onFrame(frame({ dcTractionControl: 6 }));
      processor.onFrame(frame({ dcTractionControl: 6 }, { inCar: false }));
      processor.onFrame(frame({ dcTractionControl: 8 }));

      expect(byKey(processor, 'dcTractionControl')?.value).toBe(8);
      expect(processor.snapshot().lastChange).toBeNull();

      // From there on a step is a step again.
      processor.onFrame(frame({ dcTractionControl: 9 }));
      expect(processor.snapshot().lastChange).toMatchObject({
        from: 8,
        to: 9,
      });
    });

    it('says nothing for a value that changes at the LMU monitor', () => {
      processor.onFrame(frame({ dcTractionControl: 6, LmuOutOfCar: false }));
      // At the monitor with the car in its stall: the pit flag is set, the
      // dial is still published, and a setup is being loaded.
      const atMonitor = { PlayerCarInPitStall: true, LmuOutOfCar: true };
      processor.onFrame(
        frame({ dcTractionControl: 6, ...atMonitor }, { inCar: false })
      );
      processor.onFrame(
        frame({ dcTractionControl: 9, ...atMonitor }, { inCar: false })
      );
      processor.onFrame(frame({ dcTractionControl: 9, LmuOutOfCar: false }));

      expect(byKey(processor, 'dcTractionControl')?.value).toBe(9);
      expect(processor.snapshot().lastChange).toBeNull();
    });

    it('says nothing for a dial that starts publishing a tick late', () => {
      processor.onFrame(frame({ dcBrakeBias: 50 }));
      processor.onFrame(frame({ dcBrakeBias: 50, dcABS: 3 }));

      expect(processor.snapshot().lastChange).toBeNull();
    });

    it('says nothing for a value that comes back after a tick without it', () => {
      processor.onFrame(frame({ dcBrakeBias: 50, dcABS: 3 }));
      processor.onFrame(frame({ dcBrakeBias: 50 }));
      processor.onFrame(frame({ dcBrakeBias: 50, dcABS: 4 }));

      expect(processor.snapshot().lastChange).toBeNull();
    });

    it('says nothing when the session changes under the car', () => {
      processor.onFrame(frame({ dcTractionControl: 6 }));
      processor.onFrame(frame({ dcTractionControl: 7 }));
      expect(processor.snapshot().lastChange).not.toBeNull();

      processor.onLifecycle({ type: 'sessionNumChange' });
      expect(processor.snapshot().lastChange).toBeNull();

      // The new session opens on a different setup.
      processor.onFrame(frame({ dcTractionControl: 3 }));
      expect(processor.snapshot().lastChange).toBeNull();
    });

    it('forgets the last movement on disconnect and on entering a replay', () => {
      processor.onFrame(frame({ dcTractionControl: 6 }));
      processor.onFrame(frame({ dcTractionControl: 7 }));
      processor.onLifecycle({ type: 'disconnect' });
      expect(processor.snapshot().lastChange).toBeNull();

      processor.onLifecycle({ type: 'enter', replay: false });
      processor.onFrame(frame({ dcTractionControl: 6 }));
      processor.onFrame(frame({ dcTractionControl: 7 }));
      processor.onLifecycle({ type: 'enter', replay: true });
      expect(processor.snapshot().lastChange).toBeNull();
    });

    it('does not reuse a number after the session changes', () => {
      // The renderer restarts its timer on a new number, and may not have
      // seen the snapshot in between.
      processor.onFrame(frame({ dcTractionControl: 6 }));
      processor.onFrame(frame({ dcTractionControl: 7 }));
      processor.onLifecycle({ type: 'sessionNumChange' });
      processor.onFrame(frame({ dcTractionControl: 6 }));
      processor.onFrame(frame({ dcTractionControl: 7 }));

      expect(processor.snapshot().lastChange?.seq).toBe(2);
    });
  });

  describe('the brake bias baseline', () => {
    const inStall = { PlayerCarInPitStall: true, Speed: 0, SessionState: 4 };
    const onTrack = { PlayerCarInPitStall: false, SessionState: 4 };

    it('measures the bias from where it stood at rest in the pit stall', () => {
      processor.onFrame(frame({ dcBrakeBias: 52, ...inStall }));
      expect(byKey(processor, 'dcBrakeBias')?.baselineDelta).toBe(0);

      processor.onFrame(frame({ dcBrakeBias: 53.5, ...onTrack, Speed: 60 }));

      expect(byKey(processor, 'dcBrakeBias')?.baselineDelta).toBe(1.5);
    });

    it('does not move the baseline when the car stops out on the track', () => {
      processor.onFrame(frame({ dcBrakeBias: 52, ...inStall }));
      processor.onFrame(frame({ dcBrakeBias: 53.5, ...onTrack, Speed: 60 }));
      processor.onFrame(frame({ dcBrakeBias: 53.5, ...onTrack, Speed: 0 }));

      expect(byKey(processor, 'dcBrakeBias')?.baselineDelta).toBe(1.5);
    });

    it('takes a new baseline at rest on pit road', () => {
      processor.onFrame(frame({ dcBrakeBias: 52, ...inStall }));
      processor.onFrame(frame({ dcBrakeBias: 53.5, ...onTrack, Speed: 60 }));
      processor.onFrame(
        frame({ dcBrakeBias: 53.5, ...onTrack, OnPitRoad: true, Speed: 20 })
      );
      // Rolling down the pit lane is not at rest.
      expect(byKey(processor, 'dcBrakeBias')?.baselineDelta).toBe(1.5);

      processor.onFrame(
        frame({ dcBrakeBias: 53.5, ...onTrack, OnPitRoad: true, Speed: 0 })
      );
      expect(byKey(processor, 'dcBrakeBias')?.baselineDelta).toBe(0);
    });

    it('takes a new baseline at rest before the session has gone green', () => {
      processor.onFrame(frame({ dcBrakeBias: 52, ...inStall }));
      processor.onFrame(frame({ dcBrakeBias: 53.5, ...onTrack, Speed: 60 }));
      // Stopped on the grid, in the parade-laps state.
      processor.onFrame(
        frame({ dcBrakeBias: 53.5, ...onTrack, SessionState: 3, Speed: 0 })
      );

      expect(byKey(processor, 'dcBrakeBias')?.baselineDelta).toBe(0);
    });

    it('takes the first reading when the car is first seen moving', () => {
      processor.onFrame(frame({ dcBrakeBias: 51.75, ...onTrack, Speed: 55 }));

      expect(byKey(processor, 'dcBrakeBias')?.baselineDelta).toBe(0);
    });

    it('publishes a moved baseline without calling it a dial moved', () => {
      processor.onFrame(frame({ dcBrakeBias: 52, ...inStall }));
      processor.onFrame(frame({ dcBrakeBias: 53.5, ...onTrack, Speed: 60 }));
      const { version, lastChange } = processor.snapshot();
      expect(lastChange).toMatchObject({ key: 'dcBrakeBias', seq: 1 });

      processor.onFrame(
        frame({ dcBrakeBias: 53.5, ...onTrack, OnPitRoad: true, Speed: 0 })
      );

      expect(processor.snapshot().version).toBeGreaterThan(version);
      expect(processor.snapshot().lastChange?.seq).toBe(1);
    });

    it('starts again from the first reading after the session changes', () => {
      processor.onFrame(frame({ dcBrakeBias: 52, ...inStall }));
      processor.onFrame(frame({ dcBrakeBias: 53.5, ...onTrack, Speed: 60 }));
      processor.onLifecycle({ type: 'sessionNumChange' });

      processor.onFrame(frame({ dcBrakeBias: 54, ...onTrack, Speed: 60 }));

      expect(byKey(processor, 'dcBrakeBias')?.baselineDelta).toBe(0);
    });

    it('gives no other row a baseline', () => {
      processor.onFrame(frame({ dcBrakeBias: 52, dcABS: 3, ...inStall }));

      expect(byKey(processor, 'dcABS')).not.toHaveProperty('baselineDelta');
    });
  });
});
