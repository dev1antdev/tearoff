import type { LmuRawTelemetry } from './native';

/**
 * A complete, running LMU shared-memory frame.
 *
 * Shared rather than copied: the mapper reads a long tail of per-car arrays,
 * and a hand-rolled partial frame throws on whichever one it forgot. Callers
 * override the handful of fields their case is about.
 */
export function fixture(): LmuRawTelemetry {
  return {
    running: true,
    gameVersion: 1902,
    trackName: 'Spa Francorchamps',
    playerName: 'Alonso',
    serverName: 'Server',
    session: 1,
    currentET: 1250.5,
    endET: 3600,
    maxLaps: 12,
    lapDist: 7004,
    numVehicles: 3,
    gamePhase: 4,
    yellowFlagState: 0,
    sectorFlags: new Uint8Array([0, 0, 0]),
    inRealtime: true,
    gameMode: 3,
    isFixedSetup: false,
    maxPlayers: 60,
    sessionTimeRemaining: 2349.5,
    timeOfDay: 0.45,
    trackGripLevel: 1,
    sessionStartEvents: 1,
    sessionEndEvents: 0,
    scoringUpdates: 1200,
    trackLimitsStepsPerPoint: 4,
    trackLimitsStepsPerPenalty: 12,
    cloudCoverage: 20,
    raining: 0,
    darkCloud: 0,
    ambientTemp: 23.5,
    trackTemp: 31.2,
    minPathWetness: 0,
    maxPathWetness: 0,
    avgPathWetness: 0.05,
    wind: [2, 0, -3],
    // A race under way: the three-light start sequence has gone out, and the
    // wheel is being sent a quarter of full force.
    startLight: 0,
    numRedLights: 3,
    ffbTorque: 0.25,
    playerVehicleIdx: 1,
    playerHasVehicle: true,
    activeVehicles: 2,
    gear: 5,
    engineRPM: 8200,
    engineWaterTemp: 95,
    engineOilTemp: 110,
    clutchRPM: 8200,
    unfilteredThrottle: 0.8,
    unfilteredBrake: 0,
    unfilteredSteering: -0.3,
    unfilteredClutch: 0,
    filteredThrottle: 0.79,
    filteredBrake: 0,
    filteredSteering: -0.29,
    filteredClutch: 0,
    steeringShaftTorque: 1.2,
    fuel: 42,
    fuelCapacity: 110,
    engineMaxRPM: 9000,
    rearBrakeBias: 0.55,
    lapNumber: 3,
    elapsedTime: 250.4,
    lapStartET: 200,
    currentSector: 1,
    lapInvalidated: false,
    speedLimiterActive: false,
    speedLimiter: 0,
    absActive: 1,
    tcActive: 0,
    ignitionStarter: 0,
    maxGears: 6,
    visualSteeringWheelRange: 480,
    deltaBest: 0.2,
    // 0, as the recorded LMGT3 reads on every frame: no battery. This said
    // 1 before anything read it, and a charge above 0 is now published
    // whatever the motor state says.
    batteryChargeFraction: 0,
    turboBoostPressure: 0,
    frontTireCompoundName: 'Dry',
    vehicleName: 'Ferrari 296 GT3',
    speed: 51.234,
    // The sim's car axes: to the left, up, to the rear. Going forwards at
    // the speed above, drifting a little to the left.
    localVel: [0.6, 0.1, -51.23],
    localAccel: [9.80665, 0, -19.6133],
    pos: [0, 0, 0],
    tyreTemperature: new Float64Array([80, 81, 82, 83]),
    tyrePressure: new Float64Array([180, 181, 182, 183]),
    tyreWear: new Float64Array([0.9, 0.8, 0.7, 0.6]),
    brakePressure: new Float64Array([0.4, 0.5, 0.3, 0.35]),
    suspensionDeflection: new Float64Array([0.04, 0.05, 0.06, 0.07]),
    // Kelvin, left/centre/right per wheel, as the sim publishes them. Each
    // wheel averages to the tyreTemperature above.
    tyreSurfaceTemperatureRaw: new Float64Array([
      343.15, 353.15, 363.15, 344.15, 354.15, 364.15, 345.15, 355.15, 365.15,
      346.15, 356.15, 366.15,
    ]),
    tyreInnerLayerTemperatureRaw: new Float64Array([
      348.15, 358.15, 368.15, 349.15, 359.15, 369.15, 350.15, 360.15, 370.15,
      351.15, 361.15, 371.15,
    ]),
    tyreCarcassTemperatureRaw: new Float64Array([
      351.15, 352.15, 353.15, 354.15,
    ]),
    tyreOptimalTemperatureRaw: new Float64Array([92, 92, 92, 92]),
    brakeTemperatureRaw: new Float64Array([673.15, 683.15, 573.15, 583.15]),
    // Per-wheel physics as the sim publishes it, LF RF LR RR, with figures of
    // the size a recorded LMGT3 shows in a left-hand corner: metres, newtons,
    // radians and radians per second. The right-hand side carries the load
    // and rides lower, the fronts' toe is mostly steering angle, and tyre
    // load is the zero the sim leaves it at.
    wheelRideHeight: new Float64Array([0.054, 0.05, 0.063, 0.059]),
    suspensionForce: new Float64Array([3600, 5100, 4300, 6000]),
    tyreLoad: new Float64Array([0, 0, 0, 0]),
    tyreVerticalDeflection: new Float64Array([0.014, 0.019, 0.017, 0.022]),
    wheelCamber: new Float64Array([-0.0349, -0.0381, -0.0297, -0.0281]),
    wheelToe: new Float64Array([-0.0898, -0.0843, 0.0018, -0.0018]),
    wheelRotation: new Float64Array([-153.9, -156.6, -147.2, -149.8]),
    // Whole centimetres. The right front is on a kerb; nothing is flat or off.
    tyreStaticRadius: new Uint8Array([34, 34, 36, 36]),
    wheelSurfaceType: new Uint8Array([0, 5, 0, 0]),
    tyreFlat: new Uint8Array([0, 0, 0, 0]),
    wheelDetached: new Uint8Array([0, 0, 0, 0]),
    // No third springs on this car, so each reads the mean of its axle's two
    // suspensionDeflection values above.
    front3rdDeflection: 0.045,
    rear3rdDeflection: 0.065,
    // One impact at the nose, 9.68 s before this frame's elapsedTime, which
    // left the first body part dented. The position is in car axes, where
    // forwards is -z.
    lastImpactET: 240.72,
    lastImpactMagnitude: 3016.93,
    lastImpactPos: new Float64Array([-0.567, -0.153, -2.453]),
    dentSeverity: new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0]),
    detached: false,
    overheating: false,
    // An LMGT3 has no hybrid, so the motor reads "not available" and zeros,
    // as on the recording. A spec about the hybrid overrides these.
    electricBoostMotorState: 0,
    electricBoostMotorTorque: 0,
    electricBoostMotorRPM: 0,
    electricBoostMotorTemperature: 0,
    electricBoostWaterTemperature: 0,
    // What the recording holds for all three: not lifting, wipers on auto in
    // the dry, and a physical wheel range the sim does not report.
    liftAndCoastProgress: 0,
    wiperState: 1,
    physicalSteeringWheelRange: 0,
    vehIds: [0, 1, 1],
    vehIsPlayer: [0, 1, 0],
    vehPlaces: [2, 1, 3],
    vehLapDistPct: [0.4, 0.6, 0.2],
    vehTotalLaps: [2, 3, 1],
    vehBestLapTime: [134.5, 132.8, 137.1],
    vehLastLapTime: [135.6, 133.4, 138.9],
    vehInPits: [0, 0, 1],
    vehInGarageStall: [0, 0, 0],
    vehPitState: [0, 0, 3],
    vehClass: [0, 0, 1],
    vehTimeIntoLap: [50, 60, 20],
    vehEstimatedLapTime: [134, 132, 136],
    vehTimeBehindNext: [1.2, 3.4, 5.6],
    vehTimeBehindLeader: [0, 1.2, 10.5],
    vehLapsBehindNext: [0, 0, 1],
    vehLapsBehindLeader: [0, 0, 1],
    vehQualification: [0, 132.1, 0],
    vehFinishStatus: [0, 0, 0],
    vehIndividualPhase: [10, 9, 8],
    vehLapStartET: [1000, 1100, 900],
    vehSector: [1, 2, 0],
    vehFlag: [0, 0, 6],
    vehUnderYellow: [0, 0, 0],
    vehBestSector1: [32.5, 32.1, 40.1],
    vehBestSector2: [73.7, 72.9, 91.6],
    vehLastSector1: [33.1, 32.4, 41],
    vehLastSector2: [75.1, 73.4, 93],
    vehCurSector1: [-1, 32.8, -1],
    vehCurSector2: [-1, 74.2, -1],
    vehTelemetryAvailable: [1, 1, 1],
    vehPosX: [3, 0, 20],
    vehPosZ: [0, 0, 20],
    vehOriX: [0, 0, 0],
    vehOriZ: [1, 1, 1],
    // Three cars, four wheels each, at carIdx * 4 + wheel. Car 0 is uniform
    // on compound 1, car 1 runs a wet front and a dry rear -- a real LMU
    // choice, and the case the split rendering exists for -- and car 2 is
    // uniform on 0.
    vehWheelCompounds: [1, 1, 1, 1, 3, 3, 0, 0, 0, 0, 0, 0],
    // Infringement steps per car. Four to a point and twelve to a penalty, so
    // car 0 reads 0.25 of three, car 1 is clean, and car 2 is one step from a
    // drive-through.
    vehTrackLimitsSteps: [1, 0, 11],
    // Pit stops counted so far: car 0 has made one, the player none, and
    // car 2, which is in the pit lane, is on its second.
    vehNumPitstops: [1, 0, 2],
    // Car 0 is energy-limited and runs on virtual energy; car 1 has none, so
    // its fuel byte is what counts; car 2 reports neither.
    vehFuelFraction: [255, 51, 0],
    vehVirtualEnergy: [0.42, 0, 0],
  } as unknown as LmuRawTelemetry;
}
