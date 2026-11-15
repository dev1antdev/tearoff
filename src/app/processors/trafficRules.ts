import { TrackLocation, type TrafficRelation } from '@irdashies/types';
import { wrapDelta } from './radarMath';
import { isFasterClass, isSameClass, type CarClassEntry } from './carClass';

/**
 * The rules for "a car coming up behind the player", in one place.
 *
 * The flag panel names the car a blue flag is for and the traffic widget
 * lists the cars closing from behind. Both ask the same questions: which
 * cars are behind on the road, which of them are coming to lap the player or
 * are of a faster class, in what order they queue, and when the one at the
 * head has gone by. FlagStateProcessor and TrafficProcessor both answer them
 * with this module, so the two widgets can never name different cars.
 */

/** How far behind the player a car is still looked at, metres. */
export const TRAFFIC_SEARCH_M = 500;
/** A queued car counts while it is at most this many seconds behind. */
export const TRAFFIC_QUEUE_GAP_S = 8;
/** Another car takes the head once it is this much nearer than the holder. */
const SWAP_M = 10;
/** The holder has gone by once it is this far ahead of the player. */
const PASSED_M = 5;
/** Outside a race a car counts as closing from this much more speed, m/s. */
export const TRAFFIC_CLOSING_MS = 2;
const KMH_PER_MS = 3.6;

const finiteAt = (
  values: readonly unknown[],
  index: number
): number | undefined => {
  const value = values[index];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
};

const round1 = (value: number): number => Math.round(value * 10) / 10;

/** Smoothed speed of a car in m/s, or undefined where none is known. */
export const speedOf = (
  speedsKmh: readonly number[],
  carIdx: number
): number | undefined => {
  const kmh = speedsKmh[carIdx];
  return typeof kmh === 'number' && Number.isFinite(kmh)
    ? kmh / KMH_PER_MS
    : undefined;
};

/** Whether a slot holds a car on the racing surface, out of the pits. */
export const isOnRacingSurface = (
  carIdx: number,
  surfaces: readonly unknown[],
  onPitRoad: readonly unknown[],
  excluded: ReadonlySet<number>
): boolean => {
  if (excluded.has(carIdx)) return false;
  const surface = surfaces[carIdx];
  return (
    (surface === TrackLocation.OnTrack || surface === TrackLocation.OffTrack) &&
    onPitRoad[carIdx] !== true
  );
};

/**
 * TinyPedal's relative time gap: the distance over the higher of the two
 * speeds, one decimal. Null below 1 m/s and where neither speed is known.
 */
export const relativeTimeGap = (
  distanceM: number,
  speedMs: number | undefined,
  playerSpeedMs: number | undefined
): number | null => {
  const faster = Math.max(speedMs ?? 0, playerSpeedMs ?? 0);
  return faster >= 1 ? round1(distanceM / faster) : null;
};

/**
 * The lapping rule: how a car behind stands to the player.
 *
 * In a race a car a lap or more ahead is lapping the player whatever its
 * class, and failing that a car of a faster class is traffic whatever the
 * laps. A car of the player's own class on the same lap is racing for
 * position, and a car a lap or more down is one the player has lapped.
 * Outside a race laps mean nothing: a car is traffic when it is closing.
 */
export const trafficRelationOf = (car: {
  raceRule: boolean;
  /** Whole laps the car is ahead of the player; 0 outside a race. */
  lapsAhead: number;
  fasterClass: boolean;
  sameClass: boolean;
  /** At least TRAFFIC_CLOSING_MS quicker than the player right now. */
  closing: boolean;
}): TrafficRelation => {
  if (!car.raceRule) {
    if (!car.closing) return 'behind';
    return car.fasterClass ? 'fasterClass' : 'closing';
  }
  if (car.lapsAhead >= 1) return 'lapping';
  if (car.fasterClass) return 'fasterClass';
  if (car.lapsAhead <= -1) return 'lapped';
  return car.sameClass ? 'position' : 'behind';
};

/** One tick of the field, as both processors read it off a frame. */
export interface TrafficField {
  pcts: readonly unknown[];
  laps: readonly unknown[];
  surfaces: readonly unknown[];
  onPitRoad: readonly unknown[];
  /** Smoothed speed per car, km/h, from car-speeds.snapshot. */
  speedsKmh: readonly number[];
  player: number;
  playerPct: number;
  /** Metres. */
  trackLength: number;
  /** A race under way: laps decide who is lapping whom. */
  raceRule: boolean;
  /** Le Mans Ultimate holds a car at fraction 0 until it reaches the line. */
  isLmu: boolean;
  classes: readonly (CarClassEntry | undefined)[];
  /** The pace car and spectators. */
  excluded: ReadonlySet<number>;
}

/**
 * The cars behind the player, the ones of them that are traffic, and which
 * one is at the head of the queue.
 *
 * `scan` reads one tick into the per-slot arrays; `settle` orders a pool of
 * them and keeps the head steady; `queuedBehind` counts the rest. The arrays
 * are reused every tick and indexed by car slot: an entry is only meaningful
 * for a slot that is in `candidates` after the last scan.
 */
export class TrafficQueue {
  /** The car at the head, kept between ticks for the stability rules. */
  holder = -1;
  /** Every car behind within the search distance. */
  readonly candidates: number[] = [];
  /** Those of them that are traffic. */
  readonly listed: number[] = [];
  /** Metres behind the player; 0 while alongside. */
  readonly distOf: number[] = [];
  /** Whole laps ahead of the player; negative when lapped; 0 outside a race. */
  readonly lapsOf: number[] = [];
  readonly fasterOf: boolean[] = [];
  readonly relationOf: TrafficRelation[] = [];
  /** The player's own speed at the last scan, m/s. */
  playerSpeed: number | undefined = undefined;

  private readonly byDistance = (a: number, b: number): number =>
    Math.round(this.distOf[a]) - Math.round(this.distOf[b]) ||
    Math.max(0, this.lapsOf[b]) - Math.max(0, this.lapsOf[a]) ||
    a - b;

  /**
   * Finds the candidates: real cars other than the player and the pace car,
   * with a lap fraction (under LMU above 0), on the track surface and out of
   * the pit lane, behind the player on the road and no further back than
   * the search distance. The holder stays a candidate while it draws level,
   * until it is clearly ahead.
   */
  scan(field: TrafficField): void {
    const { candidates, listed, distOf, lapsOf, fasterOf, relationOf } = this;
    const { pcts, laps, player, playerPct, raceRule, classes } = field;
    candidates.length = 0;
    listed.length = 0;
    const playerSpeed = speedOf(field.speedsKmh, player);
    this.playerSpeed = playerSpeed;
    const playerProgress = (finiteAt(laps, player) ?? 0) + playerPct;

    for (let carIdx = 0; carIdx < pcts.length; carIdx += 1) {
      if (carIdx === player) continue;
      const pct = finiteAt(pcts, carIdx);
      // LMU holds a car at exactly 0 until it first reaches the line.
      if (pct === undefined || pct < 0 || (field.isLmu && pct === 0)) continue;
      if (
        !isOnRacingSurface(
          carIdx,
          field.surfaces,
          field.onPitRoad,
          field.excluded
        )
      ) {
        continue;
      }
      const metres = wrapDelta(pct, playerPct) * field.trackLength;
      // Behind on the road; the holder stays until it is clearly ahead.
      const passed = carIdx === this.holder ? metres >= PASSED_M : metres >= 0;
      if (passed) continue;
      const dist = Math.max(0, -metres);
      if (dist > TRAFFIC_SEARCH_M) continue;

      const speed = speedOf(field.speedsKmh, carIdx);
      // `+ 0`: a car a few metres back on the same lap rounds to -0.
      const lapsAhead = raceRule
        ? Math.round((finiteAt(laps, carIdx) ?? 0) + pct - playerProgress) + 0
        : 0;
      const faster = isFasterClass(classes, carIdx, player);
      const relation = trafficRelationOf({
        raceRule,
        lapsAhead,
        fasterClass: faster,
        sameClass: isSameClass(classes, carIdx, player),
        closing:
          speed !== undefined &&
          playerSpeed !== undefined &&
          speed - playerSpeed >= TRAFFIC_CLOSING_MS,
      });

      distOf[carIdx] = dist;
      lapsOf[carIdx] = lapsAhead;
      fasterOf[carIdx] = faster;
      relationOf[carIdx] = relation;
      candidates.push(carIdx);
      if (
        relation === 'lapping' ||
        relation === 'fasterClass' ||
        relation === 'closing'
      ) {
        listed.push(carIdx);
      }
    }
  }

  /**
   * Orders a pool nearest first (equal distances to the car more laps
   * ahead, then the lower slot) and settles its head: the holder keeps the
   * place until another car of the pool is clearly nearer, so the name does
   * not flicker between two cars running together. Returns the head, or -1
   * for an empty pool.
   */
  settle(pool: number[]): number {
    if (pool.length === 0) return this.drop();
    pool.sort(this.byDistance);
    const nearest = pool[0];
    let holder = this.holder;
    if (
      !pool.includes(holder) ||
      this.distOf[holder] - this.distOf[nearest] >= SWAP_M
    ) {
      holder = nearest;
    }
    this.holder = holder;
    return holder;
  }

  /**
   * How many cars of traffic other than `head` are inside the listing
   * window: no more than TRAFFIC_QUEUE_GAP_S behind. The time limit keeps a
   * car 400 m back in a slow section out of the count.
   */
  queuedBehind(field: TrafficField, head: number): number {
    let count = 0;
    for (const carIdx of this.listed) {
      if (carIdx === head) continue;
      if (this.isInsideGap(field, carIdx)) count += 1;
    }
    return count;
  }

  /** Whether a scanned car is inside the time limit of the listing window. */
  isInsideGap(field: TrafficField, carIdx: number): boolean {
    const gap = relativeTimeGap(
      this.distOf[carIdx],
      speedOf(field.speedsKmh, carIdx),
      this.playerSpeed
    );
    return gap === null || gap <= TRAFFIC_QUEUE_GAP_S;
  }

  /** Forgets the head. */
  drop(): -1 {
    this.holder = -1;
    return -1;
  }
}
