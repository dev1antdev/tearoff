import { describe, expect, it } from 'vitest';
import type { FuelLapData, LapInput, Session } from '@irdashies/types';
import type { LmuRawSession, LmuRawTelemetry } from './native';
import {
  LMU_CURATED_TAPE_PATH,
  lmuRawWithoutPlayerVehicle,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { DriverControlsProcessor } from '../processors/DriverControlsProcessor';
import { FuelProjectionProcessor } from '../processors/FuelProjectionProcessor';
import { LapLogProcessor } from '../processors/LapLogProcessor';
import { LapTraceSampleProcessor } from '../processors/LapTraceSampleProcessor';
import { PlayerLapRecorder } from '../processors/PlayerLapRecorder';
import { TrackStateProcessor } from '../processors/TrackStateProcessor';
import { TyreStateProcessor } from '../processors/TyreStateProcessor';

/**
 * The user's own car with somebody else driving it, read from the telemetry
 * block of a car the sim really writes as it writes any car but the
 * player's. STAGED on a recorded Le Mans Ultimate race.
 *
 * The recording is four minutes of an offline race the player drives in
 * slot 0. Here the player's vehicle is taken out of every snapshot from the
 * start, and scoring's player flag is put on the LMP2 in slot 1, which the
 * AI drives: that car stands in for the user's own entry, as it would be
 * with the car handed to the AI. The app then asks the addon for that slot's
 * block, as the bridge does, and builds the frame from it.
 *
 * teamMateStint.tape.spec.ts stages the stint on the car the player had
 * been driving, and shows the keys running on through the driver change;
 * its block is the player's own, full of readings no other car has. This
 * one has no driver change in it. What it shows is the other half: the
 * frame built from a block as the sim writes it for a car the user is not
 * in. The tyre temperatures there are zeros in the recording itself, the
 * fuel is the litres of a car that has no virtual energy, and the laps are
 * the AI's.
 *
 * What it cannot show is what LMU sends for a car a person is driving on
 * another machine: whether it fills in the pedals and the revs at all, and
 * what it gives for fuel and wear. No recording holds that. The second case
 * stages scoring calling the car remote (control 2) over the same block,
 * and shows only what the app does on that word: it takes neither fuel nor
 * wear.
 *
 * Windows only, like the other tape specs.
 */

/** The LMP2 the AI drives, standing in for the user's own entry. */
const OWN = 1;
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
  'LmuPlayerWorldPos',
  'LatAccel',
] as const;
const WEAR_KEYS = ['LFwearM', 'RFwearM', 'LRwearM', 'RRwearM'] as const;

const scalar = (frame: unknown, key: string): unknown =>
  (frame as Record<string, { value: unknown[] } | undefined>)[key]?.value[0];

const numberAt = (frame: unknown, key: string, index: number): number =>
  (frame as Record<string, { value: number[] } | undefined>)[key]?.value[
    index
  ] ?? Number.NaN;

const has = (frame: unknown, key: string): boolean =>
  (frame as Record<string, unknown>)[key] !== undefined;

const emptyRange = () => ({
  min: Number.POSITIVE_INFINITY,
  max: Number.NEGATIVE_INFINITY,
});

const widen = (range: { min: number; max: number }, value: number) => {
  range.min = Math.min(range.min, value);
  range.max = Math.max(range.max, value);
};

const playOwnCar = async (control?: number) => {
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
  const controls = new DriverControlsProcessor();
  const tyres = new TyreStateProcessor();
  const lapTrace = new LapTraceSampleProcessor();
  const processors = [fuel, trackState, lapLog, controls, tyres, lapTrace];
  for (const processor of processors) {
    processor.onLifecycle({ type: 'enter', replay: false });
  }
  const libraryLaps: LapInput[] = [];
  const recorder = new PlayerLapRecorder(
    { record: (_session, lap) => libraryLaps.push(lap) },
    { simulator: 'lmu', now: () => 0, bootId: 'tape' }
  );
  recorder.onEnter();

  const seen = {
    frames: 0,
    /** Frames built from the own entry's block. */
    blockFrames: 0,
    /** Slots the read was asked the block of, once the entry was known. */
    asked: new Set<number>(),
    notOwnEntry: 0,
    atWheel: 0,
    notWatching: 0,
    /** Frames on which the frame's figure was not the block's. */
    controlsDisagreed: 0,
    speedDisagreed: 0,
    brakesDisagreed: 0,
    fuelDisagreed: 0,
    wearDisagreed: 0,
    withFuel: 0,
    withWear: 0,
    /** Frames on which the recording held a tyre temperature for the car. */
    tyresInRecording: 0,
    playerOnlyKeys: {} as Record<string, number>,
    gears: new Set<number>(),
    revs: emptyRange(),
    throttle: emptyRange(),
    fuel: emptyRange(),
    brakeCelsius: emptyRange(),
    /** Frames on which the track state did not say the block is live. */
    notLive: 0,
    controlsSnapshotOff: 0,
    tyreReadings: 0,
    noBrakeReading: 0,
    traceAtWheel: 0,
  };
  let session: Session | null = null;

  await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    speed: 40,
    // Frames and session snapshots both pass through here.
    transformRaw: (raw, blockSlot) => {
      if (blockSlot >= 0) seen.asked.add(blockSlot);
      const staged = {
        ...lmuRawWithoutPlayerVehicle(raw, blockSlot),
        // Scoring's word that the car in slot 1 is the user's.
        vehIsPlayer: Uint8Array.from(raw.vehIsPlayer, (_flag, slot) =>
          slot === OWN ? 1 : 0
        ),
        ...(control === undefined
          ? {}
          : {
              vehControl: Uint8Array.from(raw.vehControl ?? [], (was, slot) =>
                slot === OWN ? control : was
              ),
            }),
      };
      if ('drivers' in staged) {
        const grid = staged as unknown as LmuRawSession;
        grid.drivers = grid.drivers.map((driver) => ({
          ...driver,
          isPlayer: driver.id === OWN,
        }));
      }
      return staged;
    },
    gameState: () => 'monitor',
    onFrame: (frame) => {
      const { telemetry, sessionChanged } = frame;
      const raw: LmuRawTelemetry = frame.raw;
      session = frame.session;
      if (sessionChanged) {
        for (const processor of processors) processor.init(frame.session);
        recorder.onSession(frame.session);
      }
      for (const processor of processors) processor.onFrame(telemetry);
      recorder.onFrame(telemetry);

      seen.frames += 1;
      if (scalar(telemetry, 'IsOnTrack') === true) seen.atWheel += 1;
      if (lapTrace.snapshot().isOnTrack) seen.traceAtWheel += 1;
      if (tyres.snapshot().wheels.some((wheel) => wheel.surfaceTempC)) {
        seen.tyreReadings += 1;
      }
      if (scalar(telemetry, 'LmuOwnEntryTelemetry') !== true) return;

      // Built from the block of the car in slot 1, which `raw` still holds
      // as the recording has it.
      seen.blockFrames += 1;
      if (scalar(telemetry, 'PlayerCarIdx') !== OWN) seen.notOwnEntry += 1;
      if (scalar(telemetry, 'LmuWatching') !== true) seen.notWatching += 1;
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
        seen.controlsDisagreed += 1;
      }
      // The block's speed is the one the per-car array has for the slot.
      if (
        scalar(telemetry, 'Speed') !== raw.speed ||
        raw.speed !== raw.vehSpeed?.[OWN]
      ) {
        seen.speedDisagreed += 1;
      }
      seen.gears.add(gear);
      widen(seen.revs, revs);
      widen(seen.throttle, throttle);
      const brakes = raw.brakeTemperatureRaw ?? [];
      for (let wheel = 0; wheel < 4; wheel += 1) {
        const celsius = numberAt(telemetry, 'LmuBrakeTemp', wheel);
        widen(seen.brakeCelsius, celsius);
        if (!(Math.abs(celsius - (brakes[wheel] - 273.15)) < 1e-9)) {
          seen.brakesDisagreed += 1;
        }
      }
      if (
        Array.from(raw.tyreSurfaceTemperatureRaw ?? [1]).some(
          (kelvin) => kelvin
        )
      ) {
        seen.tyresInRecording += 1;
      }
      for (const key of PLAYER_ONLY_KEYS) {
        if (has(telemetry, key)) {
          seen.playerOnlyKeys[key] = (seen.playerOnlyKeys[key] ?? 0) + 1;
        }
      }
      if (has(telemetry, 'FuelLevel')) {
        seen.withFuel += 1;
        const litres = scalar(telemetry, 'FuelLevel') as number;
        widen(seen.fuel, litres);
        if (
          litres !== raw.fuel ||
          scalar(telemetry, 'FuelLevelPct') !==
            litres / (raw.fuelCapacity ?? Number.NaN)
        ) {
          seen.fuelDisagreed += 1;
        }
      }
      if (WEAR_KEYS.some((key) => has(telemetry, key))) {
        seen.withWear += 1;
        if (
          WEAR_KEYS.some(
            (key, wheel) => scalar(telemetry, key) !== raw.tyreWear?.[wheel]
          )
        ) {
          seen.wearDisagreed += 1;
        }
      }
      if (trackState.snapshot().watchingOwnCarTelemetry !== true) {
        seen.notLive += 1;
      }
      const pedals = controls.snapshot();
      if (
        pedals.throttle !== throttle ||
        pedals.gear !== gear ||
        pedals.rpm !== revs
      ) {
        seen.controlsSnapshotOff += 1;
      }
      if (tyres.snapshot().wheels.some((wheel) => wheel.brakeTempC === null)) {
        seen.noBrakeReading += 1;
      }
    },
  });

  return {
    seen,
    session: session as Session | null,
    lapsCounted,
    lapsSaved,
    libraryLaps,
    fuel: fuel.snapshot(),
    lapLog: lapLog.snapshot(),
    tyres: tyres.snapshot(),
  };
};

describe.skipIf(!lmuTapeAvailable())(
  'the own car read from the block of a car the AI drives, staged on a recorded LMU race',
  () => {
    it('carries what the sim writes for a car the user is not in, and none of it as the user’s', async () => {
      const car = await playOwnCar();
      const { seen } = car;

      // Every recorded frame of the four minutes, each built from the block
      // of slot 1 but the first, before the entry is known.
      expect(seen.frames).toBeGreaterThan(14_000);
      expect(seen.blockFrames).toBeGreaterThanOrEqual(seen.frames - 2);
      // The only block ever asked for is the own entry's.
      expect([...seen.asked]).toEqual([OWN]);
      expect(seen.notOwnEntry).toBe(0);
      expect(seen.notWatching).toBe(0);
      expect(seen.notLive).toBe(0);

      // The pedals, the gear, the revs, the rev limit, the speed and the
      // brakes are the block's own, frame by frame, and a car being raced.
      expect(seen.controlsDisagreed).toBe(0);
      expect(seen.speedDisagreed).toBe(0);
      expect(seen.brakesDisagreed).toBe(0);
      expect(seen.controlsSnapshotOff).toBe(0);
      expect(seen.gears.size).toBeGreaterThanOrEqual(5);
      expect(seen.revs.min).toBeGreaterThan(3_000);
      expect(seen.revs.max).toBeGreaterThan(8_500);
      expect(seen.throttle).toEqual({ min: 0, max: 1 });
      // 40 C at the coolest disc and some 800 at the hottest.
      expect(seen.brakeCelsius.min).toBeGreaterThan(30);
      expect(seen.brakeCelsius.max).toBeGreaterThan(600);
      expect(seen.brakeCelsius.max).toBeLessThan(900);

      // The recording holds no tyre temperature for the car on any frame,
      // and the frame has no key for one, nor for a pressure, an engine
      // temperature or a dial: absent, not zero.
      expect(seen.tyresInRecording).toBe(0);
      expect(seen.playerOnlyKeys).toEqual({});
      expect(seen.tyreReadings).toBe(0);
      // The tyre widget has the brakes, the tread and the compound.
      expect(seen.noBrakeReading).toBe(0);
      expect(car.tyres.available).toBe(true);
      for (const wheel of car.tyres.wheels) {
        expect(wheel.surfaceTempC).toBeNull();
        expect(wheel.innerLayerTempC).toBeNull();
        expect(wheel.carcassTempC).toBeNull();
        expect(wheel.pressureKpa).toBeNull();
        expect(wheel.brakeTempC).toBeGreaterThan(30);
        expect(wheel.treadRemaining).toBeGreaterThan(0.9);
        expect(wheel.treadRemaining).toBeLessThan(1);
        expect(wheel.compound).toBeGreaterThanOrEqual(0);
      }

      // The AI drives it on this machine, so the fuel and the wear are
      // taken: litres falling through the four minutes, in a tank of 75.
      expect(seen.withFuel).toBe(seen.blockFrames);
      expect(seen.fuelDisagreed).toBe(0);
      expect(seen.fuel.max - seen.fuel.min).toBeGreaterThan(4);
      expect(seen.withWear).toBe(seen.blockFrames);
      expect(seen.wearDisagreed).toBe(0);

      // The session takes its car from the same block: the tank, the gears
      // and the rev limit of the LMP2.
      const info = car.session?.DriverInfo;
      expect(info?.DriverCarIdx).toBe(OWN);
      expect(info?.DriverCarFuelMaxLtr).toBe(75);
      expect(info?.DriverCarGearNumForward).toBe(6);
      expect(info?.DriverCarRedLine).toBeGreaterThan(8_600);
      expect(info?.DriverCarRedLine).toBeLessThan(8_800);

      // The fuel calculator counts the car's laps in litres, live, and
      // saves none of them.
      expect(car.fuel).toMatchObject({ watched: true, isOnTrack: false });
      expect(car.fuel.budget ?? 'fuel').toBe('fuel');
      expect(car.fuel.fuelLevel).toBeCloseTo(seen.fuel.min, 1);
      expect(car.lapsCounted.length).toBeGreaterThanOrEqual(2);
      expect(car.lapsCounted.every((lap) => lap.wasWatched)).toBe(true);
      for (const lap of car.lapsCounted.slice(1)) {
        // An LMP2 round Laguna Seca: about two litres a lap.
        expect(lap.fuelUsed).toBeGreaterThan(1);
        expect(lap.fuelUsed).toBeLessThan(4);
      }
      expect(car.lapsSaved).toEqual([]);

      // Watched from the first frame to the last: never at the wheel, no
      // personal best, no lap of the user's own, and a lap trace that is
      // never told the user is driving.
      expect(seen.atWheel).toBe(0);
      expect(seen.traceAtWheel).toBe(0);
      expect(car.lapLog.ownBestLapTime).toBe(0);
      expect(car.libraryLaps.length).toBeGreaterThanOrEqual(1);
      expect(car.libraryLaps.every((lap) => !lap.own)).toBe(true);
    }, 120_000);

    it('takes neither fuel nor wear on scoring’s word that a person is driving it elsewhere', async () => {
      // The same block, with scoring calling the car remote. What the sim
      // would really write into it then is not known, and is not shown.
      const car = await playOwnCar(CONTROL_REMOTE);
      const { seen } = car;

      expect(seen.blockFrames).toBeGreaterThan(14_000);
      expect(seen.withFuel).toBe(0);
      expect(seen.withWear).toBe(0);
      expect(car.tyres.wheels.map((wheel) => wheel.treadRemaining)).toEqual([
        null,
        null,
        null,
        null,
      ]);
      // No tank size either, which goes with the fuel.
      expect(car.session?.DriverInfo?.DriverCarFuelMaxLtr).toBe(0);
      // With nothing to count in, the fuel calculator counts no lap and
      // does not call its figures live, so it stays hidden.
      expect(car.fuel.watched).toBeUndefined();
      expect(car.lapsCounted).toEqual([]);
      expect(car.lapsSaved).toEqual([]);

      // The pedals, the revs and the brakes are taken whoever drives.
      expect(seen.controlsDisagreed).toBe(0);
      expect(seen.brakesDisagreed).toBe(0);
      expect(seen.notLive).toBe(0);
      expect(seen.noBrakeReading).toBe(0);
      expect(seen.playerOnlyKeys).toEqual({});
      expect(seen.atWheel).toBe(0);
    }, 120_000);
  }
);
