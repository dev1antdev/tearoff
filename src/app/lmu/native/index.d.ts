/** Raw shapes returned by the LMU shared-memory addon (see lmu_node.cc). */

export type LmuVec = number[];

export interface LmuRawVehicle {
  id: number;
  isPlayer: boolean;
  /** LMU mControl: 0 local player, 1 local AI, 2 remote, 3 replay. */
  control?: number;
  name: string;
  vehicleName: string;
  vehicleModel?: string;
  /**
   * The fitted compound's name and index, front and rear.
   *
   * Both halves of the same fact, which is why they are together: the index is
   * what the per-wheel telemetry reports, and the name is the only thing that
   * says what an index means. Absent for a car with no telemetry block.
   */
  frontTireCompoundName?: string;
  rearTireCompoundName?: string;
  frontTireCompoundIndex?: number;
  rearTireCompoundIndex?: number;
  className: string;
  vehFilename: string;
  classId: number;
  totalLaps: number;
  sector: number;
  finishStatus: number;
  lapDist: number;
  bestSector1: number;
  bestSector2: number;
  bestLapTime: number;
  lastSector1: number;
  lastSector2: number;
  lastLapTime: number;
  numPitstops: number;
  numPenalties: number;
  inPits: boolean;
  place: number;
  timeBehindNext: number;
  lapsBehindNext: number;
  timeBehindLeader: number;
  lapsBehindLeader: number;
  qualification: number;
  timeIntoLap: number;
  estimatedLapTime: number;
  pitState: number;
  individualPhase: number;
  underYellow: boolean;
  countLapFlag: number;
  inGarageStall: boolean;
  pitLapDist: number;
  /**
   * Steam64 id as a decimal string.
   *
   * Not a number: the value exceeds the 2^53 range JS integers are exact
   * in, so a numeric form loses its last digits and no longer identifies
   * the player.
   */
  steamId: string;
  /**
   * Raw mFuelFraction, straight off a uint8_t, so always a whole number.
   *
   * The scale is the byte: divide by 255 for a fraction. Neither 0..1 nor a
   * percentage, which an earlier note here guessed at -- the same quantisation
   * the sim uses for mLiftAndCoastProgress.
   *
   * Per car and on the session snapshot, which only rebuilds when the session
   * signature moves, so this is not a live reading. The telemetry channel
   * LmuCarIdxEnergyRemaining is, and is what consumers should use.
   */
  fuelFraction: number;
  pos: LmuVec;
  localVel: LmuVec;
}

export interface LmuRawTelemetry {
  running: boolean;
  gameVersion: number;
  trackName: string;
  playerName: string;
  serverName: string;
  session: number;
  currentET: number;
  endET: number;
  maxLaps: number;
  lapDist: number;
  numVehicles: number;
  gamePhase: number;
  yellowFlagState: number;
  sectorFlags: Uint8Array;
  inRealtime: boolean;
  gameMode: number;
  isFixedSetup: boolean;
  maxPlayers: number;
  sessionTimeRemaining: number;
  timeOfDay: number;
  /**
   * The sim's session callbacks, as monotonic counters.
   *
   * LMU calls EndSession when a session finishes and StartSession when one
   * begins, and bumps these. An increment is the only unambiguous statement
   * that a session boundary happened -- the clock freezing or the grid
   * emptying are both inferences.
   */
  sessionStartEvents: number;
  sessionEndEvents: number;
  /** Scoring's write counter. Stalls when the session stops being scored. */
  scoringUpdates: number;
  trackGripLevel: number;
  /**
   * The scale of LMU's track-limits penalty system.
   *
   * `mTrackLimitsSteps` on a car is counted in steps, not points:
   * `steps / trackLimitsStepsPerPoint` is the points figure the sim displays,
   * and `trackLimitsStepsPerPenalty / trackLimitsStepsPerPoint` is the ceiling
   * a drive-through is served at. Neither number means anything alone.
   */
  trackLimitsStepsPerPoint: number;
  trackLimitsStepsPerPenalty: number;
  cloudCoverage: number;
  raining: number;
  darkCloud: number;
  ambientTemp: number;
  trackTemp: number;
  minPathWetness: number;
  maxPathWetness: number;
  avgPathWetness: number;
  wind: LmuVec;
  /**
   * The step the start light sequence is on (rFactor 2 header). The one
   * recording opens under green, after a rolling start: it reads
   * `numRedLights + 1` for the first five seconds and 0 from then on, which
   * fits a green light that then goes out. The steps of the countdown itself
   * have not been recorded.
   */
  startLight?: number;
  /**
   * The count of red lights in the start sequence (rFactor 2 header). 3 on
   * the recording.
   */
  numRedLights?: number;
  /**
   * Force feedback: a signed fraction of full force, 1 = clipping (TinyPedal's
   * reader; measured -0.75 to 0.95). From the sim's generic block, so it is
   * set with or without a car. A float in the sim, so not an exact decimal.
   */
  ffbTorque?: number;
  playerVehicleIdx: number;
  playerHasVehicle: boolean;
  activeVehicles: number;
  /**
   * The slot of the car whose telemetry block the single-car fields below
   * were read from, -1 when they are absent.
   *
   * The player's own slot unless the read was asked for another one
   * (`read(blockSlot)`): then it is that slot, whatever `playerVehicleIdx`
   * and `playerHasVehicle` say, which go on reporting the sim's own word
   * about the player. Absent from an addon built before the argument
   * existed, where the block is always the player's.
   */
  blockSlot?: number;
  // Present only when a block was read: the player's vehicle, or the slot
  // the read asked for.
  gear?: number;
  engineRPM?: number;
  engineWaterTemp?: number;
  engineOilTemp?: number;
  clutchRPM?: number;
  unfilteredThrottle?: number;
  unfilteredBrake?: number;
  unfilteredSteering?: number;
  unfilteredClutch?: number;
  filteredThrottle?: number;
  filteredBrake?: number;
  filteredSteering?: number;
  filteredClutch?: number;
  steeringShaftTorque?: number;
  fuel?: number;
  fuelCapacity?: number;
  /** Virtual energy remaining. A fraction of the REST maxVirtualEnergy. */
  virtualEnergy?: number;
  /** Hybrid state of charge. */
  stateOfCharge?: number;
  /** Hybrid regeneration. */
  regen?: number;
  engineMaxRPM?: number;
  rearBrakeBias?: number;
  lapNumber?: number;
  elapsedTime?: number;
  lapStartET?: number;
  currentSector?: number;
  lapInvalidated?: boolean;
  speedLimiterActive?: boolean;
  speedLimiter?: number;
  absActive?: boolean;
  tcActive?: boolean;
  /**
   * Driver-adjustable dials, each with the top of its own scale.
   *
   * The max is how a car says it has the control at all: a car without the
   * dial reports 0 for both. A setting whose max is 0 is not published as a
   * channel, so the Car Systems widget shows a row only for a control the
   * car really has.
   */
  abs?: number;
  absMax?: number;
  tc?: number;
  tcMax?: number;
  tcSlip?: number;
  tcSlipMax?: number;
  tcCut?: number;
  tcCutMax?: number;
  /** Engine map. */
  motorMap?: number;
  motorMapMax?: number;
  /** Brake migration. */
  migration?: number;
  migrationMax?: number;
  frontAntiSway?: number;
  frontAntiSwayMax?: number;
  rearAntiSway?: number;
  rearAntiSwayMax?: number;
  ignitionStarter?: number;
  maxGears?: number;
  visualSteeringWheelRange?: number;
  deltaBest?: number;
  batteryChargeFraction?: number;
  turboBoostPressure?: number;
  /**
   * Front third-spring deflection, m (measured). Equals the mean of the two
   * front suspension deflections on a car with no third spring.
   */
  front3rdDeflection?: number;
  /** Rear third-spring deflection, m (measured). */
  rear3rdDeflection?: number;
  /**
   * When the car last took an impact: s on the `elapsedTime` clock
   * (measured). 0 until the first one, and it keeps its value until the next,
   * so a new impact is a change of this number. Held to float precision: an
   * impact at 147.2 reads 147.19999695.
   */
  lastImpactET?: number;
  /** How hard the last impact was: unitless (measured 40 to 3,017). */
  lastImpactMagnitude?: number;
  /**
   * Where the last impact landed, x y z: car axes, metres assumed (header).
   * The recording fits metres: five impacts at the nose read 2.0 to 2.5
   * ahead of the car's origin, which is negative z.
   */
  lastImpactPos?: Float64Array;
  /**
   * Dent level of eight parts of the body: 0 none, 1 some, 2 more (header).
   * The index layout is TinyPedal's; index 0 is the one a nose impact raises.
   */
  dentSeverity?: Uint8Array;
  /** Whether parts other than wheels have come off (header). */
  detached?: boolean;
  /** Whether the sim is showing its overheating icon (header). */
  overheating?: boolean;
  /**
   * Hybrid motor state, an enum: 0 not available, 1 inactive, 2 deploying,
   * 3 regenerating (TinyPedal's reader). 0 on a car with no hybrid.
   */
  electricBoostMotorState?: number;
  /** Hybrid motor torque: Nm by TinyPedal's reader; unconfirmed. */
  electricBoostMotorTorque?: number;
  /** Hybrid motor speed: rev/min by TinyPedal's reader; unconfirmed. */
  electricBoostMotorRPM?: number;
  /**
   * Hybrid motor temperature. Unit unconfirmed: Celsius by TinyPedal's use,
   * possibly Kelvin. No recording holds a car with a hybrid.
   */
  electricBoostMotorTemperature?: number;
  /**
   * Hybrid motor coolant temperature. Unit unconfirmed, as the motor's:
   * Celsius by TinyPedal's use, possibly Kelvin.
   */
  electricBoostWaterTemperature?: number;
  /**
   * Lift-and-coast progress as a byte, 0..255: the fraction is the byte over
   * 255 (TinyPedal's conversion).
   */
  liftAndCoastProgress?: number;
  /**
   * Wiper state, an enum: 0 off, 1 auto, 2 slow, 3 fast (TinyPedal's reader).
   * Unconfirmed: the one recording reads 1 throughout a dry race.
   */
  wiperState?: number;
  /**
   * Rotation of the driver's physical wheel, degrees lock to lock (TinyPedal's
   * reader). 0 when the sim does not know it.
   */
  physicalSteeringWheelRange?: number;
  frontTireCompoundName?: string;
  vehicleName?: string;
  speed?: number;
  localVel?: LmuVec;
  localAccel?: LmuVec;
  pos?: LmuVec;
  tyreTemperature?: Float64Array;
  tyrePressure?: Float64Array;
  tyreWear?: Float64Array;
  brakePressure?: Float64Array;
  suspensionDeflection?: Float64Array;
  /**
   * Per-wheel detail for the player's car, exactly as the sim publishes it.
   * Wheels are LF, RF, LR, RR. Units, measured from a recorded session rather
   * than taken from the rFactor 2 header comments, which get the brake wrong:
   *
   * - surface, inner layer, carcass and brake temperatures are Kelvin;
   * - the optimal temperature is already Celsius.
   *
   * The three-zone arrays hold `wheel * 3 + zone`, and the zones are left,
   * centre and right as the car sees them, not inner and outer.
   */
  tyreSurfaceTemperatureRaw?: Float64Array;
  tyreInnerLayerTemperatureRaw?: Float64Array;
  tyreCarcassTemperatureRaw?: Float64Array;
  tyreOptimalTemperatureRaw?: Float64Array;
  brakeTemperatureRaw?: Float64Array;
  // Per-wheel physics for the player's car, exactly as the sim publishes it:
  // one value per wheel, LF, RF, LR, RR.
  /**
   * Ride height at each wheel, m (measured against the setup's 5.4 / 6.3 cm).
   * Not floored at 0: the recording has two frames 1.5 mm below it.
   */
  wheelRideHeight?: Float64Array;
  /**
   * Pushrod load, N (rFactor 2 header; measured). Negative on a drooping
   * wheel.
   */
  suspensionForce?: Float64Array;
  /**
   * Tyre load, N (header). The sim leaves it at 0 for every car recorded so
   * far, so 0 on all four wheels means "not published", not "no load".
   */
  tyreLoad?: Float64Array;
  /** How far the tyre is squashed, m (measured). 0 with the wheel in the air. */
  tyreVerticalDeflection?: Float64Array;
  /**
   * Camber, rad (measured: -0.035 is a setup's -2.0 deg). Negative with the
   * top of the wheel leaning in, on both sides.
   */
  wheelCamber?: Float64Array;
  /**
   * Toe, rad; positive = pointing right, so toe-in is positive on a left
   * wheel and negative on a right one. The fronts include the steering angle
   * (measured).
   */
  wheelToe?: Float64Array;
  /** Wheel rotation, rad/s; negative rolling forwards (measured). */
  wheelRotation?: Float64Array;
  /** Static undeflected tyre radius, whole cm (measured 34 front, 36 rear). */
  tyreStaticRadius?: Uint8Array;
  /**
   * What each wheel is on, an enum. By the header: 0 dry, 1 wet, 2 grass,
   * 3 dirt, 4 gravel, 5 kerb, 6 special. As recorded, 4 is reported on both
   * dirt and gravel terrain.
   */
  wheelSurfaceType?: Uint8Array;
  /** Whether each tyre is flat: 1 or 0. */
  tyreFlat?: Uint8Array;
  /** Whether each wheel has come off: 1 or 0. */
  wheelDetached?: Uint8Array;
  // Per-vehicle arrays, indexed by CarIdx (vehicle slot id)
  vehIds: Int32Array;
  vehIsPlayer: Uint8Array;
  /**
   * Who is driving each car, from scoring's mControl: 0 the player on this
   * machine, 1 the AI on this machine, 2 somebody on another machine, 3 a
   * replay. An empty slot reads 0. Absent from an addon built before the
   * export.
   */
  vehControl?: ArrayLike<number>;
  vehPlaces: Int32Array;
  vehLapDistPct: Float64Array;
  vehTotalLaps: Int32Array;
  vehBestLapTime: Float64Array;
  vehLastLapTime: Float64Array;
  vehInPits: Uint8Array;
  vehInGarageStall: Uint8Array;
  vehPitState: Uint8Array;
  vehClass: Int32Array;
  vehTimeIntoLap: Float64Array;
  vehEstimatedLapTime: Float64Array;
  vehTimeBehindNext: Float64Array;
  vehTimeBehindLeader: Float64Array;
  vehLapsBehindNext: Int32Array;
  vehLapsBehindLeader: Int32Array;
  vehQualification: Float64Array;
  vehFinishStatus: Int32Array;
  vehIndividualPhase: Int32Array;
  vehLapStartET: Float64Array;
  vehSector: Int32Array;
  vehFlag: Uint8Array;
  vehUnderYellow: Uint8Array;
  vehBestSector1: Float64Array;
  vehBestSector2: Float64Array;
  vehLastSector1: Float64Array;
  vehLastSector2: Float64Array;
  vehCurSector1: Float64Array;
  vehCurSector2: Float64Array;
  vehTelemetryAvailable: Uint8Array;
  vehPosX: Float64Array;
  vehPosZ: Float64Array;
  vehOriX: Float64Array;
  vehOriZ: Float64Array;
  /** 100 Hz speed magnitude per car, m/s, from the telemetry block. */
  vehSpeed?: ArrayLike<number>;
  /** 100 Hz lap number per car. */
  vehLapNumber?: ArrayLike<number>;
  /** 100 Hz per-car telemetry clock, seconds. */
  vehElapsedTime?: ArrayLike<number>;
  /**
   * Compound index per wheel, per car: four entries per slot at
   * `id * 4 + wheel`, in the sim's wheel order (FL, FR, RL, RR).
   *
   * -1 where the car had no telemetry block that frame. 0 is a real compound,
   * so the sentinel cannot be 0.
   */
  vehWheelCompounds?: ArrayLike<number>;
  /**
   * Track-limit infringement steps per car, indexed by slot.
   *
   * -1 where the car had no telemetry block that frame. 0 is a clean car, so
   * the sentinel cannot be 0. Divide by `trackLimitsStepsPerPoint` for the
   * points figure.
   */
  vehTrackLimitsSteps?: ArrayLike<number>;
  /**
   * Fuel remaining per car, as the sim quantises it: a byte over 255, not a
   * percentage. From scoring, so every car on the grid has one.
   */
  /**
   * Outstanding penalties per car, from scoring's mNumPenalties.
   *
   * A count. Scoring carries no field for which penalty it is -- that comes
   * from the pit-stop estimate's penalty time, and only for the player. See
   * lmu/penalty.ts.
   */
  vehNumPenalties?: ArrayLike<number>;
  /**
   * Pit stops per car, a count, from scoring's mNumPitstops (TinyPedal shows
   * it as the stop count). An Int32Array indexed by slot; every car on the
   * grid has one, and a slot with no car reads 0.
   */
  vehNumPitstops?: ArrayLike<number>;
  vehFuelFraction?: ArrayLike<number>;
  /**
   * Virtual energy remaining per car, already a fraction.
   *
   * From the telemetry block, so -1 where a car reported none this frame. 0 is
   * an empty battery, not a missing reading, which is why the sentinel is -1.
   */
  vehVirtualEnergy?: ArrayLike<number>;
}

export interface LmuRawSession extends LmuRawTelemetry {
  classes: { id: number; name: string }[];
  drivers: LmuRawVehicle[];
}

export class NativeLmu {
  constructor();
  start(): boolean;
  stop(): boolean;
  isRunning(): boolean;
  /**
   * One snapshot. The single-car fields are the player's car's, or with
   * `blockSlot` those of the car in that slot, whoever is driving it; the
   * result's `blockSlot` says which they are. Left out, undefined or null,
   * it is the player's. A slot that is not a whole number in range, or
   * that holds no car, gives a snapshot with no single-car fields and a
   * `blockSlot` of -1, never the player's block.
   */
  read(blockSlot?: number | null): LmuRawTelemetry;
  /** As `read`, with the drivers and the classes. */
  readSession(blockSlot?: number | null): LmuRawSession;
  /**
   * The latest recorded REST body for a path, or null.
   *
   * Only the replay build has anything: the live build reads LMU's REST API
   * over HTTP from the JS side and returns null for everything here.
   */
  readRest(path: string): string | null;
}
