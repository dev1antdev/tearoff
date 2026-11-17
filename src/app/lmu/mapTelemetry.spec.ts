import { describe, expect, it } from 'vitest';
import {
  CarLeftRight,
  GlobalFlags,
  LMU_DIAL_KEYS,
  TIMED_SESSION_LAPS,
} from '@irdashies/types';
import type { LmuRawTelemetry } from './native';
import { mapLmuTelemetry } from './mapTelemetry';
import { mapLmuSectorTimes } from './sectorTimes';
import { fixture } from './rawFixture';
import { createLmuEnergyState } from './fuelEnergy';
import { createLmuLapDistanceState } from './lapDistance';
import { createLmuSessionClockState } from './sessionClock';
import { createLmuLapStartState } from './lapStartTiming';
import { lmuRawWithoutPlayerVehicle } from '../../testing/lmuTape';

describe('mapLmuTelemetry', () => {
  it('maps session scalars', () => {
    const t = mapLmuTelemetry(fixture());
    // Both clocks are the player's 100 Hz mElapsedTime, not scoring's 5 Hz
    // mCurrentET (1250.5 in the fixture). See the session-clock specs below.
    expect(t.SessionTick.value[0]).toBe(250.4);
    expect(t.SessionTime.value[0]).toBe(250.4);
    expect(t.SessionTimeTotal.value[0]).toBe(3600);
    expect(t.SessionTimeRemain.value[0]).toBe(2349.5);
    // The fixture is session 1 -- practice -- which is always timed, so both
    // report the no-lap-limit sentinel however many laps mMaxLaps claims.
    // See the lap-limit specs below.
    expect(t.SessionLapsTotal.value[0]).toBe(TIMED_SESSION_LAPS);
    expect(t.SessionLapsRemain.value[0]).toBe(TIMED_SESSION_LAPS);
    expect(t.SessionNum.value[0]).toBe(1);
    expect(t.SessionState.value[0]).toBe(3);
    expect(t.SessionTimeOfDay.value[0]).toBe(0.45);
  });

  it('maps game phase to iRacing session state', () => {
    const base = fixture();
    const phases: [number, number][] = [
      [0, 0],
      [1, 2],
      [2, 1],
      [3, 3],
      [4, 3],
      [5, 4],
      [6, 4],
      [7, 5],
      [8, 6],
      [9, 4],
    ];
    for (const [phase, state] of phases) {
      expect(
        mapLmuTelemetry({ ...base, gamePhase: phase }).SessionState.value[0]
      ).toBe(state);
    }
  });

  it('maps player telemetry', () => {
    const t = mapLmuTelemetry(fixture());
    expect(t.PlayerCarIdx.value[0]).toBe(1);
    expect(t.Speed.value[0]).toBeCloseTo(51.234);
    expect(t.FuelLevel.value[0]).toBe(42);
    expect(t.FuelLevelPct.value[0]).toBeCloseTo(42 / 110);
    expect(t.WaterTemp.value[0]).toBe(95);
    expect(t.OilTemp.value[0]).toBe(110);
    expect(t.Gear.value[0]).toBe(5);
    expect(t.RPM.value[0]).toBe(8200);
    expect(t.LapCurrentLapTime.value[0]).toBeCloseTo(50.4);
    expect(t.Throttle.value[0]).toBeCloseTo(0.79);
    expect(t.Brake.value[0]).toBe(0);
    expect(t.Clutch.value[0]).toBe(1);
    expect(t.ClutchRaw.value[0]).toBe(1);
    expect(t.RadioTransmitCarIdx.value[0]).toBe(-1);
    expect(t.BrakeABSactive.value[0]).toBe(true);
    expect(t.Speed).toBeDefined();
    expect(t.SteeringWheelAngle.value[0]).toBeCloseTo(
      0.29 * ((480 * Math.PI) / 360)
    );
    expect(t.dcBrakeBias.value[0]).toBeCloseTo(45);
    expect(t.dcPitSpeedLimiterToggle.value[0]).toBe(false);
    // iRacing's signs: positive to the left and forwards. The sim's own
    // longitudinal axis points to the rear, so the fixture's -19.6133 is a
    // car accelerating.
    expect(t.LatAccel.value[0]).toBeCloseTo(9.80665);
    expect(t.LongAccel.value[0]).toBeCloseTo(19.6133);
    // Left, middle and right across the car, from the sim's three zones.
    expect(t.LFtempCL.value[0]).toBeCloseTo(70);
    expect(t.LFtempCM.value[0]).toBeCloseTo(80);
    expect(t.LFtempCR.value[0]).toBeCloseTo(90);
    expect(t.RFtempCL.value[0]).toBeCloseTo(71);
    expect(t.RFtempCR.value[0]).toBeCloseTo(91);
    expect(t.RRcoldPressure.value[0]).toBe(183);
    expect(t.LRwearM.value[0]).toBe(0.7);
    expect(t.RFbrakeLinePress.value[0]).toBe(0.5);
    expect(t.RRshockDefl.value[0]).toBe(0.07);
  });

  it('publishes the tyres and brakes in Celsius, outer shoulder first', () => {
    const t = mapLmuTelemetry(fixture());

    // LF is a left wheel: the sim's left zone is its outer shoulder.
    expect(t.LmuTyreSurfaceTemp?.value.slice(0, 3).map(Math.round)).toEqual([
      70, 80, 90,
    ]);
    // RF is a right wheel: the sim's right zone is its outer shoulder.
    expect(t.LmuTyreSurfaceTemp?.value.slice(3, 6).map(Math.round)).toEqual([
      91, 81, 71,
    ]);
    expect(t.LmuTyreInnerLayerTemp?.value.slice(0, 3).map(Math.round)).toEqual([
      75, 85, 95,
    ]);
    expect(t.LmuTyreCarcassTemp?.value.map(Math.round)).toEqual([
      78, 79, 80, 81,
    ]);
    // Already Celsius in shared memory, unlike the rest.
    expect(t.LmuTyreOptimalTemp?.value).toEqual([92, 92, 92, 92]);
    expect(t.LmuBrakeTemp?.value.map(Math.round)).toEqual([400, 410, 300, 310]);
  });

  it('leaves the tyre channels out when the wheels were never written', () => {
    // Out of the car the block is zeroed, and a zero must not be published as
    // a tyre at -273 C.
    const t = mapLmuTelemetry({
      ...fixture(),
      tyreSurfaceTemperatureRaw: new Float64Array(12),
      tyreInnerLayerTemperatureRaw: new Float64Array(12),
      tyreCarcassTemperatureRaw: new Float64Array(4),
      tyreOptimalTemperatureRaw: new Float64Array(4),
      brakeTemperatureRaw: new Float64Array(4),
    });

    expect(t.LmuTyreSurfaceTemp).toBeUndefined();
    expect(t.LmuTyreInnerLayerTemp).toBeUndefined();
    expect(t.LmuTyreCarcassTemp).toBeUndefined();
    expect(t.LmuTyreOptimalTemp).toBeUndefined();
    expect(t.LmuBrakeTemp).toBeUndefined();
    // The averaged reading is still there for anything that used it.
    expect(t.LFtempCM.value[0]).toBe(80);
  });

  it('maps the LMU pit limiter switch, not only active intervention', () => {
    const t = mapLmuTelemetry({
      ...fixture(),
      speedLimiter: 1,
      speedLimiterActive: false,
    });

    expect(t.dcPitSpeedLimiterToggle.value[0]).toBe(true);
  });

  it('handles the no-player case', () => {
    const rest: Record<string, unknown> = { ...fixture() };
    delete rest.speed;
    rest.playerHasVehicle = false;
    rest.playerVehicleIdx = -1;
    const t = mapLmuTelemetry(rest as unknown as LmuRawTelemetry);
    expect(t.PlayerCarIdx.value[0]).toBe(-1);
    expect(t.Speed.value[0]).toBe(0);
    expect(t.OnPitRoad.value[0]).toBe(false);
    expect(t.IsOnTrack.value[0]).toBe(false);
  });

  it('maps per-car arrays by slot', () => {
    const t = mapLmuTelemetry(fixture());
    expect(t.CarIdxPosition.value).toEqual([2, 1, 3]);
    expect(t.CarIdxLapDistPct.value).toEqual([0.4, 0.6, 0.2]);
    // The lap each car is on, as iRacing counts it, beside the laps it has
    // completed, which is what LMU counts.
    expect(t.CarIdxLap.value).toEqual([3, 4, 2]);
    expect(t.CarIdxLapCompleted.value).toEqual([2, 3, 1]);
    expect(t.Lap.value[0]).toBe(4);
    expect(t.LapCompleted.value[0]).toBe(3);
    expect(t.CarIdxClass.value).toEqual([0, 0, 1]);
    expect(t.CarIdxBestLapTime.value).toEqual([134.5, 132.8, 137.1]);
    expect(t.CarIdxEstTime.value).toEqual([50, 60, 20]);
    expect(t.CarIdxOnPitRoad.value).toEqual([false, false, true]);
    expect(t.CarIdxTrackSurface.value).toEqual([3, 3, 1]);
  });

  it('clamps LMU lap distance progress for map positioning', () => {
    const t = mapLmuTelemetry({
      ...fixture(),
      vehLapDistPct: new Float64Array([-0.1, 0.6, 1.2]),
    });
    expect(t.CarIdxLapDistPct.value).toEqual([-1, 0.6, 1]);
    expect(t.LapDistPct.value[0]).toBe(0.6);
  });

  it('maps nearby world positions to iRacing blind-spot states', () => {
    const base = {
      ...fixture(),
      playerVehicleIdx: 0,
      vehTelemetryAvailable: new Uint8Array([1, 1, 1]),
      vehPosX: new Float64Array([0, 3, 20]),
      vehPosZ: new Float64Array([0, 0, 20]),
      vehOriX: new Float64Array([0, 0, 0]),
      vehOriZ: new Float64Array([1, 1, 1]),
    };

    expect(mapLmuTelemetry(base).CarLeftRight.value[0]).toBe(
      CarLeftRight.CarLeft
    );
    expect(
      mapLmuTelemetry({
        ...base,
        vehPosX: new Float64Array([0, -3, 20]),
      }).CarLeftRight.value[0]
    ).toBe(CarLeftRight.CarRight);
    expect(
      mapLmuTelemetry({
        ...base,
        vehPosX: new Float64Array([0, 3, -3]),
        vehPosZ: new Float64Array([0, 0, 0]),
      }).CarLeftRight.value[0]
    ).toBe(CarLeftRight.CarLeftRight);
  });

  it('rotates world positions into the player frame', () => {
    const t = mapLmuTelemetry({
      ...fixture(),
      playerVehicleIdx: 0,
      vehTelemetryAvailable: new Uint8Array([1, 1]),
      vehPosX: new Float64Array([0, 0]),
      vehPosZ: new Float64Array([0, 3]),
      vehOriX: new Float64Array([1, 1]),
      vehOriZ: new Float64Array([0, 0]),
    });

    expect(t.CarLeftRight.value[0]).toBe(CarLeftRight.CarLeft);
  });

  it('turns the blind-spot signal off when native position data is missing', () => {
    const t = mapLmuTelemetry({
      ...fixture(),
      vehTelemetryAvailable: new Uint8Array([0, 0, 0]),
    });

    expect(t.CarLeftRight.value[0]).toBe(CarLeftRight.Off);
  });

  it('leaves unsupported humidity absent instead of synthesizing a zero reading', () => {
    const raw = fixture();
    const first = mapLmuTelemetry(raw);
    expect(first).not.toHaveProperty('RelativeHumidity');

    // Each mapping builds a fresh record; a previous source's reading cannot
    // leak into later LMU frames.
    first.RelativeHumidity = { value: [0.45] };
    expect(mapLmuTelemetry(raw)).not.toHaveProperty('RelativeHumidity');
  });

  it('publishes no wind, which LMU does not simulate', () => {
    const t = mapLmuTelemetry(fixture());
    expect(t).not.toHaveProperty('WindVel');
    expect(t).not.toHaveProperty('WindDir');
  });

  it('reports track wetness as a level, not as a wetness fraction', () => {
    // The bug this covers: the 0..1 fraction went through untouched, and
    // every consumer indexes a 1..7 record -- so 0.05 found no key and the
    // cell rendered empty all session. The level, not the fraction, is the
    // contract.
    const base = fixture();
    expect(base.avgPathWetness).toBe(0.05);
    expect(mapLmuTelemetry(base).TrackWetness.value[0]).toBe(2);

    expect(
      mapLmuTelemetry({ ...base, avgPathWetness: 0 }).TrackWetness.value[0]
    ).toBe(1);
    expect(
      mapLmuTelemetry({ ...base, avgPathWetness: 0.8 }).TrackWetness.value[0]
    ).toBe(7);
  });

  it('maps tyre compounds per car and per wheel', () => {
    // The bug this covers: both channels were numArr(undefined), so every row
    // fell back to index 0 and rendered whatever sat there -- the player's own
    // tyre, since DriverTires held one entry at 0.
    const t = mapLmuTelemetry(fixture());
    // Front-left per car, which is all the iRacing-shaped channel can hold.
    expect(t.CarIdxTireCompound.value).toEqual([1, 3, 0]);
    // The whole set, flat, four per car.
    expect(t.LmuCarIdxWheelCompounds?.value).toEqual([
      1, 1, 1, 1, 3, 3, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it("maps every car's tread per wheel, as the sim publishes it", () => {
    const t = mapLmuTelemetry(fixture());
    // Flat, four per car, a fraction left; -1 for a car that reported none.
    expect(t.LmuCarIdxWheelWear?.value).toEqual([
      0.97, 0.96, 0.98, 0.97, 0.9, 0.8, 0.7, 0.6, -1, -1, -1, -1,
    ]);
    // The player's slot holds what the player's own channels do.
    expect(t.LmuCarIdxWheelWear?.value.slice(4, 8)).toEqual([
      t.LFwearM.value[0],
      t.RFwearM.value[0],
      t.LRwearM.value[0],
      t.RRwearM.value[0],
    ]);
  });

  it('publishes no tread for the field from an addon built before it was exported', () => {
    const older = { ...fixture(), vehWheelWear: undefined };
    expect(mapLmuTelemetry(older).LmuCarIdxWheelWear?.value).toEqual([]);
  });

  it('reports the player’s own compound', () => {
    const base = fixture();
    // The fixture's player is car 1, on a wet front.
    expect(base.vehIsPlayer?.[1]).toBeTruthy();
    expect(mapLmuTelemetry(base).PlayerTireCompound.value[0]).toBe(3);
  });

  it('reports no compound rather than compound 0 when the sim is silent', () => {
    const base = fixture();
    const t = mapLmuTelemetry({ ...base, vehWheelCompounds: undefined });
    expect(t.CarIdxTireCompound.value).toEqual([]);
    expect(t.PlayerTireCompound.value[0]).toBe(-1);
  });

  it('maps track-limits points, converted from the sim’s steps', () => {
    // The fixture is four steps to a point and twelve to a penalty, so car 0
    // sits at 0.25 of three and car 2 is one step away.
    const t = mapLmuTelemetry(fixture());
    expect(t.LmuCarIdxTrackLimitsPoints?.value).toEqual([0.25, 0, 2.75]);
    expect(t.LmuTrackLimitsPointsMax?.value[0]).toBe(3);
  });

  it('keeps a car with no reading apart from a clean one', () => {
    const base = fixture();
    const t = mapLmuTelemetry({ ...base, vehTrackLimitsSteps: [-1, 0, 4] });
    expect(t.LmuCarIdxTrackLimitsPoints?.value).toEqual([-1, 0, 1]);
  });

  it('publishes no points at all when the session states no scale', () => {
    // Without a divisor there is no points figure, and zeroes would show the
    // whole grid as clean.
    const base = fixture();
    const t = mapLmuTelemetry({ ...base, trackLimitsStepsPerPoint: 0 });
    expect(t.LmuCarIdxTrackLimitsPoints?.value).toEqual([-1, -1, -1]);
    expect(t.LmuTrackLimitsPointsMax?.value[0]).toBe(0);
  });

  it('carries one budget per car, whichever limits it', () => {
    // Two quantities that are not comparable, but only one of them limits any
    // given car -- so one channel can hold both.
    const t = mapLmuTelemetry(fixture());
    const value = t.LmuCarIdxEnergyRemaining?.value ?? [];
    // Car 0 runs on energy, so its full fuel byte is ignored.
    expect(value[0]).toBe(0.42);
    // Car 1 has no energy, so its fuel byte is what counts.
    expect(value[1]).toBeCloseTo(51 / 255, 6);
    // Car 2 reports neither, which is not an empty tank.
    expect(value[2]).toBe(-1);
  });

  it('says which budget each figure is', () => {
    // The figure alone cannot: 0.2 is a fifth of a tank or a fifth of a
    // stint's energy, and the column showing it is headed VE.
    const t = mapLmuTelemetry(fixture());
    expect(t.LmuCarIdxEnergyIsVirtual?.value).toEqual([true, false, false]);
  });

  it('keeps a drained energy car at zero rather than showing its fuel', () => {
    // A fuel-limited car reports a virtual energy of 0 all race, so 0 alone
    // cannot mean "out of energy". Having seen the car above 0 settles it --
    // which needs a state that outlives the frame.
    const state = createLmuEnergyState();
    const map = (raw: ReturnType<typeof fixture>) =>
      mapLmuTelemetry(
        raw,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        state
      );

    map(fixture());
    const drained = map({ ...fixture(), vehVirtualEnergy: [0, 0, 0] });

    // Car 0 still has a full tank and no energy to spend it with.
    expect(drained.LmuCarIdxEnergyRemaining?.value[0]).toBe(0);
    expect(drained.LmuCarIdxEnergyIsVirtual?.value[0]).toBe(true);
    // Car 1 never had energy, so nothing changes for it.
    expect(drained.LmuCarIdxEnergyRemaining?.value[1]).toBeCloseTo(51 / 255, 6);
    expect(drained.LmuCarIdxEnergyIsVirtual?.value[1]).toBe(false);
  });

  it('without a state, reads a car at zero energy as fuel-limited', () => {
    const drained = mapLmuTelemetry({
      ...fixture(),
      vehVirtualEnergy: [0, 0, 0],
    });
    expect(drained.LmuCarIdxEnergyRemaining?.value[0]).toBe(1);
    expect(drained.LmuCarIdxEnergyIsVirtual?.value[0]).toBe(false);
  });

  it('gives two tracks two session ids', () => {
    // The frame's id has to move with the session snapshot's, because the
    // consumers that detect a session change compare the two halves of the
    // same fact. LMU's own session number is the type and never moves here.
    const raw = fixture();
    const first = mapLmuTelemetry(raw).SessionUniqueID.value[0];
    const second = mapLmuTelemetry({
      ...raw,
      trackName: 'Circuit of the Americas',
    }).SessionUniqueID.value[0];

    expect(first).not.toBe(second);
    expect(mapLmuTelemetry(raw).SessionNum.value[0]).toBe(raw.session);
  });

  it('maps LMU race flags', () => {
    const base = fixture();
    expect(
      mapLmuTelemetry({ ...base, gamePhase: 5 }).SessionFlags.value[0]
    ).toBe(0);
    expect(
      mapLmuTelemetry({
        ...base,
        sectorFlags: new Uint8Array([0, 1, 0]),
      }).SessionFlags.value[0]
    ).toBe(8);
    expect(
      mapLmuTelemetry({ ...base, gamePhase: 8 }).SessionFlags.value[0]
    ).toBe(1);
    expect(
      mapLmuTelemetry({
        ...base,
        gamePhase: 5,
        sectorFlags: new Uint8Array([255, 0, 0]),
      }).SessionFlags.value[0]
    ).toBe(0);
    expect(
      mapLmuTelemetry({
        ...base,
        gamePhase: 5,
        vehFlag: new Uint8Array([0, 6, 0]),
      }).SessionFlags.value[0]
    ).toBe(32);
  });

  it.each([
    { gamePhase: 6, yellowFlagState: 0 },
    ...[1, 2, 3, 4, 5, 6].map((yellowFlagState) => ({
      gamePhase: 5,
      yellowFlagState,
    })),
  ])(
    'distinguishes full-course caution state %j from local yellows',
    (state) => {
      const mapped = mapLmuTelemetry({ ...fixture(), ...state });
      expect(mapped.SessionFlags.value[0]).toBe(
        GlobalFlags.Yellow | GlobalFlags.Caution
      );
    }
  );

  it.each([-1, 0, 7, 8])(
    'keeps sector yellows local with non-FCY yellow state %i',
    (yellowFlagState) => {
      const mapped = mapLmuTelemetry({
        ...fixture(),
        gamePhase: 5,
        yellowFlagState,
        sectorFlags: new Uint8Array([0, 1, 0]),
      });
      expect(mapped.SessionFlags.value[0]).toBe(GlobalFlags.Yellow);
    }
  );

  it('converts cumulative LMU sector times and invalid sentinels', () => {
    const times = mapLmuSectorTimes(32.4, 73.4, 133.4);
    expect(times[0]).toBeCloseTo(32.4);
    expect(times[1]).toBeCloseTo(41);
    expect(times[2]).toBeCloseTo(60);
    expect(mapLmuSectorTimes(-1, -1, -1)).toEqual([null, null, null]);
    expect(mapLmuSectorTimes(32.4, -1, 133.4)).toEqual([32.4, null, null]);
  });

  it('maps direct LMU sector timing telemetry', () => {
    const t = mapLmuTelemetry(fixture());
    expect(t.LmuSectorIdx?.value[0]).toBe(1);
    expect(t.LmuCurrentSectorTimes?.value[0]).toBeCloseTo(32.8);
    expect(t.LmuCurrentSectorTimes?.value[1]).toBeCloseTo(41.4);
    expect(t.LmuCurrentSectorTimes?.value[2]).toBeNull();
    expect(t.LmuLastSectorTimes?.value[0]).toBeCloseTo(32.4);
    expect(t.LmuLastSectorTimes?.value[1]).toBeCloseTo(41);
    expect(t.LmuLastSectorTimes?.value[2]).toBeCloseTo(60);
  });
});

describe('mapLmuTelemetry lap validity', () => {
  it("carries the sim's lap-void flag", () => {
    expect(mapLmuTelemetry(fixture()).LmuLapInvalidated?.value[0]).toBe(false);
    const voided = { ...fixture(), lapInvalidated: true } as LmuRawTelemetry;
    expect(mapLmuTelemetry(voided).LmuLapInvalidated?.value[0]).toBe(true);
  });

  it('reads an absent flag as a valid lap', () => {
    const raw = { ...fixture() } as LmuRawTelemetry;
    delete raw.lapInvalidated;
    expect(mapLmuTelemetry(raw).LmuLapInvalidated?.value[0]).toBe(false);
  });

  it('still reports no incident count, which LMU does not keep', () => {
    // The void flag is the replacement signal, not a synthetic incident
    // count: anything reading incidents for LMU would still see nothing.
    const voided = { ...fixture(), lapInvalidated: true } as LmuRawTelemetry;
    expect(mapLmuTelemetry(voided).PlayerCarMyIncidentCount.value[0]).toBe(0);
  });
});

describe('mapLmuTelemetry delta to best lap', () => {
  it("maps LMU's delta to the player's best lap once there is one", () => {
    const t = mapLmuTelemetry({ ...fixture(), deltaBest: -0.35 });
    expect(t.LapDeltaToSessionBestLap?.value[0]).toBe(-0.35);
    expect(t.LapDeltaToSessionBestLap_OK?.value[0]).toBe(true);
  });

  it('marks the delta invalid before the player has a best lap', () => {
    // LMU reports 0 then, which would otherwise read as dead level.
    const raw = fixture();
    const noBest = {
      ...raw,
      vehBestLapTime: raw.vehBestLapTime.map(() => -1),
      deltaBest: 0,
    } as LmuRawTelemetry;
    const t = mapLmuTelemetry(noBest);
    expect(t.LapDeltaToSessionBestLap_OK?.value[0]).toBe(false);
    expect(t.LapDeltaToSessionBestLap?.value[0]).toBe(0);
  });

  it('marks an absent or non-finite delta invalid', () => {
    const absent = { ...fixture() } as LmuRawTelemetry;
    delete absent.deltaBest;
    expect(mapLmuTelemetry(absent).LapDeltaToSessionBestLap_OK?.value[0]).toBe(
      false
    );
    expect(
      mapLmuTelemetry({ ...fixture(), deltaBest: Number.NaN })
        .LapDeltaToSessionBestLap_OK?.value[0]
    ).toBe(false);
  });
});

describe('mapLmuTelemetry lap-distance reconstruction', () => {
  it('advances the fraction between scoring updates', () => {
    // LMU only publishes lap distance at 5 Hz, so two polls 15 ms apart carry
    // a byte-identical scoring fraction. Without the integrator LapTrace's
    // sample buffer drops the second one.
    const state = createLmuLapDistanceState();
    const first = fixture();
    const second = fixture();
    second.elapsedTime = (first.elapsedTime ?? 0) + 0.015;

    const a = mapLmuTelemetry(first, state).LapDistPct?.value[0] as number;
    const b = mapLmuTelemetry(second, state).LapDistPct?.value[0] as number;

    expect(b).toBeGreaterThan(a);
  });

  it('smooths the player slot of CarIdxLapDistPct and no other', () => {
    // The per-car array feeds the blind-spot monitor and the relative-gap
    // processor. Only the player can be smoothed: per-car speed is not
    // exported, so there is nothing to integrate the others with.
    const state = createLmuLapDistanceState();
    const first = fixture();
    const second = fixture();
    second.elapsedTime = (first.elapsedTime ?? 0) + 0.015;

    mapLmuTelemetry(first, state);
    const t = mapLmuTelemetry(second, state);
    const perCar = t.CarIdxLapDistPct?.value as number[];

    // playerVehicleIdx is 1 in the fixture.
    expect(perCar[1]).toBe(t.LapDistPct?.value[0]);
    expect(perCar[1]).toBeGreaterThan(0.6);
    expect(perCar[0]).toBe(0.4);
    expect(perCar[2]).toBe(0.2);
  });

  it('leaves the per-car array alone when there is no integrator', () => {
    const t = mapLmuTelemetry(fixture());
    expect(t.CarIdxLapDistPct?.value).toEqual([0.4, 0.6, 0.2]);
  });

  it('is byte-identical to the raw scoring value without a state object', () => {
    const withoutState = mapLmuTelemetry(fixture());
    expect(withoutState.LapDistPct?.value[0]).toBe(0.6);
  });

  it('leaves the no-player path untouched even when given a state object', () => {
    // Spectating or in the garage there is no elapsedTime either, so feeding
    // the integrator would anchor it on a fabricated (pct 0, t -1) pair.
    const state = createLmuLapDistanceState();
    const raw = fixture();
    raw.playerHasVehicle = false;
    raw.playerVehicleIdx = -1;

    const bare = fixture();
    bare.playerHasVehicle = false;
    bare.playerVehicleIdx = -1;

    expect(mapLmuTelemetry(raw, state).LapDistPct?.value[0]).toBe(
      mapLmuTelemetry(bare).LapDistPct?.value[0]
    );
  });

  it('moves the lap counts in the frame LapDistPct wraps, not when the counters flip', () => {
    // LMU's counters flip at the timing line, here 20 m before scoring's
    // distance wraps. The fuel calculator pairs Lap with LapDistPct, and seeing
    // the counter and then the wrap left it ignoring live usage all lap; the
    // standings and race projections take lap plus fraction from CarIdxLap.
    const state = createLmuLapDistanceState();
    const lapDist = 7004;
    const speed = 51.234;
    const frameAt = (i: number) => {
      const raw = fixture();
      raw.speed = speed;
      const trueM = lapDist - 60 + speed * (i * 0.01);
      raw.elapsedTime = 250 + i * 0.01;
      raw.lapNumber = trueM >= lapDist - 20 ? 4 : 3;
      raw.vehTotalLaps = new Int32Array([2, raw.lapNumber, 1]);
      // Scoring updates every 200 ms with the true position.
      const scoringM = lapDist - 60 + speed * (Math.floor(i / 20) * 0.2);
      raw.vehLapDistPct = new Float64Array([
        0.4,
        (scoringM % lapDist) / lapDist,
        0.2,
      ]);
      return mapLmuTelemetry(raw, state);
    };

    let previousPct = -1;
    let previousLap = -1;
    let wraps = 0;
    for (let i = 0; i <= 200; i += 1) {
      const t = frameAt(i);
      const pct = t.LapDistPct?.value[0] as number;
      const lap = t.Lap?.value[0] as number;
      const wrapped = previousPct >= 0 && pct < previousPct - 0.5;
      if (wrapped) wraps += 1;
      if (previousLap >= 0) expect(lap !== previousLap).toBe(wrapped);
      // The completed counts move with it, for the player's slots too: one
      // behind the lap being driven.
      expect(t.LapCompleted?.value[0]).toBe(lap - 1);
      expect((t.CarIdxLap?.value as number[])[1]).toBe(lap);
      expect((t.CarIdxLapCompleted?.value as number[])[1]).toBe(lap - 1);
      previousPct = pct;
      previousLap = lap;
    }
    expect(wraps).toBe(1);
    // Four laps completed: on the fifth.
    expect(previousLap).toBe(5);
  });

  it('never publishes a backward step within a lap', () => {
    // A reversal reaches LapTrace as a dirty lap, which is then never promoted
    // to a reference -- silently. See lapDistance.spec.ts for the unit-level
    // property; this is the same invariant at the mapper boundary.
    const state = createLmuLapDistanceState();
    let previous = -Infinity;
    for (let i = 0; i < 200; i += 1) {
      const raw = fixture();
      raw.elapsedTime = 250.4 + i * 0.008;
      const value = mapLmuTelemetry(raw, state).LapDistPct?.value[0] as number;
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});

describe('mapLmuTelemetry session clock', () => {
  it('takes the clock from the 100 Hz telemetry block', () => {
    // Scoring's currentET only moves at 5 Hz, so LapTrace stamped every
    // sample inside a 200 ms window with an identical time.
    const raw = fixture();
    raw.currentET = 1250.5;
    raw.elapsedTime = 250.4;

    const t = mapLmuTelemetry(raw);

    expect(t.SessionTime?.value[0]).toBe(250.4);
    expect(t.SessionTick?.value[0]).toBe(250.4);
  });

  it('falls back to scoring when there is no player car', () => {
    // mElapsedTime is absent spectating and in the garage.
    const raw = fixture();
    raw.currentET = 1250.5;
    raw.elapsedTime = undefined;

    const t = mapLmuTelemetry(raw);

    expect(t.SessionTime?.value[0]).toBe(1250.5);
  });
});

describe('mapLmuTelemetry absent-value sentinels', () => {
  /**
   * Slot 0 as the addon really leaves a hole: every array keeps the zero it
   * was created with, except vehLapDistPct, which is explicitly filled -1.
   */
  const withHole = () => {
    const raw = fixture();
    const hole = <T>(values: T) => values;
    raw.vehLapDistPct = hole([
      -1, 0.6, 0.2,
    ]) as unknown as typeof raw.vehLapDistPct;
    raw.vehBestLapTime = hole([
      0, 132.8, 137.1,
    ]) as unknown as typeof raw.vehBestLapTime;
    raw.vehLastLapTime = hole([
      0, 133.4, 138.9,
    ]) as unknown as typeof raw.vehLastLapTime;
    raw.vehTotalLaps = hole([0, 3, 1]) as unknown as typeof raw.vehTotalLaps;
    raw.vehClass = hole([0, 0, 1]) as unknown as typeof raw.vehClass;
    return raw;
  };

  it('reports an empty slot as absent, not as zero', () => {
    // The addon sizes per-car arrays to max(mID)+1 and writes only real cars,
    // so a hole keeps the zero the array was created with. formatTime renders
    // 0 as "0:00.000" and only treats a negative as absent, which is why an
    // empty slot used to show a lap time of zero in the standings.
    const t = mapLmuTelemetry(withHole());

    expect((t.CarIdxBestLapTime?.value as number[])[0]).toBe(-1);
    expect((t.CarIdxLastLapTime?.value as number[])[0]).toBe(-1);
    expect((t.CarIdxLap?.value as number[])[0]).toBe(-1);
    expect((t.CarIdxLapCompleted?.value as number[])[0]).toBe(-1);
    expect((t.CarIdxClass?.value as number[])[0]).toBe(-1);
    expect((t.CarIdxTrackSurface?.value as number[])[0]).toBe(-1);
  });

  it('leaves real cars in the same frame untouched', () => {
    const t = mapLmuTelemetry(withHole());

    expect((t.CarIdxBestLapTime?.value as number[])[1]).toBe(132.8);
    expect((t.CarIdxLastLapTime?.value as number[])[2]).toBe(138.9);
    expect((t.CarIdxLapCompleted?.value as number[])[1]).toBe(3);
    expect((t.CarIdxLap?.value as number[])[1]).toBe(4);
    expect((t.CarIdxClass?.value as number[])[2]).toBe(1);
    // Occupied cars keep a real class of 0 -- only the hole is sentinelled.
    expect((t.CarIdxClass?.value as number[])[1]).toBe(0);
  });

  it('keeps a real zero lap count but not a zero lap time', () => {
    // The two fields need different rules. A car on its first lap genuinely
    // has 0 completed laps, and turning that into the -1 of an empty slot
    // would corrupt the lap-gap arithmetic. A lap time of 0 is never real,
    // so it is absent whoever wrote it.
    const raw = fixture();
    raw.vehTotalLaps = [0, 3, 1] as unknown as typeof raw.vehTotalLaps;
    raw.vehBestLapTime = [
      0, 132.8, 137.1,
    ] as unknown as typeof raw.vehBestLapTime;

    const t = mapLmuTelemetry(raw);

    expect((t.CarIdxLapCompleted?.value as number[])[0]).toBe(0);
    // And it is on its first lap.
    expect((t.CarIdxLap?.value as number[])[0]).toBe(1);
    expect((t.CarIdxBestLapTime?.value as number[])[0]).toBe(-1);
  });

  it('keeps a car short of the line level with one just over it', () => {
    // A rolling start: LMU holds the lap fraction at exactly 0 until a car
    // reaches the line. Lap plus fraction is how the standings and the
    // relative tell who is ahead, so that car is on lap one too -- counted
    // as on no lap, it was a whole lap behind the car in front of it.
    const raw = fixture();
    raw.vehTotalLaps = [0, 0, 0] as unknown as typeof raw.vehTotalLaps;
    raw.vehLapDistPct = new Float64Array([0, 0, 0.004]);

    const t = mapLmuTelemetry(raw);

    expect(t.CarIdxLap?.value).toEqual([1, 1, 1]);
    expect(t.CarIdxLapCompleted?.value).toEqual([0, 0, 0]);
    const laps = t.CarIdxLap?.value as number[];
    const pcts = t.CarIdxLapDistPct?.value as number[];
    expect(laps[2] + pcts[2] - (laps[0] + pcts[0])).toBeCloseTo(0.004, 9);
    // The player is the car in slot 1.
    expect(t.Lap?.value[0]).toBe(1);
    expect(t.LapCompleted?.value[0]).toBe(0);
  });

  it('keeps an empty slot off every lap', () => {
    const t = mapLmuTelemetry(withHole());
    expect((t.CarIdxLap?.value as number[])[0]).toBe(-1);
    expect((t.CarIdxLapCompleted?.value as number[])[0]).toBe(-1);
  });

  it('reports the player as absent when there is no player car', () => {
    const raw = fixture();
    raw.playerHasVehicle = false;
    raw.playerVehicleIdx = -1;

    const t = mapLmuTelemetry(raw);

    expect(t.LapBestLapTime?.value[0]).toBe(-1);
    expect(t.LapLastLapTime?.value[0]).toBe(-1);
    expect(t.PlayerTrackSurface?.value[0]).toBe(-1);
  });

  it('leaves the gap fields at zero, which is what iRacing uses there', () => {
    // CarIdxF2Time and CarIdxEstTime are 0-for-absent in iRacing's own
    // telemetry, so a sentinel here would be the bug.
    const t = mapLmuTelemetry(withHole());

    expect((t.CarIdxF2Time?.value as number[])[0]).toBe(0);
    expect((t.CarIdxEstTime?.value as number[])[0]).toBe(50);
  });
});

describe('mapLmuTelemetry fuel', () => {
  it('derives the fraction from litres and capacity', () => {
    const t = mapLmuTelemetry(fixture());
    expect(t.FuelLevel?.value[0]).toBe(42);
    expect(t.FuelLevelPct?.value[0]).toBeCloseTo(42 / 110);
  });

  it('publishes no fuel level when the player has no car', () => {
    // At the monitor the sim writes no fuel. A 0 here was drawn as "0.0 L",
    // an empty tank nobody has.
    const raw = fixture();
    raw.fuel = undefined;

    const t = mapLmuTelemetry(raw);

    expect(t.FuelLevel).toBeUndefined();
    expect(t.FuelLevelPct?.value[0]).toBe(0);
  });

  it('reports zero rather than a wrong fraction when capacity is unknown', () => {
    // Nothing better is expressible here: the fuel processor coerces a
    // missing value to 0 on its way out and FuelProjectionSnapshot requires
    // a number, so absence cannot cross that boundary. The fuel calculator
    // only trusts a fraction between 0.01 and 0.99, so a 0 makes it estimate
    // the tank -- which is exactly what it would do for an absent value.
    const raw = fixture();
    raw.fuelCapacity = undefined;

    const t = mapLmuTelemetry(raw);

    expect(t.FuelLevel?.value[0]).toBe(42);
    expect(t.FuelLevelPct?.value[0]).toBe(0);
  });

  it('does not divide by a zero capacity', () => {
    const raw = fixture();
    raw.fuelCapacity = 0;

    const t = mapLmuTelemetry(raw);

    expect(t.FuelLevelPct?.value[0]).toBe(0);
    expect(Number.isFinite(t.FuelLevelPct?.value[0] as number)).toBe(true);
  });
});

describe('mapLmuTelemetry session lap limit', () => {
  /** Session ids below 10 are practice and qualifying; 10 and up are races. */
  const RACE = 10;

  it('counts down the laps of a lap-limited race', () => {
    const raw = fixture();
    raw.session = RACE;

    const t = mapLmuTelemetry(raw);

    // maxLaps 12, and the player (index 1) has completed 3.
    expect(t.SessionLapsTotal?.value[0]).toBe(12);
    expect(t.SessionLapsRemain?.value[0]).toBe(9);
  });

  it('reports no lap limit in practice and qualifying', () => {
    // The bug this fixes: mMaxLaps is not a lap count in a timed session, and
    // passing it through made the fuel calculator cap it at 1000 laps and ask
    // for thousands of litres.
    for (const session of [0, 1, 5, 8]) {
      const raw = fixture();
      raw.session = session;

      const t = mapLmuTelemetry(raw);

      expect(t.SessionLapsRemain?.value[0]).toBe(TIMED_SESSION_LAPS);
      expect(t.SessionLapsTotal?.value[0]).toBe(TIMED_SESSION_LAPS);
    }
  });

  it('reports no lap limit for a timed race', () => {
    // An endurance race is a race, but still has no lap limit. rF2 signals
    // that with a value far beyond any real race.
    const raw = fixture();
    raw.session = RACE;
    raw.maxLaps = 2147483647;

    const t = mapLmuTelemetry(raw);

    expect(t.SessionLapsRemain?.value[0]).toBe(TIMED_SESSION_LAPS);
    expect(t.SessionLapsTotal?.value[0]).toBe(TIMED_SESSION_LAPS);
  });

  it('reports no lap limit when a race reports zero laps', () => {
    const raw = fixture();
    raw.session = RACE;
    raw.maxLaps = 0;

    const t = mapLmuTelemetry(raw);

    expect(t.SessionLapsRemain?.value[0]).toBe(TIMED_SESSION_LAPS);
  });

  it('never reports a negative remaining count', () => {
    // Past the limit on the last lap.
    const raw = fixture();
    raw.session = RACE;
    raw.maxLaps = 2;

    const t = mapLmuTelemetry(raw);

    expect(t.SessionLapsRemain?.value[0]).toBe(0);
  });
});

describe('mapLmuTelemetry brake bias', () => {
  /**
   * LMU publishes only mRearBrakeBias, as a 0-1 fraction; there is no
   * mFrontBrakeBias, front is simply its complement. dcBrakeBias is percent
   * front, which is how the widget formats it, so the complement has to be
   * scaled -- otherwise a 50.8:49.2 split in LMU's own UI showed as "0.5%"
   * and looked frozen as it was adjusted.
   */
  it('reports percent front, matching the split LMU shows', () => {
    const raw = { ...fixture(), rearBrakeBias: 0.492 };

    const t = mapLmuTelemetry(raw);

    expect(t.dcBrakeBias.value[0]).toBeCloseTo(50.8, 4);
  });

  it('does not publish the bias a second time as a rear brake valve', () => {
    // It used to, which put a Rear Brake Valve column on screen reading the
    // same percentage as the Brake Bias column next to it.
    const t = mapLmuTelemetry({ ...fixture(), rearBrakeBias: 0.492 });

    expect(t.dcPeakBrakeBias).toBeUndefined();
  });

  it('moves a full point of bias as a full point', () => {
    const forward = mapLmuTelemetry({ ...fixture(), rearBrakeBias: 0.46 });
    const back = mapLmuTelemetry({ ...fixture(), rearBrakeBias: 0.47 });

    expect(
      (forward.dcBrakeBias.value[0] as number) -
        (back.dcBrakeBias.value[0] as number)
    ).toBeCloseTo(1, 4);
  });

  it('reports no bias when the sim omits it', () => {
    // Absent, not 0: with no player car the sim writes no bias, and Car
    // Systems keeps the last reading of a value that stops being published.
    const t = mapLmuTelemetry({ ...fixture(), rearBrakeBias: undefined });

    expect(t.dcBrakeBias).toBeUndefined();
  });
});

describe('mapLmuTelemetry REST channels', () => {
  it('omits the channels entirely when no REST data is supplied', () => {
    // What keeps iRacing and every pre-existing spec unaffected: absent, not
    // present-and-zero.
    const t = mapLmuTelemetry(fixture());

    expect(t.LmuPitStopTime).toBeUndefined();
    expect(t.LmuRepairTime).toBeUndefined();
  });

  it('publishes the cells it is given', () => {
    const t = mapLmuTelemetry(fixture(), undefined, undefined, {
      pitStopTime: { value: [32.5] },
      repairTime: { value: [12.25] },
    });

    expect(t.LmuPitStopTime?.value[0]).toBe(32.5);
    expect(t.LmuRepairTime?.value[0]).toBe(12.25);
  });

  it('hands the cell over by reference rather than copying it', () => {
    // The zero-allocation read path depends on this. The poller replaces a
    // cell on change, so there is nothing to clone per frame.
    const cell = { value: [32.5] } as const;
    const t = mapLmuTelemetry(fixture(), undefined, undefined, {
      pitStopTime: cell,
    });

    expect(t.LmuPitStopTime).toBe(cell);
  });

  it('publishes only the cells present, leaving the rest absent', () => {
    const t = mapLmuTelemetry(fixture(), undefined, undefined, {
      repairTime: { value: [5] },
    });

    expect(t.LmuPitStopTime).toBeUndefined();
    expect(t.LmuRepairTime?.value[0]).toBe(5);
  });

  it('publishes the pit stop, wear and setup cells under their frame keys', () => {
    const cells = {
      pitStopParts: { value: [4.27, 2.5, 0, 0, 0, 0, 0, 0] },
      refuelRatio: { value: [1.03] },
      repairChoice: { value: ['Repair Body'] },
      brakeThickness: { value: [35.99, 35.99, 31.99, 31.99] },
      wearablesSeq: { value: [12] },
      steerLockDeg: { value: [476] },
    } as const;

    const t = mapLmuTelemetry(fixture(), undefined, undefined, cells);

    // By reference, like every REST cell.
    expect(t.LmuPitStopParts).toBe(cells.pitStopParts);
    expect(t.LmuRefuelRatio).toBe(cells.refuelRatio);
    expect(t.LmuRepairChoice).toBe(cells.repairChoice);
    expect(t.LmuBrakeThickness).toBe(cells.brakeThickness);
    expect(t.LmuRestWearablesSeq).toBe(cells.wearablesSeq);
    expect(t.LmuSteerLockDeg).toBe(cells.steerLockDeg);
  });

  it('leaves those keys absent without their cells', () => {
    const t = mapLmuTelemetry(fixture(), undefined, undefined, {});

    expect(t.LmuPitStopParts).toBeUndefined();
    expect(t.LmuRefuelRatio).toBeUndefined();
    expect(t.LmuRepairChoice).toBeUndefined();
    expect(t.LmuBrakeThickness).toBeUndefined();
    expect(t.LmuRestWearablesSeq).toBeUndefined();
    expect(t.LmuSteerLockDeg).toBeUndefined();
  });

  it('falls back to the repair screen for the stop time, and only then', () => {
    // The estimate path's total is the figure; the repair screen states the
    // same stop and stands in while the estimate has not answered.
    const length = { value: [2.4207] } as const;
    const total = { value: [2.4206] } as const;

    const fallback = mapLmuTelemetry(fixture(), undefined, undefined, {
      pitStopLength: length,
    });
    const both = mapLmuTelemetry(fixture(), undefined, undefined, {
      pitStopTime: total,
      pitStopLength: length,
    });

    expect(fallback.LmuPitStopTime).toBe(length);
    expect(both.LmuPitStopTime).toBe(total);
  });
});

describe('mapLmuTelemetry virtual energy', () => {
  it('publishes the shared-memory energy channels', () => {
    const t = mapLmuTelemetry({
      ...fixture(),
      virtualEnergy: 0.62,
      stateOfCharge: 0.4,
      regen: 0.1,
    });

    expect(t.LmuVirtualEnergy?.value[0]).toBeCloseTo(0.62, 5);
    expect(t.LmuStateOfCharge?.value[0]).toBeCloseTo(0.4, 5);
    expect(t.LmuRegen?.value[0]).toBeCloseTo(0.1, 5);
  });

  it('publishes a zero rather than treating it as absent', () => {
    // A car with no hybrid system reports 0, and that is a real reading. Only
    // a tape or a pre-export build omits the field entirely.
    const t = mapLmuTelemetry({ ...fixture(), virtualEnergy: 0 });

    expect(t.LmuVirtualEnergy?.value[0]).toBe(0);
  });

  it('omits the channels when the addon does not export them', () => {
    const t = mapLmuTelemetry({
      ...fixture(),
      virtualEnergy: undefined,
      stateOfCharge: undefined,
      regen: undefined,
    });

    expect(t.LmuVirtualEnergy).toBeUndefined();
    expect(t.LmuStateOfCharge).toBeUndefined();
    expect(t.LmuRegen).toBeUndefined();
  });
});

describe('mapLmuTelemetry class position', () => {
  it('ranks a practice session by best lap time, within class', () => {
    // Session 1 is practice. Best laps are 134.5, 132.8, 137.1 and the classes
    // are [0, 0, 1], so slot 1 leads class 0 ahead of slot 0, and slot 2 is
    // alone in class 1.
    const t = mapLmuTelemetry(fixture());
    const positions = t.CarIdxClassPosition.value as number[];

    expect(positions).toEqual([2, 1, 1]);
  });

  it('does not simply echo the slot order', () => {
    // The symptom this guards: a column counting 1,2,3 down the car list
    // regardless of who is quickest.
    const t = mapLmuTelemetry(fixture());
    const positions = t.CarIdxClassPosition.value as number[];

    expect(positions).not.toEqual([1, 2, 3]);
  });

  it('publishes a non-empty array, so the fallback is not reached', () => {
    // Empty means useDriverPositions falls through to the qualifying grid,
    // which under LMU practice is entry order.
    const t = mapLmuTelemetry(fixture());

    expect((t.CarIdxClassPosition.value as number[]).length).toBeGreaterThan(0);
  });
});

describe('mapLmuTelemetry outright position', () => {
  it('orders practice by best lap, not by the entry order LMU reports', () => {
    // The symptom: the standings sort rows on CarIdxPosition, so while this
    // echoed mPlace the class column was right and the list still read as
    // car-number order. Fixture best laps are 134.5, 132.8, 137.1.
    const t = mapLmuTelemetry(fixture());

    expect(t.CarIdxPosition.value).toEqual([2, 1, 3]);
  });

  it('keeps the sim-reported places in a race', () => {
    // mPlace already accounts for laps completed and sector order, which a
    // best-lap sort would throw away.
    const raw = {
      ...fixture(),
      session: 10,
      vehPlaces: new Int32Array([3, 1, 2]),
    };

    const t = mapLmuTelemetry(raw);

    expect(t.CarIdxPosition.value).toEqual([3, 1, 2]);
  });

  it('agrees with the class column about who is ahead', () => {
    // Both come from one ordering pass, so they cannot disagree.
    const t = mapLmuTelemetry(fixture());
    const outright = t.CarIdxPosition.value as number[];
    const inClass = t.CarIdxClassPosition.value as number[];

    // Slot 1 leads class 0 and is also outright first.
    expect(inClass[1]).toBe(1);
    expect(outright[1]).toBe(1);
    expect(outright[0]).toBeGreaterThan(outright[1]);
  });
});

describe('mapLmuTelemetry adjustable dials', () => {
  // Several of these dc* channels are absent from the generated Telemetry
  // type, which covers only the variables iRacing's own capture listed.
  // CarSystemsProcessor reads them by string key, so this does too.
  const dial = (t: ReturnType<typeof mapLmuTelemetry>, key: string) =>
    (t as unknown as Record<string, { value: unknown[] } | undefined>)[key];

  it('publishes a dial the car has', () => {
    const t = mapLmuTelemetry({
      ...fixture(),
      abs: 4,
      absMax: 10,
      motorMap: 3,
      motorMapMax: 9,
      frontAntiSway: 2,
      frontAntiSwayMax: 5,
      rearAntiSway: 1,
      rearAntiSwayMax: 5,
    });

    expect(dial(t, 'dcABS')?.value[0]).toBe(4);
    expect(dial(t, 'LmuMotorMap')?.value[0]).toBe(3);
    expect(dial(t, 'dcAntiRollFront')?.value[0]).toBe(2);
    expect(dial(t, 'dcAntiRollRear')?.value[0]).toBe(1);
  });

  it('publishes the map under its own key, not as engine power', () => {
    // The recorded LMGT3: two positions, so a maximum of 1. It used to be
    // dcEnginePower, which the catalogue calls Engine Power.
    const t = mapLmuTelemetry({ ...fixture(), motorMap: 1, motorMapMax: 1 });

    expect(dial(t, 'LmuMotorMap')?.value[0]).toBe(1);
    expect(dial(t, 'dcEnginePower')).toBeUndefined();
  });

  it('omits a dial the car does not have', () => {
    // Setting and max both zero is how LMU reports a control that is not
    // fitted. Publishing it would give the car a row reading "off" forever,
    // and the row is latched for the session once discovered.
    const t = mapLmuTelemetry({ ...fixture(), abs: 0, absMax: 0 });

    expect(dial(t, 'dcABS')).toBeUndefined();
  });

  it('keeps a dial the driver has switched off', () => {
    const t = mapLmuTelemetry({ ...fixture(), abs: 0, absMax: 10 });

    expect(dial(t, 'dcABS')?.value[0]).toBe(0);
  });

  it('gives each of the three traction dials a key of its own', () => {
    // The recorded LMGT3 has all three, each topping out at 11. Packed into
    // iRacing's two generic slots, its power cut was dropped.
    const t = mapLmuTelemetry({
      ...fixture(),
      tc: 6,
      tcMax: 11,
      tcSlip: 7,
      tcSlipMax: 11,
      tcCut: 5,
      tcCutMax: 11,
    });

    expect(dial(t, 'dcTractionControl')?.value[0]).toBe(6);
    expect(dial(t, 'LmuTcSlip')?.value[0]).toBe(7);
    expect(dial(t, 'LmuTcCut')?.value[0]).toBe(5);
    expect(dial(t, 'dcTractionControl2')).toBeUndefined();
  });

  it('does not show a slip dial as the traction control level', () => {
    // A car offering only slip and cut used to have its slip dial published
    // as dcTractionControl, the first free slot.
    const t = mapLmuTelemetry({
      ...fixture(),
      tcSlip: 3,
      tcSlipMax: 6,
      tcCut: 2,
      tcCutMax: 6,
    });

    expect(dial(t, 'LmuTcSlip')?.value[0]).toBe(3);
    expect(dial(t, 'LmuTcCut')?.value[0]).toBe(2);
    expect(dial(t, 'dcTractionControl')).toBeUndefined();
    expect(dial(t, 'dcTractionControl2')).toBeUndefined();
  });

  it('publishes no traction row for a car with no traction control', () => {
    const t = mapLmuTelemetry({ ...fixture(), tcMax: 0 });

    expect(dial(t, 'dcTractionControl')).toBeUndefined();
    expect(dial(t, 'dcTractionControl2')).toBeUndefined();
    expect(dial(t, 'LmuTcSlip')).toBeUndefined();
    expect(dial(t, 'LmuTcCut')).toBeUndefined();
  });

  it('publishes brake migration only on a car that has the dial', () => {
    const without = mapLmuTelemetry({
      ...fixture(),
      migration: 0,
      migrationMax: 0,
    });
    expect(dial(without, 'LmuBrakeMigration')).toBeUndefined();

    // Position 0 of a dial the car has is a reading, and is published as one.
    const atZero = mapLmuTelemetry({
      ...fixture(),
      migration: 0,
      migrationMax: 8,
    });
    expect(dial(atZero, 'LmuBrakeMigration')?.value).toEqual([0]);
  });

  it('states the top of every scale, in the order of LMU_DIAL_KEYS', () => {
    const t = mapLmuTelemetry({
      ...fixture(),
      absMax: 9,
      tcMax: 11,
      tcSlipMax: 11,
      tcCutMax: 11,
      migrationMax: 0,
      motorMapMax: 1,
      frontAntiSwayMax: 7,
      rearAntiSwayMax: 7,
    });

    expect(LMU_DIAL_KEYS).toEqual([
      'dcABS',
      'dcTractionControl',
      'LmuTcSlip',
      'LmuTcCut',
      'LmuBrakeMigration',
      'LmuMotorMap',
      'dcAntiRollFront',
      'dcAntiRollRear',
    ]);
    expect(t.LmuDialMax?.value).toEqual([9, 11, 11, 11, 0, 1, 7, 7]);
  });

  it('keeps one cell for the maxima until one of them changes', () => {
    // Fixed per car, so a frame allocates nothing for them.
    const car = { ...fixture(), absMax: 9, tcMax: 11, motorMapMax: 1 };
    const first = mapLmuTelemetry({ ...car, abs: 9 });
    const second = mapLmuTelemetry({ ...car, abs: 8 });

    expect(second.LmuDialMax).toBe(first.LmuDialMax);

    const otherCar = mapLmuTelemetry({ ...car, absMax: 0 });
    expect(otherCar.LmuDialMax).not.toBe(first.LmuDialMax);
    expect(otherCar.LmuDialMax?.value[0]).toBe(0);
    // The cell already handed out is left as it was.
    expect(first.LmuDialMax?.value[0]).toBe(9);
  });

  it('publishes no dials, maxima or lights without a player car', () => {
    // The sim writes none of the fields then, and absent is not zero.
    const t = mapLmuTelemetry({
      ...fixture(),
      wiperState: undefined,
      tcActive: undefined,
    });

    expect(t.LmuDialMax).toBeUndefined();
    expect(t.LmuWiper).toBeUndefined();
    expect(t.LmuTcActive).toBeUndefined();
    expect(dial(t, 'dcABS')).toBeUndefined();
  });

  it('publishes the wiper state and the traction control light', () => {
    const t = mapLmuTelemetry({ ...fixture(), wiperState: 1, tcActive: true });

    expect(t.LmuWiper?.value).toEqual([1]);
    expect(t.LmuTcActive?.value).toEqual([true]);
    expect(
      mapLmuTelemetry({ ...fixture(), tcActive: false }).LmuTcActive?.value
    ).toEqual([false]);
  });
});

describe('mapLmuTelemetry penalty kinds', () => {
  const channels = {
    kind: { value: [0, 1, 2, 3] },
    penaltySeconds: { value: [0, 0, 0, 30] },
  };

  const mapped = () =>
    mapLmuTelemetry(
      fixture(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      channels
    );

  it('publishes the per-car cells the caller built', () => {
    const t = mapped();
    expect(t.LmuCarIdxPenaltyKind?.value).toEqual([0, 1, 2, 3]);
    expect(t.LmuCarIdxPenaltySeconds?.value).toEqual([0, 0, 0, 30]);
  });

  it('hands the cells over by reference rather than copying them', () => {
    // The loop runs every 8 ms. A copy per frame is an allocation per frame,
    // for a value that changes a handful of times a session.
    expect(mapped().LmuCarIdxPenaltyKind?.value).toBe(channels.kind.value);
  });

  it('leaves both channels absent when nothing is known', () => {
    // The websocket is the only source of a kind, so a build or a moment
    // without it publishes nothing rather than a grid of zeroes -- which
    // every consumer would read as "known clean".
    const t = mapLmuTelemetry(fixture());
    expect(t.LmuCarIdxPenaltyKind).toBeUndefined();
    expect(t.LmuCarIdxPenaltySeconds).toBeUndefined();
  });

  it('still publishes the count, which comes from scoring', () => {
    expect(
      Array.isArray(mapLmuTelemetry(fixture()).LmuCarIdxPenalties?.value)
    ).toBe(true);
  });
});

describe('mapLmuTelemetry finish status', () => {
  it("publishes each car's mFinishStatus as it stands", () => {
    // 0 none, 1 finished, 2 DNF, 3 DQ: the codes go out unchanged and the
    // renderer names them.
    const raw = { ...fixture(), vehFinishStatus: Int32Array.from([1, 2, 3]) };
    expect(mapLmuTelemetry(raw).LmuCarIdxFinishStatus?.value).toEqual([
      1, 2, 3,
    ]);
  });

  it('still raises Disqualify for a DQ, which race control reads', () => {
    const raw = { ...fixture(), vehFinishStatus: Int32Array.from([0, 0, 3]) };
    const flags = mapLmuTelemetry(raw).CarIdxSessionFlags.value as number[];
    expect(flags[2] & 0x00020000).toBe(0x00020000);
  });
});

describe('mapLmuTelemetry spectator focus', () => {
  const cells = (focus?: number) =>
    focus === undefined ? {} : { focusCarIdx: { value: [focus] } };

  const camCarIdx = (focus?: number, raw = fixture()) =>
    mapLmuTelemetry(raw, undefined, undefined, cells(focus)).CamCarIdx
      ?.value[0];

  it('follows the spectator camera', () => {
    // Every processor derives its focus from CamCarIdx, so this one channel
    // is the whole of following the camera.
    expect(camCarIdx(2)).toBe(2);
  });

  it('focuses slot 0 when the camera is on the first car', () => {
    expect(camCarIdx(0)).toBe(0);
  });

  it('falls back to the player when nothing is focused', () => {
    const playerIdx = mapLmuTelemetry(fixture()).PlayerCarIdx?.value[0];
    expect(camCarIdx(-1)).toBe(playerIdx);
    expect(camCarIdx(undefined)).toBe(playerIdx);
  });

  it('leaves the player index alone, which is a different fact', () => {
    // iRacing keeps DriverCarIdx and CamCarIdx apart; so do we. Fuel, inputs
    // and sector times stay the player's.
    const t = mapLmuTelemetry(fixture(), undefined, undefined, cells(2));
    expect(t.PlayerCarIdx?.value[0]).not.toBe(2);
  });

  it('focuses the watched car even with no player car at all', () => {
    // The case this exists for: while spectating, playerHasVehicle is false,
    // so the player index is -1 and there is nothing to fall back to.
    const spectating = { ...fixture(), playerHasVehicle: false };
    expect(camCarIdx(2, spectating as never)).toBe(2);
    expect(camCarIdx(undefined, spectating as never)).toBe(-1);
  });
});

describe('the session clock, the length of a race and the pit limiter', () => {
  const withClock = (
    raw: LmuRawTelemetry,
    clockState: ReturnType<typeof createLmuSessionClockState>
  ) =>
    mapLmuTelemetry(
      raw,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      clockState
    );
  const timeOf = (frame: ReturnType<typeof mapLmuTelemetry>) =>
    frame.SessionTime?.value?.[0] as unknown as number;

  it('does not run the clock backwards when the player leaves the car', () => {
    // In the car the clock is the player's own, a little ahead of scoring's.
    // Without a car there is only scoring's, and stepping back to it is what
    // made every trip to the monitor look like a restarted session.
    const clockState = createLmuSessionClockState();
    const inCar = withClock(
      { ...fixture(), elapsedTime: 1250.653, currentET: 1250.5 },
      clockState
    );
    expect(timeOf(inCar)).toBe(1250.653);

    const atMonitor = withClock(
      {
        ...fixture(),
        playerHasVehicle: false,
        elapsedTime: undefined,
        currentET: 1250.5,
      },
      clockState
    );
    expect(timeOf(atMonitor)).toBe(1250.653);
    expect(atMonitor.SessionTick?.value?.[0]).toBe(1250.653);

    const later = withClock(
      {
        ...fixture(),
        playerHasVehicle: false,
        elapsedTime: undefined,
        currentET: 1250.9,
      },
      clockState
    );
    expect(timeOf(later)).toBe(1250.9);
  });

  it('keeps to the snapshot’s own clock with no memory to hold it by', () => {
    const frame = mapLmuTelemetry({
      ...fixture(),
      playerHasVehicle: false,
      elapsedTime: undefined,
      currentET: 1250.5,
    });
    expect(timeOf(frame)).toBe(1250.5);
  });

  it('measures a race from its green flag, not from the grid', () => {
    // The session clock starts on the grid. The race here goes green at
    // 135 s and ends at 1035: fifteen minutes, not seventeen and a quarter.
    const clockState = createLmuSessionClockState();
    const race = { ...fixture(), session: 10, endET: 1035 };
    const total = (gamePhase: number, elapsedTime: number) =>
      withClock(
        { ...race, gamePhase, elapsedTime, currentET: elapsedTime },
        clockState
      ).SessionTimeTotal?.value?.[0];

    expect(total(4, 120)).toBe(1035);
    expect(total(5, 135)).toBe(900);
    expect(total(5, 600)).toBe(900);
  });

  it('gives a practice session its end time for a length', () => {
    const clockState = createLmuSessionClockState();
    const frame = withClock(
      { ...fixture(), session: 1, endET: 3600 },
      clockState
    );
    expect(frame.SessionTimeTotal?.value?.[0]).toBe(3600);
  });

  it('reports the pit limiter where the pit lane helper looks for it', () => {
    const off = mapLmuTelemetry({ ...fixture(), speedLimiter: 0 });
    const on = mapLmuTelemetry({ ...fixture(), speedLimiter: 1 });
    expect(off.EngineWarnings?.value?.[0]).toBe(0);
    // EngineWarnings.PitSpeedLimiter.
    expect(on.EngineWarnings?.value?.[0]).toBe(0x10);
  });
});

describe('the last lap of a car whose lap did not count', () => {
  const withLapStarts = (
    raw: LmuRawTelemetry,
    lapStartState: ReturnType<typeof createLmuLapStartState>
  ) =>
    mapLmuTelemetry(
      raw,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      lapStartState
    );

  it('is timed from the lap’s start to the next one’s', () => {
    // The player, in slot 1, cuts the track: the sim gives the lap no time.
    // It still took 93.4 s, and that is the last lap in the standings and in
    // the pace of the laps before.
    const lapStartState = createLmuLapStartState();
    const raw = fixture();
    withLapStarts(
      { ...raw, vehLapStartET: new Float64Array([1100, 1101, 1102]) },
      lapStartState
    );
    const after = withLapStarts(
      {
        ...raw,
        vehLapStartET: new Float64Array([1100, 1194.4, 1102]),
        vehLastLapTime: new Float64Array([133.4, -1, 138.9]),
      },
      lapStartState
    );

    const lastLaps = after.CarIdxLastLapTime?.value as number[];
    expect(lastLaps[1]).toBeCloseTo(93.4, 9);
    expect(after.LapLastLapTime?.value[0]).toBeCloseTo(93.4, 9);
    // A lap the sim did time keeps the sim's figure.
    expect(lastLaps[0]).toBe(133.4);
    expect(lastLaps[2]).toBe(138.9);
  });

  it('is left without a time where there is nothing to measure it by', () => {
    const raw = {
      ...fixture(),
      vehLastLapTime: new Float64Array([133.4, -1, 0]),
    };
    expect(mapLmuTelemetry(raw).CarIdxLastLapTime?.value).toEqual([
      133.4, -1, -1,
    ]);
    const first = withLapStarts(raw, createLmuLapStartState());
    expect(first.CarIdxLastLapTime?.value).toEqual([133.4, -1, -1]);
  });

  it('is marked as a lap that did not count, for as long as it is the last', () => {
    const lapStartState = createLmuLapStartState();
    const raw = fixture();
    const before = withLapStarts(
      { ...raw, vehLapStartET: new Float64Array([1100, 1101, 1102]) },
      lapStartState
    );
    // Every car has a time from the sim: nothing is marked.
    expect(before.LmuCarIdxLastLapInvalid?.value).toEqual([
      false,
      false,
      false,
    ]);

    // The player, in slot 1, cuts the track. The sim's time is not above 0
    // and the measured lap stands in its place.
    const cut = {
      ...raw,
      vehLapStartET: new Float64Array([1100, 1194.4, 1102]),
      vehLastLapTime: new Float64Array([133.4, -1, 138.9]),
    };
    const after = withLapStarts(cut, lapStartState);
    expect(after.LmuCarIdxLastLapInvalid?.value).toEqual([false, true, false]);
    // Still the last lap a frame later.
    expect(
      withLapStarts(cut, lapStartState).LmuCarIdxLastLapInvalid?.value?.[1]
    ).toBe(true);

    // The next lap is timed by the sim, and the mark goes with the old one.
    const clean = withLapStarts(
      {
        ...raw,
        vehLapStartET: new Float64Array([1100, 1287.2, 1102]),
        vehLastLapTime: new Float64Array([133.4, 92.8, 138.9]),
      },
      lapStartState
    );
    expect(clean.LmuCarIdxLastLapInvalid?.value?.[1]).toBe(false);
  });

  it('is not marked before any lap, when the sim has no time and none is measured', () => {
    // A car's first lap of a session: the sim reports no last lap, as it
    // does for a lap that did not count, but nothing was driven to measure.
    const raw = {
      ...fixture(),
      vehLastLapTime: new Float64Array([0, -1, 0]),
    };
    expect(
      withLapStarts(raw, createLmuLapStartState()).LmuCarIdxLastLapInvalid
        ?.value
    ).toEqual([false, false, false]);
    // And without the lap-start state at all, as a caller that keeps none.
    expect(mapLmuTelemetry(raw).LmuCarIdxLastLapInvalid?.value).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe('mapLmuTelemetry flag facts', () => {
  const flagsOf = (overrides: Partial<LmuRawTelemetry>): number =>
    mapLmuTelemetry({ ...fixture(), gamePhase: 5, ...overrides }).SessionFlags
      .value[0];
  /** The player is slot 1 of the fixture. */
  const playerBlue = new Uint8Array([0, 6, 0]);

  it('sets the blue alongside a sector yellow, not instead of it', () => {
    // The fault this replaces: the first match won, so a yellow anywhere on
    // the circuit kept the player's blue from ever being set.
    expect(
      flagsOf({ sectorFlags: new Uint8Array([11, 1, 11]), vehFlag: playerBlue })
    ).toBe(GlobalFlags.Yellow | GlobalFlags.Blue);
  });

  it('sets the blue alongside a full-course yellow', () => {
    expect(flagsOf({ gamePhase: 6, vehFlag: playerBlue })).toBe(
      GlobalFlags.Yellow | GlobalFlags.Caution | GlobalFlags.Blue
    );
  });

  it('does not add a sector yellow to a full-course one', () => {
    expect(
      flagsOf({ yellowFlagState: 4, sectorFlags: new Uint8Array([1, 1, 1]) })
    ).toBe(GlobalFlags.Yellow | GlobalFlags.Caution);
  });

  it('keeps the flags of the end of a session beside the others', () => {
    expect(flagsOf({ gamePhase: 8, vehFlag: playerBlue })).toBe(
      GlobalFlags.Checkered | GlobalFlags.Blue
    );
    expect(
      flagsOf({ gamePhase: 7, sectorFlags: new Uint8Array([11, 11, 1]) })
    ).toBe(GlobalFlags.Red | GlobalFlags.Yellow);
  });

  it('marks the player disqualified from their finish status', () => {
    expect(flagsOf({ vehFinishStatus: new Int32Array([0, 3, 0]) })).toBe(
      GlobalFlags.Disqualify
    );
    // Another car's disqualification is not the player's flag.
    expect(flagsOf({ vehFinishStatus: new Int32Array([3, 0, 0]) })).toBe(0);
  });

  it('never sets green or black, which mean other things downstream', () => {
    const flags = flagsOf({ vehNumPenalties: [0, 2, 0] });

    expect(flags & GlobalFlags.Green).toBe(0);
    expect(flags & GlobalFlags.Black).toBe(0);
    expect(flags).toBe(0);
  });

  it('reads no flag for a player without a car', () => {
    expect(flagsOf({ playerHasVehicle: false, vehFlag: playerBlue })).toBe(0);
  });

  it('publishes the session phase and the yellow sub-phase as they stand', () => {
    const t = mapLmuTelemetry({
      ...fixture(),
      gamePhase: 6,
      yellowFlagState: 3,
    });

    expect(t.LmuGamePhase?.value).toEqual([6]);
    expect(t.LmuYellowFlagState?.value).toEqual([3]);
  });

  it('publishes the sector yellows in driving order', () => {
    const sectorYellow = (raw: number[]) =>
      mapLmuTelemetry({ ...fixture(), sectorFlags: new Uint8Array(raw) })
        .LmuSectorYellow?.value;

    // The sim's 1 is the first sector, 2 the second and 0 the third.
    expect(sectorYellow([11, 1, 11])).toEqual([true, false, false]);
    expect(sectorYellow([11, 11, 1])).toEqual([false, true, false]);
    expect(sectorYellow([1, 11, 11])).toEqual([false, false, true]);
    // A clear sector reads 11 on the recording, so only 1 is a yellow.
    expect(sectorYellow([11, 11, 11])).toEqual([false, false, false]);
    expect(sectorYellow([0, 0, 0])).toEqual([false, false, false]);
  });

  it('publishes the start lights', () => {
    const t = mapLmuTelemetry({ ...fixture(), startLight: 2, numRedLights: 5 });

    expect(t.LmuStartLight?.value).toEqual([2]);
    expect(t.LmuNumRedLights?.value).toEqual([5]);
  });

  it('leaves the start lights out for an addon that does not export them', () => {
    const raw: Record<string, unknown> = { ...fixture() };
    delete raw.startLight;
    delete raw.numRedLights;
    const t = mapLmuTelemetry(raw as unknown as LmuRawTelemetry);

    expect(t.LmuStartLight).toBeUndefined();
    expect(t.LmuNumRedLights).toBeUndefined();
  });
});

describe('mapLmuTelemetry steering and force feedback', () => {
  const degrees = (radians: number) => (radians * 180) / Math.PI;
  /** Half the lock to the left, with the three ranges as given. */
  const steered = (
    ranges: { physical?: number; setup?: unknown; visual?: number },
    filteredSteering = -0.5
  ) =>
    mapLmuTelemetry(
      {
        ...fixture(),
        filteredSteering,
        physicalSteeringWheelRange: ranges.physical,
        visualSteeringWheelRange: ranges.visual,
      },
      undefined,
      undefined,
      ranges.setup === undefined
        ? undefined
        : { steerLockDeg: { value: [ranges.setup as number] } }
    );

  it('scales the wheel by the driver’s own range when the sim knows it', () => {
    const t = steered({ physical: 900, setup: 476, visual: 719 });

    // Lock to lock, in radians, as iRacing states it.
    expect(degrees(t.SteeringWheelAngleMax.value[0])).toBeCloseTo(900);
    // Half the lock is a quarter of the range, and left is positive.
    expect(degrees(t.SteeringWheelAngle.value[0])).toBeCloseTo(225);
  });

  it('falls back to the setup’s steering lock, then to the cockpit animation', () => {
    // The recorded LMGT3: the driver's wheel reads 0, the setup 476 and the
    // animation 719.
    const setup = steered({ physical: 0, setup: 476, visual: 719 });
    expect(degrees(setup.SteeringWheelAngleMax.value[0])).toBeCloseTo(476);
    expect(setup.SteeringWheelAngleMax.value[0]).toBeCloseTo(8.308, 3);
    expect(degrees(setup.SteeringWheelAngle.value[0])).toBeCloseTo(119);

    // No REST answer yet: the animation's range, as before there was a
    // choice.
    const visual = steered({ physical: 0, visual: 719 });
    expect(degrees(visual.SteeringWheelAngleMax.value[0])).toBeCloseTo(719);
    expect(degrees(visual.SteeringWheelAngle.value[0])).toBeCloseTo(179.75);
  });

  it.each([
    ['zero', 0],
    ['negative', -476],
    ['not a number', Number.NaN],
    ['text', '476 (17.2) deg'],
  ])('passes over a setup lock that is %s', (_label, setup) => {
    const t = steered({ physical: 0, setup, visual: 719 });

    expect(degrees(t.SteeringWheelAngleMax.value[0])).toBeCloseTo(719);
  });

  it('turns the wheel to the right for a positive steering fraction', () => {
    const t = steered({ setup: 476, visual: 719 }, 0.25);

    expect(degrees(t.SteeringWheelAngle.value[0])).toBeCloseTo(-59.5);
  });

  it('publishes no angle and no range when the sim states none', () => {
    const t = steered({});

    expect(t.SteeringWheelAngleMax.value[0]).toBe(0);
    expect(Math.abs(t.SteeringWheelAngle.value[0])).toBe(0);
  });

  it('publishes force feedback as a signed fraction under iRacing’s key', () => {
    expect(
      mapLmuTelemetry({ ...fixture(), ffbTorque: 0.5 })
        .SteeringWheelPctTorqueSign.value[0]
    ).toBe(0.5);
    expect(
      mapLmuTelemetry({ ...fixture(), ffbTorque: -1.02 })
        .SteeringWheelPctTorqueSign.value[0]
    ).toBe(-1.02);

    // An addon built before the export: absent, not a steady zero.
    const raw: Record<string, unknown> = { ...fixture() };
    delete raw.ffbTorque;
    expect(
      mapLmuTelemetry(raw as unknown as LmuRawTelemetry)
        .SteeringWheelPctTorqueSign
    ).toBeUndefined();
  });

  it('publishes the mean front wheel angle, signed like the steering wheel', () => {
    // The fixture steers left: both front wheels point left, which the sim
    // gives as negative toe, a little apart for the static toe.
    const t = mapLmuTelemetry(fixture());

    expect(t.SteeringWheelAngle.value[0]).toBeGreaterThan(0);
    expect(t.LmuFrontWheelAngle?.value[0]).toBeCloseTo(4.988, 3);

    // Static toe alone, equal and opposite, is no steering.
    expect(
      mapLmuTelemetry({
        ...fixture(),
        wheelToe: new Float64Array([0.002, -0.002, 0, 0]),
      }).LmuFrontWheelAngle?.value[0]
    ).toBeCloseTo(0);
  });

  it('leaves the front wheel angle absent when the sim has not written the wheels', () => {
    const raw: Record<string, unknown> = { ...fixture() };
    delete raw.wheelToe;

    expect(
      mapLmuTelemetry(raw as unknown as LmuRawTelemetry).LmuFrontWheelAngle
    ).toBeUndefined();
  });
});

describe('mapLmuTelemetry car state keys', () => {
  // Each group is converted in a module of its own, with its own spec:
  // carPitState, carMotion, wheelDynamics, damage and hybrid. These cases
  // are that the mapper calls them, with the fixture's car and without one.
  const round = (values: readonly number[] | undefined, digits: number) =>
    values?.map((value) => Number(value.toFixed(digits)));

  /** The keys that describe the player's own car, and so need one. */
  const PLAYER_CAR_KEYS = [
    'LmuWheelRideHeight',
    'LmuSuspensionPosition',
    'LmuSuspensionForce',
    'LmuTyreDeflection',
    'LmuWheelCamber',
    'LmuWheelToe',
    'LmuWheelRotation',
    'LmuTyreStaticRadius',
    'LmuWheelSurfaceType',
    'LmuThirdSpringDeflection',
    'LmuLastImpactTime',
    'LmuLastImpactMagnitude',
    'LmuLastImpactPos',
    'LmuDentSeverity',
    'LmuBodyDetached',
    'LmuOverheating',
    'LmuTyreFlat',
    'LmuWheelDetached',
    'LmuMotorState',
    'LmuLiftAndCoast',
    'LmuPlayerWorldPos',
    'YawNorth',
    'VelocityX',
    'VelocityY',
    'VelocityZ',
    'LatAccel',
    'LongAccel',
  ] as const;

  it('publishes where each car is with its pit stop', () => {
    // Three cars: one that has stopped once, the player, and one standing
    // at its box on its second stop.
    const t = mapLmuTelemetry(fixture());

    expect(t.LmuCarIdxPitState?.value).toEqual([0, 0, 3]);
    expect(t.LmuCarIdxPitStops?.value).toEqual([1, 0, 2]);
    expect(t.LmuCarIdxInGarage?.value).toEqual([false, false, false]);
  });

  it('marks an empty slot in the pit keys, and puts no car in its garage', () => {
    const raw = fixture();
    raw.vehLapDistPct = new Float64Array([-1, 0.6, 0.2]);
    raw.vehInGarageStall = new Uint8Array([1, 1, 0]);
    const t = mapLmuTelemetry(raw);

    expect(t.LmuCarIdxPitState?.value).toEqual([-1, 0, 3]);
    expect(t.LmuCarIdxPitStops?.value).toEqual([-1, 0, 2]);
    expect(t.LmuCarIdxInGarage?.value).toEqual([false, true, false]);
  });

  it('publishes the end of the session on the session clock', () => {
    expect(mapLmuTelemetry(fixture()).LmuSessionEndTime?.value).toEqual([3600]);
    // A session the sim has given no end.
    expect(
      mapLmuTelemetry({ ...fixture(), endET: 0 }).LmuSessionEndTime
    ).toBeUndefined();
  });

  it('publishes the wheels and suspension in the frame’s units', () => {
    const t = mapLmuTelemetry(fixture());

    // Millimetres, from metres.
    expect(round(t.LmuWheelRideHeight?.value, 3)).toEqual([54, 50, 63, 59]);
    expect(round(t.LmuSuspensionPosition?.value, 3)).toEqual([40, 50, 60, 70]);
    expect(round(t.LmuTyreDeflection?.value, 3)).toEqual([14, 19, 17, 22]);
    expect(round(t.LmuThirdSpringDeflection?.value, 3)).toEqual([45, 65]);
    // Degrees, from radians, with the sim's signs.
    expect(round(t.LmuWheelCamber?.value, 2)).toEqual([
      -2.0, -2.18, -1.7, -1.61,
    ]);
    expect(round(t.LmuWheelToe?.value, 2)).toEqual([-5.15, -4.83, 0.1, -0.1]);
    // As the sim states them.
    expect(t.LmuSuspensionForce?.value).toEqual([3600, 5100, 4300, 6000]);
    expect(t.LmuWheelRotation?.value).toEqual([-153.9, -156.6, -147.2, -149.8]);
    // Metres, from whole centimetres.
    expect(t.LmuTyreStaticRadius?.value).toEqual([0.34, 0.34, 0.36, 0.36]);
    expect(t.LmuWheelSurfaceType?.value).toEqual([0, 5, 0, 0]);
    // The suspension travel iRacing's keys carry stays in metres.
    expect(t.RRshockDefl.value[0]).toBe(0.07);
  });

  it('publishes no tyre load, which the sim leaves at zero', () => {
    expect(mapLmuTelemetry(fixture()).LmuTyreLoad).toBeUndefined();
  });

  it('publishes the last impact and the damage it did', () => {
    const t = mapLmuTelemetry(fixture());

    expect(t.LmuLastImpactTime?.value).toEqual([240.72]);
    expect(t.LmuLastImpactMagnitude?.value).toEqual([3016.93]);
    expect(t.LmuLastImpactPos?.value).toEqual([-0.567, -0.153, -2.453]);
    expect(t.LmuDentSeverity?.value).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
    expect(t.LmuBodyDetached?.value).toEqual([false]);
    expect(t.LmuOverheating?.value).toEqual([false]);
    expect(t.LmuTyreFlat?.value).toEqual([false, false, false, false]);
    expect(t.LmuWheelDetached?.value).toEqual([false, false, false, false]);
  });

  it('says the fixture’s LMGT3 has no hybrid, and publishes none for it', () => {
    const t = mapLmuTelemetry(fixture());

    expect(t.LmuMotorState?.value).toEqual([0]);
    expect(t.LmuLiftAndCoast?.value).toEqual([0]);
    expect(t.LmuBatteryCharge).toBeUndefined();
    expect(t.LmuMotorTorque).toBeUndefined();
    expect(t.LmuMotorRPM).toBeUndefined();
    expect(t.LmuMotorTemp).toBeUndefined();
    expect(t.LmuMotorCoolantTemp).toBeUndefined();
  });

  it('publishes the hybrid of a car that has one', () => {
    const t = mapLmuTelemetry({
      ...fixture(),
      electricBoostMotorState: 3,
      batteryChargeFraction: 0.62,
      electricBoostMotorTorque: -140,
      electricBoostMotorRPM: 7800,
      electricBoostMotorTemperature: 71.5,
      electricBoostWaterTemperature: 48,
      liftAndCoastProgress: 255,
    });

    expect(t.LmuMotorState?.value).toEqual([3]);
    expect(t.LmuBatteryCharge?.value).toEqual([0.62]);
    expect(t.LmuMotorTorque?.value).toEqual([-140]);
    expect(t.LmuMotorRPM?.value).toEqual([7800]);
    expect(t.LmuMotorTemp?.value).toEqual([71.5]);
    expect(t.LmuMotorCoolantTemp?.value).toEqual([48]);
    expect(t.LmuLiftAndCoast?.value).toEqual([1]);
  });

  it('publishes where the car is and how it is moving, in iRacing’s axes', () => {
    const t = mapLmuTelemetry(fixture());

    expect(t.LmuPlayerWorldPos?.value).toEqual([0, 0, 0]);
    // The player, in slot 1, has its nose along the world's -Z.
    expect(t.YawNorth.value[0]).toBeCloseTo(Math.PI, 12);
    // Forwards, to the left, up: the sim's are to the left, up, to the rear.
    expect(t.VelocityX.value[0]).toBe(51.23);
    expect(t.VelocityY.value[0]).toBe(0.6);
    expect(t.VelocityZ.value[0]).toBe(0.1);
  });

  it('publishes none of the player’s car without a player’s car', () => {
    // At the monitor or spectating the sim writes no single-car field.
    // Absent, not zero: a 0 would be a car on the ground with no ride
    // height, pointing north and standing still.
    const t = mapLmuTelemetry(lmuRawWithoutPlayerVehicle(fixture()));

    for (const key of PLAYER_CAR_KEYS) {
      expect(t[key], key).toBeUndefined();
    }
  });

  it('publishes all of them with one', () => {
    const t = mapLmuTelemetry(fixture());

    for (const key of PLAYER_CAR_KEYS) {
      expect(t[key], key).toBeDefined();
    }
  });

  it('keeps the per-car and session keys without a player’s car', () => {
    // Scoring writes those for the whole grid whoever is watching.
    const t = mapLmuTelemetry(lmuRawWithoutPlayerVehicle(fixture()));

    expect(t.LmuCarIdxPitState?.value).toEqual([0, 0, 3]);
    expect(t.LmuCarIdxPitStops?.value).toEqual([1, 0, 2]);
    expect(t.LmuCarIdxInGarage?.value).toEqual([false, false, false]);
    expect(t.LmuSessionEndTime?.value).toEqual([3600]);
  });
});
