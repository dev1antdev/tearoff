import { describe, expect, it } from 'vitest';
import type {
  LapLibraryLap,
  Session,
  WearSnapshot,
  WearWheelSnapshot,
} from '@irdashies/types';
import type { RendererTarget } from '../bridge/channelBus';
import {
  createLedgerHarness,
  ledgerSession,
  type LedgerHarnessOptions,
  type LedgerSim,
} from './playerLedgerFixture';

/**
 * The wear forecast as the ledger publishes it, on hand-built frames: a car
 * driven round a one-kilometre track at a lap a minute, wearing half a
 * percent of tread and two micrometres of disc a lap. The pit lane runs
 * from 0.9 of the lap to 0.1, so the line is inside it.
 */

const CAR = 'Ferrari 296 LMGT3 Evo';

/** The session with what the sim's REST API and class list add to it. */
const lmuSession = (): Session => {
  const session = ledgerSession() as unknown as {
    DriverInfo: { Drivers: Record<string, unknown>[] };
    LmuRest?: { brakeDiscNewMm: number[] };
  };
  session.DriverInfo.Drivers[0].CarClassShortName = 'LMGT3';
  session.LmuRest = { brakeDiscNewMm: [36, 36, 32, 32] };
  return session as unknown as Session;
};

const create = (options: LedgerHarnessOptions = {}) => {
  const harness = createLedgerHarness({ ...options, withoutSession: true });
  harness.runtime.onSession(lmuSession());
  return harness;
};

/** Lets a promise from the storage stand-in settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const PIT_SPEED = 10;

const enterPits = (sim: LedgerSim) => {
  sim.driveTo(0.9);
  sim.onPitRoad = true;
  sim.emit();
};

const leavePits = (sim: LedgerSim) => {
  sim.driveTo(0.1, PIT_SPEED);
  sim.onPitRoad = false;
  sim.emit();
};

const wheelsOf = (wear: WearSnapshot, key: keyof WearWheelSnapshot) =>
  wear.wheels.map((wheel) => wheel[key]);

describe('the wear forecast of the ledger', () => {
  describe('before it has laps', () => {
    it('shows what is left and no forecast, then the lap under way, then the laps', () => {
      const { sim, runtime } = create();
      sim.emit();

      // Joined half-way round: tread and discs are read, nothing is known
      // of how fast they go.
      const joined = runtime.wearSnapshot();
      expect(joined.available).toBe(true);
      expect(joined.wheels[0]).toMatchObject({
        treadPct: 100,
        treadLapPct: null,
        treadProjectedPct: null,
        treadPerLapPct: null,
        treadRateSource: null,
        treadLapsLeft: null,
        treadEndOfStintPct: null,
        brakeMm: 36,
        brakePerLapMm: null,
        brakeRateSource: null,
        brakeLapsLeft: null,
      });
      expect(joined.paceLapTime).toBeNull();

      // Over the line and a fifth of a lap on: too little to go by.
      sim.driveTo(0.2);
      const early = runtime.wearSnapshot();
      expect(early.wheels[0].treadLapPct).toBeCloseTo(0.1, 1);
      expect(early.wheels[0].treadPerLapPct).toBeNull();
      expect(early.wheels[0].treadLapsLeft).toBeNull();

      // Half-way round: the lap is heading for half a percent.
      sim.driveTo(0.5);
      const projected = runtime.wearSnapshot();
      expect(projected.wheels[0]).toMatchObject({
        treadProjectedPct: 0.5,
        treadPerLapPct: 0.5,
        treadRateSource: 'projected',
      });
      expect(projected.wheels[0].treadLapsLeft).toBeGreaterThan(195);
      expect(projected.wheels[0].treadLapsLeft).toBeLessThan(200);
      expect(projected.wheels[0]).toMatchObject({
        brakePerLapMm: 0.002,
        brakeRateSource: 'projected',
      });

      // The lap done: measured, on this tyre and in this stint.
      sim.driveTo(0.1);
      const measured = runtime.wearSnapshot();
      expect(wheelsOf(measured, 'treadPerLapPct')).toEqual([
        0.5, 0.5, 0.5, 0.5,
      ]);
      expect(wheelsOf(measured, 'treadRateSource')).toEqual([
        'tyre',
        'tyre',
        'tyre',
        'tyre',
      ]);
      expect(measured.wheels[0]).toMatchObject({
        brakePerLapMm: 0.002,
        brakeRateSource: 'stint',
      });
      expect(measured.paceLapTime).toBe(60);
    });

    it('starts from what the compound cost in earlier sessions', async () => {
      const before: LapLibraryLap = {
        lapTime: 61,
        fuelUsed: 2.5,
        energyUsed: 0.021,
        ledger: {
          flags: 0,
          compounds: ['Medium', 'Medium', 'Medium', 'Medium'],
          treadUsed: [0.004, 0.004, 0.003, 0.003],
          brakeUsed: [0.002, 0.002, 0.001, 0.001],
        },
      } as unknown as LapLibraryLap;
      const { sim, runtime } = create({ baseline: [before] });
      await settle();
      sim.emit();

      const wear = runtime.wearSnapshot();
      expect(wheelsOf(wear, 'treadPerLapPct')).toEqual([0.4, 0.4, 0.3, 0.3]);
      expect(wheelsOf(wear, 'treadRateSource')).toEqual([
        'baseline',
        'baseline',
        'baseline',
        'baseline',
      ]);
      expect(wear.wheels[0].treadLapsLeft).toBe(250);
      expect(wear.wheels[0]).toMatchObject({
        brakePerLapMm: 0.002,
        brakeRateSource: 'baseline',
      });
      // 50 L at 2.5 L a lap is 20 laps: 100 percent less 20 times 0.4.
      expect(wear.budgetLapsLeft).toBe(20);
      expect(wear.wheels[0].treadEndOfStintPct).toBe(92);
      expect(wear.paceLapTime).toBe(61);
    });
  });

  describe('tyres', () => {
    it('measures a lap that wore 0.005 of the tread as 0.50 percent', () => {
      const { sim, runtime } = create();
      sim.emit();
      sim.driveLaps(2.6);

      const wear = runtime.wearSnapshot();
      expect(wear.wheels[0].treadPerLapPct).toBe(0.5);
      // 100 percent less the two laps and a bit driven, at half a percent.
      expect(wear.wheels[0].treadPct).toBeCloseTo(98.7, 1);
      expect(wear.wheels[0].treadLapsLeft).toBe(197);
    });

    it('does not count a fall of the reading in the pit lane as wear', () => {
      const { sim, runtime } = create();
      sim.emit();
      sim.driveLaps(1.6);
      enterPits(sim);
      const before = runtime.wearSnapshot().wheels[0];

      // The reading drifts down while the car rolls along the lane.
      sim.tread = sim.tread.map((value) => (value ?? 0) - 0.002);
      sim.drive(2, PIT_SPEED);

      const after = runtime.wearSnapshot().wheels[0];
      expect(after.treadPct).toBeCloseTo((before.treadPct ?? 0) - 0.2, 1);
      expect(after.treadLapPct).toBe(before.treadLapPct);
    });

    it('forecasts another set of the same compound at what the last one wore', () => {
      const { sim, runtime } = create();
      sim.tread = [0.5, 0.5, 0.5, 0.5];
      sim.emit();
      sim.driveLaps(2.6);
      expect(runtime.wearSnapshot().wheels[0]).toMatchObject({
        treadPerLapPct: 0.5,
        treadRateSource: 'tyre',
      });

      // A rise of 0.4 in the pits is a new left front.
      enterPits(sim);
      sim.stand(2);
      sim.tread[0] = (sim.tread[0] ?? 0) + 0.4;
      sim.stand(2);

      const wear = runtime.wearSnapshot();
      expect(wear.wheels[0].treadPct).toBeCloseTo(88.5, 0);
      // Its own laps are gone; the session's stand in, as an estimate.
      expect(wear.wheels[0]).toMatchObject({
        treadPerLapPct: 0.5,
        treadRateSource: 'session',
      });
      expect(wear.wheels[1].treadRateSource).toBe('tyre');
    });

    it('does not forecast another compound at the rate of the one it replaced', () => {
      const { sim, runtime } = create();
      sim.tread = [0.5, 0.5, 0.5, 0.5];
      sim.emit();
      sim.driveLaps(2.6);

      // Hards on the left front, where mediums were.
      enterPits(sim);
      sim.stand(2);
      sim.tread[0] = 1;
      sim.compound[0] = 1;
      sim.stand(2);

      const fitted = runtime.wearSnapshot();
      expect(fitted.wheels[0]).toMatchObject({
        treadPct: 100,
        compound: 1,
        treadPerLapPct: null,
        treadRateSource: null,
        treadLapsLeft: null,
      });
      expect(fitted.wheels[1]).toMatchObject({
        compound: 0,
        treadPerLapPct: 0.5,
        treadRateSource: 'tyre',
      });

      // Out of the pits and round to the first clean lap on it.
      leavePits(sim);
      sim.driveLaps(2);
      expect(runtime.wearSnapshot().wheels[0]).toMatchObject({
        treadPerLapPct: 0.5,
        treadRateSource: 'tyre',
      });
    });

    it('keeps the laps on a tyre from one session to the next', () => {
      const { sim, runtime } = create();
      sim.emit();
      sim.driveLaps(2.6);

      sim.sessionNum = 1;
      sim.emit();

      const wear = runtime.wearSnapshot();
      expect(wear.sessionNum).toBe(1);
      expect(wear.wheels[0]).toMatchObject({
        treadPerLapPct: 0.5,
        treadRateSource: 'tyre',
        // The lap that was under way went with the session.
        treadLapPct: null,
      });
    });

    it('counts the laps down to the tread the wear widget calls finished', () => {
      const tuning = { floorPct: 0, failureFrontMm: 0, failureRearMm: 0 };
      const { sim, runtime } = create({ wear: { tuning: () => tuning } });
      sim.emit();
      sim.driveLaps(2.6);
      const toNothing = runtime.wearSnapshot().wheels[0].treadLapsLeft ?? 0;

      tuning.floorPct = 30;

      // 30 percent of tread less to wear at half a percent a lap.
      expect(runtime.wearSnapshot().wheels[0].treadLapsLeft).toBe(
        toNothing - 60
      );
    });
  });

  describe('brakes', () => {
    it('gives the discs against the setup and the figure for the class', () => {
      const { sim, runtime } = create();
      sim.emit();
      sim.driveLaps(2.6);

      const wear = runtime.wearSnapshot();
      expect(wear.brakeNewMm).toEqual([36, 32]);
      expect(wear.brakeFailureMm).toEqual([30, 30]);
      expect(wear.brakeFailureSource).toEqual(['class', 'class']);
      expect(wear.wheels[0]).toMatchObject({
        brakeMm: 35.99,
        brakeLifePct: 99.9,
        brakePerLapMm: 0.002,
        brakeLapsLeft: 999,
        brakeFailed: false,
      });
      expect(wear.wheels[2].brakeLifePct).toBe(99.7);
      expect(wear.brakeStale).toBe(false);
    });

    it('takes the failure thickness the wear widget sets', () => {
      const { sim, runtime } = create({
        wear: {
          tuning: () => ({ floorPct: 0, failureFrontMm: 35, failureRearMm: 0 }),
        },
      });
      sim.emit();
      sim.driveLaps(2.6);

      const wear = runtime.wearSnapshot();
      expect(wear.brakeFailureMm).toEqual([35, 30]);
      expect(wear.brakeFailureSource).toEqual(['setting', 'class']);
      // A millimetre of disc at two micrometres a lap.
      expect(wear.wheels[0].brakeLapsLeft).toBeGreaterThan(490);
      expect(wear.wheels[0].brakeLapsLeft).toBeLessThan(500);
    });

    it('has no brake figures for a sim that gives no thickness', () => {
      const { sim, runtime } = create({ brakePerLap: null });
      sim.emit();
      sim.driveLaps(1.6);

      const wear = runtime.wearSnapshot();
      expect(wear.brakeNewMm).toEqual([36, 32]);
      expect(wear.wheels[0]).toMatchObject({
        treadPerLapPct: 0.5,
        brakeMm: null,
        brakePerLapMm: null,
        brakeLapsLeft: null,
      });
    });

    /** Brakes for a few seconds with the REST API answering twice a second. */
    const brakeOn = (sim: LedgerSim, seconds: number) => {
      sim.extra.Brake = [0.5];
      for (let step = 0; step < seconds * 2; step += 1) {
        sim.extra.LmuRestWearablesSeq = [100 + step];
        sim.drive(0.5);
      }
    };

    it('keeps the thickness a brake failed at for the car, and only while storing', () => {
      const kept = new Map<string, number>();
      const limits = {
        get: (key: string) => kept.get(key),
        set: (key: string, mm: number) => void kept.set(key, mm),
      };
      // Discs worn to 26 mm that no longer wear at all.
      const live = create({ brakePerLap: 0, wear: { limits } });
      live.sim.brake = [26, 26, 31.9, 31.9];
      live.sim.emit();
      brakeOn(live.sim, 5);

      const wear = live.runtime.wearSnapshot();
      expect(wheelsOf(wear, 'brakeFailed')).toEqual([true, true, false, false]);
      expect(wear.brakeFailureMm).toEqual([26, 30]);
      expect(wear.brakeFailureSource).toEqual(['learned', 'class']);
      expect([...kept]).toEqual([[`lmu|${CAR}|front`, 26]]);

      // A tape or demo mode learns it for the drive and keeps nothing.
      kept.clear();
      const tape = create({ brakePerLap: 0, wear: { limits } });
      tape.runtime.setPersisting(false);
      tape.sim.brake = [26, 26, 31.9, 31.9];
      tape.sim.emit();
      brakeOn(tape.sim, 5);

      expect(tape.runtime.wearSnapshot().brakeFailureSource).toEqual([
        'learned',
        'class',
      ]);
      expect(kept.size).toBe(0);
    });

    it('reads a thickness learned in an earlier session', () => {
      const limits = {
        get: (key: string) => (key === `lmu|${CAR}|rear` ? 31 : undefined),
        set: () => undefined,
      };
      const { sim, runtime } = create({ wear: { limits } });
      sim.emit();

      const wear = runtime.wearSnapshot();
      expect(wear.brakeFailureMm).toEqual([30, 31]);
      expect(wear.brakeFailureSource).toEqual(['class', 'learned']);
    });
  });

  describe('publishing', () => {
    const windowOn = (sent: WearSnapshot[]): RendererTarget => ({
      id: 9,
      isDestroyed: () => false,
      isVisible: () => true,
      send: (_channel, name, payload) => {
        if (name === 'wear.snapshot') sent.push(payload as WearSnapshot);
      },
    });

    it('reaches a window that subscribes late with the forecast as it stands', () => {
      const { sim, bus } = create();
      sim.emit();
      sim.driveLaps(2.6);
      const sent: WearSnapshot[] = [];

      bus.subscribe(windowOn(sent), 'wear.snapshot');

      expect(sent).toHaveLength(1);
      expect(sent[0].available).toBe(true);
      expect(sent[0].wheels[0]).toMatchObject({
        treadPerLapPct: 0.5,
        treadLapsLeft: 197,
      });
    });

    it('moves the version with its rounded figures, and not at a standstill', () => {
      const { sim, runtime, bus } = create({ step: 0.05 });
      bus.subscribe(windowOn([]), 'wear.snapshot');
      sim.emit();
      const before = runtime.wearSnapshot().version;

      // Two hundred frames, a sixth of a lap: tread to a tenth of a percent
      // does not move at all, the lap's own wear a hundredth at a time.
      sim.drive(10);
      const driving = runtime.wearSnapshot().version - before;
      sim.stand(10);
      const standing = runtime.wearSnapshot().version - before - driving;

      expect(driving).toBeGreaterThanOrEqual(1);
      expect(driving).toBeLessThanOrEqual(50);
      expect(standing).toBe(0);
    });

    it('says there is no car at the monitor, and forgets on a disconnect', () => {
      const { sim, runtime, lifecycle } = create();
      sim.emit();
      sim.driveLaps(2.6);

      sim.hasCar = false;
      sim.emit();
      expect(runtime.wearSnapshot().available).toBe(false);

      // Back in the car: the laps on these tyres are still there.
      sim.hasCar = true;
      sim.emit();
      expect(runtime.wearSnapshot().wheels[0]).toMatchObject({
        treadPerLapPct: 0.5,
        treadRateSource: 'tyre',
      });

      lifecycle._onDisconnect();
      expect(runtime.wearSnapshot().available).toBe(false);
      sim.emit();
      const again = runtime.wearSnapshot();
      expect(again.available).toBe(true);
      expect(again.wheels[0].treadPerLapPct).toBeNull();
    });
  });
});
