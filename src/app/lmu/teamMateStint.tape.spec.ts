import { describe, expect, it } from 'vitest';
import type { FuelLapData, LapInput } from '@irdashies/types';
import type { LmuRawSession, LmuRawTelemetry } from './native';
import {
  LMU_CURATED_TAPE_PATH,
  lmuRawWithoutPlayerVehicle,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { DriverControlsProcessor } from '../processors/DriverControlsProcessor';
import { FuelProjectionProcessor } from '../processors/FuelProjectionProcessor';
import { LapDeltaProcessor } from '../processors/LapDeltaProcessor';
import { LapLogProcessor } from '../processors/LapLogProcessor';
import { LapTraceSampleProcessor } from '../processors/LapTraceSampleProcessor';
import { PlayerLapRecorder } from '../processors/PlayerLapRecorder';
import { ReferenceLapProcessor } from '../processors/ReferenceLapProcessor';
import { SectorTimingProcessor } from '../processors/SectorTimingProcessor';
import { TrackStateProcessor } from '../processors/TrackStateProcessor';
import { TyreStateProcessor } from '../processors/TyreStateProcessor';
import { sectorSum, type SectorBests } from '../../shared/sectorBests';
import { isEligibleLap } from '../storage/lapLibrary/LapLibraryDatabase';

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
 * The same goes for the part of the car that exists only in that block. The
 * replay asks the addon for the own entry's block by its slot, as the bridge
 * does once the sim names no player vehicle, and the pedals, the steering,
 * the gear, the revs and the brake temperatures go on flowing from it. They
 * are checked against the recording frame by frame. But the block is still
 * the one the player's own car had: it holds tyre temperatures, pressures
 * and dials, which the sim writes for no car but the player's. That they are
 * absent from the frame here is the mapper's rule at work, not the sim's
 * silence; ownEntryBlock.tape.spec.ts shows the same through the block of a
 * car the AI really drives, where they are zeros. And the recording is an
 * offline race against the AI. What the block of a car holds while a person
 * drives it on another machine -- whether the sim fills in the pedals and
 * the revs at all, and what it gives for fuel and wear -- is not known. The
 * stint is staged with scoring saying so (control 2), and the app then takes
 * neither fuel nor wear from the block; one case stages the AI at the wheel
 * (control 1) instead, where it takes both.
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
/**
 * The first lap as the lap library times it: from the frame the sim lets
 * the car go at the line, three seconds into the recording, to the first
 * crossing. The sim's own figure above runs from the green flag.
 */
const FROM_START_LAP_SECONDS = 89.83;
/** scoring's mControl: the AI on this machine, a person on another. */
const CONTROL_AI = 1;
const CONTROL_REMOTE = 2;
/** Keys the sim gives a reading for only in the block of the player's car. */
const PLAYER_ONLY_KEYS = [
  'LmuTyreSurfaceTemp',
  'LmuTyreInnerLayerTemp',
  'LmuTyreCarcassTemp',
  'LmuTyreOptimalTemp',
  'LFtempCL',
  'LFtempCM',
  'LFtempCR',
  'RRtempCM',
  'LFcoldPressure',
  'RRcoldPressure',
  'LFbrakeLinePress',
  'LFshockDefl',
  'WaterTemp',
  'OilTemp',
  'dcABS',
  'dcTractionControl',
  'LmuDialMax',
  'dcBrakeBias',
  'BrakeABSactive',
  'LmuTcActive',
  'LmuWheelRideHeight',
  'LmuDentSeverity',
] as const;
const WEAR_KEYS = ['LFwearM', 'RFwearM', 'LRwearM', 'RRwearM'] as const;

interface Staging {
  /** Seconds into the recording between which the user has no vehicle. */
  outFrom: number;
  outUntil: number;
  /** Seconds into it between which the sim's camera is on another car. */
  rivalFrom?: number;
  rivalUntil?: number;
  /** Scoring drops its player flag with the vehicle, as it may. */
  clearPlayerFlags?: boolean;
  /**
   * Who scoring says is driving the car through the stint: a person on
   * another machine unless told otherwise. On the recording it is the
   * player, which no stint is.
   */
  control?: number;
}

const scalar = (frame: unknown, key: string): unknown =>
  (frame as Record<string, { value: unknown[] } | undefined>)[key]?.value[0];

const numberAt = (frame: unknown, key: string, index: number): number =>
  (frame as Record<string, { value: number[] } | undefined>)[key]?.value[
    index
  ] ?? Number.NaN;

const has = (frame: unknown, key: string): boolean =>
  (frame as Record<string, unknown>)[key] !== undefined;

const playStint = async ({
  outFrom,
  outUntil,
  rivalFrom = Number.POSITIVE_INFINITY,
  rivalUntil = Number.NEGATIVE_INFINITY,
  clearPlayerFlags = false,
  control = CONTROL_REMOTE,
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
  const controls = new DriverControlsProcessor();
  const tyres = new TyreStateProcessor();
  const lapTrace = new LapTraceSampleProcessor();
  // The store of all-time sector bests, empty and already read.
  const sectorBestsKept = new Map<string, SectorBests>();
  let sectorBestsRevision = 1;
  const sectorTiming = new SectorTimingProcessor({
    simulator: 'lmu',
    store: {
      load: (key) => sectorBestsKept.get(key) ?? null,
      save: (key, bests) => {
        sectorBestsKept.set(key, bests);
        sectorBestsRevision += 1;
      },
      revision: () => sectorBestsRevision,
    },
  });
  const processors = [
    fuel,
    trackState,
    lapLog,
    references,
    lapDelta,
    controls,
    tyres,
    lapTrace,
    sectorTiming,
  ];
  for (const processor of processors) {
    processor.onLifecycle({ type: 'enter', replay: false });
  }
  const libraryLaps: LapInput[] = [];
  /** For each of them, whether it began as the sim let the car go at the line. */
  const libraryFromStart: boolean[] = [];
  const recorder = new PlayerLapRecorder(
    { record: (_session, lap) => libraryLaps.push(lap) },
    {
      simulator: 'lmu',
      now: () => 0,
      bootId: 'tape',
      hooks: {
        onLapClosed: (closed) => libraryFromStart.push(closed.fromStart),
      },
    }
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
  /**
   * The part of the car that exists only in its telemetry block, over the
   * frames with no player vehicle.
   */
  const block = {
    /** Frames built from the own entry's block, read by its slot. */
    frames: 0,
    /** Frames built from no block: the one the user left the car on. */
    missing: 0,
    /** Frames on which a pedal, the gear or the revs were not the recording's. */
    controlsDisagreed: 0,
    steeringDisagreed: 0,
    brakesDisagreed: 0,
    gears: new Set<number>(),
    revs: { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
    throttle: { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
    /** Frames on which the sim had written the player's car its tyres. */
    tyresInRecording: 0,
    /** Frames carrying each key the sim writes for the player's car alone. */
    playerOnlyKeys: {} as Record<string, number>,
    withFuel: 0,
    fuelDisagreed: 0,
    withWear: 0,
    wearDisagreed: 0,
    /** Frames on which the tyre widget's snapshot had a tyre reading. */
    tyreReadings: 0,
    /** Frames on which it had no brake temperature. */
    noBrakeReading: 0,
    /** Frames on which the pedals' snapshot was not the frame's. */
    controlsSnapshotOff: 0,
    /** Lap trace samples that said the user was at the wheel. */
    traceAtWheel: 0,
    /** Frames on which the track state said the block is live, by camera. */
    liveOnOwnCar: 0,
    liveOnRival: 0,
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
    transformRaw: (raw, blockSlot) => {
      startET ??= raw.currentET;
      if (!isOut(raw)) {
        if (raw.playerHasVehicle) playerSlot = raw.playerVehicleIdx;
        return raw;
      }
      // The block the read asked for by slot stays, as it would with a
      // team-mate in the car, and scoring names somebody else as driving.
      const staged = {
        ...lmuRawWithoutPlayerVehicle(raw, blockSlot),
        vehControl: Uint8Array.from(raw.vehControl ?? [], (was, slot) =>
          slot === playerSlot ? control : was
        ),
      };
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
        if (state.watchingOwnCarTelemetry) block.liveOnRival += 1;
      } else {
        if (state.watchingOwnCar) out.watchingOwnCar += 1;
        if (state.watchingOwnCarTelemetry) block.liveOnOwnCar += 1;
      }

      // The lap trace's sample never says the user is driving.
      if (lapTrace.snapshot().isOnTrack) block.traceAtWheel += 1;
      if (tyres.snapshot().wheels.some((wheel) => wheel.surfaceTempC)) {
        block.tyreReadings += 1;
      }
      if (scalar(telemetry, 'LmuOwnEntryTelemetry') !== true) {
        block.missing += 1;
        return;
      }
      // From here the frame was built from the own entry's block, and
      // `raw` still holds that block as the recording has it.
      block.frames += 1;
      // Nothing of it that the sim writes for the player's car alone.
      for (const key of PLAYER_ONLY_KEYS) {
        if (has(telemetry, key)) {
          block.playerOnlyKeys[key] = (block.playerOnlyKeys[key] ?? 0) + 1;
        }
      }
      const gear = scalar(telemetry, 'Gear') as number;
      const revs = scalar(telemetry, 'RPM') as number;
      const throttle = scalar(telemetry, 'Throttle') as number;
      if (
        throttle !== raw.filteredThrottle ||
        scalar(telemetry, 'ThrottleRaw') !== raw.unfilteredThrottle ||
        scalar(telemetry, 'Brake') !== raw.filteredBrake ||
        scalar(telemetry, 'BrakeRaw') !== raw.unfilteredBrake ||
        gear !== raw.gear ||
        revs !== raw.engineRPM ||
        scalar(telemetry, 'ShiftGrindRPM') !== raw.engineMaxRPM
      ) {
        block.controlsDisagreed += 1;
      }
      // A fraction of the lock either way, on the wheel's 719 degrees.
      const steering =
        -(raw.filteredSteering ?? Number.NaN) *
        (((raw.visualSteeringWheelRange ?? Number.NaN) * Math.PI) / 360);
      if (
        Math.abs(
          (scalar(telemetry, 'SteeringWheelAngle') as number) - steering
        ) > 1e-9
      ) {
        block.steeringDisagreed += 1;
      }
      block.gears.add(gear);
      block.revs.min = Math.min(block.revs.min, revs);
      block.revs.max = Math.max(block.revs.max, revs);
      block.throttle.min = Math.min(block.throttle.min, throttle);
      block.throttle.max = Math.max(block.throttle.max, throttle);
      // Kelvin in the recording, Celsius in the frame.
      const brakes = raw.brakeTemperatureRaw ?? [];
      for (let wheel = 0; wheel < 4; wheel += 1) {
        const celsius = numberAt(telemetry, 'LmuBrakeTemp', wheel);
        if (!(Math.abs(celsius - (brakes[wheel] - 273.15)) < 1e-9)) {
          block.brakesDisagreed += 1;
        }
      }
      if ((raw.tyreSurfaceTemperatureRaw?.[0] ?? 0) > 273) {
        block.tyresInRecording += 1;
      }
      if (has(telemetry, 'FuelLevel')) {
        block.withFuel += 1;
        if (scalar(telemetry, 'FuelLevel') !== raw.fuel) {
          block.fuelDisagreed += 1;
        }
      }
      if (WEAR_KEYS.some((key) => has(telemetry, key))) {
        block.withWear += 1;
        if (
          WEAR_KEYS.some(
            (key, wheel) => scalar(telemetry, key) !== raw.tyreWear?.[wheel]
          )
        ) {
          block.wearDisagreed += 1;
        }
      }
      if (tyres.snapshot().wheels.some((wheel) => wheel.brakeTempC === null)) {
        block.noBrakeReading += 1;
      }
      const pedals = controls.snapshot();
      if (
        pedals.throttle !== throttle ||
        pedals.gear !== gear ||
        pedals.rpm !== revs
      ) {
        block.controlsSnapshotOff += 1;
      }
    },
  });

  return {
    playerSlot,
    rivalSlot,
    out,
    block,
    tyres: tyres.snapshot(),
    largestStepBack,
    lapWentBack,
    changes,
    crossings,
    atWheelAfterReturn,
    framesAfterReturn,
    lapsCounted,
    lapsSaved,
    libraryLaps,
    libraryFromStart,
    fuel: fuel.snapshot(),
    lapLog: lapLog.snapshot(),
    lapDelta: lapDelta.snapshot(),
    sessionBests: references.snapshot().bestLaps,
    references: references.snapshot(),
    sectorTiming: sectorTiming.snapshot(),
    /** What the store of all-time sector bests was left holding, by key. */
    sectorBestsKept,
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

        // Nor a last lap or a best of the stint: the lap the team-mate
        // drove from line to line is the car's, not the user's.
        expect(stint.references.playerLastLap).toBeNull();
        expect(stint.references.playerStintBestLap).toBeNull();
        expect(stint.lapDelta.lastLap.lapTime).toBeNull();
        expect(stint.lapDelta.stintBest.lapTime).toBeNull();
        // That lap was timed as it ended, and had nothing of the user's to
        // be measured against.
        expect(stint.lapDelta.lastLapFinal?.lapTime).toBeCloseTo(
          SECOND_LAP_SECONDS,
          1
        );
        expect(stint.lapDelta.lastLapFinal).toMatchObject({
          sessionBest: null,
          allTime: null,
          stintBest: null,
          lastLap: null,
        });

        // And no sector of it: none for the session, none kept for the
        // track and car, and nothing written to the store. The one sector
        // the user did finish at the wheel began before the recording.
        const empty = [null, null, null];
        const { sectorTiming } = stint;
        expect(sectorTiming.inclusive.sessionBestSectorTimes).toEqual(empty);
        expect(sectorTiming.clean.sessionBestSectorTimes).toEqual(empty);
        expect(sectorTiming.inclusive.sessionBestLapSectorTimes).toEqual(empty);
        expect(sectorTiming.allTime).toEqual({
          bestSectorTimes: empty,
          previousBestSectorTimes: empty,
          bestLapSectorTimes: empty,
        });
        expect(stint.sectorBestsKept.size).toBe(0);

        // The lap library has both laps the car completed, and neither as
        // the user's own, so neither can ever be a reference.
        expect(stint.libraryLaps).toHaveLength(2);
        expect(stint.libraryFromStart).toEqual([true, false]);
        // The first is the lap from the rolling start: it began with the
        // user at the wheel, as the sim let the car go at the line, and the
        // team-mate finished it. Kept for what it cost, without a curve.
        expect(stint.libraryLaps[0]).toMatchObject({
          own: false,
          complete: false,
          curve: null,
        });
        expect(stint.libraryLaps[0].lapTime).toBeCloseTo(
          FROM_START_LAP_SECONDS,
          0
        );
        // The second began and ended at a crossing, whole, and was the
        // team-mate's from the line.
        expect(stint.libraryLaps[1]).toMatchObject({
          own: false,
          complete: true,
        });
        expect(stint.libraryLaps[1].lapTime).toBeCloseTo(SECOND_LAP_SECONDS, 0);
        expect(stint.libraryLaps.map(isEligibleLap)).toEqual([false, false]);

        // The pedals, the gear and the revs go on flowing, from the own
        // entry's block read by its slot: on every frame but the one the
        // user left the car on, which the replay cannot read again as the
        // bridge does.
        const { block } = stint;
        expect(block.missing).toBeLessThanOrEqual(1);
        expect(block.frames).toBe(out.frames - block.missing);
        // They are the recording's own, frame by frame: both pedals as
        // pressed and as the car received them, the gear, the revs, the
        // rev limit, the steering and the brake temperatures.
        expect(block.controlsDisagreed).toBe(0);
        expect(block.steeringDisagreed).toBe(0);
        expect(block.brakesDisagreed).toBe(0);
        expect(block.controlsSnapshotOff).toBe(0);
        // And they are a car being driven round a lap, not a held reading.
        expect(block.gears.size).toBeGreaterThanOrEqual(4);
        expect(block.revs.max - block.revs.min).toBeGreaterThan(3_000);
        expect(block.throttle).toEqual({ min: 0, max: 1 });

        // The tyre temperatures and pressures, the engine temperatures and
        // the dials are absent from every frame built from the block, not
        // zero. Here the recording does hold them: it is the mapper that
        // takes nothing the sim writes for the player's car alone. And the
        // tyre widget has no tyre reading on any frame of the stint.
        expect(block.tyresInRecording).toBe(block.frames);
        expect(block.playerOnlyKeys).toEqual({});
        expect(block.tyreReadings).toBe(0);
        // The brakes are there for the tyre widget, and no tyre reading.
        expect(block.noBrakeReading).toBe(0);
        expect(stint.tyres.available).toBe(true);
        for (const wheel of stint.tyres.wheels) {
          expect(wheel.surfaceTempC).toBeNull();
          expect(wheel.pressureKpa).toBeNull();
          expect(wheel.brakeTempC).toBeGreaterThan(100);
          expect(wheel.compound).toBeGreaterThanOrEqual(0);
        }

        // With a person driving on another machine, neither the fuel nor
        // the wear is taken from the block: what the sim sends for them
        // online is not known.
        expect(block.withFuel).toBe(0);
        expect(block.withWear).toBe(0);
        expect(stint.tyres.wheels.map((wheel) => wheel.treadRemaining)).toEqual(
          [null, null, null, null]
        );

        // The widgets made of these are told they are live while the
        // camera is on the team car, and not while it is on the rival.
        expect(block.liveOnRival).toBe(0);
        expect(block.liveOnOwnCar).toBe(block.frames - out.onRival);
        // Nothing of it is the user's driving: the lap trace is never told
        // the user is at the wheel, so it records none of these laps.
        expect(block.traceAtWheel).toBe(0);
      }, 90_000);
    });

    it('takes the fuel and the wear from the block as well while the AI drives the car', async () => {
      // The car handed to the AI: simulated on this machine, so the sim is
      // known to write both.
      const stint = await playStint({
        outFrom: 60,
        outUntil: Number.POSITIVE_INFINITY,
        control: CONTROL_AI,
      });
      const { out, block } = stint;

      expect(block.frames).toBeGreaterThan(4_000);
      expect(block.frames).toBe(out.frames - block.missing);
      expect(block.controlsDisagreed).toBe(0);
      // Litres and tread, the recording's own on every frame.
      expect(block.withFuel).toBe(block.frames);
      expect(block.fuelDisagreed).toBe(0);
      expect(block.withWear).toBe(block.frames);
      expect(block.wearDisagreed).toBe(0);
      for (const wheel of stint.tyres.wheels) {
        expect(wheel.treadRemaining).toBeGreaterThan(0.9);
        expect(wheel.treadRemaining).toBeLessThan(1);
      }
      // The tank of a car counted in virtual energy is read beside it.
      expect(stint.fuel.budget).toBe('virtualEnergy');
      expect(stint.fuel.tank?.level).toBeGreaterThan(35);
      expect(stint.fuel.tank?.level).toBeLessThan(45);
      // Still nothing the sim writes for the player's car alone.
      expect(block.playerOnlyKeys).toEqual({});
      expect(block.tyreReadings).toBe(0);

      // And still none of it the user's own.
      expect(out.atWheel).toBe(0);
      expect(block.traceAtWheel).toBe(0);
      expect(stint.lapsCounted.every((lap) => lap.wasWatched)).toBe(true);
      expect(stint.lapsSaved).toEqual([]);
      expect(stint.lapLog.ownBestLapTime).toBe(0);
      expect(stint.libraryLaps.every((lap) => !lap.own)).toBe(true);
    }, 90_000);

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

      // The forty seconds out were read from the own entry's block, and the
      // frames either side of them from the player's own: the pedals never
      // stopped being the recording's.
      expect(stint.block.frames).toBeGreaterThan(1_000);
      expect(stint.block.missing).toBeLessThanOrEqual(1);
      expect(stint.block.controlsDisagreed).toBe(0);
      expect(stint.block.traceAtWheel).toBe(0);
      // Back at the wheel the tyres read again.
      expect(stint.tyres.wheels[0].surfaceTempC).not.toBeNull();
      expect(stint.tyres.wheels[0].pressureKpa).toBeGreaterThan(150);

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
      // That lap is the user's last lap and the best of their stint too,
      // and the one before it, which the team-mate had a part of, is not.
      expect(stint.references.playerLastLap).toBe(sessionBest);
      expect(stint.references.playerStintBestLap).toBe(sessionBest);
      expect(stint.lapDelta.lastLap.lapTime).toBeCloseTo(SECOND_LAP_SECONDS, 0);
      expect(stint.lapDelta.stintBest.lapTime).toBeCloseTo(
        SECOND_LAP_SECONDS,
        0
      );

      // The sectors the user drove from their start count, and only those:
      // of the lap the team-mate had part of, the last one alone; then the
      // whole of the lap after it, which is the best lap, and the first
      // sector of the third. They are what is kept for the track and car.
      const { sectorTiming } = stint;
      const bestLap = sectorTiming.clean.sessionBestLapSectorTimes;
      expect(sectorSum(bestLap)).toBeCloseTo(SECOND_LAP_SECONDS, 1);
      expect(sectorTiming.allTime?.bestLapSectorTimes).toEqual(bestLap);
      expect(sectorTiming.allTime?.bestSectorTimes).toEqual(
        sectorTiming.clean.sessionBestSectorTimes
      );
      // The second sector of the first lap, which the user came back into
      // the car part-way through, is nobody's best: the only second sector
      // there is to have been improved on would have been that one.
      expect(sectorTiming.allTime?.previousBestSectorTimes[1]).toBeNull();
      expect(sectorTiming.allTime?.previousBestSectorTimes[2]).toBeCloseTo(
        FIRST_LAP_SECONDS - 78.816,
        1
      );
      expect([...stint.sectorBestsKept.values()]).toEqual([
        {
          bestSectorTimes: sectorTiming.allTime?.bestSectorTimes,
          bestLapSectorTimes: bestLap,
        },
      ]);
      // The library has both laps. The one from the rolling start is not
      // the user's own, the team-mate having had the car for forty seconds
      // of it, and has no curve. The one after it is the user's from the
      // line, whole: the only one of the two fit to be a reference.
      expect(stint.libraryLaps).toHaveLength(2);
      expect(stint.libraryFromStart).toEqual([true, false]);
      expect(stint.libraryLaps[0]).toMatchObject({
        own: false,
        complete: false,
        curve: null,
      });
      expect(stint.libraryLaps[0].lapTime).toBeCloseTo(
        FROM_START_LAP_SECONDS,
        0
      );
      expect(stint.libraryLaps[1]).toMatchObject({ own: true, complete: true });
      expect(stint.libraryLaps[1].lapTime).toBeCloseTo(SECOND_LAP_SECONDS, 0);
      expect(stint.libraryLaps.map(isEligibleLap)).toEqual([false, true]);
    }, 90_000);
  }
);
