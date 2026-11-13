import type {
  MinimapSnapshot,
  Session,
  SessionLifecycleEvent,
  Telemetry,
} from '@irdashies/types';
import type { TelemetryProcessor } from './TelemetryProcessor';

type Frame = Record<string, { value?: unknown[] } | undefined>;

const scalar = (frame: Telemetry, key: string): number | undefined => {
  const value = (frame as unknown as Frame)[key]?.value?.[0];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
};

const array = (frame: Telemetry, key: string): readonly unknown[] => {
  const value = (frame as unknown as Frame)[key]?.value;
  return Array.isArray(value) ? value : [];
};

/**
 * Five decimals of a lap: 14 cm at Le Mans, 4 cm on a 4 km circuit. Fine
 * enough that a zoomed-in car moves smoothly, coarse enough that a parked car
 * stops republishing.
 */
const POSITION_SCALE = 100_000;

/** A slot with no car on track, as both sims mark it. */
const NOT_ON_TRACK = -1;

const copyPositions = (
  target: number[],
  source: readonly unknown[]
): boolean => {
  let changed = target.length !== source.length;
  if (changed) target.length = source.length;
  for (let index = 0; index < source.length; index += 1) {
    const raw = source[index];
    const current =
      typeof raw === 'number' && Number.isFinite(raw) && raw >= 0
        ? Math.round(raw * POSITION_SCALE) / POSITION_SCALE
        : NOT_ON_TRACK;
    if (target[index] !== current) changed = true;
    target[index] = current;
  }
  return changed;
};

const copyNumbers = (target: number[], source: readonly unknown[]): boolean => {
  let changed = target.length !== source.length;
  if (changed) target.length = source.length;
  for (let index = 0; index < source.length; index += 1) {
    const raw = source[index];
    const current = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
    if (target[index] !== current) changed = true;
    target[index] = current;
  }
  return changed;
};

const copyBooleans = (
  target: boolean[],
  source: readonly unknown[]
): boolean => {
  let changed = target.length !== source.length;
  if (changed) target.length = source.length;
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index] === true || source[index] === 1;
    if (target[index] !== current) changed = true;
    target[index] = current;
  }
  return changed;
};

/**
 * Publishes every car's place on the lap for the close-range minimap.
 *
 * Reads only channels both simulators fill, so the same processor serves
 * iRacing and Le Mans Ultimate. The arrays are copied in place and the version
 * only moves when something did, so a paused or empty session costs the
 * renderer nothing.
 */
export class MinimapProcessor implements TelemetryProcessor<MinimapSnapshot> {
  readonly channel = 'minimap.snapshot';
  // Positional: the renderer interpolates between snapshots, as the track map
  // does.
  readonly tickRateHz = 25;

  private readonly lapDistPct: number[] = [];
  private readonly onPitRoad: boolean[] = [];
  private readonly position: number[] = [];
  private readonly classPosition: number[] = [];
  private readonly latest: MinimapSnapshot = {
    focusCarIdx: null,
    carIdxLapDistPct: this.lapDistPct,
    carIdxOnPitRoad: this.onPitRoad,
    carIdxPosition: this.position,
    carIdxClassPosition: this.classPosition,
    sessionNum: null,
    version: 0,
  };

  /**
   * Deliberately does nothing: the host calls this on every session publish,
   * and nothing here depends on session data.
   */
  init(session: Session): void {
    void session;
  }

  onFrame(frame: Telemetry): void {
    let changed = false;

    changed =
      copyPositions(this.lapDistPct, array(frame, 'CarIdxLapDistPct')) ||
      changed;
    changed =
      copyBooleans(this.onPitRoad, array(frame, 'CarIdxOnPitRoad')) || changed;
    changed =
      copyNumbers(this.position, array(frame, 'CarIdxPosition')) || changed;
    changed =
      copyNumbers(this.classPosition, array(frame, 'CarIdxClassPosition')) ||
      changed;

    // The camera's car when the sim names one, so the map follows a spectated
    // driver or a replay; the player's own otherwise.
    const camera = scalar(frame, 'CamCarIdx');
    const player = scalar(frame, 'PlayerCarIdx');
    const focus =
      camera !== undefined && camera >= 0
        ? camera
        : player !== undefined && player >= 0
          ? player
          : null;
    if (focus !== this.latest.focusCarIdx) {
      this.latest.focusCarIdx = focus;
      changed = true;
    }

    const sessionNum = scalar(frame, 'SessionNum') ?? null;
    if (sessionNum !== this.latest.sessionNum) {
      this.latest.sessionNum = sessionNum;
      changed = true;
    }

    if (changed) this.latest.version += 1;
  }

  /**
   * Clears the cars on anything but entering a session, so the map never shows
   * the previous session's field.
   */
  onLifecycle(event: SessionLifecycleEvent): void {
    if (event.type === 'enter') return;
    this.lapDistPct.length = 0;
    this.onPitRoad.length = 0;
    this.position.length = 0;
    this.classPosition.length = 0;
    this.latest.focusCarIdx = null;
    this.latest.sessionNum = null;
    this.latest.version += 1;
  }

  snapshot(): MinimapSnapshot {
    return this.latest;
  }
}
