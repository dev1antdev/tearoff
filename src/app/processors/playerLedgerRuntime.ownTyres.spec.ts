import { describe, expect, it } from 'vitest';
import type { LapLibraryLap } from '@irdashies/types';
import { createLedgerHarness, type LedgerSim } from './playerLedgerFixture';

/**
 * What the ledger tells of the tyres on our own car to whoever reckons
 * another car's from them, on hand-built frames: a car driven round a
 * one-kilometre track at a lap a minute, wearing half a percent of tread a
 * lap. The pit lane runs from 0.9 of the lap to 0.1.
 */

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

/** Lets a promise from the storage stand-in settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the ledger's word on our own tyres", () => {
  it('gives the tread as the sim reads it now', () => {
    const { sim, runtime } = createLedgerHarness();
    sim.emit();
    sim.driveLaps(2.6);

    const tread = runtime.ownTyres().tread;
    expect(tread).toHaveLength(4);
    // Two laps and six tenths at half a percent a lap.
    tread?.forEach((value) => expect(value).toBeCloseTo(0.987, 3));
  });

  it('has no live tread under iRacing, which refreshes it in the pits alone', () => {
    const { sim, runtime } = createLedgerHarness({ simulator: 'iracing' });
    sim.emit();
    sim.driveLaps(1.2);

    expect(runtime.ownTyres().tread).toBeNull();
  });

  it('has watched the tyres since it first read them', () => {
    const { sim, runtime } = createLedgerHarness();
    sim.emit();
    const first = sim.time;
    sim.driveLaps(2.6);

    expect(runtime.ownTyres().watch).toEqual({
      since: first,
      changedAt: Number.NaN,
      changeLap: -1,
    });
  });

  it('says when a tyre went on, and how many laps were behind the car', () => {
    const { sim, runtime } = createLedgerHarness();
    sim.emit();
    const first = sim.time;
    sim.driveLaps(2.6);

    // A stop the car drives into after its third lap: the line is in the
    // lane, so it has four behind it when it stands.
    enterPits(sim);
    sim.driveTo(0.05, PIT_SPEED);
    sim.stand(2);
    expect(runtime.ownTyres().watch.changeLap).toBe(-1);
    sim.tread = [1, 1, 1, 1];
    const fittedAt = sim.time;
    sim.stand(2);

    const { watch } = runtime.ownTyres();
    expect(watch.since).toBe(first);
    // On the first frame that shows them.
    expect(watch.changedAt).toBe(fittedAt + sim.step);
    expect(watch.changeLap).toBe(sim.lapsCompleted);

    // Driven on, it stays the last change seen.
    leavePits(sim);
    sim.driveLaps(2);
    expect(runtime.ownTyres().watch).toEqual(watch);
  });

  it('counts the laps as the race history does where the sim gives the lap', () => {
    const { sim, runtime } = createLedgerHarness();
    // The car's lap, which is one more than it has completed.
    sim.extra = { CarIdxLap: [8, 3] };
    sim.emit();
    sim.driveLaps(0.6);
    enterPits(sim);
    sim.stand(2);
    sim.tread = [1, 1, 1, 1];
    sim.stand(2);

    expect(runtime.ownTyres().watch.changeLap).toBe(7);
  });

  it('loses sight of the tyres while the car is out of the world', () => {
    const { sim, runtime } = createLedgerHarness();
    sim.emit();
    sim.driveLaps(1.6);

    sim.hasCar = false;
    sim.stand(3);
    expect(runtime.ownTyres().watch.since).toBeNaN();
    expect(runtime.ownTyres().tread).toBeNull();

    // Back in its garage on the tyres it left on: watched again from now,
    // with nothing to say of the time between.
    sim.hasCar = true;
    sim.inGarage = true;
    const backAt = sim.time;
    sim.stand(1);
    const back = runtime.ownTyres().watch;
    expect(back.since).toBe(backAt + sim.step);
    expect(back.changeLap).toBe(-1);
  });

  it('sees the set a car comes back from its garage on', () => {
    const { sim, runtime } = createLedgerHarness();
    sim.emit();
    sim.driveLaps(1.6);

    sim.hasCar = false;
    sim.stand(3);
    sim.hasCar = true;
    sim.inGarage = true;
    sim.tread = [1, 1, 1, 1];
    sim.stand(1);

    const { watch } = runtime.ownTyres();
    expect(watch.changeLap).toBe(sim.lapsCompleted);
    expect(watch.changedAt).toBeGreaterThanOrEqual(watch.since);
  });

  it('starts over in another session', () => {
    const { sim, runtime } = createLedgerHarness();
    sim.emit();
    sim.driveLaps(1.6);
    enterPits(sim);
    sim.stand(2);
    sim.tread = [1, 1, 1, 1];
    sim.stand(2);
    expect(runtime.ownTyres().watch.changeLap).toBeGreaterThanOrEqual(0);

    sim.sessionNum = 1;
    sim.emit();

    expect(runtime.ownTyres().watch).toEqual({
      since: sim.time,
      changedAt: Number.NaN,
      changeLap: -1,
    });
  });

  it('says what a lap costs the tread on the compound it has run', () => {
    const { sim, runtime } = createLedgerHarness();
    sim.emit();
    sim.driveLaps(0.6);
    expect(runtime.ownTyres().costs.size).toBe(0);

    sim.driveLaps(4);
    const cost = runtime.ownTyres().costs.get('Medium');
    expect(cost?.laps).toEqual([4, 4, 4, 4]);
    cost?.perLap.forEach((value) => expect(value).toBeCloseTo(0.005, 4));
    // Made again only when a lap has been added.
    expect(runtime.ownTyres().costs).toBe(runtime.ownTyres().costs);
  });

  it('lets earlier sessions on the track stand in before it has laps', async () => {
    const before = (treadUsed: number[]): LapLibraryLap =>
      ({
        lapTime: 61,
        fuelUsed: 2.5,
        energyUsed: 0.021,
        ledger: {
          flags: 0,
          compounds: ['Hard', 'Hard', 'Hard', 'Hard'],
          treadUsed,
          brakeUsed: [0.002, 0.002, 0.001, 0.001],
        },
      }) as unknown as LapLibraryLap;
    const { sim, runtime } = createLedgerHarness({
      baseline: [
        before([0.003, 0.003, 0.002, 0.002]),
        before([0.003, 0.003, 0.002, 0.002]),
        before([0.003, 0.003, 0.002, 0.002]),
      ],
    });
    sim.emit();
    await settle();

    expect(runtime.ownTyres().costs.get('Hard')).toEqual({
      perLap: [0.003, 0.003, 0.002, 0.002],
      laps: [3, 3, 3, 3],
    });
  });
});
