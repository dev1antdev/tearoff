import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LEDGER_LAP_IN_LAP,
  LEDGER_LAP_OUT_LAP,
  LEDGER_LAP_SERVICED,
} from '@irdashies/types';
import { ChannelBus } from '../bridge/channelBus';
import { createSessionLifecycle } from '../sessionLifecycle';
import { dispatch } from '../storage/lapLibrary/dispatch';
import { LapLibraryDatabase } from '../storage/lapLibrary/LapLibraryDatabase';
import {
  createLapLibraryService,
  type LapLibraryService,
} from '../storage/lapLibrary/lapLibraryService';
import {
  createWorkerClient,
  type WorkerLike,
  type WorkerReply,
  type WorkerRequest,
} from '../storage/lapLibrary/workerClient';
import { ledgerSession, LedgerSim } from './playerLedgerFixture';
import { PlayerLedgerRuntime } from './playerLedgerRuntime';

/**
 * The ledger through the real storage: the runtime, the lap library's
 * service, its client and dispatcher, and a real database in a file of its
 * own under the system's temporary folder. Everything but the worker
 * thread, which a stand-in answers for on the next turn of the event loop.
 *
 * Never the player's own library: the file is made for the spec and removed
 * after it.
 */
const fakeWorker = (db: LapLibraryDatabase): WorkerLike => {
  const listeners: ((reply: WorkerReply) => void)[] = [];
  const worker: WorkerLike = {
    postMessage(request: WorkerRequest) {
      setTimeout(() => {
        let reply: WorkerReply;
        try {
          reply = {
            id: request.id,
            // Cloned, as a real thread boundary would.
            result: structuredClone(
              dispatch(db, request.method, structuredClone(request.args))
            ),
          };
        } catch (error) {
          reply = { id: request.id, error: (error as Error).message };
        }
        for (const listener of listeners) listener(reply);
      }, 0);
    },
    on(event: 'message' | 'error' | 'exit', listener: never) {
      if (event === 'message') listeners.push(listener);
      return worker;
    },
    terminate: () => Promise.resolve(0),
  };
  return worker;
};

const PIT_SPEED = 10;

describe('the ledger in the lap library', () => {
  let folder: string;
  let file: string;
  let db: LapLibraryDatabase;
  let service: LapLibraryService;
  const errors: string[] = [];

  const open = () => {
    db = new LapLibraryDatabase(file);
    service = createLapLibraryService(createWorkerClient(fakeWorker(db)), {
      maxLaps: 5000,
      logError: (message, error) => errors.push(`${message} ${String(error)}`),
    });
  };

  /** Waits until the library has answered everything asked of it so far. */
  const stored = async () => {
    await service.getStats();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  const start = (bootId: string) => {
    let clock = Date.UTC(2026, 10, 15, 12, 0, 0);
    const runtime = new PlayerLedgerRuntime(
      new ChannelBus(),
      createSessionLifecycle(),
      { markStart: () => undefined, markEnd: () => undefined },
      service,
      { simulator: 'lmu', bootId, now: () => (clock += 1000) }
    );
    const sim = new LedgerSim((frame) => runtime.onFrame(frame));
    runtime.onSession(ledgerSession());
    return { runtime, sim };
  };

  /** Two laps, a stop for forty litres with the line after the box, a lap. */
  const driveAStop = (sim: LedgerSim) => {
    sim.emit();
    sim.driveLaps(2.6);
    sim.driveTo(0.9);
    sim.onPitRoad = true;
    sim.emit();
    sim.driveTo(0.95, PIT_SPEED);
    sim.stand(22, (dt) => {
      sim.fuel = (sim.fuel ?? 0) + (40 / 22) * dt;
    });
    sim.driveTo(0.1, PIT_SPEED);
    sim.onPitRoad = false;
    sim.emit();
    sim.driveLaps(1.2);
  };

  beforeEach(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tearoff-ledger-'));
    file = path.join(folder, 'laps.db');
    errors.length = 0;
    open();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(folder, { recursive: true, force: true });
  });

  it('keeps every lap with what it cost and the stint it was driven in', async () => {
    const { runtime, sim } = start('run-a');
    driveAStop(sim);
    await stored();

    const [session] = await service.listSessions();
    expect(session).toMatchObject({
      simulator: 'lmu',
      trackId: 18,
      carKey: 'Ferrari 296 LMGT3 Evo',
      sessionType: 'Practice',
      lapCount: 4,
    });
    const laps = await service.listLaps(session.id);
    const stints = await service.listStints(session.id);

    expect(laps.map((lap) => lap.ledger?.flags)).toEqual([
      0,
      0,
      LEDGER_LAP_IN_LAP | LEDGER_LAP_SERVICED,
      LEDGER_LAP_OUT_LAP,
    ]);
    expect(laps.map((lap) => lap.ledger?.stintLap)).toEqual([2, 3, 4, 1]);
    expect(laps.map((lap) => lap.pit)).toEqual([false, false, true, true]);
    // The refuel-corrected figure in the lap's own column as well.
    expect(laps[2].fuelUsed).toBeCloseTo(2.4, 1);
    expect(laps[2].ledger?.fuelAdded).toBeCloseTo(40, 6);
    expect(laps[0].ledger).toMatchObject({
      sessionNum: 0,
      compounds: ['Medium', 'Medium', 'Medium', 'Medium'],
      wetness: 1,
      position: 4,
      classPosition: 2,
    });
    expect(laps[0].ledger?.simLapTime).toBeCloseTo(60, 6);
    expect(laps[0].ledger?.treadUsed[0]).toBeCloseTo(0.005, 6);
    expect(laps[0].ledger?.brakeAtLine[3]).toBeCloseTo(32 - 0.003, 3);
    expect(laps[0].eligible).toBe(true);

    // The first stint closed by the stop; the second is still running, and
    // stands as it was at its last lap.
    expect(stints).toHaveLength(2);
    expect(stints[0]).toMatchObject({
      ordinal: 1,
      openedBy: 'joined',
      closedBy: 'service',
      laps: 4,
      cleanLaps: 2,
      startFuel: 50,
      driver: 'Sergio Test',
      own: true,
    });
    expect(stints[0].stop?.fuelAdded).toBeCloseTo(40, 6);
    expect(stints[0].stop?.stationaryTime).toBeCloseTo(22, 6);
    expect(stints[0].bestLap).toBeCloseTo(60, 3);
    expect(stints[0].endedAt).not.toBeNull();
    expect(stints[1]).toMatchObject({
      ordinal: 2,
      openedBy: 'pitExit',
      closedBy: null,
      laps: 1,
      endLap: 5,
      endedAt: null,
    });
    expect(laps.map((lap) => lap.ledger?.stintId)).toEqual([
      stints[0].id,
      stints[0].id,
      stints[0].id,
      stints[1].id,
    ]);
    // The rows on the channel carry the ids the library gave the laps.
    expect(
      [...runtime.ledgerSnapshot().laps].reverse().map((row) => row.id)
    ).toEqual(laps.map((lap) => lap.id));
    expect(errors).toEqual([]);
  });

  it('closes the open stint and stores the lap in hand when it is let go', async () => {
    const { runtime, sim } = start('run-a');
    sim.emit();
    sim.driveLaps(2.5);
    // Just over the line: the second lap is still waiting for its time.
    sim.drive(1);
    runtime.dispose();
    await stored();

    const [session] = await service.listSessions();
    const stints = await service.listStints(session.id);
    expect(session.lapCount).toBe(2);
    expect(stints).toHaveLength(1);
    expect(stints[0]).toMatchObject({
      closedBy: 'disconnect',
      laps: 3,
      endLap: 3,
    });
    expect(stints[0].endFuel).toBeCloseTo(sim.fuel ?? 0, 6);
    expect(stints[0].endedAt).not.toBeNull();
    expect(errors).toEqual([]);
  });

  it('keeps no stint that ended without a lap', async () => {
    const { sim } = start('run-a');
    sim.emit();
    sim.driveLaps(1.6);
    // To the garage, out again, and straight back before the line.
    sim.inGarage = true;
    sim.onPitRoad = true;
    sim.progress = sim.lapsCompleted + 0.95;
    sim.stand(2);
    sim.inGarage = false;
    sim.driveTo(0.98, PIT_SPEED);
    sim.onPitRoad = false;
    sim.emit();
    sim.inGarage = true;
    sim.stand(2);
    await stored();

    const [session] = await service.listSessions();
    const stints = await service.listStints(session.id);
    expect(stints.map((stint) => [stint.ordinal, stint.closedBy])).toEqual([
      [1, 'garage'],
    ]);
    expect(errors).toEqual([]);
  });

  it('is all still there after the app is closed and started again, and is where the next session starts from', async () => {
    const first = start('run-a');
    driveAStop(first.sim);
    first.runtime.dispose();
    await stored();
    db.close();

    // The file as the next run finds it.
    open();
    const [session] = await service.listSessions();
    const laps = await service.listLaps(session.id);
    const stints = await service.listStints(session.id);
    expect(laps).toHaveLength(4);
    expect(stints.map((stint) => stint.closedBy)).toEqual([
      'service',
      'disconnect',
    ]);

    // The same track and car, mid-session: a new stint, no rows in hand,
    // and rates from what the laps before the restart cost.
    const second = start('run-b');
    await stored();
    second.sim.fuel = 31;
    second.sim.emit();

    const snapshot = second.runtime.stintSnapshot();
    expect(second.runtime.ledgerSnapshot().laps).toEqual([]);
    expect(snapshot.stint).toMatchObject({
      ordinal: 1,
      openedBy: 'joined',
      startFuel: 31,
    });
    expect(snapshot.stint?.id).not.toBe(stints[0].id);
    expect(snapshot.rates.source).toBe('baseline');
    // The two clean laps; the pit laps are no part of a baseline.
    expect(snapshot.rates.fuel).toBeCloseTo(2.4, 3);
    expect(snapshot.rates.lapTime).toBeCloseTo(60, 3);
    expect(snapshot.budgetLapsLeft).toBeCloseTo(31 / 2.4, 1);
    expect(errors).toEqual([]);
  });
});
