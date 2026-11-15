import type {
  LapLogSnapshot,
  Session,
  SessionLifecycleEvent,
  Telemetry,
} from '@irdashies/types';
import { GlobalFlags } from '../irsdk/types/enums';
import type { TelemetryProcessor } from './TelemetryProcessor';
import { isAwayFromWheel } from './watchedCar';

const FULL_COURSE_CAUTION_FLAGS =
  GlobalFlags.Caution | GlobalFlags.CautionWaving;

/**
 * How long after the user leaves the wheel a best lap may still appear and
 * be the lap they have just finished. The sim publishes a lap's time a
 * moment after the line, and a driver who crosses it and gets straight out
 * is out of the car by then.
 */
const BEST_LAP_PUBLISH_SECONDS = 5;

const numberValue = (frame: Telemetry, key: keyof Telemetry): number => {
  const value = frame[key]?.value?.[0];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

const booleanValue = (frame: Telemetry, key: keyof Telemetry): boolean => {
  const value = frame[key]?.value?.[0];
  return value === true || value === 1;
};

/**
 * Whether the sim gave the player's last lap no time, from LMU's per-car
 * flags. The flag stands for as long as that lap is the last one: the mapper
 * sets it when the lap ends untimed and drops it when the next lap is timed
 * or its lap-start state is reset for a new session.
 *
 * iRacing publishes no such flag and reads false here for now. Its untimed
 * laps have to be inferred from the incident count and the track surface,
 * which is the shared lap-validity module of a later phase.
 */
const playerLastLapInvalid = (frame: Telemetry): boolean => {
  const playerIdx = frame.PlayerCarIdx?.value?.[0];
  if (typeof playerIdx !== 'number' || playerIdx < 0) return false;
  return frame.LmuCarIdxLastLapInvalid?.value?.[playerIdx] === true;
};

export class LapLogProcessor implements TelemetryProcessor<LapLogSnapshot> {
  readonly channel = 'lap-log.snapshot';
  readonly tickRateHz = 25;
  private readonly bestLaps: number[] = [];
  private readonly latest = this.empty();
  private currentLapUnderCaution = false;
  /** LapBestLapTime on the previous frame, to see a new one appear. */
  private lastBestLapTime = 0;
  /**
   * The user's present spell at the wheel, or their last one: when it
   * began and the last frame of it, on the session clock. Null before the
   * user has been seen at the wheel.
   */
  private spellStart: number | null = null;
  private spellEnd = 0;
  private wasAtWheel = false;

  init(session: Session): void {
    void session;
  }

  onFrame(frame: Telemetry): void {
    const lapCompleted = numberValue(frame, 'LapCompleted');
    const sessionNum = numberValue(frame, 'SessionNum');
    const sessionTime = numberValue(frame, 'SessionTime');
    const sessionChanged =
      sessionNum !== this.latest.sessionNum ||
      sessionTime < this.latest.sessionTime - 5;
    if (sessionChanged || lapCompleted < this.latest.lapCompleted) {
      // A new session or replay rewind must not inherit the old lap's latch.
      this.currentLapUnderCaution = false;
      this.latest.lastLapUnderCaution = false;
      // Nor the best lap of the session before, or a spell at the wheel
      // timed on its clock.
      if (sessionChanged) this.resetOwnBest();
    } else if (lapCompleted > this.latest.lapCompleted) {
      // Retain this result until the next completed lap: LapLastLapTime may
      // arrive after LapCompleted, and the renderer can miss individual ticks.
      this.latest.lastLapUnderCaution = this.currentLapUnderCaution;
      this.currentLapUnderCaution = false;
    }
    this.currentLapUnderCaution ||=
      (numberValue(frame, 'SessionFlags') & FULL_COURSE_CAUTION_FLAGS) !== 0;

    const source = frame.CarIdxBestLapTime?.value;
    this.bestLaps.length = Array.isArray(source) ? source.length : 0;
    for (let index = 0; index < this.bestLaps.length; index += 1) {
      const value = source?.[index];
      this.bestLaps[index] =
        typeof value === 'number' && Number.isFinite(value) ? value : 0;
    }
    const bestLapTime = numberValue(frame, 'LapBestLapTime');
    Object.assign(this.latest, {
      lapCompleted,
      currentLapTime: numberValue(frame, 'LapCurrentLapTime'),
      lastLapTime: numberValue(frame, 'LapLastLapTime'),
      bestLapTime,
      ownBestLapTime: this.ownBestLapTime(frame, bestLapTime, sessionTime),
      sessionNum,
      sessionTime,
      playerTrackSurface: numberValue(frame, 'PlayerTrackSurface'),
      incidentCount: numberValue(frame, 'PlayerCarMyIncidentCount'),
      lapDistPct: numberValue(frame, 'LapDistPct'),
      deltaToSessionLastLap: numberValue(frame, 'LapDeltaToSessionLastlLap'),
      deltaToSessionLastLapOk: booleanValue(
        frame,
        'LapDeltaToSessionLastlLap_OK'
      ),
      deltaToSessionBestLap: numberValue(frame, 'LapDeltaToSessionBestLap'),
      deltaToSessionBestLapOk: booleanValue(
        frame,
        'LapDeltaToSessionBestLap_OK'
      ),
      // LMU only; iRacing publishes no such var, read here as false.
      lapInvalidated: booleanValue(frame, 'LmuLapInvalidated'),
      lastLapInvalid: playerLastLapInvalid(frame),
      version: this.latest.version + 1,
    });
  }

  /**
   * The best lap that is the user's own, as of this frame.
   *
   * iRacing's best lap is the player's, and is passed through. Le Mans
   * Ultimate's is the car's: after a team-mate's stint it may be a lap they
   * drove, and it stays the car's best once the user is back in it. So a
   * time is taken only when it appears as an improvement while the user has
   * been at the wheel, without a break, for at least as long as the lap
   * took. A best that was already there when this began watching, or that
   * a team-mate set, is never taken, however long the user then drives.
   *
   * Measured in time at the wheel rather than by counting laps, because the
   * lap count here moves where the lap fraction wraps and the sim times the
   * lap at its timing line, which can be either side of that.
   */
  private ownBestLapTime(
    frame: Telemetry,
    bestLapTime: number,
    sessionTime: number
  ): number {
    if (frame.LmuWatching === undefined) return bestLapTime;

    if (!isAwayFromWheel(frame)) {
      if (!this.wasAtWheel) this.spellStart = sessionTime;
      this.spellEnd = sessionTime;
      this.wasAtWheel = true;
    } else {
      this.wasAtWheel = false;
    }

    const previous = this.lastBestLapTime;
    this.lastBestLapTime = bestLapTime;
    const improved =
      bestLapTime > 0 && (previous <= 0 || bestLapTime < previous);
    const own = this.latest.ownBestLapTime;
    if (!improved || this.spellStart === null) return own;
    const drivenWhole =
      sessionTime - this.spellEnd <= BEST_LAP_PUBLISH_SECONDS &&
      this.spellEnd - this.spellStart >= bestLapTime;
    return drivenWhole && (own <= 0 || bestLapTime < own) ? bestLapTime : own;
  }

  private resetOwnBest(): void {
    this.latest.ownBestLapTime = 0;
    this.lastBestLapTime = 0;
    this.spellStart = null;
    this.spellEnd = 0;
    this.wasAtWheel = false;
  }

  onLifecycle(event: SessionLifecycleEvent): void {
    if (event.type === 'enter') return;
    this.currentLapUnderCaution = false;
    this.resetOwnBest();
    Object.assign(this.latest, this.empty(), {
      version: this.latest.version + 1,
    });
    this.bestLaps.length = 0;
  }

  snapshot(): LapLogSnapshot {
    return this.latest;
  }

  private empty(): LapLogSnapshot {
    return {
      lapCompleted: 0,
      currentLapTime: 0,
      lastLapTime: 0,
      bestLapTime: 0,
      ownBestLapTime: 0,
      carIdxBestLapTime: this.bestLaps,
      sessionNum: null,
      sessionTime: 0,
      playerTrackSurface: 0,
      incidentCount: 0,
      lapDistPct: 0,
      deltaToSessionLastLap: 0,
      deltaToSessionLastLapOk: false,
      deltaToSessionBestLap: 0,
      deltaToSessionBestLapOk: false,
      lapInvalidated: false,
      lastLapInvalid: false,
      lastLapUnderCaution: false,
      version: 0,
    };
  }
}
