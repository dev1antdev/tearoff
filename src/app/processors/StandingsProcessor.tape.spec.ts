import { describe, expect, it } from 'vitest';
import type { StandingsSnapshot } from '@irdashies/types';
import type { LmuRawTelemetry } from '../lmu/native';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { StandingsProcessor } from './StandingsProcessor';

/**
 * What the standings and the class summary read of `standings.snapshot`, on
 * a recorded Le Mans Ultimate race: four minutes from the green flag at
 * Laguna Seca, 38 cars in three classes (14 LMP2, 14 LMGT3, 10 LMP3), the
 * player in an LMGT3.
 *
 * The recording is all under green: every lap is timed, nobody is lapped,
 * nobody is in a garage. So what it can show as recorded is that nothing is
 * marked or counted out that should not be. Every case where something is
 * marked is STAGED: the same recording with one field changed before it is
 * mapped, as raceGap.tape.spec.ts stages its lapped class. Each test that
 * does so says what it changed.
 *
 * The renderer's half (the "-2L" a row prints, the 12/14 a class chip
 * shows) is checked on a fixture cut from this tape, in
 * frontend/domain/standings; this is the main-process half those read.
 *
 * Windows only, like the other tape specs.
 */

/** The class the player's LMGT3 runs in, by the id the addon gives it. */
const GT_CLASS = 1;
/** The lap time the sim measures every car's time into the lap against. */
const ESTIMATED_LAP_SECONDS = 84.233;
const CARS = 38;

type Transform = <T extends LmuRawTelemetry>(raw: T) => T;

interface Frame {
  /** The snapshot after this frame. Live: read it, do not keep it. */
  snapshot: StandingsSnapshot;
  /** The frame as mapped, after any staging. */
  raw: LmuRawTelemetry;
  /** The same instant as the sim recorded it, before any staging. */
  recorded: LmuRawTelemetry;
}

/**
 * Plays the recording through the session and telemetry mapping and the
 * standings processor, handing each frame's snapshot to `onFrame`.
 */
const playStandings = async (
  onFrame: (frame: Frame) => void,
  stage?: Transform
): Promise<number> => {
  const processor = new StandingsProcessor();
  processor.onLifecycle({ type: 'enter', replay: false });
  let recorded: LmuRawTelemetry | null = null;
  let frames = 0;
  await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    // Fast enough to finish in seconds, slow enough that every recorded
    // frame is read.
    speed: 40,
    transformRaw: (raw) => {
      // Session snapshots pass through here too; only a frame is kept, so
      // what is compared against is the same instant.
      if (!('drivers' in raw)) recorded = raw;
      return stage ? stage(raw) : raw;
    },
    onFrame: ({ raw, telemetry, session, sessionChanged }) => {
      if (sessionChanged) processor.init(session);
      processor.onFrame(telemetry);
      if (!recorded) return;
      frames += 1;
      onFrame({ snapshot: processor.snapshot(), raw, recorded });
    },
  });
  return frames;
};

const progress = (snapshot: StandingsSnapshot, carIdx: number): number =>
  snapshot.carIdxLap[carIdx] + snapshot.carIdxLapDistPct[carIdx];

describe.skipIf(!lmuTapeAvailable())(
  'the standings snapshot on a recorded LMU race',
  () => {
    it('marks no last lap: the sim timed every lap of the recording', async () => {
      const laps: number[] = [];
      let completions = 0;
      let marked = 0;
      let shortArrays = 0;
      const frames = await playStandings(({ snapshot, recorded }) => {
        if (snapshot.carIdxLastLapInvalid.length !== CARS) shortArrays += 1;
        for (let carIdx = 0; carIdx < CARS; carIdx += 1) {
          if (snapshot.carIdxLastLapInvalid[carIdx]) marked += 1;
          const total = recorded.vehTotalLaps[carIdx];
          if (laps[carIdx] !== undefined && total > laps[carIdx]) {
            completions += 1;
          }
          laps[carIdx] = total;
        }
      });

      // The whole recording, and laps enough for a false mark to show: every
      // car crosses the line at least twice.
      expect(frames).toBeGreaterThan(5_000);
      expect(completions).toBeGreaterThanOrEqual(2 * CARS);
      expect(shortArrays).toBe(0);
      expect(marked).toBe(0);
    }, 90_000);

    it('marks a car whose lap the sim gave no time, from its next lap (staged)', async () => {
      // STAGED: one car's last lap time forced to -1 on every frame, which is
      // what the sim publishes for a lap it did not count. Its lap starts are
      // untouched, so the lap is still measured from them.
      const slot = 5;
      let lapsAtStart: number | undefined;
      let firstMarkedAfterLaps: number | undefined;
      let markedFrames = 0;
      let unmarkedAfterMark = 0;
      let othersMarked = 0;
      let worst = 0;
      let compared = 0;
      await playStandings(
        ({ snapshot, recorded }) => {
          const laps = recorded.vehTotalLaps[slot];
          lapsAtStart ??= laps;
          for (let carIdx = 0; carIdx < CARS; carIdx += 1) {
            if (carIdx !== slot && snapshot.carIdxLastLapInvalid[carIdx]) {
              othersMarked += 1;
            }
          }
          if (!snapshot.carIdxLastLapInvalid[slot]) {
            if (firstMarkedAfterLaps !== undefined) unmarkedAfterMark += 1;
            return;
          }
          markedFrames += 1;
          firstMarkedAfterLaps ??= laps;
          // The time published for the lap, against the one the sim had
          // really given it, once the sim's own has caught up with the lap.
          const simTime = recorded.vehLastLapTime[slot];
          if (simTime > 0) {
            worst = Math.max(
              worst,
              Math.abs(snapshot.carIdxLastLapTime[slot] - simTime)
            );
            compared += 1;
          }
        },
        (raw) => ({
          ...raw,
          vehLastLapTime: Float64Array.from(
            raw.vehLastLapTime,
            (time, carIdx) => (carIdx === slot ? -1 : time)
          ),
        })
      );

      expect(lapsAtStart).toBeDefined();
      // Not before the car has finished a lap in front of the recording...
      expect(firstMarkedAfterLaps).toBeGreaterThan(lapsAtStart ?? Infinity);
      // ...and from then on without a gap, for that car alone.
      expect(markedFrames).toBeGreaterThan(1_000);
      expect(unmarkedAfterMark).toBe(0);
      expect(othersMarked).toBe(0);
      expect(compared).toBeGreaterThan(1_000);
      expect(worst).toBeLessThan(0.05);
    }, 90_000);

    it('has every car out of its garage, in the world and unfinished', async () => {
      // What the class summary counts as "still running": 38 of 38.
      let inGarage = 0;
      let notInWorld = 0;
      let finished = 0;
      let shortArrays = 0;
      const perClass = new Map<number, number>();
      await playStandings(({ snapshot, recorded }) => {
        if (snapshot.carIdxInGarage.length !== CARS) shortArrays += 1;
        for (let carIdx = 0; carIdx < CARS; carIdx += 1) {
          if (snapshot.carIdxInGarage[carIdx]) inGarage += 1;
          if (snapshot.carIdxTrackSurface[carIdx] < 0) notInWorld += 1;
          if (snapshot.carIdxFinishStatus[carIdx] !== 0) finished += 1;
        }
        if (perClass.size === 0) {
          for (let carIdx = 0; carIdx < CARS; carIdx += 1) {
            const classId = recorded.vehClass[carIdx];
            perClass.set(classId, (perClass.get(classId) ?? 0) + 1);
          }
        }
      });

      expect(shortArrays).toBe(0);
      expect(inGarage).toBe(0);
      expect(notInWorld).toBe(0);
      expect(finished).toBe(0);
      expect([...perClass.values()].sort((a, b) => a - b)).toEqual([
        10, 14, 14,
      ]);
    }, 90_000);

    it('flags two cars put in their garages, and no others (staged)', async () => {
      // STAGED: the garage-stall flag set for two LMGT3 slots on every frame.
      let slots: number[] = [];
      let wrong = 0;
      let surfaceNotStall = 0;
      const frames = await playStandings(
        ({ snapshot }) => {
          for (let carIdx = 0; carIdx < CARS; carIdx += 1) {
            const staged = slots.includes(carIdx);
            if (snapshot.carIdxInGarage[carIdx] !== staged) wrong += 1;
            // The surface alone still says "in pit stall", as for a stop at
            // the box: the flag is what tells the two apart.
            if (staged && snapshot.carIdxTrackSurface[carIdx] !== 1) {
              surfaceNotStall += 1;
            }
          }
        },
        (raw) => {
          if (slots.length === 0) {
            // Two LMGT3 cars other than the player's, which is slot 0: its
            // garage is also what says whether the player is driving.
            slots = Array.from(raw.vehClass)
              .map((classId, carIdx) => (classId === GT_CLASS ? carIdx : -1))
              .filter((carIdx) => carIdx > 0)
              .slice(0, 2);
          }
          return {
            ...raw,
            vehInGarageStall: Uint8Array.from(
              raw.vehInGarageStall,
              (flag, carIdx) => (slots.includes(carIdx) ? 1 : flag)
            ),
          };
        }
      );

      expect(slots).toHaveLength(2);
      expect(frames).toBeGreaterThan(5_000);
      expect(wrong).toBe(0);
      expect(surfaceNotStall).toBe(0);
    }, 90_000);

    it('has nobody a lap apart: every gap in the recording is a time', async () => {
      // As recorded. The lap rule turns a gap to laps only past one full lap
      // of progress; the whole field stays inside one.
      let widest = 0;
      await playStandings(({ snapshot }) => {
        let first = Number.NEGATIVE_INFINITY;
        let last = Number.POSITIVE_INFINITY;
        for (let carIdx = 0; carIdx < CARS; carIdx += 1) {
          const at = progress(snapshot, carIdx);
          first = Math.max(first, at);
          last = Math.min(last, at);
        }
        widest = Math.max(widest, first - last);
      });

      expect(widest).toBeGreaterThan(0.3);
      expect(widest).toBeLessThan(1);
    }, 90_000);

    it('puts a lapped class one to two laps behind the prototypes (staged)', async () => {
      // STAGED, as in raceGap.tape.spec.ts: every prototype two laps further
      // on, so the whole LMGT3 class has been lapped twice. Measured from the
      // player's LMGT3, every prototype is then more than a lap up the road
      // (what the standings print as "-1L" or "-2L" against the player),
      // while no LMGT3 is a lap from another (they keep their seconds).
      let player = -1;
      let prototypeSamples = 0;
      let prototypeOutside = 0;
      let classSamples = 0;
      let classOutside = 0;
      await playStandings(
        ({ snapshot, raw }) => {
          player = raw.playerVehicleIdx;
          const own = progress(snapshot, player);
          for (let carIdx = 0; carIdx < CARS; carIdx += 1) {
            if (carIdx === player) continue;
            const ahead = progress(snapshot, carIdx) - own;
            if (raw.vehClass[carIdx] === GT_CLASS) {
              classSamples += 1;
              if (Math.abs(ahead) >= 1) classOutside += 1;
            } else {
              prototypeSamples += 1;
              if (ahead <= 1 || ahead >= 3) prototypeOutside += 1;
            }
          }
        },
        (raw) => ({
          ...raw,
          vehTotalLaps: Int32Array.from(raw.vehTotalLaps, (laps, carIdx) =>
            raw.vehClass[carIdx] === GT_CLASS ? laps : laps + 2
          ),
        })
      );

      expect(player).toBeGreaterThanOrEqual(0);
      expect(prototypeSamples).toBeGreaterThan(100_000);
      expect(classSamples).toBeGreaterThan(60_000);
      expect(prototypeOutside).toBe(0);
      expect(classOutside).toBe(0);
    }, 90_000);

    it('puts a car two laps down two laps and two lap times behind the one ahead (staged)', async () => {
      // STAGED: two laps taken off one LMGT3, the last of its class at the
      // end of the recording. The standings read its interval off these
      // arrays: more than two laps of progress behind the class car ahead is
      // "-2L", and the difference of the two times behind the leader is what
      // "Time" mode prints, about 2:48.
      let slot = -1;
      /** The last frame's reading; an object so the callback can fill it. */
      const final = {
        seen: false,
        lapsBehind: 0,
        secondsBehind: 0,
        recordedSecondsBehind: 0,
      };
      // A first pass over the recording as it is, to find the car.
      await playStandings(({ snapshot, recorded }) => {
        let last = -1;
        for (let carIdx = 0; carIdx < CARS; carIdx += 1) {
          if (recorded.vehClass[carIdx] !== GT_CLASS) continue;
          if (
            last < 0 ||
            snapshot.carIdxClassPosition[carIdx] >
              snapshot.carIdxClassPosition[last]
          ) {
            last = carIdx;
          }
        }
        slot = last;
      });
      expect(slot).toBeGreaterThanOrEqual(0);

      await playStandings(
        ({ snapshot, recorded }) => {
          const place = snapshot.carIdxClassPosition[slot];
          const ahead = snapshot.carIdxClassPosition.findIndex(
            (position, carIdx) =>
              position === place - 1 && recorded.vehClass[carIdx] === GT_CLASS
          );
          if (ahead < 0) return;
          final.seen = true;
          final.lapsBehind =
            progress(snapshot, ahead) - progress(snapshot, slot);
          final.secondsBehind =
            snapshot.carIdxF2Time[slot] - snapshot.carIdxF2Time[ahead];
          final.recordedSecondsBehind =
            recorded.vehTimeBehindLeader[slot] -
            recorded.vehTimeBehindLeader[ahead];
        },
        (raw) => ({
          ...raw,
          vehTotalLaps: Int32Array.from(raw.vehTotalLaps, (laps, carIdx) =>
            carIdx === slot ? laps - 2 : laps
          ),
          ...(raw.vehLapNumber
            ? {
                vehLapNumber: Int32Array.from(
                  raw.vehLapNumber,
                  (lap, carIdx) => (carIdx === slot ? lap - 2 : lap)
                ),
              }
            : {}),
        })
      );

      expect(final.seen).toBe(true);
      const { lapsBehind, secondsBehind, recordedSecondsBehind } = final;
      // Two laps and a little: "-2L".
      expect(lapsBehind).toBeGreaterThan(2);
      expect(lapsBehind).toBeLessThan(3);
      // Two reference laps on top of the gap it really had: 2:48 and a bit.
      expect(secondsBehind - recordedSecondsBehind).toBeCloseTo(
        2 * ESTIMATED_LAP_SECONDS,
        0
      );
      expect(secondsBehind).toBeGreaterThan(168);
      expect(secondsBehind).toBeLessThan(180);
    }, 180_000);
  }
);
