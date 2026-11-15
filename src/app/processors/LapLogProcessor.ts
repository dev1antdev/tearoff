import type {
  LapLogSnapshot,
  Session,
  SessionLifecycleEvent,
  Telemetry,
} from '@irdashies/types';
import { GlobalFlags } from '../irsdk/types/enums';
import type { TelemetryProcessor } from './TelemetryProcessor';

const FULL_COURSE_CAUTION_FLAGS =
  GlobalFlags.Caution | GlobalFlags.CautionWaving;

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

  init(session: Session): void {
    void session;
  }

  onFrame(frame: Telemetry): void {
    const lapCompleted = numberValue(frame, 'LapCompleted');
    const sessionNum = numberValue(frame, 'SessionNum');
    const sessionTime = numberValue(frame, 'SessionTime');
    if (
      sessionNum !== this.latest.sessionNum ||
      sessionTime < this.latest.sessionTime - 5 ||
      lapCompleted < this.latest.lapCompleted
    ) {
      // A new session or replay rewind must not inherit the old lap's latch.
      this.currentLapUnderCaution = false;
      this.latest.lastLapUnderCaution = false;
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
    Object.assign(this.latest, {
      lapCompleted,
      currentLapTime: numberValue(frame, 'LapCurrentLapTime'),
      lastLapTime: numberValue(frame, 'LapLastLapTime'),
      bestLapTime: numberValue(frame, 'LapBestLapTime'),
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

  onLifecycle(event: SessionLifecycleEvent): void {
    if (event.type === 'enter') return;
    this.currentLapUnderCaution = false;
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
