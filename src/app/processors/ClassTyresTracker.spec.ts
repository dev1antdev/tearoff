import { describe, expect, it } from 'vitest';
import type {
  ClassTyresTuning,
  LmuPitService,
  RaceRecords,
  Session,
  Telemetry,
} from '@irdashies/types';
import {
  TREAD_ESTIMATE,
  TREAD_MEASURED,
  TREAD_NONE,
  TYRE_SET_AT_LEAST,
  TYRE_SET_LIKELY,
  TYRE_SET_SEEN,
  TYRE_SET_UNKNOWN,
} from '@irdashies/types';
import { ClassTyresTracker } from './ClassTyresTracker';
import type { TreadCost } from './ledgerRates';
import type { OwnTyres } from './ownTyres';
import {
  drive,
  driveLaps,
  enterPits,
  Field,
  leaveBox,
  leavePits,
  recorded,
  standInBox,
  type FrameSink,
} from './raceHistoryFixture';

/**
 * Staged, every frame of it: a small field lapping a circuit, with stops
 * put on it by hand. No recording has a pit stop. What is checked here is
 * that the tracker reads the race history's own records by the rule, on
 * frames shaped as a sim's are; whether a real field's stops can be told
 * apart this way only a real race can say.
 */

const MEDIUM = 0;
const HARD = 1;
const OWN = 0;
/** Cars 0 to 2 are one class; car 3 is another. */
const OTHER_CLASS = 3;
/** A lap costs 3 % of a full budget. */
const USAGE = 0.03;

/** What Le Mans Ultimate states for the recorded LMGT3. */
const SERVICE: LmuPitService = {
  fuelFillRate: 3.4,
  fuelInsert: 1,
  fuelRemove: 1,
  virtualEnergyFillRate: 0.025,
  virtualEnergyInsert: 0,
  virtualEnergyRemove: 0,
  fourTireChange: 12,
  tireTimeConcurrent: 0,
  driverChange: 25,
  driverConcurrent: 1,
};

const cost = (perLap: number, laps = 5): TreadCost => ({
  perLap: [perLap, perLap, perLap, perLap],
  laps: [laps, laps, laps, laps],
});

interface StageOptions {
  lmu?: boolean;
  service?: LmuPitService;
}

/** A field, the race history recording it, and the tracker reading both. */
class Stage {
  readonly field: Field;
  run: ReturnType<typeof recorded>;
  tracker: ClassTyresTracker;
  /** The compounds on each car, as the frames say. */
  readonly compounds: number[][];
  /** The wear the frames publish for each car, where they publish any. */
  wear: number[][] | null = null;
  /** Cars whose published wear does not move, whatever they do. */
  readonly withheldWear = new Set<number>();
  own: OwnTyres | undefined;
  tuning: ClassTyresTuning = { tyreChangeSeconds: 0 };
  readonly sink: FrameSink;
  private readonly lmu: boolean;
  private readonly service: LmuPitService | undefined;

  constructor({ lmu = true, service = SERVICE }: StageOptions = {}) {
    this.lmu = lmu;
    this.service = lmu ? service : undefined;
    this.field = new Field({ cars: 4, lmu });
    this.field.cars[OTHER_CLASS].classId = 9;
    // Half a budget aboard, so that a stop has room to add to it.
    this.field.energy = this.field.cars.map(() => 0.5);
    this.compounds = this.field.cars.map(() => [
      MEDIUM,
      MEDIUM,
      MEDIUM,
      MEDIUM,
    ]);
    this.run = recorded({ simulator: () => (lmu ? 'lmu' : 'iracing') });
    this.tracker = this.newTracker();
    this.sink = { onFrame: (frame) => this.onFrame(frame) };
    this.handSession();
  }

  /** The app started again: nothing is held but what the file gives back. */
  restart(stored: RaceRecords): void {
    this.run = recorded({
      simulator: () => (this.lmu ? 'lmu' : 'iracing'),
      bootId: 'later',
    });
    this.tracker = this.newTracker();
    this.handSession();
    // Picked up again, and the file read a moment after.
    this.drive(0.5);
    this.run.recorder.restore(stored);
  }

  drive(seconds: number): void {
    drive(this.field, this.sink, seconds, () => this.burn());
  }

  laps(carIdx: number, laps: number): void {
    driveLaps(this.field, this.sink, carIdx, laps, () => this.burn());
  }

  /**
   * A stop half way round the lap: five seconds down the lane, `standing`
   * seconds in the box and three out of it. What it takes on and the tyres
   * it is given go on while it stands.
   */
  stop(
    carIdx: number,
    standing: number,
    {
      gain = 0,
      compound,
      wear,
    }: { gain?: number; compound?: number; wear?: number } = {}
  ): void {
    const car = this.field.cars[carIdx];
    while (car.pct < 0.5 || car.pct > 0.6) this.drive(0.1);
    enterPits(car);
    this.drive(5);
    standInBox(car);
    this.drive(standing / 2);
    this.field.energy[carIdx] = Math.min(1, this.field.energy[carIdx] + gain);
    if (compound !== undefined) this.compounds[carIdx].fill(compound);
    if (wear !== undefined) this.wear?.[carIdx].fill(wear);
    this.drive(standing / 2);
    leaveBox(car);
    this.drive(3);
    leavePits(car);
    this.drive(1);
  }

  /** What the tracker says of a car, by name. */
  car(carIdx: number) {
    const snapshot = this.tracker.snapshot();
    return {
      setLaps: snapshot.setLaps[carIdx],
      sure: snapshot.sure[carIdx],
      treadPct: snapshot.treadPct[carIdx],
      treadSource: snapshot.treadSource[carIdx],
      compounds: snapshot.compounds.slice(carIdx * 4, carIdx * 4 + 4),
    };
  }

  /** Everything the race history holds, as the file would hand it back. */
  stored(): RaceRecords {
    const { recorder } = this.run;
    const cars = this.field.cars.map((_, carIdx) => carIdx);
    return structuredClone({
      laps: cars.flatMap((carIdx) => recorder.carLaps(carIdx)),
      stints: cars.flatMap((carIdx) =>
        recorder.carStints(carIdx).filter((stint) => stint.laps > 0)
      ),
      driverChanges: [...recorder.driverChanges()],
    }) as RaceRecords;
  }

  private newTracker(): ClassTyresTracker {
    return new ClassTyresTracker({
      history: {
        raceToken: () => this.run.recorder.currentRace()?.token ?? '',
        revision: (carIdx) => this.run.recorder.carRevision(carIdx),
        laps: (carIdx) => this.run.recorder.carLaps(carIdx),
        stints: (carIdx) => this.run.recorder.carStints(carIdx),
      },
      own: () => this.own,
      tuning: () => this.tuning,
    });
  }

  private handSession(): void {
    const session = this.field.session();
    const staged = {
      ...session,
      DriverInfo: {
        ...session.DriverInfo,
        DriverCarIdx: OWN,
        DriverCarFuelMaxLtr: 100,
      },
      ...(this.service ? { LmuRest: { pitService: this.service } } : {}),
    } as unknown as Session;
    this.run.recorder.onSession(staged);
    this.tracker.onSession(staged);
  }

  /** Every car on the move burns what a lap costs it. */
  private burn(): void {
    this.field.cars.forEach((car, carIdx) => {
      if (car.halted) return;
      this.field.energy[carIdx] = Math.max(
        0,
        this.field.energy[carIdx] - (USAGE * this.field.dt) / car.pace
      );
      if (this.withheldWear.has(carIdx)) return;
      // A tyre wears a little faster than our own costs say: 1.2 % a lap.
      this.wear?.[carIdx].forEach((value, wheel, wheels) => {
        wheels[wheel] = value - (0.012 * this.field.dt) / car.pace;
      });
    });
  }

  private onFrame(frame: Telemetry): void {
    const cells = frame as unknown as Record<string, { value: unknown[] }>;
    if (this.lmu) {
      cells.LmuCarIdxWheelCompounds = { value: this.compounds.flat() };
      cells.LmuRefuelRatio = { value: [1.03] };
      if (this.wear) cells.LmuCarIdxWheelWear = { value: this.wear.flat() };
    } else {
      cells.CarIdxTireCompound = {
        value: this.compounds.map((wheels) => wheels[0]),
      };
    }
    this.run.recorder.onFrame(frame);
    this.tracker.onFrame(frame);
  }
}

describe('ClassTyresTracker', () => {
  describe('laps on the set', () => {
    it('counts from the start for a car that has not stopped', () => {
      const stage = new Stage();
      stage.laps(2, 4);
      stage.drive(2);

      for (const carIdx of [0, 1, 2]) {
        expect(stage.car(carIdx)).toMatchObject({
          setLaps: 4,
          sure: TYRE_SET_SEEN,
          compounds: [MEDIUM, MEDIUM, MEDIUM, MEDIUM],
        });
      }
    });

    it('counts from a stop that was seen to change the compound', () => {
      const stage = new Stage();
      stage.laps(1, 3);
      // Too short to be told by its length: only the compound says so.
      stage.stop(1, 14, { compound: HARD });
      stage.drive(2);

      // Seen while the car is still on the lap it stopped on.
      expect(stage.car(1)).toMatchObject({
        setLaps: 0,
        sure: TYRE_SET_SEEN,
        compounds: [HARD, HARD, HARD, HARD],
      });

      stage.laps(1, 3);
      stage.drive(2);
      // The lap it stopped on is not one on the new set.
      expect(stage.car(1)).toMatchObject({ setLaps: 2, sure: TYRE_SET_SEEN });
      // Nobody else stopped.
      expect(stage.car(2)).toMatchObject({ sure: TYRE_SET_SEEN });
      expect(stage.car(2).setLaps).toBeGreaterThanOrEqual(6);
    });

    it('counts from a stop four tyres longer than its refill, as likely', () => {
      const stage = new Stage();
      stage.laps(2, 3);
      // 0.6 of a budget of virtual energy takes 24 s; 40 s leaves 16.
      stage.stop(2, 40, { gain: 0.6 });
      stage.laps(2, 3);
      stage.drive(2);

      expect(stage.car(2)).toMatchObject({ setLaps: 2, sure: TYRE_SET_LIKELY });
    });

    it('costs a car on fuel with the fuel hose', () => {
      const stage = new Stage();
      stage.laps(1, 3);
      // Car 1 runs on fuel: 0.6 of a 100-litre tank is 17.6 s at 3.4 l/s,
      // and 2 s of hose. 32 s leaves 12.4.
      stage.stop(1, 32, { gain: 0.6 });
      stage.laps(1, 3);
      stage.drive(2);

      expect(stage.car(1)).toMatchObject({ setLaps: 2, sure: TYRE_SET_LIKELY });
    });

    it('carries the set through a stop its refill explains, as likely', () => {
      const stage = new Stage();
      stage.laps(2, 3);
      stage.stop(2, 26, { gain: 0.6 });
      stage.laps(2, 3);
      stage.drive(2);

      expect(stage.car(2)).toMatchObject({ setLaps: 6, sure: TYRE_SET_LIKELY });
    });

    it('says at least the laps since a stop it cannot judge', () => {
      const stage = new Stage();
      stage.laps(2, 3);
      // Seven seconds to spare: too long for the refill, too short for tyres.
      stage.stop(2, 31, { gain: 0.6 });
      stage.laps(2, 3);
      stage.drive(2);

      expect(stage.car(2)).toMatchObject({
        setLaps: 2,
        sure: TYRE_SET_AT_LEAST,
      });
    });

    it('says at least, while the car is still in its box', () => {
      const stage = new Stage();
      stage.laps(2, 3);
      const car = stage.field.cars[2];
      while (car.pct < 0.5) stage.drive(0.1);
      enterPits(car);
      stage.drive(5);
      standInBox(car);
      stage.drive(6);

      expect(stage.car(2)).toMatchObject({
        setLaps: 0,
        sure: TYRE_SET_AT_LEAST,
      });
    });

    it('takes what four tyres take from the setting where one is given', () => {
      const stage = new Stage();
      stage.tuning = { tyreChangeSeconds: 20 };
      stage.laps(2, 3);
      // Sixteen seconds to spare are a change at 12 s, and not at 20.
      stage.stop(2, 40, { gain: 0.6 });
      stage.laps(2, 3);
      stage.drive(2);

      expect(stage.car(2).sure).toBe(TYRE_SET_AT_LEAST);

      // Changed while the race is on: the same records, read again.
      stage.tuning = { tyreChangeSeconds: 0 };
      stage.drive(2);
      expect(stage.car(2).sure).toBe(TYRE_SET_LIKELY);
    });

    it('judges no stop by its length where nothing says what four tyres take', () => {
      const stage = new Stage({
        service: { ...SERVICE, fourTireChange: undefined },
      });
      stage.laps(2, 3);
      stage.stop(2, 40, { gain: 0.6 });
      stage.laps(2, 3);
      stage.drive(2);

      expect(stage.car(2)).toMatchObject({
        setLaps: 2,
        sure: TYRE_SET_AT_LEAST,
      });
    });
  });

  describe('under iRacing', () => {
    it('runs on the stops alone: a compound that changed, or at least', () => {
      const stage = new Stage({ lmu: false });
      stage.laps(2, 3);
      stage.stop(1, 30);
      stage.stop(2, 30, { compound: HARD });
      stage.laps(2, 3);
      stage.drive(2);

      // One compound a car, no refill to reckon and no time for tyres.
      expect(stage.car(1)).toMatchObject({
        // The quicker of the two: a lap further on since its stop.
        setLaps: 3,
        sure: TYRE_SET_AT_LEAST,
        compounds: [MEDIUM, MEDIUM, MEDIUM, MEDIUM],
        treadPct: -1,
        treadSource: TREAD_NONE,
      });
      expect(stage.car(2)).toMatchObject({
        setLaps: 2,
        sure: TYRE_SET_SEEN,
        compounds: [HARD, HARD, HARD, HARD],
      });
    });

    it('rules a change out of a stop shorter than the setting says tyres take', () => {
      const stage = new Stage({ lmu: false });
      stage.tuning = { tyreChangeSeconds: 15 };
      stage.laps(2, 3);
      stage.stop(2, 6);
      stage.laps(2, 3);
      stage.drive(2);

      expect(stage.car(2)).toMatchObject({ setLaps: 6, sure: TYRE_SET_LIKELY });
    });
  });

  describe('the tread left', () => {
    it('is our own wear a lap times the laps on the set, as an estimate', () => {
      const stage = new Stage();
      stage.own = {
        tread: null,
        watch: { since: Number.NaN, changedAt: Number.NaN, changeLap: -1 },
        costs: new Map([['Medium', cost(0.009)]]),
      };
      stage.laps(2, 10);
      stage.drive(2);

      // Ten laps at 0.9 % a lap.
      expect(stage.car(2)).toMatchObject({
        setLaps: 10,
        treadPct: 91,
        treadSource: TREAD_ESTIMATE,
      });
    });

    it('takes each wheel at what its own compound costs', () => {
      const stage = new Stage();
      stage.compounds[2] = [HARD, HARD, MEDIUM, MEDIUM];
      stage.own = {
        tread: null,
        watch: { since: Number.NaN, changedAt: Number.NaN, changeLap: -1 },
        costs: new Map([
          ['Medium', cost(0.012)],
          ['Hard', cost(0.004)],
        ]),
      };
      stage.laps(2, 10);
      stage.drive(2);

      // 0.4 % a lap at the front and 1.2 % at the rear: 0.8 % in the mean.
      expect(stage.car(2)).toMatchObject({
        treadPct: 92,
        treadSource: TREAD_ESTIMATE,
      });
    });

    it('is not given before our own car has three clean laps on the compound', () => {
      const stage = new Stage();
      stage.own = {
        tread: null,
        watch: { since: Number.NaN, changedAt: Number.NaN, changeLap: -1 },
        costs: new Map([['Medium', cost(0.009, 2)]]),
      };
      stage.laps(2, 4);
      stage.drive(2);

      expect(stage.car(2)).toMatchObject({
        setLaps: 4,
        treadPct: -1,
        treadSource: TREAD_NONE,
      });

      stage.own = {
        ...stage.own,
        costs: new Map([['Medium', cost(0.009, 3)]]),
      };
      stage.laps(2, 1);
      stage.drive(2);
      expect(stage.car(2)).toMatchObject({
        setLaps: 5,
        treadPct: 96,
        treadSource: TREAD_ESTIMATE,
      });
    });

    it('is not given for a compound our own car has not run', () => {
      const stage = new Stage();
      stage.compounds[2] = [HARD, HARD, HARD, HARD];
      stage.own = {
        tread: null,
        watch: { since: Number.NaN, changedAt: Number.NaN, changeLap: -1 },
        costs: new Map([['Medium', cost(0.009)]]),
      };
      stage.laps(2, 4);
      stage.drive(2);

      expect(stage.car(2)).toMatchObject({
        setLaps: 4,
        treadPct: -1,
        treadSource: TREAD_NONE,
      });
      // The car beside it, on mediums, has one.
      expect(stage.car(1).treadSource).toBe(TREAD_ESTIMATE);
    });

    it('is not given with no ledger of our own car at all', () => {
      const stage = new Stage();
      stage.laps(2, 4);
      stage.drive(2);

      expect(stage.car(2)).toMatchObject({
        setLaps: 4,
        treadPct: -1,
        treadSource: TREAD_NONE,
      });
    });
  });

  describe('our own car', () => {
    it('shows the tread the sim reads and the change its ledger saw', () => {
      const stage = new Stage();
      const watch = { since: 0, changedAt: Number.NaN, changeLap: -1 };
      stage.own = {
        tread: [0.9, 0.9, 0.86, 0.86],
        watch,
        costs: new Map([['Medium', cost(0.009)]]),
      };
      stage.laps(OWN, 3);
      stage.drive(2);

      expect(stage.car(OWN)).toMatchObject({
        setLaps: 3,
        sure: TYRE_SET_SEEN,
        treadPct: 88,
        treadSource: TREAD_MEASURED,
      });

      // A stop the refill explains, at which the ledger saw new tyres go
      // on all the same: the same compound, so the record cannot say.
      stage.stop(OWN, 26, { gain: 0.6 });
      watch.changedAt = stage.field.time - 10;
      watch.changeLap = 3;
      stage.own = { ...stage.own, tread: [1, 1, 1, 1] };
      stage.laps(OWN, 2);
      stage.drive(2);

      expect(stage.car(OWN)).toMatchObject({
        setLaps: 1,
        sure: TYRE_SET_SEEN,
        treadPct: 100,
        treadSource: TREAD_MEASURED,
      });
    });

    it('knows no set went on at a stop its ledger watched', () => {
      const stage = new Stage();
      stage.own = {
        tread: [0.95, 0.95, 0.95, 0.95],
        watch: { since: 0, changedAt: Number.NaN, changeLap: -1 },
        costs: new Map(),
      };
      stage.laps(OWN, 3);
      // By its length this stop is a likely change; the ledger saw none.
      stage.stop(OWN, 40, { gain: 0.6 });
      stage.laps(OWN, 2);
      stage.drive(2);

      expect(stage.car(OWN)).toMatchObject({ setLaps: 5, sure: TYRE_SET_SEEN });
    });

    it('is reckoned like any other car where its tread is not read', () => {
      const stage = new Stage();
      stage.own = {
        // iRacing, or a team-mate at the wheel with no reading.
        tread: null,
        watch: { since: Number.NaN, changedAt: Number.NaN, changeLap: -1 },
        costs: new Map([['Medium', cost(0.01)]]),
      };
      stage.laps(OWN, 3);
      stage.stop(OWN, 40, { gain: 0.6 });
      stage.laps(OWN, 2);
      stage.drive(2);

      expect(stage.car(OWN)).toMatchObject({
        setLaps: 1,
        sure: TYRE_SET_LIKELY,
        treadPct: 99,
        treadSource: TREAD_ESTIMATE,
      });
    });
  });

  describe("a sim that publishes every car's wear", () => {
    const withWear = (): Stage => {
      const stage = new Stage();
      stage.wear = stage.field.cars.map(() => [1, 1, 1, 1]);
      return stage;
    };

    it('shows the reading as the tread once it has been seen to fall', () => {
      const stage = withWear();
      stage.own = {
        tread: null,
        watch: { since: Number.NaN, changedAt: Number.NaN, changeLap: -1 },
        costs: new Map([['Medium', cost(0.005)]]),
      };
      stage.laps(2, 5);
      stage.drive(2);

      const car = stage.car(2);
      expect(car.treadSource).toBe(TREAD_MEASURED);
      // About five laps at 1.2 % a lap, not at our own 0.5 %.
      expect(car.treadPct).toBeGreaterThanOrEqual(93);
      expect(car.treadPct).toBeLessThanOrEqual(95);
    });

    it('sees a set go on when the wear goes back up in the pits', () => {
      const stage = withWear();
      stage.laps(2, 3);
      // The refill explains this stop and the compound is the same.
      stage.stop(2, 26, { gain: 0.6, wear: 1 });
      stage.laps(2, 3);
      stage.drive(2);

      expect(stage.car(2)).toMatchObject({ setLaps: 2, sure: TYRE_SET_SEEN });
    });

    it('knows no set went on at a stop where the wear did not go up', () => {
      const stage = withWear();
      stage.laps(2, 3);
      // By its length a likely change.
      stage.stop(2, 40, { gain: 0.6 });
      stage.laps(2, 3);
      stage.drive(2);

      expect(stage.car(2)).toMatchObject({ setLaps: 6, sure: TYRE_SET_SEEN });
    });

    it('takes no reading that never moves for the car’s own', () => {
      // Online a rival's wear reads 100 % all race.
      const stage = withWear();
      stage.withheldWear.add(2);
      stage.own = {
        tread: null,
        watch: { since: Number.NaN, changedAt: Number.NaN, changeLap: -1 },
        costs: new Map([['Medium', cost(0.009)]]),
      };
      stage.laps(2, 3);
      stage.stop(2, 40, { gain: 0.6 });
      stage.laps(2, 3);
      stage.drive(2);

      // The stop's length is all there is to go by, where a reading that
      // was the car's own would have shown no set going on; and the tread
      // is an estimate, not the 100 % the sim goes on publishing.
      expect(stage.car(2)).toMatchObject({
        setLaps: 2,
        sure: TYRE_SET_LIKELY,
        treadPct: 98,
        treadSource: TREAD_ESTIMATE,
      });
    });
  });

  it('leaves a car of another class alone', () => {
    const stage = new Stage();
    stage.own = {
      tread: [0.9, 0.9, 0.9, 0.9],
      watch: { since: 0, changedAt: Number.NaN, changeLap: -1 },
      costs: new Map([['Medium', cost(0.009)]]),
    };
    stage.laps(OTHER_CLASS, 3);
    stage.stop(OTHER_CLASS, 14, { compound: HARD });
    stage.laps(OTHER_CLASS, 2);
    stage.drive(2);

    expect(stage.car(OTHER_CLASS)).toEqual({
      setLaps: -1,
      sure: TYRE_SET_UNKNOWN,
      treadPct: -1,
      treadSource: TREAD_NONE,
      compounds: [-1, -1, -1, -1],
    });
  });

  it('says the same after a restart, from what the file holds', () => {
    const stage = new Stage();
    stage.own = {
      tread: null,
      watch: { since: Number.NaN, changedAt: Number.NaN, changeLap: -1 },
      costs: new Map([
        ['Medium', cost(0.009)],
        ['Hard', cost(0.006)],
      ]),
    };
    stage.laps(2, 3);
    stage.stop(1, 14, { compound: HARD });
    stage.stop(2, 40, { gain: 0.6 });
    stage.laps(2, 4);
    stage.drive(4);
    const before = [0, 1, 2].map((carIdx) => stage.car(carIdx));
    expect(before.map((car) => car.sure)).toEqual([
      TYRE_SET_SEEN,
      TYRE_SET_SEEN,
      TYRE_SET_LIKELY,
    ]);

    stage.restart(stage.stored());
    stage.drive(2);

    expect([0, 1, 2].map((carIdx) => stage.car(carIdx))).toEqual(before);
  });

  it('counts a car as at least as old as the laps since it was first seen', () => {
    // Recording began with the race under way and nothing in the file.
    const stage = new Stage();
    for (let step = 0; step < 3200; step += 1) stage.field.step();
    stage.laps(2, 2);
    stage.drive(2);

    expect(stage.car(2)).toMatchObject({ setLaps: 2, sure: TYRE_SET_AT_LEAST });
  });

  describe('the snapshot', () => {
    it('is indexed by car, with four compounds a car', () => {
      const stage = new Stage();
      stage.laps(2, 2);
      stage.drive(2);
      const snapshot = stage.tracker.snapshot();

      expect(snapshot.ownCarIdx).toBe(OWN);
      expect(snapshot.sessionNum).toBe(0);
      expect(snapshot.setLaps).toHaveLength(4);
      expect(snapshot.sure).toHaveLength(4);
      expect(snapshot.treadPct).toHaveLength(4);
      expect(snapshot.treadSource).toHaveLength(4);
      expect(snapshot.compounds).toHaveLength(16);
      expect(Object.keys(snapshot).sort()).toEqual([
        'compounds',
        'ownCarIdx',
        'sessionNum',
        'setLaps',
        'sure',
        'treadPct',
        'treadSource',
        'version',
      ]);
    });

    it('moves its version only when a figure has moved', () => {
      const stage = new Stage();
      stage.laps(2, 2);
      stage.drive(2);
      const version = stage.tracker.snapshot().version;

      // Half a lap with nobody crossing the line.
      stage.drive(30);
      expect(stage.tracker.snapshot().version).toBe(version);

      stage.laps(0, 1);
      stage.drive(2);
      expect(stage.tracker.snapshot().version).toBeGreaterThan(version);
    });

    it('says nothing while no race is being recorded, or with no car of our own', () => {
      const tracker = new ClassTyresTracker({
        history: {
          raceToken: () => '',
          revision: () => 0,
          laps: () => [],
          stints: () => [],
        },
        own: () => undefined,
        tuning: () => ({ tyreChangeSeconds: 0 }),
      });
      const field = new Field({ cars: 2, lmu: true });
      tracker.onSession(field.session());
      tracker.onFrame(field.frame());

      expect(tracker.snapshot()).toMatchObject({
        ownCarIdx: -1,
        setLaps: [],
        sure: [],
        compounds: [],
      });
    });

    it('is empty again once the sim has gone', () => {
      const stage = new Stage();
      stage.laps(2, 2);
      stage.drive(2);
      expect(stage.tracker.snapshot().setLaps).toHaveLength(4);

      stage.tracker.reset();
      expect(stage.tracker.snapshot()).toMatchObject({
        ownCarIdx: -1,
        setLaps: [],
        sessionNum: null,
      });
    });
  });
});
