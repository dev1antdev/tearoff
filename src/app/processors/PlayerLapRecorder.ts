import type {
  LapCurve,
  LapInput,
  LapSessionInput,
  Session,
  Telemetry,
} from '@irdashies/types';
import {
  bucketIndex,
  crossingTime,
  intervalFor,
  isHeldAtLine,
  isLineCrossing,
  pointsCountFor,
  trackLengthFrom,
} from './lapTiming';

/** Where finished laps go. The recorder itself keeps nothing. */
export interface PlayerLapSink {
  record(session: LapSessionInput, lap: LapInput): void;
}

export interface PlayerLapRecorderOptions {
  /** 'iracing' or 'lmu'. */
  simulator: string;
  /** Wall-clock time in Unix milliseconds. */
  now: () => number;
  /**
   * Distinguishes one run of the app from the next, so the session tokens of
   * two runs never collide.
   */
  bootId: string;
}

/** Conversion from the m/s of the raw `Speed` channel to the km/h stored. */
const MS_TO_KPH = 3.6;
/** Where a lap is far enough from the line that LMU's void flag is its own. */
const INVALIDATION_START_PCT = 0.05;
/**
 * Further back than this in one step is not driving: the car was returned to
 * its pit, or the sim reset it. A spin that rolls backwards stays inside it.
 */
const BACKWARD_JUMP_METERS = 50;
/** Further forward than this in one step is not driving either. */
const FORWARD_JUMP_PCT = 0.25;
/**
 * Where the sim's lap number is read. At the line itself it may or may not
 * have moved on yet; a tenth of the way round it has.
 */
const LAP_NUMBER_PCT = 0.1;

const numberAt = (
  frame: Telemetry,
  key: keyof Telemetry,
  index = 0
): number | null => {
  const value = (frame[key]?.value as unknown[] | undefined)?.[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const flagAt = (frame: Telemetry, key: keyof Telemetry, index = 0): boolean => {
  const value = (frame[key]?.value as unknown[] | undefined)?.[index];
  return value === true || value === 1;
};

/** The lap being driven, from the crossing that began it. */
interface ActiveLap {
  startTime: number;
  lapNumber: number | null;
  pointPos: Float32Array;
  times: Float32Array;
  speedsKph: Float32Array;
  /** False once a ten-metre stretch went by unsampled. */
  contiguous: boolean;
  /** False once any sample had no speed to go with it. */
  hasSpeeds: boolean;
  pit: boolean;
  voided: boolean;
  own: boolean;
  incidentsAtStart: number | null;
  fuelAtStart: number | null;
  energyAtStart: number | null;
}

/**
 * Records every lap the player completes, for the lap library.
 *
 * Unlike the reference recorder, which runs only while a widget wants
 * reference laps and keeps only the best, this sees every frame for as long
 * as a session runs and passes on every lap: quick or slow, clean or not,
 * with what is known about it. Whether a lap is fit to be a reference is
 * decided from those facts later, not here.
 *
 * A lap is timed between two line crossings that were both seen. The stretch
 * driven before the first crossing -- leaving the pits, joining mid-lap, the
 * start of a race in Le Mans Ultimate -- is not a lap and is not recorded.
 */
export class PlayerLapRecorder {
  private playerCarIdx = -1;
  private sessionInfo: Session | null = null;
  private identity = '';
  private trackLengthM = 0;
  private pointsCount = 0;
  private interval = 0;
  private backwardJumpPct = 0;

  private enabled = true;
  private sessionNum: number | null = null;
  private tokenCounter = 0;
  private token = '';
  private active: ActiveLap | null = null;
  private prevPct: number | null = null;
  private prevTime: number | null = null;

  constructor(
    private readonly sink: PlayerLapSink,
    private readonly options: PlayerLapRecorderOptions
  ) {
    this.nextToken();
  }

  /** Stops or resumes recording. A lap under way when stopped is dropped. */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.abandonLap();
  }

  /**
   * A new connection to the sim: whatever was being driven before is over,
   * and what follows is listed as its own session.
   */
  onEnter(): void {
    this.abandonLap();
    this.sessionNum = null;
    this.nextToken();
  }

  onDisconnect(): void {
    this.abandonLap();
    this.sessionNum = null;
  }

  onSession(session: Session): void {
    this.sessionInfo = session;
    const playerCarIdx = session.DriverInfo?.DriverCarIdx ?? -1;
    const player = session.DriverInfo?.Drivers?.find(
      (driver) => driver?.CarIdx === playerCarIdx
    );
    const trackLengthM = trackLengthFrom(session);
    const identity = [
      session.WeekendInfo?.SubSessionID ?? -1,
      session.WeekendInfo?.TrackID ?? -1,
      trackLengthM,
      playerCarIdx,
      player?.CarModel ?? player?.CarPath ?? '',
    ].join('|');
    if (identity === this.identity) return;
    // A different event, track or car: not a continuation of anything.
    this.identity = identity;
    this.playerCarIdx = playerCarIdx;
    this.trackLengthM = trackLengthM;
    this.pointsCount = trackLengthM > 0 ? pointsCountFor(trackLengthM) : 0;
    this.interval = this.pointsCount > 0 ? intervalFor(this.pointsCount) : 0;
    this.backwardJumpPct =
      trackLengthM > 0 ? BACKWARD_JUMP_METERS / trackLengthM : 0.02;
    this.abandonLap();
    this.nextToken();
  }

  onFrame(frame: Telemetry): void {
    if (!this.enabled || this.pointsCount === 0 || this.playerCarIdx < 0) {
      return;
    }
    const sessionTime = numberAt(frame, 'SessionTime');
    if (sessionTime === null) return;
    const sessionNum = numberAt(frame, 'SessionNum');
    if (sessionNum !== this.sessionNum) {
      // Practice to qualifying to race: each is listed on its own.
      if (this.sessionNum !== null) this.nextToken();
      this.sessionNum = sessionNum;
      this.abandonLap();
    }

    const trackPct = numberAt(frame, 'CarIdxLapDistPct', this.playerCarIdx);
    const prevPct = this.prevPct;
    const prevTime = this.prevTime;
    this.prevTime = sessionTime;
    if (
      trackPct === null ||
      trackPct < 0 ||
      trackPct > 1 ||
      isHeldAtLine(trackPct)
    ) {
      this.abandonLap();
      return;
    }
    this.prevPct = trackPct;
    if (prevPct === null || prevTime === null) return;
    // The clock ran backwards: a restart, or a replay being scrubbed.
    if (sessionTime < prevTime) {
      this.active = null;
      return;
    }

    if (isLineCrossing(prevPct, trackPct)) {
      const crossedAt = crossingTime(prevPct, trackPct, prevTime, sessionTime);
      if (this.active) this.finishLap(this.active, crossedAt, frame);
      this.active = this.startLap(crossedAt, frame);
      // The frame that revealed the crossing is the new lap's first sample.
      this.sample(this.active, trackPct, sessionTime, frame);
      return;
    }

    const lap = this.active;
    if (!lap) return;
    const moved = trackPct - prevPct;
    if (moved < -this.backwardJumpPct || moved > FORWARD_JUMP_PCT) {
      // Put back in the pits, or reset: the lap was not driven to its end.
      this.active = null;
      return;
    }
    this.sample(lap, trackPct, sessionTime, frame);
  }

  private startLap(startTime: number, frame: Telemetry): ActiveLap {
    return {
      startTime,
      lapNumber: null,
      pointPos: new Float32Array(this.pointsCount).fill(-1),
      times: new Float32Array(this.pointsCount),
      speedsKph: new Float32Array(this.pointsCount),
      contiguous: true,
      hasSpeeds: true,
      pit: false,
      voided: false,
      own: true,
      incidentsAtStart: numberAt(frame, 'PlayerCarMyIncidentCount'),
      fuelAtStart: numberAt(frame, 'FuelLevel'),
      energyAtStart: this.virtualEnergy(frame),
    };
  }

  /** Takes one frame into the lap: its facts, and a curve point if due. */
  private sample(
    lap: ActiveLap,
    trackPct: number,
    sessionTime: number,
    frame: Telemetry
  ): void {
    if (flagAt(frame, 'CarIdxOnPitRoad', this.playerCarIdx)) lap.pit = true;
    // The void flag is ignored just after the line, where it may still be
    // the previous lap's: it stays set for the rest of a voided lap, so a
    // cut early in the lap is caught once past it.
    if (
      flagAt(frame, 'LmuLapInvalidated') &&
      trackPct >= INVALIDATION_START_PCT
    ) {
      lap.voided = true;
    }
    if (!flagAt(frame, 'IsOnTrack')) lap.own = false;
    if (lap.lapNumber === null && trackPct >= LAP_NUMBER_PCT) {
      lap.lapNumber = numberAt(frame, 'Lap');
    }

    const key = bucketIndex(trackPct, this.pointsCount);
    if (lap.pointPos[key] !== -1) return;
    if (key > 0 && lap.pointPos[key - 1] === -1) lap.contiguous = false;
    lap.pointPos[key] = trackPct;
    lap.times[key] = sessionTime - lap.startTime;
    const speedMs = numberAt(frame, 'Speed');
    if (speedMs === null) lap.hasSpeeds = false;
    else lap.speedsKph[key] = speedMs * MS_TO_KPH;
  }

  private finishLap(
    lap: ActiveLap,
    finishTime: number,
    frame: Telemetry
  ): void {
    const lapTime = finishTime - lap.startTime;
    if (!(lapTime > 0) || !this.sessionInfo) return;
    const complete = lap.contiguous && !lap.pointPos.includes(-1);
    const curve: LapCurve | null = complete
      ? {
          interval: this.interval,
          pointPos: lap.pointPos,
          times: lap.times,
          speedsKph: lap.hasSpeeds ? lap.speedsKph : null,
        }
      : null;
    const incidentsNow = numberAt(frame, 'PlayerCarMyIncidentCount');
    const fuelNow = numberAt(frame, 'FuelLevel');
    const energyNow = this.virtualEnergy(frame);
    this.sink.record(this.sessionInput(this.sessionInfo), {
      lapNumber: lap.lapNumber,
      lapTime,
      completedAt: this.options.now(),
      complete,
      pit: lap.pit,
      voided: lap.voided,
      own: lap.own,
      incidents:
        incidentsNow !== null && lap.incidentsAtStart !== null
          ? Math.max(0, incidentsNow - lap.incidentsAtStart)
          : null,
      fuelUsed: used(lap.fuelAtStart, fuelNow),
      energyUsed: used(lap.energyAtStart, energyNow),
      airTemp: numberAt(frame, 'AirTemp'),
      trackTemp:
        numberAt(frame, 'TrackTempCrew') ?? numberAt(frame, 'TrackTemp'),
      curve,
    });
  }

  /**
   * The player's virtual energy, 0..1, or null for a car that runs on fuel
   * and under a sim without it.
   */
  private virtualEnergy(frame: Telemetry): number | null {
    if (!flagAt(frame, 'LmuCarIdxEnergyIsVirtual', this.playerCarIdx)) {
      return null;
    }
    const value = numberAt(
      frame,
      'LmuCarIdxEnergyRemaining',
      this.playerCarIdx
    );
    return value !== null && value >= 0 ? value : null;
  }

  private sessionInput(session: Session): LapSessionInput {
    const weekend = session.WeekendInfo;
    const player = session.DriverInfo?.Drivers?.find(
      (driver) => driver?.CarIdx === this.playerCarIdx
    );
    const current = session.SessionInfo?.Sessions?.find(
      (entry) => entry?.SessionNum === this.sessionNum
    );
    const subSessionId = weekend?.SubSessionID ?? 0;
    return {
      token: this.token,
      simulator: this.options.simulator,
      // Only iRacing's id names one event and no other. Its test sessions
      // all report 0, and LMU's id is derived from the track and session
      // type, which two evenings at the same circuit share.
      sessionKey:
        this.options.simulator === 'iracing' && subSessionId > 0
          ? `${subSessionId}:${this.sessionNum ?? 0}`
          : '',
      trackId: weekend?.TrackID ?? -1,
      trackName: weekend?.TrackDisplayName || weekend?.TrackName || 'Unknown',
      trackConfig: weekend?.TrackConfigName || null,
      trackLengthM: this.trackLengthM,
      carKey: player?.CarModel ?? player?.CarPath ?? '',
      carName:
        player?.CarScreenName || player?.CarModel || player?.CarPath || '',
      sessionType: current?.SessionType || null,
      sessionName: current?.SessionName || null,
    };
  }

  private abandonLap(): void {
    this.active = null;
    this.prevPct = null;
  }

  private nextToken(): void {
    this.tokenCounter += 1;
    this.token = `${this.options.bootId}:${this.tokenCounter}`;
  }
}

/** What was spent between two readings, or null when it cannot be told. */
const used = (atStart: number | null, atEnd: number | null): number | null => {
  if (atStart === null || atEnd === null) return null;
  const spent = atStart - atEnd;
  // More at the end than at the start is a pit stop, not consumption.
  return spent >= 0 ? spent : null;
};
