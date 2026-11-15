import { describe, expect, it } from 'vitest';
import type { FuelLapData, LapInput } from '@irdashies/types';
import type { LmuRawSession, LmuRawTelemetry } from './native';
import {
  LMU_CURATED_TAPE_PATH,
  lmuRawWithoutPlayerVehicle,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { FuelProjectionProcessor } from '../processors/FuelProjectionProcessor';
import { LapDeltaProcessor } from '../processors/LapDeltaProcessor';
import { LapLogProcessor } from '../processors/LapLogProcessor';
import { PlayerLapRecorder } from '../processors/PlayerLapRecorder';
import { ReferenceLapProcessor } from '../processors/ReferenceLapProcessor';
import { TrackStateProcessor } from '../processors/TrackStateProcessor';

/**
 * The team car's own numbers through a team-mate's stint, STAGED on a
 * recorded Le Mans Ultimate race.
 *
 * No recording of a real driver change exists yet, so this is not one. The
 * recording is four minutes of an offline race the player drives from the
 * rolling start, in an LMGT3 on virtual energy. For part of it every
 * snapshot is rewritten to what the sim is known to write when it names no
 * player vehicle: the slot becomes -1 and the single-car fields go, while
 * the session-wide fields and the per-car arrays stay. The car that was the
 * player's goes on lapping in its slot, which stands in for a team-mate
 * driving it, and the game state is supplied as LMU's REST API would give
 * it, a second late at each change.
 *
 * What it shows is that the app's own chain holds over real cars and real
 * laps: the keys that describe one car go on describing the user's own
 * entry, without a break at either change, and nothing a team-mate drives
 * is kept as the user's own. What LMU really writes for the team car during
 * a stint online -- whether it has a telemetry block at all, and so a speed
 * and an energy -- is exactly what this cannot show: here the block is the
 * one the player's own car had.
 *
 * The recording crosses the line twice, 93 and 180 seconds in, so it holds
 * one lap that begins and ends at a crossing, and the lap before it from
 * the rolling start. Two stagings share it. In the first the user is out
 * from the first minute to the end, and that whole lap is the team-mate's.
 * In the second the user is out for forty seconds early on and back before
 * the first crossing, so that lap is their own again from the line.
 *
 * Windows only, like the other tape specs.
 */

/** How long the game state goes on saying where the user was. */
const STATE_LAG_SECONDS = 1.2;
/** A lap of the recording's track is about 90 s; its second lap, 86.66 s. */
const SECOND_LAP_SECONDS = 86.66;
const FIRST_LAP_SECONDS = 97.82;

interface Staging {
  /** Seconds into the recording between which the user has no vehicle. */
  outFrom: number;
  outUntil: number;
  /** Seconds into it between which the sim's camera is on another car. */
  rivalFrom?: number;
  rivalUntil?: number;
  /** Scoring drops its player flag with the vehicle, as it may. */
  clearPlayerFlags?: boolean;
}

const scalar = (frame: unknown, key: string): unknown =>
  (frame as Record<string, { value: unknown[] } | undefined>)[key]?.value[0];

const numberAt = (frame: unknown, key: string, index: number): number =>
  (frame as Record<string, { value: number[] } | undefined>)[key]?.value[
    index
  ] ?? Number.NaN;

const playStint = async ({
  outFrom,
  outUntil,
  rivalFrom = Number.POSITIVE_INFINITY,
  rivalUntil = Number.NEGATIVE_INFINITY,
  clearPlayerFlags = false,
}: Staging) => {
  const lapsCounted: FuelLapData[] = [];
  const lapsSaved: FuelLapData[] = [];
  const fuel = new FuelProjectionProcessor({
    persistence: {
      lapCompleted: (lap) => lapsCounted.push(lap),
      saveLap: (lap) => lapsSaved.push(lap),
    },
    persistLaps: true,
  });
  const trackState = new TrackStateProcessor();
  const lapLog = new LapLogProcessor();
  const references = new ReferenceLapProcessor({
    load: () => null,
    save: () => undefined,
  });
  const lapDelta = new LapDeltaProcessor(references);
  const processors = [fuel, trackState, lapLog, references, lapDelta];
  for (const processor of processors) {
    processor.onLifecycle({ type: 'enter', replay: false });
  }
  const libraryLaps: LapInput[] = [];
  const recorder = new PlayerLapRecorder(
    { record: (_session, lap) => libraryLaps.push(lap) },
    { simulator: 'lmu', now: () => 0, bootId: 'tape' }
  );
  recorder.onEnter();

  let startET: number | null = null;
  let playerSlot = -1;
  let rivalSlot = -1;
  const since = (raw: LmuRawTelemetry): number =>
    raw.currentET - (startET ?? raw.currentET);
  const isOut = (raw: LmuRawTelemetry): boolean =>
    since(raw) >= outFrom && since(raw) < outUntil;
  const onRival = (raw: LmuRawTelemetry): boolean =>
    since(raw) >= rivalFrom && since(raw) < rivalUntil;

  let previousLap = Number.NaN;
  let previousPct = Number.NaN;
  let previousOut = false;
  const out = {
    frames: 0,
    /** Frames on which the frame did not name the own entry as the car. */
    notOwnEntry: 0,
    /** Frames on which the session did not either. */
    sessionNotOwnEntry: 0,
    atWheel: 0,
    inCar: 0,
    /** Frames whose lap or place on it was not the slot's own. */
    notTheSlots: 0,
    noSpeed: 0,
    noEnergy: 0,
    slowest: Number.POSITIVE_INFINITY,
    firstEnergy: Number.NaN,
    lastEnergy: Number.NaN,
    sectors: new Set<number>(),
    /** Frames with the first sector of the lap under way timed. */
    firstSectorTimed: 0,
    watchingOwnCar: 0,
    watchingOwnCarOnRival: 0,
    onRival: 0,
  };
  /** The largest step back in the lap fraction that was not the line. */
  let largestStepBack = 0;
  let lapWentBack = 0;
  /** What stood at each change of the vehicle, either side of it. */
  const changes: {
    at: number;
    lap: [number, number];
    pct: [number, number];
  }[] = [];
  /**
   * Each line crossing: when, who was driving, and what the frame said a
   * second later, by when the sim has timed the lap that ended there.
   */
  const crossings: {
    at: number;
    out: boolean;
    settled: boolean;
    lastLapTime: number;
    bestLapTime: number;
    currentLapTime: number;
    ownBestLapTime: number;
    lastSectors: unknown;
  }[] = [];
  let atWheelAfterReturn = 0;
  let framesAfterReturn = 0;

  await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    speed: 40,
    transformRaw: (raw) => {
      startET ??= raw.currentET;
      if (!isOut(raw)) {
        if (raw.playerHasVehicle) playerSlot = raw.playerVehicleIdx;
        return raw;
      }
      const staged = lmuRawWithoutPlayerVehicle(raw);
      if (!clearPlayerFlags) return staged;
      const cleared = {
        ...staged,
        vehIsPlayer: new Uint8Array(staged.vehIsPlayer.length),
      };
      if ('drivers' in cleared) {
        const session = cleared as unknown as LmuRawSession;
        session.drivers = session.drivers.map((driver) => ({
          ...driver,
          isPlayer: false,
        }));
      }
      return cleared;
    },
    gameState: (raw) => {
      // What the vehicle was a second ago, either way.
      const then = since(raw) - STATE_LAG_SECONDS;
      return then >= outFrom && then < outUntil ? 'monitor' : 'driving';
    },
    restCells: (raw) => {
      if (!onRival(raw)) return undefined;
      if (rivalSlot < 0) {
        rivalSlot = Array.from(raw.vehLapDistPct).findIndex(
          (pct, slot) =>
            slot !== playerSlot && pct >= 0 && !raw.vehInGarageStall[slot]
        );
      }
      return { focusCarIdx: { value: [rivalSlot] } };
    },
    onFrame: ({ raw, telemetry, session, sessionChanged }) => {
      if (sessionChanged) {
        for (const processor of processors) processor.init(session);
        recorder.onSession(session);
      }
      for (const processor of processors) processor.onFrame(telemetry);
      recorder.onFrame(telemetry);

      const lap = scalar(telemetry, 'Lap') as number;
      const pct = scalar(telemetry, 'LapDistPct') as number;
      const isOutNow = !raw.playerHasVehicle;
      if (isOutNow !== previousOut && !Number.isNaN(previousLap)) {
        changes.push({
          at: since(raw),
          lap: [previousLap, lap],
          pct: [previousPct, pct],
        });
      }
      const crossedLine = previousPct > 0.9 && pct < 0.1;
      if (!Number.isNaN(previousPct) && !crossedLine) {
        largestStepBack = Math.max(largestStepBack, previousPct - pct);
      }
      if (lap < previousLap) lapWentBack += 1;
      if (crossedLine) {
        crossings.push({
          at: since(raw),
          out: isOutNow,
          settled: false,
          lastLapTime: Number.NaN,
          bestLapTime: Number.NaN,
          currentLapTime: Number.NaN,
          ownBestLapTime: Number.NaN,
          lastSectors: undefined,
        });
      }
      const crossing = crossings.at(-1);
      if (crossing && !crossing.settled && since(raw) - crossing.at >= 1) {
        crossing.settled = true;
        crossing.lastLapTime = scalar(telemetry, 'LapLastLapTime') as number;
        crossing.bestLapTime = scalar(telemetry, 'LapBestLapTime') as number;
        crossing.currentLapTime = scalar(
          telemetry,
          'LapCurrentLapTime'
        ) as number;
        crossing.ownBestLapTime = lapLog.snapshot().ownBestLapTime;
        crossing.lastSectors = (
          telemetry as unknown as Record<string, { value: unknown[] }>
        ).LmuLastSectorTimes.value;
      }
      previousLap = lap;
      previousPct = pct;
      previousOut = isOutNow;

      if (!isOutNow) {
        if (since(raw) >= outUntil + STATE_LAG_SECONDS + 0.5) {
          framesAfterReturn += 1;
          if (scalar(telemetry, 'IsOnTrack') === true) atWheelAfterReturn += 1;
        }
        return;
      }
      out.frames += 1;
      if (scalar(telemetry, 'PlayerCarIdx') !== playerSlot) {
        out.notOwnEntry += 1;
      }
      if (session.DriverInfo?.DriverCarIdx !== playerSlot) {
        out.sessionNotOwnEntry += 1;
      }
      if (scalar(telemetry, 'IsOnTrack') === true) out.atWheel += 1;
      if (scalar(telemetry, 'LmuOutOfCar') !== true) out.inCar += 1;
      if (
        lap !== numberAt(telemetry, 'CarIdxLap', playerSlot) ||
        pct !== numberAt(telemetry, 'CarIdxLapDistPct', playerSlot) ||
        scalar(telemetry, 'LapCompleted') !==
          numberAt(telemetry, 'CarIdxLapCompleted', playerSlot)
      ) {
        out.notTheSlots += 1;
      }
      const speed = scalar(telemetry, 'Speed');
      if (typeof speed !== 'number') out.noSpeed += 1;
      else out.slowest = Math.min(out.slowest, speed);
      const energy = scalar(telemetry, 'LmuVirtualEnergy');
      if (typeof energy !== 'number') out.noEnergy += 1;
      else {
        if (Number.isNaN(out.firstEnergy)) out.firstEnergy = energy;
        out.lastEnergy = energy;
      }
      out.sectors.add(scalar(telemetry, 'LmuSectorIdx') as number);
      if (scalar(telemetry, 'LmuCurrentSectorTimes') !== null) {
        out.firstSectorTimed += 1;
      }
      const state = trackState.snapshot();
      if (onRival(raw)) {
        out.onRival += 1;
        if (state.watchingOwnCar) out.watchingOwnCarOnRival += 1;
      } else if (state.watchingOwnCar) {
        out.watchingOwnCar += 1;
      }
    },
  });

  return {
    playerSlot,
    rivalSlot,
    out,
    largestStepBack,
    lapWentBack,
    changes,
    crossings,
    atWheelAfterReturn,
    framesAfterReturn,
    lapsCounted,
    lapsSaved,
    libraryLaps,
    fuel: fuel.snapshot(),
    lapLog: lapLog.snapshot(),
    lapDelta: lapDelta.snapshot(),
    sessionBests: references.snapshot().bestLaps,
  };
};

const lapTimeOf = (lap: { startTime: number; finishTime: number }) =>
  lap.finishTime - lap.startTime;

describe.skipIf(!lmuTapeAvailable())(
  'the team car’s own numbers through a stint staged on a recorded LMU race',
  () => {
    describe.each([
      ['scoring keeps its player flag on the car', false],
      ['scoring drops its player flag too', true],
    ])('with a team-mate driving to the end, when %s', (_name, flags) => {
      it('goes on describing the own entry, and keeps none of it as the user’s', async () => {
        // Out a minute in, part-way round the first lap, and not back. The
        // camera is on another car for twenty seconds of the second lap.
        const stint = await playStint({
          outFrom: 60,
          outUntil: Number.POSITIVE_INFINITY,
          rivalFrom: 120,
          rivalUntil: 140,
          clearPlayerFlags: flags,
        });
        const { out, crossings } = stint;

        expect(stint.playerSlot).toBeGreaterThanOrEqual(0);
        // Three minutes of it, every recorded frame.
        expect(out.frames).toBeGreaterThan(4_000);

        // The own entry is the car the frame and the session describe, for
        // every frame the sim names no player on.
        expect(out.notOwnEntry).toBe(0);
        expect(out.sessionNotOwnEntry).toBe(0);
        // Watched, never driven: not at the wheel, and out of the car by
        // the frame's own word, the second of state lag included.
        expect(out.atWheel).toBe(0);
        expect(out.inCar).toBe(0);

        // The lap and the place on it are the slot's own, and run on
        // through the change: no step back, and no more of a step forward
        // than a frame's driving, which on this lap is under a thousandth
        // of it. Nothing that follows them -- the fuel count, the lap
        // delta's clock -- sees the car move. (The change is staged on a
        // scoring update, where the two integrators that hand the car over
        // agree; a real one comes with the car standing in its pit box.)
        expect(out.notTheSlots).toBe(0);
        expect(stint.lapWentBack).toBe(0);
        expect(stint.largestStepBack).toBeLessThan(0.0002);
        expect(stint.changes).toHaveLength(1);
        for (const change of stint.changes) {
          expect(change.lap[1]).toBe(change.lap[0]);
          expect(change.pct[1] - change.pct[0]).toBeGreaterThanOrEqual(0);
          expect(change.pct[1] - change.pct[0]).toBeLessThan(0.001);
        }

        // Speed and energy from the car's telemetry block, on every frame:
        // a car racing, and using what it has.
        expect(out.noSpeed).toBe(0);
        expect(out.slowest).toBeGreaterThan(10);
        expect(out.noEnergy).toBe(0);
        expect(out.lastEnergy).toBeLessThan(out.firstEnergy - 0.02);
        // All three sectors driven through, and timed.
        expect([...out.sectors].sort()).toEqual([0, 1, 2]);
        expect(out.firstSectorTimed).toBeGreaterThan(1_000);

        // Both line crossings came with the team-mate driving, and each lap
        // was timed as it ended.
        expect(crossings.map((crossing) => crossing.out)).toEqual([true, true]);
        expect(crossings[0].lastLapTime).toBeCloseTo(FIRST_LAP_SECONDS, 1);
        expect(crossings[1].lastLapTime).toBeCloseTo(SECOND_LAP_SECONDS, 1);
        expect(crossings[1].bestLapTime).toBeCloseTo(SECOND_LAP_SECONDS, 1);
        for (const crossing of crossings) {
          // The lap clock starts again at the line: a second on, it reads
          // about a second.
          expect(crossing.currentLapTime).toBeGreaterThan(0.5);
          expect(crossing.currentLapTime).toBeLessThan(2.5);
        }
        expect(crossings[1].lastSectors).toEqual([
          expect.any(Number),
          expect.any(Number),
          expect.any(Number),
        ]);

        // Watching the own car, except while the camera was on a rival:
        // then the keys were still the team car's and not that car's.
        expect(stint.rivalSlot).toBeGreaterThanOrEqual(0);
        expect(stint.rivalSlot).not.toBe(stint.playerSlot);
        expect(out.onRival).toBeGreaterThan(300);
        expect(out.watchingOwnCarOnRival).toBe(0);
        expect(out.watchingOwnCar).toBe(out.frames - out.onRival);

        // The fuel calculator counted both laps, in the car's virtual
        // energy: they are what it used. Neither was saved.
        expect(stint.lapsCounted.map((lap) => lap.lapNumber)).toEqual([1, 2]);
        expect(stint.lapsCounted.every((lap) => lap.wasWatched)).toBe(true);
        expect(stint.lapsCounted[1].fuelUsed).toBeGreaterThan(1.5);
        expect(stint.lapsCounted[1].fuelUsed).toBeLessThan(4);
        expect(stint.lapsSaved).toEqual([]);
        expect(stint.fuel).toMatchObject({
          budget: 'virtualEnergy',
          watched: true,
          isOnTrack: false,
        });
        expect(stint.fuel.completedLaps).toHaveLength(2);
        expect(stint.fuel.lastLapUsage).toBeCloseTo(
          stint.lapsCounted[1].fuelUsed,
          6
        );

        // The car's best lap is the team-mate's. The user has none, so no
        // personal best is taken.
        expect(stint.lapLog.bestLapTime).toBeCloseTo(SECOND_LAP_SECONDS, 1);
        expect(stint.lapLog.ownBestLapTime).toBe(0);
        expect(crossings.map((crossing) => crossing.ownBestLapTime)).toEqual([
          0, 0,
        ]);

        // Nor a session best for the lap delta to measure against, though
        // other cars have theirs.
        expect(
          stint.sessionBests.some(([carIdx]) => carIdx === stint.playerSlot)
        ).toBe(false);
        expect(stint.sessionBests.length).toBeGreaterThan(5);
        expect(stint.lapDelta.sessionBest.lapTime).toBeNull();

        // The lap library has the one lap that began and ended at a
        // crossing, whole, and not as the user's own: it can never be a
        // reference.
        expect(stint.libraryLaps).toHaveLength(1);
        expect(stint.libraryLaps[0]).toMatchObject({
          own: false,
          complete: true,
        });
        expect(stint.libraryLaps[0].lapTime).toBeCloseTo(SECOND_LAP_SECONDS, 0);
      }, 90_000);
    });

    it('records the user’s own lap again from its next line crossing', async () => {
      // Out twenty seconds in and back at sixty, half a minute before the
      // first crossing: the lap that ends there was partly the team-mate's,
      // and the one after it is the user's from the line.
      const stint = await playStint({ outFrom: 20, outUntil: 60 });
      const { out, crossings } = stint;

      expect(out.frames).toBeGreaterThan(1_000);
      expect(out.notOwnEntry).toBe(0);
      expect(out.atWheel).toBe(0);
      expect(out.inCar).toBe(0);
      // At the wheel again once the game state has caught up.
      expect(stint.framesAfterReturn).toBeGreaterThan(4_000);
      expect(stint.atWheelAfterReturn).toBe(stint.framesAfterReturn);

      // Out and back: no step in the lap or the place on it at either.
      expect(stint.changes).toHaveLength(2);
      for (const change of stint.changes) {
        expect(change.lap[1]).toBe(change.lap[0]);
        expect(change.pct[1] - change.pct[0]).toBeGreaterThanOrEqual(0);
        expect(change.pct[1] - change.pct[0]).toBeLessThan(0.001);
      }
      expect(stint.lapWentBack).toBe(0);
      expect(stint.largestStepBack).toBeLessThan(0.0002);

      // Both crossings with the user at the wheel.
      expect(crossings.map((crossing) => crossing.out)).toEqual([false, false]);

      // The first lap was not the user's from start to finish: counted,
      // and not saved. The second was, and is saved.
      expect(stint.lapsCounted.map((lap) => lap.lapNumber)).toEqual([1, 2]);
      expect(stint.lapsCounted[0].wasWatched).toBe(true);
      expect(stint.lapsCounted[1]).not.toHaveProperty('wasWatched');
      expect(stint.lapsSaved.map((lap) => lap.lapNumber)).toEqual([2]);
      expect(stint.fuel.watched).toBeUndefined();

      // The same for the personal best: not the first lap's time, which
      // the user had been at the wheel for a third of, and then the
      // second's.
      expect(crossings[0].bestLapTime).toBeCloseTo(FIRST_LAP_SECONDS, 1);
      expect(crossings[0].ownBestLapTime).toBe(0);
      expect(stint.lapLog.ownBestLapTime).toBeCloseTo(SECOND_LAP_SECONDS, 1);

      // And for the lap delta's session best, and the lap library.
      const sessionBest = stint.sessionBests.find(
        ([carIdx]) => carIdx === stint.playerSlot
      )?.[1];
      expect(sessionBest).toBeDefined();
      expect(
        lapTimeOf(sessionBest ?? { startTime: 0, finishTime: 0 })
      ).toBeCloseTo(SECOND_LAP_SECONDS, 0);
      expect(stint.lapDelta.sessionBest.lapTime).toBeCloseTo(
        SECOND_LAP_SECONDS,
        0
      );
      expect(stint.libraryLaps).toHaveLength(1);
      expect(stint.libraryLaps[0]).toMatchObject({ own: true, complete: true });
      expect(stint.libraryLaps[0].lapTime).toBeCloseTo(SECOND_LAP_SECONDS, 0);
    }, 90_000);
  }
);
