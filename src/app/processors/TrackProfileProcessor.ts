import type {
  Session,
  SessionLifecycleEvent,
  Telemetry,
  TrackProfile,
  TrackProfileSnapshot,
} from '@irdashies/types';
import { pointsCountFor, trackLengthFrom } from './lapTiming';
import type { TelemetryProcessor } from './TelemetryProcessor';

/** Where the profile comes from. Answers from memory: a processor cannot wait. */
export interface TrackProfileSource {
  /**
   * The stored profile of a track, sampled at this many buckets, or null:
   * there is none, or it has not been read yet, and `revision` moves when
   * it has. The same object for as long as the profile is unchanged.
   */
  load(
    simulator: string,
    trackId: number,
    pointsCount: number
  ): TrackProfile | null;
  /** Moves whenever `load` may answer differently. */
  revision(): number;
  /**
   * How far round the lap that will give the track being driven its first
   * elevation the player is, 0..1; null when no such lap is under way.
   */
  recordingProgress(): number | null;
}

export const noTrackProfiles: TrackProfileSource = {
  load: () => null,
  revision: () => 0,
  recordingProgress: () => null,
};

/** Progress is published each time it passes another twentieth of a lap. */
const PROGRESS_STEPS = 20;
/** Decimetres: what a height is drawn and read to. */
const HEIGHT_SCALE = 10;

const roundHeight = (value: number): number =>
  Math.round(value * HEIGHT_SCALE) / HEIGHT_SCALE;

const sameNumbers = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/** The session's own sector starts, in lap order. */
const sectorStartsOf = (session: Session): number[] =>
  (session.SplitTimeInfo?.Sectors ?? [])
    .map((sector) => sector?.SectorStartPct)
    .filter(
      (start): start is number =>
        typeof start === 'number' && Number.isFinite(start)
    )
    .sort((a, b) => a - b);

/**
 * Publishes the profile of the track being driven: its height along the
 * lap, where its sectors start, and the driver's notes.
 *
 * It keeps nothing of its own and reads no disk. The profile is whatever
 * the source holds for the track the session names, republished when the
 * source says it has changed; the heights go out shifted so the lowest
 * point of the lap is 0 and rounded to a tenth of a metre. While the lap
 * that will give a track its first elevation is being driven, how far round
 * it the player is goes out too, in steps of 5 %.
 *
 * The sector starts are the stored ones where the car has been seen
 * crossing them, and otherwise the session's own.
 */
export class TrackProfileProcessor implements TelemetryProcessor<
  TrackProfileSnapshot,
  'track-profile.snapshot'
> {
  readonly channel = 'track-profile.snapshot';
  // Changes when a lap is stored or a note is edited, not per frame.
  readonly tickRateHz = 'event' as const;

  private trackId: number | null = null;
  private trackLengthM = 0;
  private pointsCount = 0;
  private sessionSectors: readonly number[] = [];
  /** The stored profile the snapshot was last built from. */
  private profile: TrackProfile | null = null;
  private revision: number | null = null;
  private progressStep: number | null = null;
  private readonly latest: TrackProfileSnapshot = {
    trackKey: null,
    trackLengthM: 0,
    elevationM: [],
    lineElevationM: 0,
    elevationRangeM: 0,
    elevationSource: null,
    recordingProgress: null,
    sectorStartPct: [],
    notes: [],
    sessionNum: null,
    version: 0,
  };

  /**
   * @param simulator What the profiles are filed under: 'iracing' or 'lmu'.
   *   Empty where there is no store behind the source, and then no track is
   *   named either.
   */
  constructor(
    private readonly source: TrackProfileSource = noTrackProfiles,
    private readonly simulator = ''
  ) {}

  init(session: Session): void {
    const rawId = session.WeekendInfo?.TrackID;
    const trackId =
      this.simulator !== '' && typeof rawId === 'number' ? rawId : null;
    const trackLengthM = trackLengthFrom(session);
    const sectors = sectorStartsOf(session);
    if (
      trackId === this.trackId &&
      trackLengthM === this.trackLengthM &&
      sameNumbers(sectors, this.sessionSectors)
    ) {
      return;
    }
    this.trackId = trackId;
    this.trackLengthM = trackLengthM;
    this.pointsCount = trackLengthM > 0 ? pointsCountFor(trackLengthM) : 0;
    this.sessionSectors = sectors;
    this.revision = this.source.revision();
    this.rebuild(this.stored());
    this.latest.version += 1;
  }

  onFrame(frame: Telemetry): void {
    let changed = false;

    const revision = this.source.revision();
    if (revision !== this.revision) {
      this.revision = revision;
      const profile = this.stored();
      // The same object is the same profile: another track's changed.
      if (profile !== this.profile) {
        this.rebuild(profile);
        changed = true;
      }
    }

    const progress =
      this.trackId === null ? null : this.source.recordingProgress();
    const step =
      progress === null
        ? null
        : Math.min(
            Math.max(Math.floor(progress * PROGRESS_STEPS), 0),
            PROGRESS_STEPS - 1
          );
    if (step !== this.progressStep) {
      this.progressStep = step;
      this.latest.recordingProgress =
        step === null ? null : step / PROGRESS_STEPS;
      changed = true;
    }

    const value = frame.SessionNum?.value?.[0];
    const sessionNum =
      typeof value === 'number' && Number.isFinite(value) ? value : null;
    if (sessionNum !== null && sessionNum !== this.latest.sessionNum) {
      this.latest.sessionNum = sessionNum;
      changed = true;
    }

    if (changed) this.latest.version += 1;
  }

  onLifecycle(event: SessionLifecycleEvent): void {
    // A new session at the same track is the same track, and a replay of a
    // race is run on the same road as the race was.
    if (event.type !== 'disconnect') return;
    this.trackId = null;
    this.trackLengthM = 0;
    this.pointsCount = 0;
    this.sessionSectors = [];
    this.revision = null;
    this.progressStep = null;
    this.rebuild(null);
    this.latest.recordingProgress = null;
    this.latest.sessionNum = null;
    this.latest.version += 1;
  }

  snapshot(): TrackProfileSnapshot {
    return this.latest;
  }

  private stored(): TrackProfile | null {
    return this.trackId !== null && this.pointsCount > 0
      ? this.source.load(this.simulator, this.trackId, this.pointsCount)
      : null;
  }

  /** Rewrites everything in the snapshot that comes from the profile. */
  private rebuild(profile: TrackProfile | null): void {
    this.profile = profile;
    const latest = this.latest;
    latest.trackKey =
      this.trackId === null ? null : `${this.simulator}:${this.trackId}`;
    latest.trackLengthM = this.trackLengthM;
    latest.notes = profile?.notes ?? [];
    latest.sectorStartPct =
      profile &&
      profile.sectorSource !== 'nominal' &&
      profile.sectorStartPct.length > 0
        ? profile.sectorStartPct
        : this.sessionSectors;

    const heights = profile?.elevationM;
    if (!heights || heights.length === 0) {
      latest.elevationM = [];
      latest.lineElevationM = 0;
      latest.elevationRangeM = 0;
      latest.elevationSource = null;
      return;
    }
    let lowest = Infinity;
    let highest = -Infinity;
    for (const height of heights) {
      if (height < lowest) lowest = height;
      if (height > highest) highest = height;
    }
    const shifted = heights.map((height) => roundHeight(height - lowest));
    latest.elevationM = shifted;
    latest.lineElevationM = shifted[0];
    latest.elevationRangeM = roundHeight(highest - lowest);
    latest.elevationSource = profile.elevationSource;
  }
}
