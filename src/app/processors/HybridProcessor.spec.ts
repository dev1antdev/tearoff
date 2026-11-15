import { describe, expect, it } from 'vitest';
import type { Session, Telemetry } from '@irdashies/types';
import {
  HybridProcessor,
  hybridPowerKw,
  hybridTemperatureC,
} from './HybridProcessor';

/**
 * Every frame here is built by hand. No recording holds a car with a hybrid
 * system, so these pin the rules as the specification states them, not what
 * a Hypercar does; the figures are of the size its units would give.
 */

type Values = Record<string, number | boolean>;

const frame = (values: Values): Telemetry =>
  Object.fromEntries(
    Object.entries(values).map(([key, current]) => [key, { value: [current] }])
  ) as unknown as Telemetry;

const TRACK_M = 1000;

const session = (trackLength = `${TRACK_M} m`): Session =>
  ({ WeekendInfo: { TrackLength: trackLength } }) as unknown as Session;

/** In the car, on the track, in session 0. */
const IN_CAR: Values = {
  IsOnTrack: true,
  OnPitRoad: false,
  PlayerCarInPitStall: false,
  IsInGarage: false,
  IsReplayPlaying: false,
  SessionNum: 0,
  PlayerCarIdx: 7,
};

/**
 * A car driven through a processor a tick at a time. Charge is given in
 * percent, as the snapshot states it; the frame carries the fraction the
 * mapper publishes.
 */
class Drive {
  readonly processor = new HybridProcessor();
  time = 100;
  lapCompleted = 3;
  /** The motor state the sim reports until a tick says otherwise. */
  state = 1;
  /** Seconds between ticks: 25 a second, as the processor runs. */
  stepS = 0.04;

  constructor(trackLength?: string) {
    this.processor.init(session(trackLength));
    this.processor.onLifecycle({ type: 'enter', replay: false });
  }

  /** One tick at a charge, `stepS` after the last. */
  tick(chargePct: number, extra: Values = {}) {
    this.time += this.stepS;
    this.processor.onFrame(
      frame({
        ...IN_CAR,
        SessionTime: this.time,
        LmuBatteryCharge: chargePct / 100,
        LmuMotorState: this.state,
        LapCompleted: this.lapCompleted,
        LapDistPct: 0.5,
        ...extra,
      })
    );
    return this.processor.snapshot();
  }

  /** A tick at a moment of the session clock. */
  tickAt(time: number, chargePct: number, extra: Values = {}) {
    this.time = time - this.stepS;
    return this.tick(chargePct, extra);
  }

  /**
   * One lap from the line: the count goes up as the distance wraps, then a
   * tick every 10 m with the charge `chargeAt` gives for it. Stops at
   * `untilM`, short of the next line.
   */
  lap(
    chargeAt: (metres: number) => number,
    {
      untilM = TRACK_M - 10,
      extraAt,
    }: { untilM?: number; extraAt?: (metres: number) => Values } = {}
  ) {
    this.stepS = 0.1;
    this.lapCompleted += 1;
    for (let metres = 0; metres <= untilM; metres += 10) {
      this.tick(chargeAt(metres), {
        LapDistPct: metres / TRACK_M,
        ...extraAt?.(metres),
      });
    }
    return this.processor.snapshot();
  }

  get snapshot() {
    return this.processor.snapshot();
  }
}

/** Straight lines between the points of a lap, flat after the last. */
const through =
  (points: readonly (readonly [number, number])[]) =>
  (metres: number): number => {
    for (let index = 1; index < points.length; index += 1) {
      const [fromM, fromValue] = points[index - 1];
      const [toM, toValue] = points[index];
      if (metres <= toM) {
        return (
          fromValue + ((metres - fromM) / (toM - fromM)) * (toValue - fromValue)
        );
      }
    }
    return points[points.length - 1][1];
  };

/**
 * The lap the specification measures the next one against, from a charge of
 * 50: a net change of -5 a quarter of the way round, -8 at half, -3 at
 * three quarters and -2 at the line.
 */
const REFERENCE_LAP = through([
  [0, 50],
  [250, 45],
  [500, 42],
  [750, 47],
  [990, 48],
]);

/** The lap after it, from 48: a net change of -10 by half way. */
const NEXT_LAP = through([
  [0, 48],
  [500, 38],
]);

describe('HybridProcessor', () => {
  describe('whether the car has the system', () => {
    it('never says so, and never publishes, for a car that shows nothing', () => {
      // A GT3: the motor state reads 0 and the mapper publishes no charge.
      const processor = new HybridProcessor();
      processor.init(session());
      processor.onLifecycle({ type: 'enter', replay: false });
      for (let tick = 0; tick < 200; tick += 1) {
        processor.onFrame(
          frame({
            ...IN_CAR,
            SessionTime: 100 + tick * 0.04,
            LmuMotorState: 0,
            LmuStateOfCharge: 0,
            LmuRegen: 0,
            LapCompleted: Math.floor(tick / 50),
            LapDistPct: (tick % 50) / 50,
          })
        );
      }

      expect(processor.snapshot()).toMatchObject({
        available: false,
        chargePct: null,
        motorState: 0,
        sessionNum: null,
        version: 0,
      });
    });

    it('does not take a charge of 0 with no motor state for a battery', () => {
      const drive = new Drive();
      drive.state = 0;
      for (let tick = 0; tick < 20; tick += 1) drive.tick(0);

      expect(drive.snapshot.available).toBe(false);
      expect(drive.snapshot.version).toBe(0);
    });

    it('says so from the first frame in the car with a motor state', () => {
      const drive = new Drive();
      drive.state = 1;
      const snapshot = drive.tick(62.5);

      expect(snapshot).toMatchObject({
        available: true,
        chargePct: 62.5,
        motorState: 1,
        motorStateInferred: false,
        sessionNum: 0,
        version: 1,
      });
    });

    it('says so once the charge moves, where the sim states no motor state', () => {
      const drive = new Drive();
      drive.state = 0;
      // A charge is not yet a battery.
      expect(drive.tick(40).available).toBe(false);
      expect(drive.tick(40).available).toBe(false);
      expect(drive.snapshot.version).toBe(0);

      // One that falls is, and the fall is booked.
      expect(drive.tick(39.8)).toMatchObject({
        available: true,
        chargePct: 39.8,
        motorState: 2,
        motorStateInferred: true,
        drainLapPct: 0.2,
        version: 1,
      });
    });

    it('does not take a charge that never moves for a battery', () => {
      // No recorded car does this: the GT3 reads 0. A car with no battery
      // that reported a constant must not be given a widget that reads it.
      const drive = new Drive();
      drive.state = 0;
      for (let tick = 0; tick < 200; tick += 1) {
        drive.tick(100, { LapDistPct: (tick % 50) / 50 });
      }
      // Dropping to 0 and coming back is not movement either.
      drive.tick(0);
      drive.tick(100);

      expect(drive.snapshot).toMatchObject({
        available: false,
        chargePct: null,
        version: 0,
      });
    });

    it('takes a motor that states what it is doing for a hybrid with no charge read', () => {
      const processor = new HybridProcessor();
      processor.init(session());
      processor.onFrame(
        frame({ ...IN_CAR, SessionTime: 100, LmuMotorState: 1 })
      );

      expect(processor.snapshot()).toMatchObject({
        available: true,
        chargePct: null,
        version: 1,
      });
    });

    it('waits for a frame from inside the car', () => {
      const drive = new Drive();
      // At the monitor with the car in its stall: the pit flag is still set.
      drive.tick(62.5, {
        IsOnTrack: false,
        OnPitRoad: true,
        LmuOutOfCar: true,
      });
      drive.tick(62.5, { IsOnTrack: false, IsInGarage: true });
      drive.tick(62.5, { IsReplayPlaying: true });
      expect(drive.snapshot.available).toBe(false);

      // In the box counts as in the car.
      drive.tick(62.5, { IsOnTrack: false, PlayerCarInPitStall: true });
      expect(drive.snapshot.available).toBe(true);
    });

    it('keeps saying so once it has, with the last readings, out of the car', () => {
      const drive = new Drive();
      drive.tick(62.5);
      const version = drive.snapshot.version;
      drive.tick(10, { IsOnTrack: false, LmuOutOfCar: true });

      expect(drive.snapshot).toMatchObject({
        available: true,
        chargePct: 62.5,
        version,
      });
    });

    it('reads nothing under a sim that publishes none of it', () => {
      // iRacing: none of the keys, whatever the car.
      const processor = new HybridProcessor();
      processor.init(session('3.6 km'));
      processor.onFrame(
        frame({ ...IN_CAR, SessionTime: 10, LapCompleted: 1, LapDistPct: 0.2 })
      );

      expect(processor.snapshot().available).toBe(false);
      expect(processor.snapshot().version).toBe(0);
    });
  });

  describe('what a lap used and recovered', () => {
    it('books a falling charge as used', () => {
      const drive = new Drive();
      drive.state = 2;
      drive.tick(80);
      drive.tick(79.5);
      const snapshot = drive.tick(79);

      expect(snapshot).toMatchObject({
        chargePct: 79,
        drainLapPct: 1,
        regenLapPct: 0,
        motorState: 2,
        motorStateInferred: false,
      });
    });

    it('books a rising charge as recovered', () => {
      const drive = new Drive();
      drive.state = 2;
      drive.tick(80);
      drive.tick(79.5);
      drive.tick(79);
      drive.state = 3;
      drive.tick(79);
      const snapshot = drive.tick(79.4);

      expect(snapshot).toMatchObject({
        drainLapPct: 1,
        regenLapPct: 0.4,
        motorState: 3,
      });
    });

    it('does not book a step from exactly 0', () => {
      // A battery that read 0 for a frame at a reset is not one that was
      // charged from empty.
      const drive = new Drive();
      drive.state = 3;
      drive.tick(0);
      const snapshot = drive.tick(5);

      expect(snapshot).toMatchObject({ chargePct: 5, regenLapPct: 0 });
    });

    it('does not book a fall that lands on 0', () => {
      const drive = new Drive();
      drive.state = 2;
      drive.tick(0.4);
      const snapshot = drive.tick(0);

      expect(snapshot).toMatchObject({ chargePct: 0, drainLapPct: 0 });
    });

    it('does not book a rise that lands on 100', () => {
      const drive = new Drive();
      drive.state = 3;
      drive.tick(99.5);
      const snapshot = drive.tick(100);

      expect(snapshot).toMatchObject({ chargePct: 100, regenLapPct: 0 });
    });

    it('runs a battery from full to nearly empty and back', () => {
      const drive = new Drive();
      drive.state = 2;
      for (let charge = 100; charge >= 2; charge -= 2) drive.tick(charge);
      expect(drive.snapshot).toMatchObject({
        chargePct: 2,
        drainLapPct: 98,
        regenLapPct: 0,
      });

      drive.state = 3;
      for (let charge = 2; charge <= 98; charge += 2) drive.tick(charge);
      expect(drive.snapshot).toMatchObject({
        chargePct: 98,
        drainLapPct: 98,
        regenLapPct: 96,
      });
    });

    it('turns the totals over at the line', () => {
      const drive = new Drive();
      drive.state = 2;
      drive.tick(80);
      drive.tick(78);
      drive.state = 3;
      drive.tick(79);
      drive.state = 2;
      // Deploying across the line, which is half a second on.
      drive.stepS = 0.5;
      const before = drive.tick(78.5);
      expect(before).toMatchObject({
        drainLapPct: 2.5,
        regenLapPct: 1,
        drainLastLapPct: null,
        regenLastLapPct: null,
      });

      drive.lapCompleted = 4;
      const after = drive.tick(78.5, { LapDistPct: 0 });
      expect(after).toMatchObject({
        drainLapPct: 0,
        regenLapPct: 0,
        drainLastLapPct: 2.5,
        regenLastLapPct: 1,
        lapElapsedS: 0,
      });
      // The deployment goes on counting, from zero.
      expect(after.deployTimeLapS).toBe(0.5);

      // The lap clock runs from that line, in whole seconds.
      drive.stepS = 0.75;
      drive.tick(78);
      drive.tick(77.5);
      drive.tick(77.5);
      expect(drive.snapshot).toMatchObject({
        drainLapPct: 1,
        drainLastLapPct: 2.5,
        lapElapsedS: 2,
      });
    });

    it('stops carrying the lap clock at 30 seconds', () => {
      const drive = new Drive();
      drive.tick(50);
      drive.lapCompleted = 4;
      drive.tick(50);
      drive.stepS = 0.9;
      for (let tick = 0; tick < 40; tick += 1) drive.tick(50);

      expect(drive.snapshot.lapElapsedS).toBe(30);
    });

    it("takes the sim's lap clock until it has seen a line", () => {
      const drive = new Drive();

      expect(drive.tick(50, { LapCurrentLapTime: 12.7 }).lapElapsedS).toBe(12);
      expect(drive.tick(50, { LapCurrentLapTime: 71.2 }).lapElapsedS).toBe(30);
    });

    it('books nothing across a gap in the clock of more than a second', () => {
      const drive = new Drive();
      drive.state = 2;
      drive.tick(80);
      drive.tick(79);
      // The window was hidden for four seconds and the processor not run.
      drive.stepS = 4;
      drive.tick(60);
      drive.stepS = 0.04;
      const snapshot = drive.tick(59.5);

      expect(snapshot).toMatchObject({ chargePct: 59.5, drainLapPct: 1.5 });
      expect(snapshot.deployTimeLapS).toBe(0.1);
    });

    it('adds nothing while the sim is paused, or the frame is stale', () => {
      const drive = new Drive();
      drive.state = 2;
      drive.tick(80);
      drive.tick(79);
      const { version } = drive.snapshot;

      for (let tick = 0; tick < 50; tick += 1) {
        drive.tick(70, { LmuGamePaused: true });
      }
      for (let tick = 0; tick < 50; tick += 1) {
        drive.tick(65, { LmuDataStale: true });
      }
      expect(drive.snapshot).toMatchObject({
        chargePct: 79,
        drainLapPct: 1,
        deployTimeLapS: 0,
        version,
      });

      // The first frame after it is a new baseline, not a step.
      drive.tick(60);
      expect(drive.snapshot).toMatchObject({ chargePct: 60, drainLapPct: 1 });
      expect(drive.tick(59).drainLapPct).toBe(2);
    });
  });

  describe('the motor state', () => {
    it('is inferred from the charge where the sim states none', () => {
      const drive = new Drive();
      drive.state = 0;
      drive.tick(80);
      expect(drive.tick(79.6)).toMatchObject({
        motorState: 2,
        motorStateInferred: true,
      });
      expect(drive.tick(79.9)).toMatchObject({
        motorState: 3,
        motorStateInferred: true,
      });

      // Still for two ticks: not yet idle.
      drive.tick(79.9);
      expect(drive.tick(79.9).motorState).toBe(3);
      // And for a third.
      expect(drive.tick(79.9)).toMatchObject({
        motorState: 1,
        motorStateInferred: true,
      });
    });

    it("is the sim's wherever it states one", () => {
      const drive = new Drive();
      drive.state = 3;
      drive.tick(80);
      // The charge falls, and the sim still says regenerating.
      expect(drive.tick(79)).toMatchObject({
        motorState: 3,
        motorStateInferred: false,
      });
    });

    it('takes a state it does not know for none', () => {
      const drive = new Drive();
      drive.tick(80);
      drive.state = 9;
      drive.tick(80);
      expect(drive.tick(79.5)).toMatchObject({
        motorState: 2,
        motorStateInferred: true,
      });
    });

    it('times a deployment from the tick it starts to the tick it ends', () => {
      const drive = new Drive();
      drive.stepS = 0.2;
      drive.state = 1;
      drive.tickAt(9.8, 80);
      expect(drive.snapshot.sinceDeployS).toBeNull();

      drive.state = 2;
      drive.tickAt(10, 80);
      expect(drive.snapshot).toMatchObject({
        deployTimeLapS: 0,
        sinceDeployS: null,
      });
      while (drive.time < 13.2 - 0.3) drive.tick(80);
      drive.state = 1;
      drive.tickAt(13.2, 80);
      expect(drive.snapshot).toMatchObject({
        deployTimeLapS: 3.2,
        sinceDeployS: 0,
      });

      // Since the deployment ended, on the session clock.
      drive.tickAt(13.8, 80);
      drive.tickAt(14.2, 80);
      expect(drive.snapshot).toMatchObject({
        deployTimeLapS: 3.2,
        sinceDeployS: 1,
      });

      // And nothing again as the next one starts.
      drive.state = 2;
      drive.tickAt(14.6, 80);
      expect(drive.snapshot.sinceDeployS).toBeNull();
      drive.tickAt(15, 80);
      expect(drive.snapshot.deployTimeLapS).toBe(3.6);
    });
  });

  describe('the estimate of the lap', () => {
    /** A car at the end of a lap, about to start one from the line. */
    const atTheLine = () => {
      const drive = new Drive();
      drive.stepS = 0.1;
      drive.tick(50, { LapDistPct: 0.98 });
      drive.tick(50, { LapDistPct: 0.99 });
      return drive;
    };

    it('has none on the first lap', () => {
      const drive = atTheLine();
      const snapshot = drive.lap(REFERENCE_LAP);

      expect(snapshot.netLapEstimatePct).toBeNull();
      expect(snapshot).toMatchObject({ drainLapPct: 8, regenLapPct: 6 });
    });

    it('measures the next lap against the one before at the same place', () => {
      const drive = atTheLine();
      drive.lap(REFERENCE_LAP);
      const snapshot = drive.lap(NEXT_LAP, { untilM: 500 });

      // Last lap ended at -2 and was at -8 here; this one is at -10.
      expect(snapshot).toMatchObject({
        drainLastLapPct: 8,
        regenLastLapPct: 6,
        drainLapPct: 10,
        regenLapPct: 0,
        netLapEstimatePct: -4,
      });
    });

    it('is that lap’s total for the first moments after the line', () => {
      const drive = atTheLine();
      drive.lap(REFERENCE_LAP);
      // 0.2 s into the lap and a whole point down already, where the lap
      // before had used 0.4 by here.
      const early = drive.lap(
        through([
          [0, 48],
          [20, 47],
        ]),
        { untilM: 20 }
      );
      expect(early.drainLapPct).toBe(1);
      expect(early.netLapEstimatePct).toBe(-2);

      // Past 0.3 s the difference counts: the lap before was at -0.8 here.
      drive.stepS = 0.25;
      drive.tick(47, { LapDistPct: 0.04 });
      expect(drive.snapshot.netLapEstimatePct).toBe(-2.2);
    });

    it('does not measure against a lap that went through the pits', () => {
      const drive = atTheLine();
      drive.lap(REFERENCE_LAP, {
        extraAt: (metres: number): Values =>
          metres === 900 ? { OnPitRoad: true } : {},
      });
      const snapshot = drive.lap(NEXT_LAP, { untilM: 500 });

      expect(snapshot.drainLastLapPct).toBe(8);
      expect(snapshot.netLapEstimatePct).toBeNull();
    });

    it('does not measure against a lap with a teleport in it', () => {
      const drive = atTheLine();
      // 150 m in one tick, half way round.
      drive.lap(REFERENCE_LAP, {
        extraAt: (metres: number): Values =>
          metres >= 500 ? { LapDistPct: (metres + 140) / TRACK_M } : {},
        untilM: 850,
      });
      const snapshot = drive.lap(NEXT_LAP, { untilM: 500 });

      expect(snapshot.netLapEstimatePct).toBeNull();
    });

    it('does not measure against a lap it did not see from the line', () => {
      // Joined half way round: what the lap had used by then is not known.
      const drive = new Drive();
      drive.stepS = 0.1;
      for (let metres = 500; metres <= 990; metres += 10) {
        drive.tick(REFERENCE_LAP(metres), { LapDistPct: metres / TRACK_M });
      }
      const snapshot = drive.lap(NEXT_LAP, { untilM: 500 });

      expect(snapshot.drainLastLapPct).toBe(0);
      expect(snapshot.netLapEstimatePct).toBeNull();
    });

    it('keeps the last clean lap to measure against through a pit lap', () => {
      const drive = atTheLine();
      drive.lap(REFERENCE_LAP);
      // An in-lap from 48 that uses nothing.
      drive.lap(() => 48, {
        extraAt: (metres: number): Values =>
          metres >= 900 ? { OnPitRoad: true } : {},
      });
      // The lap after: -10 by half way, against the clean lap's -8 there.
      const snapshot = drive.lap(NEXT_LAP, { untilM: 500 });

      expect(snapshot.drainLastLapPct).toBe(0);
      expect(snapshot.netLapEstimatePct).toBe(-4);
    });

    it('has none without a track length to place the lap on', () => {
      const drive = new Drive('');
      drive.stepS = 0.1;
      drive.tick(50, { LapDistPct: 0.99 });
      drive.lap(REFERENCE_LAP);
      const snapshot = drive.lap(NEXT_LAP, { untilM: 500 });

      expect(snapshot.drainLapPct).toBe(10);
      expect(snapshot.netLapEstimatePct).toBeNull();
    });
  });

  describe('what clears it', () => {
    /** Two laps in, with a reference, last-lap totals and a deployment. */
    const midRun = () => {
      const drive = new Drive();
      drive.stepS = 0.1;
      drive.tick(50, { LapDistPct: 0.99 });
      drive.lap(REFERENCE_LAP);
      drive.state = 2;
      drive.lap(NEXT_LAP, { untilM: 500 });
      return drive;
    };

    const BLANK_LAPS = {
      drainLapPct: 0,
      regenLapPct: 0,
      drainLastLapPct: null,
      regenLastLapPct: null,
      netLapEstimatePct: null,
      deployTimeLapS: 0,
      sinceDeployS: null,
    };

    it.each([{ type: 'sessionNumChange' }, { type: 'disconnect' }] as const)(
      'forgets the car altogether on $type',
      (event) => {
        const drive = midRun();
        expect(drive.snapshot.netLapEstimatePct).toBe(-4);
        const { version } = drive.snapshot;
        drive.processor.onLifecycle(event);

        expect(drive.snapshot).toMatchObject({
          ...BLANK_LAPS,
          available: false,
          chargePct: null,
          motorState: 0,
          stateOfCharge: null,
          sessionNum: null,
          version: version + 1,
        });
        expect(drive.snapshot.motor.motorTempC).toBeNull();
      }
    );

    it('forgets the car when the frames move to another session', () => {
      const drive = midRun();
      drive.tick(38, { SessionNum: 1 });

      // The same car, seen again in the new session, with nothing kept.
      expect(drive.snapshot).toMatchObject({
        ...BLANK_LAPS,
        available: true,
        chargePct: 38,
        sessionNum: 1,
      });
    });

    it('clears the laps, and keeps the car, on a return to the garage', () => {
      const drive = midRun();
      drive.tick(38, { IsOnTrack: false, IsInGarage: true });

      expect(drive.snapshot).toMatchObject({
        ...BLANK_LAPS,
        available: true,
        // The last reading from the car stands.
        chargePct: 38,
      });

      // Out again: a first lap, with nothing to measure it against.
      drive.state = 1;
      drive.tick(38, { OnPitRoad: true });
      const snapshot = drive.lap(() => 38);
      expect(snapshot.drainLastLapPct).toBe(0);
      expect(snapshot.netLapEstimatePct).toBeNull();
    });

    it('clears the laps when the player is in another car', () => {
      const drive = midRun();
      drive.tick(38, { PlayerCarIdx: 9 });

      expect(drive.snapshot).toMatchObject({ ...BLANK_LAPS, available: true });
    });

    it('clears the laps when the session clock steps back', () => {
      const drive = midRun();
      drive.tickAt(5, 38);

      expect(drive.snapshot).toMatchObject({ ...BLANK_LAPS, chargePct: 38 });
    });

    it('records nothing from a replay', () => {
      const drive = new Drive();
      drive.tick(62.5);
      drive.processor.onLifecycle({ type: 'enter', replay: true });
      expect(drive.snapshot.available).toBe(false);

      const { version } = drive.snapshot;
      drive.tick(62.5);
      expect(drive.snapshot.available).toBe(false);
      expect(drive.snapshot.version).toBe(version);

      drive.processor.onLifecycle({ type: 'enter', replay: false });
      expect(drive.tick(62.5).available).toBe(true);
    });

    it('keeps what it has across a session republish', () => {
      const drive = midRun();
      const before = { ...drive.snapshot };
      drive.processor.init(session());

      expect(drive.snapshot).toEqual(before);
      // And goes on measuring against the same lap.
      drive.tick(37.8, { LapDistPct: 0.51 });
      expect(drive.snapshot.netLapEstimatePct).not.toBeNull();
    });
  });

  describe('the motor', () => {
    const motor = (values: Values) => {
      const drive = new Drive();
      drive.state = 2;
      return drive.tick(74, values).motor;
    };

    it('publishes what a Hypercar deploying out of a corner would read', () => {
      expect(
        motor({
          LmuMotorTorque: 212.46,
          LmuMotorRPM: 9150.4,
          LmuMotorTemp: 68.44,
          LmuMotorCoolantTemp: 51.26,
          LmuRegen: 0,
        })
      ).toEqual({
        torqueNm: 212.5,
        rpm: 9150,
        powerKw: 203.6,
        motorTempC: 68.4,
        coolantTempC: 51.3,
        regenKw: 0,
      });
    });

    it('reads no power from a motor that is being driven', () => {
      expect(
        motor({ LmuMotorTorque: -100, LmuMotorRPM: 7800, LmuRegen: -84.26 })
      ).toMatchObject({ torqueNm: -100, powerKw: 0, regenKw: -84.3 });
    });

    it('works power out from torque and speed', () => {
      expect(hybridPowerKw(200, 9549.3)).toBe(200);
      expect(hybridPowerKw(-100, 9549.3)).toBe(0);
      expect(hybridPowerKw(0, 9549.3)).toBe(0);
      expect(hybridPowerKw(undefined, 9549.3)).toBeNull();
      expect(hybridPowerKw(200, undefined)).toBeNull();
    });

    it('takes a temperature above 200 for Kelvin, and one below for Celsius', () => {
      // Which the sim writes is not known; the same motor either way.
      expect(hybridTemperatureC(353.15)).toBe(80);
      expect(hybridTemperatureC(80)).toBe(80);
      expect(hybridTemperatureC(295.65)).toBe(22.5);
      expect(hybridTemperatureC(22.5)).toBe(22.5);
      expect(hybridTemperatureC(199.96)).toBe(200);
    });

    it('has no temperature where the sim writes none', () => {
      expect(hybridTemperatureC(0)).toBeNull();
      expect(hybridTemperatureC(undefined)).toBeNull();
      // A unit with no coolant circuit, on a car that has the rest.
      expect(
        motor({ LmuMotorTemp: 353.15, LmuMotorCoolantTemp: 0 })
      ).toMatchObject({ motorTempC: 80, coolantTempC: null });
    });

    it('leaves out what the frame does not carry', () => {
      // A charge with no motor state: the mapper publishes no motor at all.
      const drive = new Drive();
      drive.state = 0;
      drive.tick(40);
      expect(drive.tick(39.5).available).toBe(true);

      expect(drive.snapshot.motor).toEqual({
        torqueNm: null,
        rpm: null,
        powerKw: null,
        motorTempC: null,
        coolantTempC: null,
        regenKw: null,
      });
    });

    it('carries the state-of-charge field as it stands, to be compared', () => {
      const drive = new Drive();

      expect(drive.tick(74, { LmuStateOfCharge: 0.73962 }).stateOfCharge).toBe(
        0.74
      );
    });
  });

  describe('publishing', () => {
    it('does not publish a change below what is shown', () => {
      const drive = new Drive();
      drive.tick(62.5, { LmuMotorTemp: 68.42, LmuMotorTorque: 0 });
      // Past the first second, after which the lap clock is whole seconds.
      const { version } = drive.snapshot;

      drive.tick(62.501, { LmuMotorTemp: 68.44, LmuMotorTorque: 0.02 });
      drive.tick(62.502, { LmuMotorTemp: 68.41, LmuMotorTorque: 0.04 });
      expect(drive.snapshot.version).toBe(version);
      expect(drive.snapshot.chargePct).toBe(62.5);

      drive.tick(62.51, { LmuMotorTemp: 68.41, LmuMotorTorque: 0.04 });
      expect(drive.snapshot.version).toBe(version + 1);
      expect(drive.snapshot.chargePct).toBe(62.51);
    });

    it('publishes nothing for a battery that sits still', () => {
      const drive = new Drive();
      // A lap clock past its cap, so that only the battery could move it.
      drive.tick(62.5, { LapCurrentLapTime: 45 });
      drive.tick(62.5, { LapCurrentLapTime: 45.04 });
      drive.tick(62.5, { LapCurrentLapTime: 45.08 });
      drive.tick(62.5, { LapCurrentLapTime: 45.12 });
      const { version } = drive.snapshot;
      for (let tick = 0; tick < 100; tick += 1) {
        drive.tick(62.5, { LapCurrentLapTime: 46 + tick * 0.04 });
      }

      expect(drive.snapshot.version).toBe(version);
    });
  });
});
