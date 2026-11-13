import type {
  FuelBudget,
  FuelLapData,
  FuelProjectionSnapshot,
  Session,
  SessionLifecycleEvent,
  Telemetry,
} from '@irdashies/types';
import {
  FuelProjectionEngine,
  type FuelEngineCommand,
  type FuelEngineFrame,
} from '@irdashies/shared';
import type { TelemetryProcessor } from './TelemetryProcessor';

const MAX_LAP_HISTORY = 50;
const CLASS_PACE_HISTORY = 5;
const CLASS_PACE_OUTLIER_SECONDS = 2;

/** A full virtual energy budget, in the percent it is counted in. */
const VIRTUAL_ENERGY_CAPACITY = 100;
/**
 * Added to the car a lap history is kept under when the laps are counted in
 * virtual energy, so they never share a history with laps counted in litres.
 * Part of a storage key; shown nowhere.
 */
const VIRTUAL_ENERGY_KEY_SUFFIX = ' (virtual energy)';
/** Tank laps kept for an energy car: enough for the average and its filter. */
const MAX_TANK_LAP_HISTORY = 10;
/** How many recent laps the tank's litres a lap is averaged over. */
const TANK_AVERAGE_LAPS = 5;

export interface FuelProjectionPersistence {
  lapCompleted(lap: FuelLapData): void;
  saveLap(lap: FuelLapData): void;
}

export interface FuelProjectionProcessorOptions {
  persistence?: FuelProjectionPersistence;
  persistLaps?: boolean;
  clock?: () => number;
  sourceReplay?: boolean;
}

const noPersistence: FuelProjectionPersistence = {
  lapCompleted: () => undefined,
  saveLap: () => undefined,
};

const value = (
  frame: Telemetry,
  key: keyof Telemetry,
  fallback = 0
): number => {
  const candidate = frame[key]?.value?.[0];
  return typeof candidate === 'number' ? candidate : fallback;
};

const booleanValue = (frame: Telemetry, key: keyof Telemetry): boolean => {
  const candidate = frame[key]?.value?.[0];
  return candidate === true || candidate === 1;
};

const values = (frame: Telemetry, key: keyof Telemetry): readonly number[] => {
  const candidates = frame[key]?.value;
  return Array.isArray(candidates)
    ? candidates.map((candidate) =>
        typeof candidate === 'number' && Number.isFinite(candidate)
          ? candidate
          : 0
      )
    : [];
};

const isGreenFlag = (flags: number): boolean =>
  (flags & (0x00004000 | 0x00008000 | 0x00010000)) === 0;

/**
 * The lap being driven, counted from one.
 *
 * iRacing's lap channels are laps started. Le Mans Ultimate's are laps
 * completed, so its first lap is lap 0: the engine reads that as "no lap yet"
 * and never records it, every lap number came out one short, and so did the
 * race distance. One more than the laps completed is the lap being driven in
 * both sims, so the greater of the two is used. Without a completed count the
 * lap channel stands as it is.
 */
const lapStarted = (lap: number, completed: unknown): number =>
  typeof completed === 'number' && Number.isFinite(completed)
    ? Math.max(lap, completed + 1)
    : lap;

/**
 * The player's virtual energy as a fraction, or undefined when their car runs
 * on fuel -- every car outside Le Mans Ultimate, and its fuel-limited classes.
 *
 * From the per-car channels rather than the player's own LmuVirtualEnergy:
 * those say which budget the figure is and remember a car once seen above
 * zero, where a bare 0 is also what every fuel-limited car reads all race.
 */
const playerVirtualEnergy = (
  frame: Telemetry,
  playerCarIdx: number
): number | undefined => {
  if (playerCarIdx < 0) return undefined;
  if (frame.LmuCarIdxEnergyIsVirtual?.value?.[playerCarIdx] !== true) {
    return undefined;
  }
  const remaining = frame.LmuCarIdxEnergyRemaining?.value?.[
    playerCarIdx
  ] as unknown;
  return typeof remaining === 'number' && remaining >= 0
    ? Math.min(remaining, 1)
    : undefined;
};

const validateLap = (
  fuelUsed: number,
  lapTime: number,
  recentLaps: FuelLapData[]
): boolean => {
  if (fuelUsed <= 0 || lapTime <= 0) return false;
  const valid = recentLaps.filter((lap) => lap.isValidForCalc);
  if (valid.length < 3) return true;
  const fuels = valid.map((lap) => lap.fuelUsed).sort((a, b) => a - b);
  const q1 = fuels[Math.floor(fuels.length * 0.25)];
  const q3 = fuels[Math.floor(fuels.length * 0.75)];
  const iqr = q3 - q1;
  const mean = fuels.reduce((sum, fuel) => sum + fuel, 0) / fuels.length;
  return (
    (fuelUsed >= q1 - 2 * iqr && fuelUsed <= q3 + 2 * iqr) ||
    Math.abs(fuelUsed - mean) <= mean * 0.15
  );
};

export class FuelProjectionProcessor implements TelemetryProcessor<FuelProjectionSnapshot> {
  readonly channel = 'fuel.projection';
  readonly tickRateHz = 5;

  private clockMilliseconds = 0;
  private readonly engine: FuelProjectionEngine;
  private readonly laps: FuelLapData[] = [];
  private readonly persistence: FuelProjectionPersistence;
  private readonly persistLaps: boolean;
  private lastCommands: readonly FuelEngineCommand[] = [];
  private readonly classLapTimes = new Map<number, number[]>();
  private lastLapTimesByCarIdx: number[] = [];
  private aggregationEnabled = true;
  private session?: Session;
  private sourceReplay: boolean;
  private latest: FuelProjectionSnapshot;
  /**
   * What the engine is counting. Fuel until the player's car is seen running
   * on virtual energy, and energy from then until the session is left or the
   * car changes: a budget does not change under a car, and laps counted in
   * one cannot be carried into the other.
   */
  private budget: FuelBudget = 'fuel';
  /** The last virtual energy read, held through a frame with no reading. */
  private lastEnergy = 0;
  /**
   * The player's entry, which is what says whether the car has changed:
   * the model in iRacing, the livery file in Le Mans Ultimate.
   */
  private carPath: string | undefined;
  /**
   * The model Le Mans Ultimate names for that entry, kept once seen. The sim
   * only names it while the car has a telemetry block, so it goes missing at
   * the monitor; forgetting it there would move the lap history to another
   * key every time the driver got out of the car.
   */
  private carModel: string | undefined;
  /**
   * The tank of an energy car, counted by an engine of its own so its laps
   * are judged by the same rules as the energy's. Never published as laps,
   * never stored: only its average reaches the snapshot.
   */
  private readonly tankEngine: FuelProjectionEngine;
  private readonly tankLaps: FuelLapData[] = [];
  private tankLevel = 0;

  constructor(options: FuelProjectionProcessorOptions = {}) {
    this.persistence = options.persistence ?? noPersistence;
    this.persistLaps = options.persistLaps ?? false;
    this.sourceReplay = options.sourceReplay ?? false;
    const clock = { now: options.clock ?? (() => this.clockMilliseconds) };
    const logger = { debug: () => undefined };
    this.engine = new FuelProjectionEngine(clock, logger);
    this.tankEngine = new FuelProjectionEngine(clock, logger);
    this.latest = this.emptySnapshot();
  }

  init(session: Session): void {
    this.session = session;
    const driverInfo = session.DriverInfo;
    const player = driverInfo?.Drivers?.find(
      (driver) => driver.CarIdx === driverInfo.DriverCarIdx
    );
    const carPath = player?.CarPath;
    if (carPath !== undefined && carPath !== this.carPath) {
      // A different car: its laps are not this one's, nor is its budget.
      if (this.carPath !== undefined) this.reset();
      this.carPath = carPath;
      this.carModel = undefined;
    }
    if (player?.CarModel) this.carModel = player.CarModel;
  }

  /**
   * The car the lap history is kept under.
   *
   * Le Mans Ultimate's CarPath is the livery file, so two entries of one car
   * differ there; it names the model separately, and the model is the key.
   * iRacing's CarPath is the model.
   */
  private get carKey(): string | undefined {
    return this.carModel ?? this.carPath;
  }

  setSourceReplay(replay: boolean): void {
    this.sourceReplay = replay;
    this.latest = { ...this.latest, isReplay: replay };
  }

  onFrame(frame: Telemetry): void {
    if (!this.aggregationEnabled) return;
    const sessionTime = value(frame, 'SessionTime');
    this.clockMilliseconds = Math.round(sessionTime * 1000);
    const driverInfo = this.session?.DriverInfo;
    const energy = playerVirtualEnergy(frame, driverInfo?.DriverCarIdx ?? -1);
    if (energy !== undefined) {
      // The first sight of the car's energy. Whatever was counted until now
      // was its tank, in litres, and none of it carries over.
      if (this.budget === 'fuel') {
        this.reset();
        this.budget = 'virtualEnergy';
      }
      this.lastEnergy = energy;
    }
    const onEnergy = this.budget === 'virtualEnergy';
    // Absent at the monitor and while spectating, where the sim writes no
    // fuel. For an energy car the last reading is held, as its energy is.
    const hasTankReading = typeof frame.FuelLevel?.value?.[0] === 'number';
    if (hasTankReading || !onEnergy) this.tankLevel = value(frame, 'FuelLevel');
    const fuelLevel = onEnergy
      ? this.lastEnergy * VIRTUAL_ENERGY_CAPACITY
      : this.tankLevel;
    const lap = lapStarted(value(frame, 'Lap'), frame.LapCompleted?.value?.[0]);
    const lapDistPct = value(frame, 'LapDistPct');
    const sessionNum = value(frame, 'SessionNum');
    const sessionInfo = this.session?.SessionInfo?.Sessions?.find(
      (candidate) => candidate.SessionNum === sessionNum
    );
    const maxFuel = driverInfo?.DriverCarFuelMaxLtr;
    const maxFuelPct = driverInfo?.DriverCarMaxFuelPct;
    this.updateClassLapTimes(frame);
    const raceProjection = this.calculateRaceProjection(
      frame,
      sessionInfo?.SessionType,
      sessionInfo?.SessionLaps
    );
    const engineFrame: FuelEngineFrame = {
      fuelLevel,
      lap,
      lapDistPct,
      onPitRoad: booleanValue(frame, 'OnPitRoad'),
      playerCarTowTime: value(frame, 'PlayerCarTowTime'),
      sessionFlags: value(frame, 'SessionFlags'),
      sessionNum,
      sessionTime,
    };
    const commands = this.engine.onFrame(
      engineFrame,
      { getRecentLaps: (count) => this.laps.slice(0, count) },
      validateLap,
      isGreenFlag,
      { persistLaps: this.persistLaps }
    );
    this.lastCommands = commands;
    this.execute(commands);
    if (onEnergy && hasTankReading) this.countTank(engineFrame);

    const engine = this.engine.snapshot();
    const currentLapUsage =
      engine.lapStartFuel > 0
        ? Math.max(0, engine.lapStartFuel - fuelLevel)
        : 0;
    const validLaps = this.laps.filter((completed) => completed.isValidForCalc);
    const average = validLaps.length
      ? validLaps.reduce((sum, completed) => sum + completed.fuelUsed, 0) /
        validLaps.length
      : 0;
    this.latest = {
      isReplay: this.sourceReplay,
      // Left out for a car on fuel rather than written as 'fuel', so what a
      // fuel car publishes is exactly what it published before there was a
      // second budget.
      ...(onEnergy
        ? {
            budget: this.budget,
            tank: { level: this.tankLevel, perLap: this.tankPerLap() },
          }
        : {}),
      fuelLevel,
      fuelLevelPct: onEnergy ? this.lastEnergy : value(frame, 'FuelLevelPct'),
      currentLap: lap,
      lapDistPct,
      currentLapUsage,
      projectedLapUsage: this.engine.project({
        avgConsumption: average,
        currentFuel: fuelLevel,
        currentLapUsage,
        lap,
        lapDistPct,
        lapStartFuel: engine.lapStartFuel,
        lastLapUsage: this.laps[0]?.fuelUsed ?? 0,
        qualifyConsumption: null,
      }),
      lastLapUsage: this.laps[0]?.fuelUsed ?? 0,
      sessionLapsRemain: value(frame, 'SessionLapsRemain'),
      sessionTimeRemain: value(frame, 'SessionTimeRemain'),
      sessionTimeTotal: value(frame, 'SessionTimeTotal'),
      sessionFlags: value(frame, 'SessionFlags'),
      sessionState: value(frame, 'SessionState'),
      sessionNum,
      sessionLaps: sessionInfo?.SessionLaps ?? 0,
      calculatedTotalRaceLaps: raceProjection.totalRaceLaps,
      estimatedLapsRemaining: raceProjection.lapsRemaining,
      hasValidRaceEstimate: raceProjection.hasValidEstimate,
      isFixedLapRace: raceProjection.isFixedLapRace,
      sessionType: sessionInfo?.SessionType,
      isOnTrack: booleanValue(frame, 'IsOnTrack'),
      trackId:
        this.session?.WeekendInfo?.TrackName ??
        this.session?.WeekendInfo?.TrackID,
      carName:
        this.carKey !== undefined && onEnergy
          ? `${this.carKey}${VIRTUAL_ENERGY_KEY_SUFFIX}`
          : this.carKey,
      fuelTankCapacity: onEnergy
        ? VIRTUAL_ENERGY_CAPACITY
        : maxFuel !== undefined && maxFuelPct !== undefined
          ? maxFuel * maxFuelPct
          : maxFuel,
      completedLaps: this.laps,
      engine,
    };
  }

  onLifecycle(event: SessionLifecycleEvent): void {
    if (event.type === 'enter') {
      this.reset();
      this.aggregationEnabled = !event.replay;
      return;
    }
    if (event.type === 'sessionNumChange') {
      this.reset({ preserveCompletedLaps: true });
      return;
    }
    this.reset();
    this.session = undefined;
    this.carPath = undefined;
    this.carModel = undefined;
    this.aggregationEnabled = false;
  }

  snapshot(): FuelProjectionSnapshot {
    return this.latest;
  }

  validationSnapshot(): {
    commands: readonly FuelEngineCommand[];
    state: ReturnType<FuelProjectionEngine['snapshot']>;
  } {
    return { commands: this.lastCommands, state: this.engine.snapshot() };
  }

  private execute(commands: readonly FuelEngineCommand[]): void {
    for (const command of commands) {
      if (command.type === 'lapCompleted') {
        this.laps.unshift(command.lap);
        if (this.laps.length > MAX_LAP_HISTORY) this.laps.pop();
        this.persistence.lapCompleted(command.lap);
      } else {
        this.persistence.saveLap(command.lap);
      }
    }
  }

  /**
   * The same frame through the tank's own engine, with litres where the
   * energy was. Only the laps come back; nothing is stored.
   */
  private countTank(frame: FuelEngineFrame): void {
    const commands = this.tankEngine.onFrame(
      { ...frame, fuelLevel: this.tankLevel },
      { getRecentLaps: (count) => this.tankLaps.slice(0, count) },
      validateLap,
      isGreenFlag,
      { persistLaps: false }
    );
    for (const command of commands) {
      if (command.type !== 'lapCompleted') continue;
      this.tankLaps.unshift(command.lap);
      if (this.tankLaps.length > MAX_TANK_LAP_HISTORY) this.tankLaps.pop();
    }
  }

  /**
   * Litres a lap over the tank's recent laps, or 0 before there is one.
   * Laps through the pits are left out when there are others, as the
   * renderer leaves them out of the energy's average.
   */
  private tankPerLap(): number {
    const valid = this.tankLaps.filter((lap) => lap.isValidForCalc);
    const full = valid.filter((lap) => !lap.isOutLap && !lap.isInLap);
    const laps = (full.length > 0 ? full : valid).slice(0, TANK_AVERAGE_LAPS);
    if (laps.length === 0) return 0;
    return laps.reduce((sum, lap) => sum + lap.fuelUsed, 0) / laps.length;
  }

  private reset(
    { preserveCompletedLaps }: { preserveCompletedLaps: boolean } = {
      preserveCompletedLaps: false,
    }
  ): void {
    this.engine.reset();
    this.tankEngine.reset();
    this.lastCommands = [];
    this.classLapTimes.clear();
    this.lastLapTimesByCarIdx = [];
    if (!preserveCompletedLaps) {
      this.laps.length = 0;
      this.tankLaps.length = 0;
      // The laps were what tied the engine to a budget. With them gone the
      // next reading decides again, as it did the first time.
      this.budget = 'fuel';
      this.lastEnergy = 0;
      this.tankLevel = 0;
    }
    this.latest = this.emptySnapshot();
  }

  private emptySnapshot(): FuelProjectionSnapshot {
    return {
      isReplay: this.sourceReplay,
      // Kept through a change of session, where the laps are kept too: a
      // snapshot that said fuel for one tick would have the renderer drop
      // the car's energy history and load its litres.
      ...(this.budget === 'virtualEnergy' ? { budget: this.budget } : {}),
      fuelLevel: 0,
      fuelLevelPct: 0,
      currentLap: 0,
      lapDistPct: 0,
      currentLapUsage: 0,
      projectedLapUsage: 0,
      lastLapUsage: 0,
      sessionLapsRemain: 0,
      sessionTimeRemain: 0,
      sessionTimeTotal: 0,
      sessionFlags: 0,
      sessionState: 0,
      sessionNum: 0,
      sessionLaps: 0,
      calculatedTotalRaceLaps: 0,
      estimatedLapsRemaining: 0,
      hasValidRaceEstimate: false,
      isFixedLapRace: false,
      isOnTrack: false,
      completedLaps: this.laps,
      engine: this.engine.snapshot(),
    };
  }

  private calculateRaceProjection(
    frame: Telemetry,
    sessionType?: string,
    sessionLaps?: string
  ): {
    totalRaceLaps: number;
    lapsRemaining: number;
    hasValidEstimate: boolean;
    isFixedLapRace: boolean;
  } {
    const timeRemaining = value(frame, 'SessionTimeRemain');
    const isFixedLapRace = !(timeRemaining > 0 && timeRemaining !== 604800);
    const emptyProjection = {
      totalRaceLaps: 0,
      lapsRemaining: 0,
      hasValidEstimate: false,
      isFixedLapRace,
    };
    if (sessionType !== 'Race') return emptyProjection;

    const driverCarIdx = this.session?.DriverInfo?.DriverCarIdx ?? 0;
    const cameraCarIdx = value(frame, 'CamCarIdx', -1);
    const playerCarIdx = cameraCarIdx >= 0 ? cameraCarIdx : driverCarIdx;
    const lapsCompleted = frame.CarIdxLapCompleted?.value;
    const carLaps = values(frame, 'CarIdxLap').map((carLap, carIdx) =>
      lapStarted(carLap, lapsCompleted?.[carIdx])
    );
    const positions = values(frame, 'CarIdxPosition');
    const lapDistances = values(frame, 'CarIdxLapDistPct');
    const playerLap =
      carLaps[playerCarIdx] ??
      lapStarted(value(frame, 'Lap'), frame.LapCompleted?.value?.[0]);
    let leaderCarIdx = -1;
    for (let index = 0; index < positions.length; index++) {
      if (positions[index] === 1) {
        leaderCarIdx = index;
        break;
      }
    }
    const paceCarIdx = leaderCarIdx >= 0 ? leaderCarIdx : playerCarIdx;
    const drivers = this.session?.DriverInfo?.Drivers;
    const leaderClassEstimate = drivers?.find(
      (driver) => driver.CarIdx === paceCarIdx
    )?.CarClassEstLapTime;
    const playerClassEstimate = drivers?.find(
      (driver) => driver.CarIdx === playerCarIdx
    )?.CarClassEstLapTime;
    const bestLapTimes = values(frame, 'CarIdxBestLapTime');
    const leaderLapTime =
      this.classPace(paceCarIdx) ??
      (leaderClassEstimate && leaderClassEstimate > 1
        ? leaderClassEstimate
        : (bestLapTimes[paceCarIdx] ?? 0));
    const playerLapTime =
      this.classPace(playerCarIdx) ??
      (playerClassEstimate && playerClassEstimate > 1
        ? playerClassEstimate
        : (bestLapTimes[playerCarIdx] ?? 0));
    const configuredLaps = Number.parseInt(sessionLaps ?? '0', 10) || 0;

    if (value(frame, 'SessionState') >= 5) {
      return {
        totalRaceLaps: playerLap,
        lapsRemaining: 0,
        hasValidEstimate: true,
        isFixedLapRace,
      };
    }
    if (isFixedLapRace) {
      let totalRaceLaps = configuredLaps;
      const leaderLap = carLaps[leaderCarIdx] ?? 0;
      const leaderDistance = lapDistances[leaderCarIdx] ?? 0;
      const playerDistance = value(frame, 'LapDistPct');
      if (playerLap > 0 && leaderLap > 0) {
        const distanceBehind =
          leaderLap + leaderDistance - (playerLap + playerDistance);
        if (distanceBehind > 0) totalRaceLaps -= Math.floor(distanceBehind);
      }
      const playerProgress =
        Math.max(0, playerLap - 1) + Math.max(0, value(frame, 'LapDistPct'));
      return {
        totalRaceLaps,
        lapsRemaining: Math.max(0, totalRaceLaps - playerProgress),
        hasValidEstimate: configuredLaps > 0,
        isFixedLapRace,
      };
    }
    if (leaderLapTime < 10 || playerLapTime < 10) return emptyProjection;

    const leaderLap = carLaps[leaderCarIdx] ?? playerLap;
    const leaderDistance = lapDistances[paceCarIdx] ?? 0;
    const playerDistance =
      lapDistances[playerCarIdx] ?? value(frame, 'LapDistPct');
    const leaderProgress = Math.max(0, leaderLap - 1) + leaderDistance;
    const playerProgress = Math.max(0, playerLap - 1) + playerDistance;
    const leaderProgressAtTimeLimit =
      leaderProgress + timeRemaining / leaderLapTime;
    const leaderFinishProgress = Math.ceil(leaderProgressAtTimeLimit);
    const timeUntilLeaderFinishes =
      (leaderFinishProgress - leaderProgress) * leaderLapTime;
    let playerFinishProgress = Math.ceil(
      playerProgress + timeUntilLeaderFinishes / playerLapTime
    );
    if (configuredLaps > 0) {
      playerFinishProgress = Math.min(playerFinishProgress, configuredLaps);
    }
    return {
      totalRaceLaps: playerFinishProgress,
      lapsRemaining: Math.max(0, playerFinishProgress - playerProgress),
      hasValidEstimate: true,
      isFixedLapRace,
    };
  }

  private updateClassLapTimes(frame: Telemetry): void {
    const lapTimes = values(frame, 'CarIdxLastLapTime');
    if (lapTimes.length === 0 || !isGreenFlag(value(frame, 'SessionFlags'))) {
      return;
    }
    const classPositions = values(frame, 'CarIdxClassPosition');
    const drivers = this.session?.DriverInfo?.Drivers;
    lapTimes.forEach((lapTime, carIdx) => {
      const previous = this.lastLapTimesByCarIdx[carIdx];
      this.lastLapTimesByCarIdx[carIdx] = lapTime;
      if (
        lapTime < 10 ||
        lapTime === previous ||
        classPositions[carIdx] !== 1
      ) {
        return;
      }
      const classId = drivers?.find(
        (driver) => driver.CarIdx === carIdx
      )?.CarClassID;
      if (classId === undefined) return;
      const history = [
        ...(this.classLapTimes.get(classId) ?? []),
        lapTime,
      ].slice(-CLASS_PACE_HISTORY);
      this.classLapTimes.set(classId, history);
    });
  }

  private classPace(carIdx: number): number | undefined {
    const classId = this.session?.DriverInfo?.Drivers?.find(
      (driver) => driver.CarIdx === carIdx
    )?.CarClassID;
    if (classId === undefined) return undefined;
    const history = this.classLapTimes.get(classId) ?? [];
    if (history.length === 0) return undefined;
    const fastest = Math.min(...history);
    const valid = history.filter(
      (lapTime) => lapTime <= fastest + CLASS_PACE_OUTLIER_SECONDS
    );
    return valid.reduce((sum, lapTime) => sum + lapTime, 0) / valid.length;
  }
}
