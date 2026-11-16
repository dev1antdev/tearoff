import type {
  Session,
  SessionLifecycleEvent,
  SessionTimingSnapshot,
  Telemetry,
} from '@irdashies/types';
import { SessionState } from '../irsdk/types/enums';
import type { TelemetryProcessor } from './TelemetryProcessor';

const UPDATE_INTERVAL_SECONDS = 0.2;
const TIME_EPSILON = 1e-6;
/**
 * The sim whose time remaining in a race is the race's own countdown from
 * the green flag. iRacing's is left as it was: nothing here has measured
 * what its figure does before and after the green.
 */
const SIM_COUNTING_RACE_DOWN = 'Le Mans Ultimate';

const numberValue = (frame: Telemetry, key: keyof Telemetry): number | null => {
  const value = frame[key]?.value?.[0];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const numberArray = (frame: Telemetry, key: keyof Telemetry): unknown[] => {
  const value = frame[key]?.value;
  return Array.isArray(value) ? value : [];
};

const finiteAt = (values: unknown[], index: number | null): number => {
  if (index === null || index < 0) return 0;
  const value = values[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

/** LMU's finish status of a car that has taken the flag. */
const LMU_FINISHED = 1;

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * The stop the focus car still has to make before the end, for the one lap
 * it can cost at the flag.
 */
export interface FinalStop {
  /** Stops still needed to reach the end. Only exactly one is counted. */
  stopsToGo: number;
  /** Seconds the stop costs against staying out, pit lane included. */
  seconds: number;
}

/** All five, always: they are optional only for snapshots made before them. */
type RaceProjection = Required<
  Pick<
    SessionTimingSnapshot,
    | 'lapsCompleted'
    | 'lapProgress'
    | 'projectedLaps'
    | 'projectedLapsExact'
    | 'extraLaps'
  >
>;

export class SessionTimingProcessor implements TelemetryProcessor<SessionTimingSnapshot> {
  readonly channel = 'session-timing.snapshot';
  readonly tickRateHz = 5;

  private session?: Session;
  private driverCarIdx: number | null = null;
  private lastUpdateTime: number | null = null;
  private previousSessionState: number | null = null;
  private previousLeaderLap: number | null = null;
  private greenFlagTimestamp: number | null = null;
  private checkeredLap: number | null = null;
  private lateJoin = false;
  /** Whether the sim's own time remaining is the race's countdown. */
  private simCountsRaceDown = false;
  private enabled = true;
  private latest = this.emptySnapshot();

  /**
   * @param lapTimes Each car's pace, by CarIdx: `lap-times.snapshot`.
   * @param finalStop The focus car's last stop, where something knows it.
   *   Without it a late stop takes no lap off the forecast.
   */
  constructor(
    private readonly lapTimes: () => readonly number[] = () => [],
    private readonly finalStop: () => FinalStop | null = () => null
  ) {}

  init(session: Session): void {
    this.session = session;
    this.simCountsRaceDown =
      session.WeekendInfo?.SimMode === SIM_COUNTING_RACE_DOWN;
    const carIdx = session.DriverInfo?.DriverCarIdx;
    this.driverCarIdx =
      typeof carIdx === 'number' && carIdx >= 0 ? carIdx : null;
  }

  onFrame(frame: Telemetry): void {
    if (!this.enabled) return;
    const sessionTime = numberValue(frame, 'SessionTime');
    if (sessionTime === null) return;
    const sessionNum = numberValue(frame, 'SessionNum');
    const focusCarIdx = this.focusCarIdx(frame);
    const timeWentBackwards =
      this.lastUpdateTime !== null && sessionTime < this.lastUpdateTime;
    const sessionChanged =
      this.latest.sessionNum !== null && sessionNum !== this.latest.sessionNum;
    if (timeWentBackwards || sessionChanged) this.reset(sessionNum);
    if (
      this.lastUpdateTime !== null &&
      sessionTime - this.lastUpdateTime < UPDATE_INTERVAL_SECONDS - TIME_EPSILON
    ) {
      return;
    }
    this.lastUpdateTime = sessionTime;

    const state = numberValue(frame, 'SessionState') ?? 0;
    const sessionInfo = this.session?.SessionInfo?.Sessions?.find(
      (entry) => entry.SessionNum === sessionNum
    );
    const sessionType = sessionInfo?.SessionType;
    const laps = numberArray(frame, 'CarIdxLap');
    const positions = numberArray(frame, 'CarIdxPosition');
    const lapDistPcts = numberArray(frame, 'CarIdxLapDistPct');
    const currentLap = finiteAt(laps, focusCarIdx);
    let leaderCarIdx = -1;
    for (let index = 0; index < positions.length; index += 1) {
      if (positions[index] === 1) {
        leaderCarIdx = index;
        break;
      }
    }
    const leaderLap = finiteAt(laps, leaderCarIdx);
    const leaderLapDistPct = finiteAt(lapDistPcts, leaderCarIdx);

    const timeTotal = numberValue(frame, 'SessionTimeTotal') ?? 0;
    const rawTimeRemaining = numberValue(frame, 'SessionTimeRemain') ?? 0;
    this.updateGreenFlag(
      sessionType,
      state,
      sessionTime,
      leaderCarIdx,
      leaderLap,
      timeTotal,
      rawTimeRemaining
    );
    if (state >= SessionState.Checkered) {
      if (this.checkeredLap === null && currentLap > 0) {
        this.checkeredLap = currentLap;
      }
    } else {
      this.checkeredLap = null;
    }

    const timeRemaining =
      sessionType === 'Race' &&
      state === SessionState.GetInCar &&
      rawTimeRemaining >= 604800 &&
      timeTotal >= 604800
        ? -1
        : rawTimeRemaining;
    const totalLaps =
      typeof sessionInfo?.SessionLaps === 'number'
        ? sessionInfo.SessionLaps
        : 0;
    const fixedLapRace = !(timeRemaining > 0 && timeRemaining !== 604800);
    const displayLap =
      state >= SessionState.Checkered
        ? (this.checkeredLap ?? currentLap)
        : currentLap;
    const raceValues = this.calculateRaceValues(
      frame,
      sessionType,
      state,
      focusCarIdx,
      displayLap,
      leaderCarIdx,
      leaderLap,
      leaderLapDistPct,
      totalLaps,
      timeRemaining,
      timeTotal,
      fixedLapRace
    );
    const projection = this.calculateProjection(
      frame,
      sessionType,
      state,
      focusCarIdx,
      leaderCarIdx,
      laps,
      lapDistPcts,
      totalLaps,
      timeRemaining,
      fixedLapRace,
      raceValues.totalRaceLaps
    );

    this.latest = {
      sessionType,
      state,
      currentLap: displayLap,
      totalLaps,
      time: sessionTime,
      timeTotal,
      timeRemaining,
      greenFlagTimestamp: this.greenFlagTimestamp ?? 0,
      isFixedLapRace: fixedLapRace,
      ...raceValues,
      ...projection,
      sessionNum,
      version: this.latest.version + 1,
    };
    this.previousSessionState = state;
    this.previousLeaderLap = leaderLap;
  }

  onLifecycle(event: SessionLifecycleEvent): void {
    if (event.type === 'enter') {
      this.enabled = !event.replay;
      if (event.replay) this.reset(null);
      return;
    }
    this.reset(null);
  }

  snapshot(): SessionTimingSnapshot {
    return this.latest;
  }

  private focusCarIdx(frame: Telemetry): number | null {
    const cameraCarIdx = numberValue(frame, 'CamCarIdx');
    return cameraCarIdx !== null && cameraCarIdx >= 0
      ? cameraCarIdx
      : this.driverCarIdx;
  }

  private updateGreenFlag(
    sessionType: string | undefined,
    state: number,
    sessionTime: number,
    leaderCarIdx: number,
    leaderLap: number,
    timeTotal: number,
    timeRemaining: number
  ): void {
    // Le Mans Ultimate counts a timed race down itself, so the green flag is
    // where that count puts it: the race's length less what is left, back
    // from now. Kept to on every update rather than worked out once, so the
    // time remaining the widgets take from it is the sim's own figure whatever
    // happened to this processor in between.
    //
    // What it replaces is a guess. A processor that first sees a race already
    // under way puts the green flag a number of laps back at an assumed lap
    // time, and under LMU that happened over and over: each pause used to
    // hide the overlay and destroy this processor, each trip out of the car
    // reset it, and the lap time it then fell back on is the sim's one
    // reference lap for every class. In a four-hour race the clock on the
    // overlay ran out many minutes before the race did.
    if (
      this.simCountsRaceDown &&
      sessionType === 'Race' &&
      state === SessionState.Racing &&
      timeTotal > 0 &&
      timeRemaining > 0 &&
      timeRemaining <= timeTotal
    ) {
      this.greenFlagTimestamp = sessionTime - (timeTotal - timeRemaining);
      this.lateJoin = false;
      return;
    }
    if (
      sessionType === 'Race' &&
      this.greenFlagTimestamp === null &&
      state === SessionState.Racing
    ) {
      if (
        this.previousSessionState !== null &&
        this.previousSessionState < SessionState.Racing
      ) {
        this.greenFlagTimestamp = sessionTime;
        this.lateJoin = false;
      } else if (this.previousSessionState === null) {
        this.lateJoin = true;
      }
    }
    if (
      this.lateJoin &&
      sessionType === 'Race' &&
      state === SessionState.Racing &&
      this.previousLeaderLap !== null &&
      leaderLap > this.previousLeaderLap &&
      leaderLap > 0
    ) {
      const averageLapTime = this.averageLapTime(leaderCarIdx);
      if (averageLapTime > 0) {
        // The leader has just started this lap, so the race is the laps
        // before it old. Counted with this lap as well, a race joined after
        // its start was a lap further along than it was.
        this.greenFlagTimestamp =
          sessionTime - (leaderLap - 1) * averageLapTime;
        this.lateJoin = false;
      }
    }
  }

  private calculateRaceValues(
    frame: Telemetry,
    sessionType: string | undefined,
    state: number,
    focusCarIdx: number | null,
    currentLap: number,
    leaderCarIdx: number,
    leaderLap: number,
    leaderLapDistPct: number,
    totalLaps: number,
    timeRemaining: number,
    timeTotal: number,
    fixedLapRace: boolean
  ): Pick<
    SessionTimingSnapshot,
    'totalRaceLaps' | 'totalRaceTime' | 'adjustedRaceTime'
  > {
    let totalRaceLaps = 0;
    let totalRaceTime = 0;
    let adjustedRaceTime = 0;

    const lapDistPct = numberValue(frame, 'LapDistPct') ?? 0;
    const focusBestLap = finiteAt(
      numberArray(frame, 'CarIdxBestLapTime'),
      focusCarIdx
    );
    const averageLapTime =
      this.averageLapTime(leaderCarIdx >= 0 ? leaderCarIdx : focusCarIdx) ||
      focusBestLap;
    const lapsValid = currentLap > 0 && leaderLap > 0;
    if (fixedLapRace) {
      totalRaceLaps = totalLaps;
      if (lapsValid) {
        totalRaceLaps -= Math.max(
          0,
          Math.floor(leaderLap + leaderLapDistPct - (currentLap + lapDistPct))
        );
      }
      if (averageLapTime > 0) {
        totalRaceTime = totalLaps * averageLapTime;
        adjustedRaceTime = totalRaceLaps * averageLapTime;
      }
    } else {
      totalRaceTime = timeTotal;
      if (averageLapTime > 0) {
        totalRaceLaps =
          currentLap === 0
            ? timeTotal / averageLapTime
            : timeRemaining / averageLapTime +
              (leaderLap - 1) +
              leaderLapDistPct;
        if (leaderLap > currentLap + 1) {
          totalRaceLaps -= Math.floor(leaderLap - currentLap);
        }
        if (totalLaps > 0) totalRaceLaps = Math.min(totalRaceLaps, totalLaps);
      }
    }
    if (state >= SessionState.Checkered) totalRaceLaps = currentLap;
    return { totalRaceLaps, totalRaceTime, adjustedRaceTime };
  }

  /**
   * Where the focus car is in its race and where it will be at the flag.
   *
   * The laps completed and the share of the lap are the car's own in any
   * session. The rest is a race's, under green:
   *
   * - A race decided by laps ends on the scheduled lap, less the whole laps
   *   the car is down: exact, and nothing to add.
   * - A race decided by the clock ends for this car where its pace puts it
   *   when the time runs out, which is a fraction of a lap. It then finishes
   *   the lap it is on, so the laps it has to do are that rounded up, and
   *   two things can move the whole number: the leader still has to finish
   *   his lap after the clock stops, which gives everyone behind him that
   *   much more time (+1 lap when it carries the car over the line once
   *   more), and a last pit stop takes time away (-1 when it keeps the car
   *   from starting a lap).
   *
   * Nothing is projected without a pace: a figure made from a guessed lap
   * time would be printed with the same confidence as a measured one.
   */
  private calculateProjection(
    frame: Telemetry,
    sessionType: string | undefined,
    state: number,
    focusCarIdx: number | null,
    leaderCarIdx: number,
    laps: unknown[],
    lapDistPcts: unknown[],
    totalLaps: number,
    timeRemaining: number,
    fixedLapRace: boolean,
    totalRaceLaps: number
  ): RaceProjection {
    const completed = numberArray(frame, 'CarIdxLapCompleted');
    // The lap a car is on, less one, where the sim gives no completed count.
    const lapsDone = (carIdx: number | null): number =>
      Math.max(
        0,
        carIdx !== null && typeof completed[carIdx] === 'number'
          ? finiteAt(completed, carIdx)
          : finiteAt(laps, carIdx) - 1
      );
    const fractionOf = (carIdx: number | null): number =>
      Math.min(Math.max(finiteAt(lapDistPcts, carIdx), 0), 1);

    const lapsCompleted = lapsDone(focusCarIdx);
    const fraction = fractionOf(focusCarIdx);
    const base = {
      lapsCompleted,
      // Rounded down, so the figure never reads a full lap before the line.
      lapProgress: Math.min(Math.floor(fraction * 100 + 1e-9) / 100, 0.99),
    };
    const none: RaceProjection = {
      ...base,
      projectedLaps: 0,
      projectedLapsExact: false,
      extraLaps: 0,
    };

    if (sessionType !== 'Race') return none;
    if (state >= SessionState.Checkered) {
      return {
        ...none,
        projectedLaps: lapsCompleted,
        projectedLapsExact: true,
      };
    }
    if (state !== SessionState.Racing) return none;
    if (fixedLapRace && totalLaps > 0) {
      return {
        ...none,
        projectedLaps: totalRaceLaps,
        projectedLapsExact: true,
      };
    }

    const bestLaps = numberArray(frame, 'CarIdxBestLapTime');
    const focusPace = this.pace(focusCarIdx, bestLaps);
    if (!(focusPace > 0)) return none;
    const remaining = Math.max(timeRemaining, 0);
    const projected = lapsCompleted + fraction + remaining / focusPace;
    // A race with both limits ends on whichever comes first.
    if (totalLaps > 0 && projected >= totalLaps) {
      return { ...none, projectedLaps: totalLaps };
    }

    /** Laps still to finish, this one included, with `seconds` on the clock. */
    const whole = (seconds: number): number =>
      Math.ceil(Math.max(seconds, 0) / focusPace + fraction);
    let extraLaps = 0;
    const leaderPace =
      leaderCarIdx >= 0 && leaderCarIdx !== focusCarIdx
        ? this.pace(leaderCarIdx, bestLaps)
        : 0;
    const leaderFinished =
      numberArray(frame, 'LmuCarIdxFinishStatus')[leaderCarIdx] ===
      LMU_FINISHED;
    if (leaderPace > 0 && !leaderFinished) {
      const leaderAtZero =
        lapsDone(leaderCarIdx) +
        fractionOf(leaderCarIdx) +
        remaining / leaderPace;
      const intoLap = leaderAtZero - Math.floor(leaderAtZero);
      const overrun = intoLap > 0 ? (1 - intoLap) * leaderPace : 0;
      extraLaps += whole(remaining + overrun) - whole(remaining);
      const stop = this.finalStop();
      if (stop && stop.stopsToGo === 1 && stop.seconds > 0) {
        extraLaps += whole(remaining - stop.seconds) - whole(remaining);
      }
    }

    return {
      ...base,
      projectedLaps: round2(projected),
      projectedLapsExact: false,
      extraLaps,
    };
  }

  /**
   * A car's pace for a projection: its recent laps, then its class's
   * estimate, then its own best lap. 0 where none of them reads.
   */
  private pace(carIdx: number | null, bestLaps: unknown[]): number {
    const average = this.averageLapTime(carIdx);
    if (average > 0) return average;
    const best = finiteAt(bestLaps, carIdx);
    return best > 1 ? best : 0;
  }

  private averageLapTime(carIdx: number | null): number {
    if (carIdx === null || carIdx < 0) return 0;
    const average = this.lapTimes()[carIdx] ?? 0;
    if (average > 0) return average;
    const driver = this.session?.DriverInfo?.Drivers?.find(
      (entry) => entry?.CarIdx === carIdx
    );
    const estimate = driver?.CarClassEstLapTime;
    return typeof estimate === 'number' && estimate > 1 ? estimate : 0;
  }

  private reset(sessionNum: number | null): void {
    const version = this.latest.version + 1;
    this.lastUpdateTime = null;
    this.previousSessionState = null;
    this.previousLeaderLap = null;
    this.greenFlagTimestamp = null;
    this.checkeredLap = null;
    this.lateJoin = false;
    this.latest = { ...this.emptySnapshot(), sessionNum, version };
  }

  private emptySnapshot(): SessionTimingSnapshot {
    return {
      state: 0,
      currentLap: 0,
      totalLaps: 0,
      time: 0,
      timeTotal: 0,
      timeRemaining: 0,
      greenFlagTimestamp: 0,
      isFixedLapRace: true,
      totalRaceLaps: 0,
      totalRaceTime: 0,
      adjustedRaceTime: 0,
      lapsCompleted: 0,
      lapProgress: 0,
      projectedLaps: 0,
      projectedLapsExact: false,
      extraLaps: 0,
      sessionNum: null,
      version: 0,
    };
  }
}
