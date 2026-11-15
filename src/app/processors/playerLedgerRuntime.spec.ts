import { describe, expect, it } from 'vitest';
import type { LapLibraryLap, LedgerLap } from '@irdashies/types';
import {
  GlobalFlags,
  LEDGER_LAP_CAUTION,
  LEDGER_LAP_FROM_START,
  LEDGER_LAP_IN_LAP,
  LEDGER_LAP_NOT_OWN,
  LEDGER_LAP_OUT_LAP,
  LEDGER_LAP_SERVICED,
  LEDGER_LAP_VOIDED,
  LEDGER_LAP_WET,
  SessionState,
} from '@irdashies/types';
import { isCleanLap } from '../../shared/lapValidity';
import type { RendererTarget } from '../bridge/channelBus';
import {
  createLedgerHarness,
  ledgerSession,
  type LedgerSim,
} from './playerLedgerFixture';

/**
 * The ledger end to end on hand-built frames: a car driven round a
 * one-kilometre track, into the pit lane and out again. The pit lane runs
 * from 0.9 of the lap to 0.1, so the line is inside it.
 */

type Harness = ReturnType<typeof createLedgerHarness>;

/** The rows oldest first, as they were driven. */
const rowsOf = ({ runtime }: Harness): LedgerLap[] =>
  [...runtime.ledgerSnapshot().laps].reverse();

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

/** Stands in the box while the crew puts `litres` in over `seconds`. */
const refuel = (sim: LedgerSim, litres: number, seconds: number) =>
  sim.stand(seconds, (dt) => {
    sim.fuel = (sim.fuel ?? 0) + (litres / seconds) * dt;
  });

describe('PlayerLedgerRuntime', () => {
  describe('laps', () => {
    it('makes a row of every lap driven from line to line, and of no other', () => {
      const harness = createLedgerHarness();
      const { sim } = harness;
      sim.emit();

      // Joined half-way round: the rest of that lap is not one.
      sim.driveLaps(0.6);
      expect(rowsOf(harness)).toHaveLength(0);
      sim.driveLaps(2);

      const rows = rowsOf(harness);
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.lapNumber)).toEqual([2, 3]);
      expect(rows[0].lapTime).toBeCloseTo(60, 3);
      expect(rows[0].endTime - rows[0].startTime).toBeCloseTo(60, 3);
      expect(rows[0].flags).toBe(0);
      expect(rows[0]).toMatchObject({
        sessionNum: 0,
        incidents: null,
        compounds: ['Medium', 'Medium', 'Medium', 'Medium'],
        wetness: 1,
        rain: 0,
        airTemp: 21,
        trackTemp: 30,
        position: 4,
        classPosition: 2,
      });
    });

    it('measures what a lap cost from the levels at its two ends', () => {
      const harness = createLedgerHarness();
      const { sim } = harness;
      sim.emit();
      sim.driveLaps(1.6);
      const [row] = rowsOf(harness);

      expect(row.fuelUsed).toBeCloseTo(2.4, 6);
      expect(row.fuelAdded).toBe(0);
      expect(row.energyUsed).toBeCloseTo(0.02, 6);
      expect(row.energyAdded).toBe(0);
      row.treadUsed.forEach((used) => expect(used).toBeCloseTo(0.005, 6));
      row.brakeUsed.forEach((used) => expect(used).toBeCloseTo(0.002, 6));
      expect(row.fuelAtLine).toBeCloseTo(50 - 2.4 * 1.5, 1);
      expect(row.treadAtLine[0]).toBeCloseTo(1 - 0.005 * 1.5, 3);
      expect(row.brakeAtLine[2]).toBeCloseTo(32 - 0.002 * 1.5, 3);
    });

    it('has no energy figure for a car that runs on fuel', () => {
      const fuelCar = createLedgerHarness({ energyPerLap: null });
      fuelCar.sim.emit();
      fuelCar.sim.driveLaps(1.6);
      const energyCar = createLedgerHarness();
      energyCar.sim.emit();
      energyCar.sim.driveLaps(1.6);

      const [fuelRow] = rowsOf(fuelCar);
      expect(fuelRow.energyUsed).toBeNull();
      expect(fuelRow.energyAtLine).toBeNull();
      expect(fuelRow.fuelUsed).toBeCloseTo(2.4, 6);
      expect(fuelCar.runtime.stintSnapshot().budget).toBe('fuel');
      expect(fuelCar.runtime.stintSnapshot().stint?.startEnergy).toBeNull();

      expect(rowsOf(energyCar)[0].energyUsed).toBeCloseTo(0.02, 6);
      expect(energyCar.runtime.stintSnapshot().budget).toBe('virtualEnergy');
      expect(energyCar.runtime.stintSnapshot().stint?.startEnergy).toBe(0.9);
    });

    it('takes the time the sim gave the lap, whether it comes early or late', () => {
      const early = createLedgerHarness();
      early.sim.emit();
      early.sim.driveLaps(1.6);
      // Read three seconds after the line: not there on the row before.
      const late = createLedgerHarness();
      late.sim.simLapDelay = 2;
      late.sim.emit();
      late.sim.driveLaps(1.5);
      late.sim.drive(1);
      expect(rowsOf(late)[0].simLapTime).toBeNull();
      late.sim.drive(5);

      expect(rowsOf(early)[0].simLapTime).toBeCloseTo(60, 6);
      expect(rowsOf(late)[0].simLapTime).toBeCloseTo(60, 6);
    });

    it('leaves the sim time empty when the sim never times the lap', () => {
      const harness = createLedgerHarness();
      const { sim } = harness;
      sim.simLapDelay = 1000;
      sim.emit();
      sim.driveLaps(2.6);

      expect(rowsOf(harness).map((row) => row.simLapTime)).toEqual([
        null,
        null,
      ]);
    });

    it('makes no row of a lap that was not driven to its end', () => {
      const harness = createLedgerHarness();
      const { sim } = harness;
      sim.emit();
      sim.driveLaps(1);
      // Put back half a lap, as a reset does.
      sim.progress -= 0.4;
      sim.driveLaps(1);

      expect(rowsOf(harness)).toHaveLength(0);
      sim.driveLaps(1);
      expect(rowsOf(harness)).toHaveLength(1);
    });

    it('marks a lap the sim voided, one not driven throughout, and a wet one', () => {
      const harness = createLedgerHarness();
      const { sim } = harness;
      sim.emit();
      sim.driveLaps(0.8);
      sim.voided = true;
      sim.driveLaps(0.6);
      sim.voided = false;
      sim.driveLaps(0.5);
      sim.isOnTrack = false;
      sim.driveLaps(0.2);
      sim.isOnTrack = true;
      sim.driveLaps(0.7);
      sim.wetness = 3;
      sim.driveLaps(1);

      const flags = rowsOf(harness).map((row) => row.flags);
      expect(flags).toEqual([
        LEDGER_LAP_VOIDED,
        LEDGER_LAP_NOT_OWN,
        LEDGER_LAP_WET,
      ]);
      expect(flags.map(isCleanLap)).toEqual([false, false, true]);
      expect(rowsOf(harness)[2].wetness).toBe(3);
    });

    it('keeps the laps a team-mate drives as the car’s and not the user’s, with its levels read', () => {
      // Through a team-mate's stint the frame goes on carrying the car's
      // fuel, energy and tread, read from its telemetry block. The laps are
      // rows like any other, measured the same, and marked as not driven by
      // the user: no rate, pace or best is taken from them.
      const harness = createLedgerHarness();
      const { sim, runtime } = harness;
      sim.isOnTrack = false;
      sim.emit();
      sim.driveLaps(2.6);

      const rows = rowsOf(harness);
      expect(rows.map((row) => row.flags)).toEqual([
        LEDGER_LAP_NOT_OWN,
        LEDGER_LAP_NOT_OWN,
      ]);
      expect(rows.map((row) => isCleanLap(row.flags))).toEqual([false, false]);
      // What the car used is still what the lap cost.
      expect(rows[1].fuelUsed).toBeCloseTo(2.4, 3);
      expect(rows[1].treadUsed[0]).toBeCloseTo(0.005, 6);

      expect(runtime.stintSnapshot().stint?.own).toBe(false);
      expect(runtime.stintSnapshot().rates).toEqual({
        fuel: null,
        energy: null,
        lapTime: null,
        source: null,
      });
      expect(runtime.stintSnapshot().budgetLapsLeft).toBeNull();
      expect(runtime.referenceWearCurves()).toBeNull();

      // The user takes the car back: their own laps are the first to count.
      sim.isOnTrack = true;
      sim.driveLaps(2);
      const after = rowsOf(harness);
      expect(after.slice(-1)[0].flags).toBe(0);
      expect(runtime.stintSnapshot().rates.fuel).toBeCloseTo(2.4, 3);
    });

    it('starts the first lap of a race when the car is let go from the line', () => {
      const harness = createLedgerHarness();
      const { sim, runtime, stored } = harness;
      sim.sessionNum = 1;
      sim.sessionState = SessionState.ParadeLaps;
      sim.progress = 0.0004;
      sim.heldAtLine = true;
      sim.emit();
      sim.drive(20);
      // Before the green nothing is a stint.
      expect(runtime.stintSnapshot().stint).toBeNull();
      expect(runtime.stintSnapshot().state).toBe('idle');

      sim.sessionState = SessionState.Racing;
      sim.heldAtLine = false;
      sim.driveLaps(2.2);

      const rows = rowsOf(harness);
      expect(rows).toHaveLength(2);
      expect(rows[0].flags).toBe(LEDGER_LAP_FROM_START);
      expect(rows[0].stintLap).toBe(1);
      expect(isCleanLap(rows[0].flags)).toBe(false);
      expect(rows[1].flags).toBe(0);
      expect(rows[1].stintLap).toBe(2);
      expect(runtime.stintSnapshot().stint).toMatchObject({
        openedBy: 'green',
        laps: 2,
        cleanLaps: 1,
      });
      // Kept, but without a curve: it can never be a reference.
      expect(stored.laps[0].lap).toMatchObject({
        complete: false,
        curve: null,
      });
      expect(stored.laps[1].lap.complete).toBe(true);
    });

    it('times the sectors itself where the sim states none', () => {
      const harness = createLedgerHarness({
        simulator: 'iracing',
        withoutSession: true,
      });
      const { sim, runtime } = harness;
      runtime.onSession({
        ...ledgerSession(),
        SplitTimeInfo: {
          Sectors: [
            { SectorNum: 0, SectorStartPct: 0 },
            { SectorNum: 1, SectorStartPct: 0.3 },
            { SectorNum: 2, SectorStartPct: 0.7 },
          ],
        },
      } as never);
      sim.emit();
      sim.incidents = 2;
      sim.driveLaps(1.6);
      sim.incidents = 4;
      sim.driveLaps(1);

      const rows = rowsOf(harness);
      expect(rows[0].sectors[0]).toBeCloseTo(18, 2);
      expect(rows[0].sectors[1]).toBeCloseTo(24, 2);
      expect(rows[0].sectors[2]).toBeCloseTo(18, 2);
      // iRacing counts incidents, and refreshes tread only in the pits.
      expect(rows.map((row) => row.incidents)).toEqual([0, 2]);
      expect(isCleanLap(rows[1].flags)).toBe(false);
      expect(rows[0].treadUsed).toEqual([null, null, null, null]);
    });
  });

  describe('stints', () => {
    it('opens a stint as joined when the app starts with the car on track', () => {
      const harness = createLedgerHarness();
      const { sim, runtime, logs } = harness;
      sim.fuel = 31.5;
      sim.emit();

      const snapshot = runtime.stintSnapshot();
      expect(snapshot).toMatchObject({ available: true, state: 'running' });
      expect(snapshot.stint).toMatchObject({
        ordinal: 1,
        openedBy: 'joined',
        closedBy: null,
        own: true,
        startTime: 100,
        startLap: 0,
        laps: 0,
        startFuel: 31.5,
        startEnergy: 0.9,
        startTread: [1, 1, 1, 1],
        startBrake: [36, 36, 32, 32],
        compounds: ['Medium', 'Medium', 'Medium', 'Medium'],
        stop: null,
      });
      expect(snapshot.stint?.id).toMatch(/^boot:\d+:1$/);
      expect(logs).toEqual([
        expect.stringContaining('Stint 1 opened (joined) at 100.0 s'),
      ]);
    });

    it('opens a stint when the car leaves the pit lane', () => {
      const harness = createLedgerHarness();
      const { sim, runtime } = harness;
      sim.onPitRoad = true;
      sim.progress = 0.95;
      sim.emit();
      expect(runtime.stintSnapshot()).toMatchObject({
        state: 'idle',
        stint: null,
      });

      leavePits(sim);

      // The line was crossed in the pit lane, before there was a stint.
      expect(runtime.stintSnapshot().stint).toMatchObject({
        openedBy: 'pitExit',
        laps: 0,
        startTime: sim.time,
      });
      sim.driveLaps(1);
      expect(rowsOf(harness)[0]).toMatchObject({
        flags: LEDGER_LAP_OUT_LAP,
        stintLap: 1,
      });
    });

    it('ends a stint at a refuel, with the line before the box', () => {
      const harness = createLedgerHarness();
      const { sim, runtime, logs } = harness;
      sim.emit();
      sim.driveLaps(2.6);
      enterPits(sim);
      const fuelAtEntry = sim.fuel ?? 0;
      const entryTime = sim.time;
      // Over the line in the pit lane, to a box just past it.
      sim.driveTo(0.03, PIT_SPEED);
      refuel(sim, 40, 22);
      leavePits(sim);
      const exitTime = sim.time;
      const fuelAtExit = sim.fuel ?? 0;
      sim.driveLaps(1.2);

      const { stints } = runtime.ledgerSnapshot();
      expect(stints).toHaveLength(1);
      const [first] = stints;
      expect(first).toMatchObject({
        ordinal: 1,
        openedBy: 'joined',
        closedBy: 'service',
        // Three on track and the one in the pit lane.
        laps: 4,
        endTime: entryTime,
        startFuel: 50,
        cleanLaps: 2,
      });
      expect(first.endFuel).toBeCloseTo(fuelAtEntry, 6);
      expect(first.bestLap).toBeCloseTo(60, 3);
      expect(first.stop).toMatchObject({
        tyresChanged: 0,
        brakesChanged: false,
        driverChanged: false,
        energyAdded: 0,
      });
      expect(first.stop?.fuelAdded).toBeCloseTo(40, 6);
      expect(first.stop?.stationaryTime).toBeCloseTo(22, 6);
      expect(first.stop?.pitLaneTime).toBeCloseTo(exitTime - entryTime, 6);

      // The in-lap is the old stint's; the lap with the stop in it closes
      // after the pit exit and is the new stint's first.
      const rows = rowsOf(harness);
      expect(rows).toHaveLength(4);
      expect(rows[2].flags).toBe(LEDGER_LAP_IN_LAP);
      expect(rows[2].stintId).toBe(first.id);
      expect(rows[2].stintLap).toBe(4);
      const open = runtime.stintSnapshot().stint;
      expect(open).toMatchObject({ ordinal: 2, openedBy: 'pitExit', laps: 1 });
      expect(rows[3].stintId).toBe(open?.id);
      expect(rows[3].stintLap).toBe(1);
      expect(rows[3].flags).toBe(LEDGER_LAP_OUT_LAP | LEDGER_LAP_SERVICED);
      // Forty litres went in and the lap still cost what it burned.
      expect(rows[3].fuelAdded).toBeCloseTo(40, 6);
      expect(rows[3].fuelUsed).toBeCloseTo(2.4, 1);
      expect(open?.startFuel).toBeCloseTo(fuelAtExit, 6);
      expect(fuelAtExit).toBeGreaterThan(fuelAtEntry + 39);

      expect(logs.map((line) => line.split(/[:,]/)[0])).toEqual([
        '[Ledger] Stint 1 opened (joined) at 100.0 s',
        '[Ledger] Stint 1 closed (service)',
        '[Ledger] Stint 2 opened (pitExit) at ' + exitTime.toFixed(1) + ' s',
      ]);
      expect(logs[1]).toContain('fuel 40.00 L');
    });

    it('ends it the same way with the line after the box', () => {
      const harness = createLedgerHarness();
      const { sim, runtime } = harness;
      sim.emit();
      sim.driveLaps(2.6);
      enterPits(sim);
      // The box is short of the line: the in-lap has the stop in it.
      sim.driveTo(0.95, PIT_SPEED);
      refuel(sim, 40, 22);
      leavePits(sim);
      sim.driveLaps(1.2);

      const [first] = runtime.ledgerSnapshot().stints;
      const rows = rowsOf(harness);
      expect(first).toMatchObject({ closedBy: 'service', laps: 4 });
      expect(rows[2].stintId).toBe(first.id);
      expect(rows[2].flags).toBe(LEDGER_LAP_IN_LAP | LEDGER_LAP_SERVICED);
      expect(rows[2].fuelAdded).toBeCloseTo(40, 6);
      expect(rows[2].fuelUsed).toBeCloseTo(2.4, 1);
      expect(rows[3].stintId).toBe(runtime.stintSnapshot().stint?.id);
      expect(rows[3].stintLap).toBe(1);
      expect(rows[3].flags).toBe(LEDGER_LAP_OUT_LAP);
      expect(rows[3].fuelAdded).toBe(0);
    });

    it('ends a stint at a tyre change, and counts none of it as wear', () => {
      const harness = createLedgerHarness();
      const { sim, runtime } = harness;
      sim.emit();
      sim.driveLaps(2.6);
      enterPits(sim);
      sim.driveTo(0.95, PIT_SPEED);
      const worn = [...sim.tread];
      sim.stand(8);
      // New fronts; the rears stay on.
      sim.tread = [1, 1, worn[2], worn[3]];
      sim.compound = [1, 1, 0, 0];
      sim.stand(8);
      leavePits(sim);
      sim.driveLaps(1.2);

      const [first] = runtime.ledgerSnapshot().stints;
      expect(first.closedBy).toBe('service');
      expect(first.stop).toMatchObject({ tyresChanged: 3, fuelAdded: 0 });
      expect(first.endTread[0]).toBeCloseTo(worn[0] ?? 0, 6);
      const open = runtime.stintSnapshot().stint;
      expect(open?.compounds).toEqual(['Hard', 'Hard', 'Medium', 'Medium']);
      expect(open?.startTread[0]).toBe(1);
      // The lap with the change in it wore what it drove on track: a tenth
      // of the lap was spent in the pit lane.
      const inLap = rowsOf(harness)[2];
      expect(inLap.flags).toBe(LEDGER_LAP_IN_LAP | LEDGER_LAP_SERVICED);
      inLap.treadUsed.forEach((used) => expect(used).toBeCloseTo(0.0045, 4));
      expect(inLap.compounds).toEqual(['Hard', 'Hard', 'Medium', 'Medium']);
    });

    it('carries a stint through a drive-through and a stop that services nothing', () => {
      const harness = createLedgerHarness();
      const { sim, runtime } = harness;
      sim.emit();
      sim.driveLaps(1.6);
      // A drive-through: never below pit speed.
      enterPits(sim);
      const entryTime = sim.time;
      leavePits(sim);
      const exitTime = sim.time;
      sim.driveLaps(1);
      // A stop-and-go: six seconds in the box, nothing touched.
      enterPits(sim);
      sim.driveTo(0.95, PIT_SPEED);
      sim.stand(6);
      leavePits(sim);
      sim.driveLaps(1.2);

      expect(runtime.ledgerSnapshot().stints).toHaveLength(0);
      const open = runtime.stintSnapshot().stint;
      expect(open).toMatchObject({ ordinal: 1, closedBy: null, stop: null });
      expect(open?.passes).toHaveLength(2);
      expect(open?.passes[0].stationaryTime).toBe(0);
      expect(open?.passes[0].pitLaneTime).toBeCloseTo(exitTime - entryTime, 6);
      expect(exitTime - entryTime).toBeGreaterThan(19);
      expect(open?.passes[1].stationaryTime).toBeCloseTo(6, 6);
      // Every lap is the one stint's, pit lane or not.
      const rows = rowsOf(harness);
      expect(new Set(rows.map((row) => row.stintId)).size).toBe(1);
      expect(rows.map((row) => row.flags)).toEqual([
        0,
        LEDGER_LAP_IN_LAP,
        LEDGER_LAP_OUT_LAP,
        LEDGER_LAP_IN_LAP,
        LEDGER_LAP_OUT_LAP,
      ]);
    });

    it('sits out a red flag in the pit lane without ending the stint', () => {
      const harness = createLedgerHarness();
      const { sim, runtime } = harness;
      sim.sessionNum = 1;
      sim.emit();
      sim.driveLaps(1.6);
      // Stopped: LMU reads as past the chequered flag, not as racing.
      sim.sessionFlags = GlobalFlags.Red;
      sim.sessionState = SessionState.Checkered;
      enterPits(sim);
      sim.driveTo(0.95, PIT_SPEED);
      sim.stand(180);
      sim.sessionFlags = 0;
      sim.sessionState = SessionState.Racing;
      leavePits(sim);
      sim.driveLaps(2.2);

      expect(runtime.ledgerSnapshot().stints).toHaveLength(0);
      const open = runtime.stintSnapshot().stint;
      expect(open).toMatchObject({ ordinal: 1, laps: 5, cleanLaps: 2 });
      expect(open?.passes).toHaveLength(1);
      expect(open?.passes[0].stationaryTime).toBeCloseTo(180, 6);
      const rows = rowsOf(harness);
      expect(rows[1].flags).toBe(LEDGER_LAP_IN_LAP | LEDGER_LAP_CAUTION);
      expect(rows.map((row) => isCleanLap(row.flags))).toEqual([
        true,
        false,
        false,
        true,
      ]);
    });

    it('ends a stint when the car goes back to its garage, at the levels it had on track', () => {
      const harness = createLedgerHarness();
      const { sim, runtime } = harness;
      sim.emit();
      sim.driveLaps(1.7);
      const fuelOnTrack = sim.fuel ?? 0;
      const lastOnTrack = sim.time;
      // Escape: the sim puts the car in its stall.
      sim.inGarage = true;
      sim.onPitRoad = true;
      sim.progress = sim.lapsCompleted + 0.93;
      sim.stand(5);
      // The driver stays there, and the setup screen fills the tank.
      sim.fuel = 80;
      sim.stand(600);

      const { stints } = runtime.ledgerSnapshot();
      expect(stints).toHaveLength(1);
      expect(stints[0]).toMatchObject({
        closedBy: 'garage',
        endTime: lastOnTrack,
        laps: 2,
        stop: null,
      });
      expect(stints[0].endFuel).toBeCloseTo(fuelOnTrack, 6);
      expect(runtime.stintSnapshot()).toMatchObject({
        state: 'idle',
        stint: null,
      });

      sim.inGarage = false;
      leavePits(sim);
      expect(runtime.stintSnapshot().stint).toMatchObject({
        ordinal: 2,
        openedBy: 'pitExit',
      });
      expect(runtime.stintSnapshot().stint?.startFuel).toBeCloseTo(80, 0);
    });

    it('does not keep a stint that ends without a lap', () => {
      const harness = createLedgerHarness();
      const { sim, runtime, logs } = harness;
      sim.onPitRoad = true;
      sim.progress = 0.95;
      sim.emit();
      sim.driveTo(0.99, PIT_SPEED);
      sim.onPitRoad = false;
      sim.emit();
      expect(runtime.stintSnapshot().stint?.laps).toBe(0);
      // Back to the garage before the line.
      sim.inGarage = true;
      sim.stand(2);

      expect(runtime.ledgerSnapshot().stints).toHaveLength(0);
      expect(logs.at(-1)).toContain('without a lap');
    });

    it('ends a stint when another driver takes the car at a stop', () => {
      const harness = createLedgerHarness();
      const { sim, runtime } = harness;
      sim.emit();
      sim.driveLaps(1.6);
      enterPits(sim);
      sim.driveTo(0.95, PIT_SPEED);
      sim.stand(10);
      runtime.onSession(ledgerSession({ driver: 'Team Mate' }));
      sim.stand(10);
      leavePits(sim);

      const [first] = runtime.ledgerSnapshot().stints;
      expect(first).toMatchObject({
        closedBy: 'service',
        driver: 'Sergio Test',
      });
      expect(first.stop).toMatchObject({ driverChanged: true, fuelAdded: 0 });
      expect(runtime.stintSnapshot().stint?.driver).toBe('Team Mate');
    });

    it('ends a stint with its session and keeps the laps', () => {
      const harness = createLedgerHarness();
      const { sim, runtime } = harness;
      sim.emit();
      sim.driveLaps(2.7);
      sim.sessionNum = 1;
      sim.sessionState = SessionState.GetInCar;
      sim.onPitRoad = true;
      sim.time = 5;
      sim.stand(3);

      const ledger = runtime.ledgerSnapshot();
      expect(ledger.stints).toHaveLength(1);
      expect(ledger.stints[0]).toMatchObject({
        closedBy: 'session',
        sessionNum: 0,
        laps: 3,
      });
      expect(ledger.laps).toHaveLength(2);
      expect(ledger.sessionNum).toBe(1);
      expect(runtime.stintSnapshot().stint).toBeNull();
    });

    it('ends a stint when the sim goes away, and empties itself', () => {
      const harness = createLedgerHarness();
      const { sim, runtime, lifecycle, logs } = harness;
      sim.emit();
      sim.driveLaps(1.7);
      const versionBefore = runtime.ledgerSnapshot().version;

      lifecycle._onDisconnect();

      expect(logs.at(-1)).toContain('Stint 1 closed (disconnect)');
      const ledger = runtime.ledgerSnapshot();
      expect(ledger.laps).toEqual([]);
      expect(ledger.stints).toEqual([]);
      expect(ledger.version).toBeGreaterThan(versionBefore);
      expect(runtime.stintSnapshot()).toMatchObject({
        available: false,
        state: 'idle',
        stint: null,
      });
    });

    it('starts over for another track with the sim still connected', () => {
      const harness = createLedgerHarness();
      const { sim, runtime } = harness;
      sim.emit();
      sim.driveLaps(1.7);

      runtime.onSession(ledgerSession({ trackId: 19, subSessionId: 48214 }));

      expect(runtime.ledgerSnapshot().laps).toEqual([]);
      expect(runtime.ledgerSnapshot().stints).toEqual([]);
      sim.emit();
      expect(runtime.stintSnapshot().stint).toMatchObject({
        ordinal: 1,
        openedBy: 'joined',
      });
    });
  });

  describe('the stint under way', () => {
    it('carries the present levels, rounded, and the lap being driven', () => {
      const harness = createLedgerHarness();
      const { sim, runtime } = harness;
      sim.emit();
      sim.driveLaps(1.75);

      const snapshot = runtime.stintSnapshot();
      expect(snapshot.stint).toMatchObject({
        endLap: 2,
        endTime: Math.floor(sim.time),
        laps: 2,
      });
      expect(snapshot.stint?.endFuel).toBeCloseTo(50 - 2.4 * 1.75, 2);
      expect(snapshot.stint?.endEnergy).toBeCloseTo(0.9 - 0.02 * 1.75, 4);
      expect(snapshot.stint?.endTread[0]).toBeCloseTo(1 - 0.005 * 1.75, 3);
      expect(snapshot.lap).toMatchObject({
        lapNumber: 3,
        stintLap: 3,
        flags: 0,
      });
      expect(snapshot.lap.fuelUsed).toBeCloseTo(2.4 * 0.25, 2);
      expect(snapshot.lap.energyUsed).toBeCloseTo(0.02 * 0.25, 4);
    });

    it('carries the tread the lap under way has worn so far', () => {
      const harness = createLedgerHarness({ treadPerLap: 0.02 });
      const { sim, runtime } = harness;
      sim.emit();
      // Joined half-way round: no lap is open until the line is crossed.
      expect(runtime.stintSnapshot().lap.treadUsed).toBeUndefined();

      sim.driveLaps(1.75);

      // A quarter of a lap in, a quarter of a lap's wear on each wheel.
      expect(runtime.stintSnapshot().lap.treadUsed).toEqual([
        0.005, 0.005, 0.005, 0.005,
      ]);
    });

    it('has no tread figure for the lap where tread is only read in the pits', () => {
      const harness = createLedgerHarness({ simulator: 'iracing' });
      const { sim, runtime } = harness;
      sim.emit();
      sim.driveLaps(1.75);

      expect(runtime.stintSnapshot().lap.treadUsed).toEqual([
        null,
        null,
        null,
        null,
      ]);
    });

    it('takes its rates from the stint and says how long the budget lasts', () => {
      const harness = createLedgerHarness();
      const { sim, runtime } = harness;
      sim.emit();
      sim.driveLaps(0.6);
      expect(runtime.stintSnapshot().rates).toEqual({
        fuel: null,
        energy: null,
        lapTime: null,
        source: null,
      });
      expect(runtime.stintSnapshot().budgetLapsLeft).toBeNull();
      sim.driveLaps(2);

      const snapshot = runtime.stintSnapshot();
      expect(snapshot.rates).toMatchObject({ source: 'stint' });
      expect(snapshot.rates.fuel).toBeCloseTo(2.4, 3);
      expect(snapshot.rates.energy).toBeCloseTo(0.02, 5);
      expect(snapshot.rates.lapTime).toBeCloseTo(60, 3);
      // Fuel for 18 laps, energy for 42: the tank ends this stint.
      expect(snapshot.budgetLapsLeft).toBeCloseTo((50 - 2.4 * 2.6) / 2.4, 1);
      const rates = runtime.currentRates();
      rates.tread.forEach((rate) => expect(rate).toBeCloseTo(0.005, 6));
      rates.brake.forEach((rate) => expect(rate).toBeCloseTo(0.002, 6));
    });

    it('starts from what the track and car cost before, until it has a lap', async () => {
      const before = (lapTime: number, fuelUsed: number): LapLibraryLap =>
        ({
          lapTime,
          fuelUsed,
          energyUsed: 0.021,
          ledger: {
            flags: 0,
            compounds: ['Medium', 'Medium', 'Medium', 'Medium'],
            treadUsed: [0.004, 0.004, 0.003, 0.003],
            brakeUsed: [0.002, 0.002, 0.001, 0.001],
          },
        }) as unknown as LapLibraryLap;
      const harness = createLedgerHarness({
        baseline: [before(61, 2.5), before(62, 2.7), before(60, 2.6)],
      });
      const { sim, runtime, stored } = harness;
      await settle();
      sim.emit();

      expect(stored.baselineAsked).toBe(1);
      const snapshot = runtime.stintSnapshot();
      expect(snapshot.rates).toEqual({
        fuel: 2.6,
        energy: 0.021,
        lapTime: 61,
        source: 'baseline',
      });
      expect(snapshot.budgetLapsLeft).toBeCloseTo(50 / 2.6, 1);
      expect(runtime.currentRates().tread).toEqual([
        0.004, 0.004, 0.003, 0.003,
      ]);

      sim.driveLaps(1.6);
      expect(runtime.stintSnapshot().rates.source).toBe('stint');
    });

    it('reaches a window that subscribes late with the whole stint', () => {
      const harness = createLedgerHarness();
      const { sim, bus } = harness;
      sim.emit();
      sim.driveLaps(2.6);

      const sent: { name: string; payload: { version: number } }[] = [];
      const target: RendererTarget = {
        id: 7,
        isDestroyed: () => false,
        isVisible: () => true,
        send: (_channel, name, payload) =>
          sent.push({ name, payload: payload as { version: number } }),
      };
      bus.subscribe(target, 'player-ledger.snapshot');
      bus.subscribe(target, 'player-stint.snapshot');

      const ledger = sent.find(({ name }) => name === 'player-ledger.snapshot');
      const stint = sent.find(({ name }) => name === 'player-stint.snapshot');
      expect(ledger?.payload).toMatchObject({
        laps: [{ lapNumber: 3 }, { lapNumber: 2 }],
      });
      expect(stint?.payload).toMatchObject({
        available: true,
        stint: { ordinal: 1, laps: 3, startFuel: 50 },
      });
    });

    it('moves the stint version with its rounded figures, not with every frame', () => {
      const harness = createLedgerHarness({ step: 0.05 });
      const { sim, runtime, bus } = harness;
      const target: RendererTarget = {
        id: 7,
        isDestroyed: () => false,
        isVisible: () => true,
        send: () => undefined,
      };
      bus.subscribe(target, 'player-stint.snapshot');
      sim.emit();
      const before = runtime.stintSnapshot().version;
      // Two hundred frames. Fuel to a hundredth of a litre moves a few
      // times a second at racing pace; the stint is looked at five times.
      sim.drive(10);
      const driving = runtime.stintSnapshot().version - before;
      // At a standstill only the clock moves, a second at a time.
      sim.stand(10);
      const standing = runtime.stintSnapshot().version - before - driving;

      expect(driving).toBeGreaterThanOrEqual(10);
      expect(driving).toBeLessThanOrEqual(51);
      expect(standing).toBeGreaterThanOrEqual(9);
      expect(standing).toBeLessThanOrEqual(11);
    });
  });

  describe('storing', () => {
    it('stores every lap with its ledger and the stint it was driven in', async () => {
      const harness = createLedgerHarness();
      const { sim, runtime, stored } = harness;
      sim.emit();
      sim.driveLaps(2.6);
      await settle();

      expect(stored.laps).toHaveLength(2);
      const [first, second] = stored.laps;
      expect(first.session).toMatchObject({
        simulator: 'lmu',
        trackId: 18,
        carKey: 'Ferrari 296 LMGT3 Evo',
        sessionType: 'Practice',
      });
      expect(first.lap).toMatchObject({
        complete: true,
        pit: false,
        own: true,
      });
      expect(first.lap.fuelUsed).toBeCloseTo(2.4, 6);
      expect(first.lap.ledger).toMatchObject({
        sessionNum: 0,
        stintLap: 2,
        flags: 0,
        fuelAdded: 0,
        compounds: ['Medium', 'Medium', 'Medium', 'Medium'],
      });
      expect(first.lap.ledger?.simLapTime).toBeCloseTo(60, 6);
      // The stint as it stood when the lap was stored: open, present levels.
      expect(first.lap.ledger?.stint?.stint).toMatchObject({
        ordinal: 1,
        closedBy: null,
        laps: 2,
        endLap: 2,
      });
      expect(second.lap.ledger?.stint?.stint.laps).toBe(3);
      expect(second.lap.ledger?.stint?.endedAt).toBeNull();
      // The rows carry the ids the library gave them.
      expect(rowsOf(harness).map((row) => row.id)).toEqual([1, 2]);
      expect(runtime.ledgerSnapshot().laps[0].id).toBe(2);
    });

    it('stores a stint when it opens and when it closes', () => {
      const harness = createLedgerHarness();
      const { sim, stored } = harness;
      sim.emit();
      sim.driveLaps(1.6);
      enterPits(sim);
      sim.driveTo(0.95, PIT_SPEED);
      refuel(sim, 30, 15);
      leavePits(sim);

      expect(
        stored.stints.map(({ input }) => [
          input.stint.ordinal,
          input.stint.closedBy,
          input.endedAt === null,
        ])
      ).toEqual([
        [1, null, true],
        [1, 'service', false],
        [2, null, true],
      ]);
      expect(stored.stints[1].input.stint.stop?.fuelAdded).toBeCloseTo(30, 6);
    });

    it('stores what is in hand when it is let go: the lap, and the stint closed', async () => {
      const harness = createLedgerHarness();
      const { sim, runtime, stored } = harness;
      sim.emit();
      sim.driveLaps(1.5);
      // One second past the line: the lap is still waiting for its time.
      sim.drive(1);
      expect(stored.laps).toHaveLength(0);

      runtime.dispose();
      await settle();

      expect(stored.laps).toHaveLength(1);
      expect(stored.laps[0].lap.ledger?.stint?.stint).toMatchObject({
        closedBy: 'disconnect',
        laps: 2,
      });
      expect(stored.stints.at(-1)?.input.stint.closedBy).toBe('disconnect');
    });

    it('measures and publishes a tape or a demo, and stores none of it', async () => {
      const harness = createLedgerHarness();
      const { sim, runtime, stored } = harness;
      runtime.setPersisting(false);
      sim.emit();
      sim.driveLaps(2.6);
      enterPits(sim);
      sim.driveTo(0.95, PIT_SPEED);
      refuel(sim, 30, 15);
      leavePits(sim);
      await settle();

      expect(rowsOf(harness)).toHaveLength(3);
      expect(rowsOf(harness).map((row) => row.id)).toEqual([0, 0, 0]);
      expect(runtime.ledgerSnapshot().stints).toHaveLength(1);
      expect(stored.laps).toHaveLength(0);
      expect(stored.stints).toHaveLength(0);
    });

    it('measures nothing while a replay file is loaded', () => {
      const harness = createLedgerHarness();
      const { sim, runtime } = harness;
      runtime.setPaused(true);
      sim.emit();
      sim.driveLaps(2.6);

      expect(rowsOf(harness)).toHaveLength(0);
      expect(runtime.stintSnapshot().stint).toBeNull();

      runtime.setPaused(false);
      sim.driveLaps(2);
      expect(rowsOf(harness)).toHaveLength(1);
    });
  });
});
