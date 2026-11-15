import type {
  LapCurve,
  LapInput,
  LapSessionInput,
  Session,
  Telemetry,
} from '@irdashies/types';
import { voidFlagIsThisLaps } from '../../shared/lapValidity';
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

/** A lap as the recorder closed it, for whoever follows the same laps. */
export interface ClosedLap {
  session: LapSessionInput;
  lap: LapInput;
  /** Session clock at the two ends, seconds. */
  startTime: number;
  endTime: number;
  /** Opened by the car being let go from the line, not at a crossing. */
  fromStart: boolean;
}

/**
 * Told where the recorder's laps begin and end, so that whatever else is
 * measured per lap is measured over the very same laps. Called whether or
 * not laps are being stored.
 */
export interface PlayerLapHooks {
  /**
   * A lap opened: at a line crossing, or, with `fromStart`, by the car
   * being let go from the line. At a crossing that also ended a lap this
   * follows `onLapClosed` on the same frame.
   */
  onLapOpened?(startTime: number, frame: Telemetry, fromStart: boolean): void;
  /** A lap ended at the line. Called before the lap is handed to the sink. */
  onLapClosed?(closed: ClosedLap, frame: Telemetry): void;
  /** The lap under way was given up; there will be no row for it. */
  onLapAbandoned?(): void;
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
  hooks?: PlayerLapHooks;
}

/** Conversion from the m/s of the raw `Speed` channel to the km/h stored. */
const MS_TO_KPH = 3.6;
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
/**
 * A car let go from the line is first seen this close to it. Further round,
 * a fraction that leaves 0 is the sim placing the car somewhere, not a start.
 */
const RELEASE_MAX_PCT = 0.05;

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
  /** Opened by a release from the line: its start was not a crossing. */
  fromStart: boolean;
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
 * driven before the first crossing -- leaving the pits, joining mid-lap --
 * is not a lap and is not recorded. The one lap that does not begin at a
 * crossing is the first of a Le Mans Ultimate race: the sim holds a car
 * rolling up to the start at a lap fraction of exactly 0 and lets it go at
 * the line, so no crossing is ever seen. That lap opens when the fraction is
 * let go, is marked as begun from the start, and is kept without a curve:
 * its first metres were not sampled and its clock did not start at a
 * crossing, so it can never be a reference.
 *
 * Timing and storing are separate. Laps are timed, and the hooks told of
 * them, for as long as the recorder is enabled; `setPersisting(false)` only
 * stops them being handed to the sink, which is what a tape, a replay
 * source and demo mode want.
 */
export class PlayerLapRecorder {
  private playerCarIdx = -1;
  /** False while the sim names no car for the player. */
  private playerPresent = false;
  /** What the laps are filed under, kept while the player is out of the car. */
  private carKey = '';
  private carName = '';
  private sessionInfo: Session | null = null;
  private identity = '';
  private trackLengthM = 0;
  private pointsCount = 0;
  private interval = 0;
  private backwardJumpPct = 0;

  private enabled = true;
  private persisting = true;
  private sessionNum: number | null = null;
  private tokenCounter = 0;
  private token = '';
  private active: ActiveLap | null = null;
  private prevPct: number | null = null;
  private prevTime: number | null = null;
  /** The frame before this one had the car held at the line. */
  private heldAtLine = false;
  private readonly hooks: PlayerLapHooks;

  constructor(
    private readonly sink: PlayerLapSink,
    private readonly options: PlayerLapRecorderOptions
  ) {
    this.hooks = options.hooks ?? {};
    this.nextToken();
  }

  /**
   * Stops or resumes timing altogether: no laps, and no word to the hooks.
   * A lap under way when stopped is dropped.
   */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.abandonLap();
  }

  /**
   * Stops or resumes handing laps to the sink. Laps are timed and the hooks
   * are called all the same, and the lap under way carries on.
   */
  setPersisting(persisting: boolean): void {
    this.persisting = persisting;
  }

  /** Names the session laps are filed under: one run of one session. */
  sessionToken(): string {
    return this.token;
  }

  /** Moves when the event, track or car is another one. */
  identityKey(): string {
    return this.identity;
  }

  /** False while the sim names no car for the player. */
  hasPlayer(): boolean {
    return this.playerPresent && this.playerCarIdx >= 0;
  }

  /** The player's slot, or -1. */
  playerSlot(): number {
    return this.playerCarIdx;
  }

  /** How many ten-metre points a lap of this track has; 0 when unknown. */
  curvePoints(): number {
    return this.pointsCount;
  }

  /** Whether a lap is being timed. */
  hasOpenLap(): boolean {
    return this.active !== null;
  }

  /**
   * The session a lap closed now would be filed under, or null before the
   * sim has described one.
   */
  currentSession(): LapSessionInput | null {
    return this.sessionInfo && this.carKey !== ''
      ? this.sessionInput(this.sessionInfo)
      : null;
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
    // Le Mans Ultimate names the model apart from CarPath, which there is the
    // livery file and differs between two entries of one car. It names it
    // only while the entry has a telemetry block, so without a model the car
    // is not known, rather than being a different one.
    const carKey =
      this.options.simulator === 'lmu'
        ? (player?.CarModel ?? '')
        : (player?.CarModel ?? player?.CarPath ?? '');
    if (playerCarIdx < 0 || carKey === '') {
      // Out of the car: at the monitor under LMU the sim names no player at
      // all. That is not a different car and not the end of the session, so
      // what follows the return to the car carries on in the same one. The
      // lap that was being driven is over all the same.
      this.playerPresent = false;
      this.abandonLap();
      return;
    }
    this.playerPresent = true;
    this.carName = player?.CarScreenName || carKey;
    const trackLengthM = trackLengthFrom(session);
    const identity = [
      session.WeekendInfo?.SubSessionID ?? -1,
      session.WeekendInfo?.TrackID ?? -1,
      trackLengthM,
      playerCarIdx,
      carKey,
    ].join('|');
    if (identity === this.identity) return;
    // A different event, track or car: not a continuation of anything.
    this.identity = identity;
    this.playerCarIdx = playerCarIdx;
    this.carKey = carKey;
    this.trackLengthM = trackLengthM;
    this.pointsCount = trackLengthM > 0 ? pointsCountFor(trackLengthM) : 0;
    this.interval = this.pointsCount > 0 ? intervalFor(this.pointsCount) : 0;
    this.backwardJumpPct =
      trackLengthM > 0 ? BACKWARD_JUMP_METERS / trackLengthM : 0.02;
    this.abandonLap();
    this.nextToken();
  }

  onFrame(frame: Telemetry): void {
    if (
      !this.enabled ||
      !this.playerPresent ||
      this.pointsCount === 0 ||
      this.playerCarIdx < 0
    ) {
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
    const wasHeld = this.heldAtLine;
    this.prevTime = sessionTime;
    this.heldAtLine = false;
    if (trackPct === null || trackPct < 0 || trackPct > 1) {
      this.abandonLap();
      return;
    }
    if (isHeldAtLine(trackPct)) {
      this.abandonLap();
      this.heldAtLine = true;
      return;
    }
    this.prevPct = trackPct;
    if (
      wasHeld &&
      this.isRelease(trackPct, frame) &&
      prevTime !== null &&
      sessionTime >= prevTime
    ) {
      // Let go from the line: the first lap of the race starts here.
      this.openLap(sessionTime, frame, true);
      this.sample(this.active as ActiveLap, trackPct, sessionTime, frame);
      return;
    }
    if (prevPct === null || prevTime === null) return;
    // The clock ran backwards: a restart, or a replay being scrubbed.
    if (sessionTime < prevTime) {
      this.dropLap();
      return;
    }

    if (isLineCrossing(prevPct, trackPct)) {
      const crossedAt = crossingTime(prevPct, trackPct, prevTime, sessionTime);
      if (this.active) this.finishLap(this.active, crossedAt, frame);
      this.openLap(crossedAt, frame, false);
      // The frame that revealed the crossing is the new lap's first sample.
      this.sample(this.active as ActiveLap, trackPct, sessionTime, frame);
      return;
    }

    const lap = this.active;
    if (!lap) return;
    const moved = trackPct - prevPct;
    if (moved < -this.backwardJumpPct || moved > FORWARD_JUMP_PCT) {
      // Put back in the pits, or reset: the lap was not driven to its end.
      this.dropLap();
      return;
    }
    this.sample(lap, trackPct, sessionTime, frame);
  }

  /**
   * Whether a fraction that has just left 0 is the car being let go from the
   * line. Only Le Mans Ultimate holds a car at 0, and only a car on the
   * track is let go: one that the sim has placed in the pit lane or its
   * garage has not started a lap by appearing there.
   */
  private isRelease(trackPct: number, frame: Telemetry): boolean {
    return (
      this.options.simulator === 'lmu' &&
      trackPct < RELEASE_MAX_PCT &&
      !flagAt(frame, 'CarIdxOnPitRoad', this.playerCarIdx) &&
      !flagAt(frame, 'IsInGarage')
    );
  }

  private openLap(
    startTime: number,
    frame: Telemetry,
    fromStart: boolean
  ): void {
    this.active = {
      startTime,
      fromStart,
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
    this.hooks.onLapOpened?.(startTime, frame, fromStart);
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
    if (flagAt(frame, 'LmuLapInvalidated') && voidFlagIsThisLaps(trackPct)) {
      lap.voided = true;
    }
    if (!flagAt(frame, 'IsOnTrack')) lap.own = false;
    if (lap.lapNumber === null && trackPct >= LAP_NUMBER_PCT) {
      // The lap being driven, the way a driver counts: 1 on the first.
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
    if (!(lapTime > 0) || !this.sessionInfo) {
      this.hooks.onLapAbandoned?.();
      return;
    }
    // A lap let go from the line has no crossing to hang its curve on.
    const complete =
      !lap.fromStart && lap.contiguous && !lap.pointPos.includes(-1);
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
    const session = this.sessionInput(this.sessionInfo);
    const input: LapInput = {
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
    };
    this.hooks.onLapClosed?.(
      {
        session,
        lap: input,
        startTime: lap.startTime,
        endTime: finishTime,
        fromStart: lap.fromStart,
      },
      frame
    );
    if (this.persisting) this.sink.record(session, input);
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
      carKey: this.carKey,
      carName: this.carName,
      sessionType: current?.SessionType || null,
      sessionName: current?.SessionName || null,
    };
  }

  /** Gives up the lap under way; the next one starts at a crossing seen. */
  private abandonLap(): void {
    this.dropLap();
    this.prevPct = null;
    this.heldAtLine = false;
  }

  /** Gives up the lap under way and keeps following the car. */
  private dropLap(): void {
    if (this.active) {
      this.active = null;
      this.hooks.onLapAbandoned?.();
    }
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
