import { beforeAll, describe, expect, it } from 'vitest';
import type { ClassTyresSnapshot, Session, Telemetry } from '@irdashies/types';
import {
  TREAD_MEASURED,
  TREAD_NONE,
  TYRE_SET_SEEN,
  TYRE_SET_UNKNOWN,
} from '@irdashies/types';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { ClassTyresTracker } from './ClassTyresTracker';
import { RaceHistoryRecorder } from './RaceHistoryRecorder';

/**
 * The tyres of our class on a recorded Le Mans Ultimate race: four minutes
 * offline against the AI at Laguna Seca, 38 cars in three classes, two or
 * three laps each.
 *
 * What the recording can show, and does: that the sim publishes every car's
 * tread offline and that it falls lap by lap; what the per-wheel compound
 * indices hold; and that the tracker, on the app's own frames, counts every
 * car's set from the start and reads its tread. Nobody stops on it, so it
 * shows nothing of a change of tyres. The last case is STAGED on its
 * frames, and says so: it is not a recording of a stop.
 *
 * What it cannot show is a race online, where a rival's tread is reported
 * to read 100 % throughout.
 *
 * Windows only, like the other tape specs.
 */

const CARS = 38;
const WHEELS = 4;

type Cells = Record<string, { value: unknown[] } | undefined>;

const numbers = (frame: Telemetry, key: string): number[] =>
  ((frame as unknown as Cells)[key]?.value ?? []) as number[];

interface Played {
  session: Session | null;
  snapshot: ClassTyresSnapshot;
  /** Each car's four treads the first and the last time they were read. */
  firstWear: number[][];
  lastWear: number[][];
  /** Every compound index a wheel of each car was seen on. */
  compoundsSeen: Set<number>[];
  /** Readings on which a wheel's tread was higher than on the one before. */
  rises: number;
  /** Laps each car had completed at the end. */
  lapsCompleted: number[];
  /** Our own car's tread as the player's own channels give it, at the end. */
  ownTread: number[];
  frames: number;
}

/** What is done to a frame, as mapped, before anything reads it. */
type Stage = (frame: Telemetry, sessionTime: number) => void;

const play = async (stage?: Stage): Promise<Played> => {
  const recorder = new RaceHistoryRecorder(
    {
      onRaceStarted: () => undefined,
      onLap: () => undefined,
      onStint: () => undefined,
      onDriverChange: () => undefined,
      onRaceInfoChanged: () => undefined,
      onCarReplaced: () => undefined,
      onRaceEnded: () => undefined,
    },
    {
      simulator: () => 'lmu',
      sessionIdsAreUnique: () => false,
      now: () => 1_800_000_000_000,
      bootId: 'tape',
    }
  );
  const tracker = new ClassTyresTracker({
    history: {
      raceToken: () => recorder.currentRace()?.token ?? '',
      revision: (carIdx) => recorder.carRevision(carIdx),
      laps: (carIdx) => recorder.carLaps(carIdx),
      stints: (carIdx) => recorder.carStints(carIdx),
    },
    // No ledger of our own car: it is read like any other, from the wear
    // the sim publishes for every car.
    own: () => undefined,
    tuning: () => ({ tyreChangeSeconds: 0 }),
  });
  const out: Played = {
    session: null,
    snapshot: tracker.snapshot(),
    firstWear: [],
    lastWear: [],
    compoundsSeen: Array.from({ length: CARS }, () => new Set<number>()),
    rises: 0,
    lapsCompleted: [],
    ownTread: [],
    frames: 0,
  };
  await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    onFrame: ({ telemetry, session, sessionChanged, sessionTime }) => {
      out.frames += 1;
      if (sessionChanged) {
        out.session = session;
        recorder.onSession(session);
        tracker.onSession(session);
      }
      stage?.(telemetry, sessionTime);
      const wear = numbers(telemetry, 'LmuCarIdxWheelWear');
      const compounds = numbers(telemetry, 'LmuCarIdxWheelCompounds');
      for (let carIdx = 0; carIdx < CARS; carIdx += 1) {
        const wheels = wear.slice(carIdx * WHEELS, carIdx * WHEELS + WHEELS);
        if (wheels.length === WHEELS && wheels.every((value) => value > 0)) {
          const before = out.lastWear[carIdx];
          if (before && wheels.some((value, wheel) => value > before[wheel])) {
            out.rises += 1;
          }
          out.firstWear[carIdx] ??= wheels;
          out.lastWear[carIdx] = wheels;
        }
        for (let wheel = 0; wheel < WHEELS; wheel += 1) {
          const compound = compounds[carIdx * WHEELS + wheel];
          if (compound !== undefined && compound >= 0) {
            out.compoundsSeen[carIdx].add(compound);
          }
        }
      }
      out.lapsCompleted = numbers(telemetry, 'CarIdxLap').map((lap) =>
        Math.max(0, lap - 1)
      );
      out.ownTread = ['LFwearM', 'RFwearM', 'LRwearM', 'RRwearM'].map(
        (key) => numbers(telemetry, key)[0]
      );
      recorder.onFrame(telemetry);
      tracker.onFrame(telemetry);
    },
  });
  return out;
};

/** The cars of the class our own car is in, and the rest. */
const classesOf = (played: Played) => {
  const drivers = played.session?.DriverInfo?.Drivers ?? [];
  const own = played.session?.DriverInfo?.DriverCarIdx ?? -1;
  const ownClass = drivers.find((driver) => driver.CarIdx === own)?.CarClassID;
  const inClass = drivers
    .filter((driver) => driver.CarClassID === ownClass)
    .map((driver) => driver.CarIdx);
  const others = drivers
    .filter((driver) => driver.CarClassID !== ownClass)
    .map((driver) => driver.CarIdx);
  return { own, inClass, others };
};

describe.skipIf(!lmuTapeAvailable())(
  'the tyres of our class on the recorded Le Mans Ultimate race',
  () => {
    let played: Played;

    beforeAll(async () => {
      played = await play();
    }, 240_000);

    it('reads the whole recording', () => {
      expect(played.frames).toBeGreaterThan(15_000);
      expect(played.session).not.toBeNull();
    });

    it("finds every car's tread published, and falling", () => {
      // The addon exports it as `vehWheelWear`. One built before that
      // exported the player's alone, and every case below would fail for a
      // reason that says nothing of it.
      expect(
        played.firstWear.length,
        'The native addon is stale: it exports no tread for the field. Run `npm run irsdk:build`.'
      ).toBe(CARS);
      // Offline the sim writes each car's own tread into its telemetry
      // block: all 38 of them, AI and player alike.
      for (let carIdx = 0; carIdx < CARS; carIdx += 1) {
        const first = played.firstWear[carIdx];
        const last = played.lastWear[carIdx];
        expect(first, `car ${carIdx}`).toHaveLength(WHEELS);
        for (let wheel = 0; wheel < WHEELS; wheel += 1) {
          expect(first[wheel]).toBeLessThanOrEqual(1);
          expect(last[wheel]).toBeGreaterThan(0.9);
          // Two laps and more of racing took something off every wheel.
          expect(last[wheel]).toBeLessThan(first[wheel]);
        }
      }
      // And never the other way: nobody was given a tyre.
      expect(played.rises).toBe(0);
    });

    it("gives our own car, in its slot, the tread the player's own channels have", () => {
      const { own } = classesOf(played);
      played.ownTread.forEach((tread, wheel) =>
        expect(played.lastWear[own][wheel]).toBeCloseTo(tread, 5)
      );
    });

    it('finds one compound index on every wheel of every car', () => {
      // All the recording can say of the per-wheel indices: they are read
      // for every car, and each is 0 throughout, which the session's tyre
      // list names. No car is on a second compound, so it cannot show that
      // an index means the same compound from one car to the next.
      for (let carIdx = 0; carIdx < CARS; carIdx += 1) {
        expect([...played.compoundsSeen[carIdx]], `car ${carIdx}`).toEqual([0]);
      }
      expect(played.session?.DriverInfo?.DriverTires).toEqual([
        { TireIndex: 0, TireCompoundType: 'Medium' },
      ]);
    });

    it('counts every car of our class from the start, with its tread as read', () => {
      const { own, inClass } = classesOf(played);
      const { snapshot } = played;
      expect(snapshot.ownCarIdx).toBe(own);
      expect(inClass.length).toBeGreaterThan(1);
      for (const carIdx of inClass) {
        // Seen from the grid, and nobody stopped: every lap is on the set.
        expect(snapshot.sure[carIdx], `car ${carIdx}`).toBe(TYRE_SET_SEEN);
        expect(snapshot.setLaps[carIdx]).toBe(played.lapsCompleted[carIdx]);
        expect(snapshot.setLaps[carIdx]).toBeGreaterThanOrEqual(2);
        // The sim's own figure, not an estimate: the mean of four wheels.
        expect(snapshot.treadSource[carIdx]).toBe(TREAD_MEASURED);
        const mean =
          played.lastWear[carIdx].reduce((sum, value) => sum + value, 0) /
          WHEELS;
        expect(Math.abs(snapshot.treadPct[carIdx] - mean * 100)).toBeLessThan(
          1
        );
        expect(
          snapshot.compounds.slice(carIdx * WHEELS, carIdx * WHEELS + WHEELS)
        ).toEqual([0, 0, 0, 0]);
      }
    });

    it('says nothing of the cars of the other classes', () => {
      const { others } = classesOf(played);
      const { snapshot } = played;
      expect(others.length).toBeGreaterThan(0);
      for (const carIdx of others) {
        expect(snapshot.sure[carIdx], `car ${carIdx}`).toBe(TYRE_SET_UNKNOWN);
        expect(snapshot.setLaps[carIdx]).toBe(-1);
        expect(snapshot.treadPct[carIdx]).toBe(-1);
        expect(snapshot.treadSource[carIdx]).toBe(TREAD_NONE);
      }
    });

    it('STAGED: sees a set go on when a tread goes back up on pit road', async () => {
      // Not a recording of a stop. A rival of our class is written onto
      // pit road for five seconds half way through, and its tread back
      // to new from the middle of them: what the sim would publish if
      // it were given tyres there, as far as anybody can say without a
      // recording of it.
      const { own, inClass } = classesOf(played);
      const rival = inClass.find((carIdx) => carIdx !== own) as number;
      let from = Number.NaN;
      let lapsThen = -1;
      const staged = await play((frame, sessionTime) => {
        if (Number.isNaN(from)) from = sessionTime + 120;
        if (sessionTime < from) return;
        const cells = frame as unknown as Cells;
        const onPitRoad = cells.CarIdxOnPitRoad?.value;
        if (onPitRoad && sessionTime < from + 5) onPitRoad[rival] = true;
        if (sessionTime < from + 2.5) return;
        if (lapsThen < 0) {
          lapsThen = Math.max(0, numbers(frame, 'CarIdxLap')[rival] - 1);
        }
        const wear = cells.LmuCarIdxWheelWear?.value;
        for (let wheel = 0; wear && wheel < WHEELS; wheel += 1) {
          wear[rival * WHEELS + wheel] = 1;
        }
      });

      expect(lapsThen).toBeGreaterThanOrEqual(1);
      const { snapshot } = staged;
      expect(snapshot.sure[rival]).toBe(TYRE_SET_SEEN);
      // Counted from the change, not from the start; and the lap it was
      // on pit road for, which the record marks as a lap into the pits,
      // is not one on the new set.
      expect(snapshot.setLaps[rival]).toBe(
        staged.lapsCompleted[rival] - lapsThen - 1
      );
      expect(snapshot.setLaps[rival]).toBeLessThan(staged.lapsCompleted[rival]);
      expect(snapshot.treadPct[rival]).toBe(100);
      // The car beside it is counted from the start as before.
      const other = inClass.find(
        (carIdx) => carIdx !== own && carIdx !== rival
      ) as number;
      expect(snapshot.setLaps[other]).toBe(staged.lapsCompleted[other]);
    }, 240_000);
  }
);
