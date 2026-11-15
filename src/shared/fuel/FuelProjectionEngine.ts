import type { FuelLapData } from '@irdashies/types';

const MIN_LAP_TIME = 10;
const LAP_DIST_RESET_THRESHOLD = 0.5;
const MAX_PROJECTION_CHANGE_PERCENT = 0.5;
/**
 * How far past the line, as a share of the lap, a lap may be picked up and
 * still be the whole lap. Frames arrive a few times a second, so even a lap
 * seen crossing the line is first measured a little way into it; and Le
 * Mans Ultimate reports a car coming up to the start at exactly 0 until it
 * is over the line, where no crossing is ever seen. Two hundredths of a lap
 * is a couple of seconds and as much of the fuel.
 */
const LAP_START_TOLERANCE = 0.02;

export interface FuelEngineClock {
  now(): number;
}

export interface FuelEngineLogger {
  debug(message: string): void;
}

export interface FuelEngineFrame {
  fuelLevel: number;
  lap: number;
  lapDistPct: number;
  onPitRoad: boolean;
  playerCarTowTime: number;
  sessionFlags: number;
  sessionNum?: number;
  sessionTime: number;
}

export interface FuelEngineHistory {
  getRecentLaps(count: number): readonly FuelLapData[];
}

export type FuelEngineCommand =
  | { type: 'lapCompleted'; lap: FuelLapData }
  | { type: 'saveLap'; lap: FuelLapData };

export interface FuelEngineSettings {
  persistLaps: boolean;
}

export interface FuelEngineState {
  accumulatedRefuel: number;
  isLapDistPctReset: boolean;
  lapCrossingTime: number;
  lapStartFuel: number;
  lastLap: number;
  lastLapDistPct: number;
  lastSessionFlags: number;
  wasOnPitRoad: boolean;
}

export interface FuelProjectionInput {
  avgConsumption: number;
  currentFuel: number;
  currentLapUsage: number;
  lap: number;
  lapDistPct: number;
  lapStartFuel: number;
  lastLapUsage: number;
  qualifyConsumption: number | null;
}

export type FuelLapValidator = (
  fuelUsed: number,
  lapTime: number,
  recentLaps: FuelLapData[]
) => boolean;

const defaultState = (): FuelEngineState => ({
  accumulatedRefuel: 0,
  isLapDistPctReset: false,
  lapCrossingTime: 0,
  lapStartFuel: 0,
  lastLap: 0,
  lastLapDistPct: 0,
  lastSessionFlags: 0,
  wasOnPitRoad: false,
});

const createState = (
  initialState: Partial<FuelEngineState> = {}
): FuelEngineState => {
  const defaults = defaultState();
  return {
    accumulatedRefuel:
      initialState.accumulatedRefuel ?? defaults.accumulatedRefuel,
    isLapDistPctReset:
      initialState.isLapDistPctReset ?? defaults.isLapDistPctReset,
    lapCrossingTime: initialState.lapCrossingTime ?? defaults.lapCrossingTime,
    lapStartFuel: initialState.lapStartFuel ?? defaults.lapStartFuel,
    lastLap: initialState.lastLap ?? defaults.lastLap,
    lastLapDistPct: initialState.lastLapDistPct ?? defaults.lastLapDistPct,
    lastSessionFlags:
      initialState.lastSessionFlags ?? defaults.lastSessionFlags,
    wasOnPitRoad: initialState.wasOnPitRoad ?? defaults.wasOnPitRoad,
  };
};

/**
 * Stateful, deterministic core of the legacy Fuel calculator.
 *
 * It owns no React, storage, logging, or wall-clock APIs. Callers execute the
 * returned commands and provide the clock used for persisted lap timestamps.
 */
export class FuelProjectionEngine {
  private state: FuelEngineState;
  private previousFuelLevel?: number;
  private lastRefuelTime?: number;
  private lastSessionTime?: number;
  private wasTowedDuringLap = false;
  private wasOnPitRoadDuringLap = false;
  private isLapFullyGreen = true;
  /**
   * Whether the lap under way is being measured from the line. The engine
   * can be started anywhere on a lap -- the app opened mid-race, the widget
   * turned on, a reset -- and what is left of that lap is not a lap: half of
   * one burns half the fuel, and recorded it halves the average the driver
   * fills the tank by. Such a lap ends without being recorded.
   */
  private lapFromLine = false;
  private lastProjectedUsage: number | null = null;
  private smoothedProjectedUsage = 0;
  private lastSmoothedLap = -1;

  constructor(
    private readonly clock: FuelEngineClock,
    private readonly logger: FuelEngineLogger,
    initialState: Partial<FuelEngineState> = {}
  ) {
    this.state = createState(initialState);
  }

  snapshot(): Readonly<FuelEngineState> {
    return { ...this.state };
  }

  reset(initialState: Partial<FuelEngineState> = {}): void {
    this.state = createState(initialState);
    this.previousFuelLevel = undefined;
    this.lastRefuelTime = undefined;
    this.lastSessionTime = undefined;
    this.wasTowedDuringLap = false;
    this.wasOnPitRoadDuringLap = false;
    this.isLapFullyGreen = true;
    this.lapFromLine = false;
    this.resetProjection();
  }

  onFrame(
    frame: FuelEngineFrame,
    history: FuelEngineHistory,
    validateLap: FuelLapValidator,
    isGreenFlag: (flags: number) => boolean,
    settings: FuelEngineSettings
  ): readonly FuelEngineCommand[] {
    const commands: FuelEngineCommand[] = [];

    if (frame.playerCarTowTime > 0) this.wasTowedDuringLap = true;
    if (frame.onPitRoad) this.wasOnPitRoadDuringLap = true;
    if (!isGreenFlag(frame.sessionFlags)) this.isLapFullyGreen = false;
    this.state.lastSessionFlags = frame.sessionFlags;

    if (
      this.state.lastLapDistPct > 0 &&
      frame.lapDistPct < this.state.lastLapDistPct - LAP_DIST_RESET_THRESHOLD
    ) {
      this.state.isLapDistPctReset = true;
      this.resetProjection();
    } else if (
      this.state.isLapDistPctReset &&
      frame.lapDistPct > this.state.lastLapDistPct + 0.05
    ) {
      this.state.isLapDistPctReset = false;
    }

    if (this.previousFuelLevel !== undefined) {
      const fuelDelta = frame.fuelLevel - this.previousFuelLevel;
      const timeDelta = frame.sessionTime - (this.lastRefuelTime ?? 0);
      if (fuelDelta > 0.05 && timeDelta > 5) {
        this.state.accumulatedRefuel += fuelDelta;
        this.lastRefuelTime = frame.sessionTime;
      }
    }
    this.previousFuelLevel = frame.fuelLevel;

    if (frame.lap < this.state.lastLap) {
      if (
        this.lastSessionTime !== undefined &&
        frame.sessionTime > this.lastSessionTime
      ) {
        this.state.lastLapDistPct = frame.lapDistPct;
        this.lastSessionTime = frame.sessionTime;
        return commands;
      }
      this.startLap(frame);
      this.lastSessionTime = frame.sessionTime;
      this.state.isLapDistPctReset = false;
      this.resetProjection();
      return commands;
    }

    // With nothing seen before this frame, nothing was seen crossing the
    // line -- though a first frame on lap 1 reads as the count going up by
    // one, which is what a crossing looks like.
    const isFirstFrame = this.lastSessionTime === undefined;
    this.lastSessionTime = frame.sessionTime;
    const distanceCrossed =
      this.state.lastLapDistPct > 0.9 && frame.lapDistPct < 0.1;
    const lapIncremented = frame.lap > this.state.lastLap;
    const isCrossing =
      distanceCrossed ||
      (lapIncremented && frame.lap - this.state.lastLap === 1);

    if (!isCrossing) {
      if (this.state.lastLapDistPct === 0) this.startLap(frame);
      else this.state.lastLapDistPct = frame.lapDistPct;
      return commands;
    }

    const lapTime = frame.sessionTime - this.state.lapCrossingTime;
    // A crossing seconds after the last one is a stutter at the line, and the
    // lap under way carries on. Unless that lap was picked up somewhere
    // else: then this is the first crossing there has been, and the lap is
    // measured from it.
    if (
      this.lapFromLine &&
      !lapIncremented &&
      lapTime > 0 &&
      lapTime < MIN_LAP_TIME
    ) {
      this.state.lastLapDistPct = frame.lapDistPct;
      return commands;
    }

    // More than one lap counted since the last frame: frames were missed.
    // The lap ending here was not seen whole, and this frame is not known to
    // be the line, so the lap starting is whole only if it is found there.
    const lapsSkipped = frame.lap - this.state.lastLap > 1;
    const completedLap = frame.lap - 1;
    const fuelUsed =
      this.state.lapStartFuel + this.state.accumulatedRefuel - frame.fuelLevel;
    if (
      this.lapFromLine &&
      !lapsSkipped &&
      completedLap >= 1 &&
      fuelUsed > 0 &&
      lapTime >= MIN_LAP_TIME
    ) {
      const wasTowed = this.wasTowedDuringLap;
      const isOutlier = !validateLap(fuelUsed, lapTime, [
        ...history.getRecentLaps(10),
      ]);
      const lap: FuelLapData = {
        lapNumber: completedLap,
        fuelUsed,
        lapTime,
        isGreenFlag: this.isLapFullyGreen,
        isValidForCalc: !wasTowed && !isOutlier && this.isLapFullyGreen,
        isOutLap: this.state.wasOnPitRoad,
        isInLap: this.wasOnPitRoadDuringLap,
        wasTowed,
        timestamp: this.clock.now(),
        sessionNum: frame.sessionNum,
      };
      commands.push({ type: 'lapCompleted', lap });
      if (settings.persistLaps) commands.push({ type: 'saveLap', lap });
    }

    this.wasTowedDuringLap = false;
    this.wasOnPitRoadDuringLap = false;
    this.isLapFullyGreen = isGreenFlag(frame.sessionFlags);
    this.state.isLapDistPctReset = false;
    this.resetProjection();
    this.startLap(
      frame,
      Math.max(frame.lap, completedLap + 1),
      !isFirstFrame && !lapsSkipped
    );
    return commands;
  }

  project(input: FuelProjectionInput): number {
    if (this.lastSmoothedLap !== input.lap) {
      this.smoothedProjectedUsage = 0;
      this.lastSmoothedLap = input.lap;
    }

    let historicalReference = input.avgConsumption;
    if (
      input.lastLapUsage > 0 &&
      input.avgConsumption > 0 &&
      Math.abs(input.lastLapUsage - input.avgConsumption) /
        input.avgConsumption <
        0.2
    ) {
      historicalReference = input.lastLapUsage;
    } else if (historicalReference === 0 && input.qualifyConsumption) {
      historicalReference = input.qualifyConsumption;
    }
    if (historicalReference <= 0) historicalReference = 3.2;

    let projected = historicalReference;
    if (
      input.currentFuel <= input.lapStartFuel &&
      !this.state.isLapDistPctReset &&
      input.lapDistPct <= 0.99 &&
      input.lapDistPct >= 0.001
    ) {
      const safeProjection = Math.max(
        0.1,
        Math.min(20, input.currentLapUsage / input.lapDistPct)
      );
      const confidence =
        input.lapDistPct < 0.5
          ? input.lapDistPct
          : 0.5 + ((input.lapDistPct - 0.5) / 0.5) * 0.3;
      projected =
        (safeProjection * confidence + historicalReference * (1 - confidence)) *
        (1.02 + 0.05 * (1 - confidence));
      if (this.lastProjectedUsage !== null && this.lastProjectedUsage > 0) {
        projected = Math.max(
          this.lastProjectedUsage * (1 - MAX_PROJECTION_CHANGE_PERCENT),
          Math.min(
            this.lastProjectedUsage * (1 + MAX_PROJECTION_CHANGE_PERCENT),
            projected
          )
        );
      }
    }
    this.lastProjectedUsage = projected;

    let smoothingFactor = Math.min(0.3, 0.1 * (1 + input.lapDistPct * 2));
    if (input.lapDistPct > 0.9) smoothingFactor = 0.05;
    if (this.smoothedProjectedUsage === 0) {
      this.smoothedProjectedUsage = projected;
    } else {
      const delta = projected - this.smoothedProjectedUsage;
      const target =
        Math.abs(delta) > 0.2
          ? this.smoothedProjectedUsage + Math.sign(delta) * 0.2
          : projected;
      this.smoothedProjectedUsage +=
        (target - this.smoothedProjectedUsage) * smoothingFactor;
    }
    return this.smoothedProjectedUsage;
  }

  /**
   * Starts measuring a lap at this frame. It is the whole lap when the car
   * was seen to cross the line into it, or is found no further past the line
   * than a frame could have left it. Started anywhere else, the lap is
   * measured for the display and never recorded.
   */
  private startLap(
    frame: FuelEngineFrame,
    lap = frame.lap,
    crossedLine = false
  ): void {
    this.state.lastLapDistPct = frame.lapDistPct;
    this.state.lapStartFuel = frame.fuelLevel;
    this.state.lapCrossingTime = frame.sessionTime;
    this.state.lastLap = lap;
    this.state.wasOnPitRoad = frame.onPitRoad;
    this.state.accumulatedRefuel = 0;
    this.lapFromLine =
      crossedLine ||
      (frame.lapDistPct >= 0 && frame.lapDistPct <= LAP_START_TOLERANCE);
    this.logger.debug(`Fuel lap ${lap} started`);
  }

  private resetProjection(): void {
    this.lastProjectedUsage = null;
    this.smoothedProjectedUsage = 0;
    this.lastSmoothedLap = -1;
  }
}
