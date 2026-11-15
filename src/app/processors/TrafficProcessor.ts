import type {
  Session,
  SessionLifecycleEvent,
  Telemetry,
  TrafficArrival,
  TrafficCar,
  TrafficForecast,
  TrafficPick,
  TrafficSnapshot,
} from '@irdashies/types';
import { SessionState, TrackLocation } from '@irdashies/types';
import {
  FORECAST_MAX_LAPS,
  FORECAST_MIN_FALL_S,
  FORECAST_STEADY_S,
  forecastCatch,
  type CatchForecast,
  type CatchInput,
} from '@irdashies/shared';
import type { TelemetryProcessor } from './TelemetryProcessor';
import { parseTrackLength } from './RadarProcessor';
import { carClassesFrom, type CarClassEntry } from './carClass';
import { RunningTrace } from './runningTrace';
import {
  ClosingAverages,
  INTERVAL_WINDOW_S,
  IntervalWindow,
  SWAP_JUMP_S,
  lapsToContact,
  meetsThisLap,
} from './trafficRates';
import {
  TRAFFIC_QUEUE_GAP_S,
  TrafficQueue,
  isOnRacingSurface,
  relativeTimeGap,
  speedOf,
  type TrafficField,
} from './trafficRules';

const TRAFFIC_TICK_HZ = 5;
/** TinyPedal's rule: slower than this on the track is slow. */
export const TRAFFIC_SLOW_SPEED_MS = 8;
/** A race's first seconds are a standing field, not a slow car. */
const RACE_START_QUIET_S = 3;
/** The nearest car behind is named while it is no further off than this. */
const NEAREST_BEHIND_MAX_S = 60;
/** Cars listed for the pit exit and the rejoin. */
const ARRIVING_MAX = 8;
/** How long after the pit lane, or after being slow, they go on being listed. */
const ARRIVING_HOLD_S = 30;
/** Rows of the mirror. */
const MIRROR_ROWS = 4;
/** A car racing the player for position is in the mirror this close. */
const RIVAL_GAP_S = 3;
/** A car's closing is measured for a forecast while it is this close. */
const FORECAST_RANGE_S = 30;
/**
 * The closing rate of a forecast is the fall of the interval over this
 * long. A car closing too slowly for that to show is measured over the
 * whole minute the window holds.
 */
const FORECAST_WINDOW_S = 20;
/** A closing rate is shown from this many seconds of measuring, */
const CLOSING_SHOWN_AFTER_S = 3;
/** and is the fall over this long. */
const CLOSING_SHOWN_OVER_S = 12;
/** Readings a running average needs before a contact is worked out from it. */
const MIN_RATE_SAMPLES = 10;
/** Two frames further apart than this are not neighbours. */
const MAX_FRAME_GAP_S = 2;
/** A lap fraction that moves this much in one tick is a car that was moved. */
const JUMP_LAPS = 0.2;
/** The least of a lap on record from which a lap time is worked out. */
const MIN_RECORD_LAPS = 0.1;
/** LMU's wheel surfaces off the road: grass, dirt, gravel. */
const SURFACE_GRASS = 2;
const SURFACE_GRAVEL = 4;

const NO_VALUES: readonly unknown[] = [];
const NO_NUMBERS: readonly number[] = [];

type Cells = Record<string, { value?: readonly unknown[] } | undefined>;

const valuesOf = (cells: Cells, key: string): readonly unknown[] =>
  cells[key]?.value ?? NO_VALUES;

const finiteAt = (
  values: readonly unknown[],
  index: number
): number | undefined => {
  const value = values[index];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
};

const scalarOf = (cells: Cells, key: string): number | undefined =>
  finiteAt(valuesOf(cells, key), 0);

// The `+ 0` turns a rounded -0 into 0: the two are different values to a
// comparison, and a gap that has not moved has not changed.
const round1 = (value: number): number => Math.round(value * 10) / 10 + 0;
const round2 = (value: number): number => Math.round(value * 100) / 100 + 0;
const round3 = (value: number): number => Math.round(value * 1000) / 1000 + 0;
const roundPct = (value: number | null): number | null =>
  // A fraction that rounds up to 1 is the line: 0.
  value === null ? null : round3(value) % 1;

export interface TrafficDependencies {
  /**
   * Smoothed speed per car in km/h, from car-speeds.snapshot. Empty when that
   * channel has nothing, as during a replay.
   */
  carSpeeds?: () => readonly number[];
  /** Measured pace per car in seconds, from lap-times.snapshot; 0 for none. */
  lapTimes?: () => readonly number[];
}

/** What is kept about one car. Made once per slot, then changed in place. */
interface CarState {
  /**
   * How fast the car is gaining on the player, seconds per second. A car is
   * in both lists, a lap less its gap behind being its gap ahead, so one
   * figure serves both: gaining is closing from behind and pulling away
   * ahead, and the player closing on a car ahead is the same with its sign
   * turned.
   */
  closing: ClosingAverages;
  /**
   * The last reading: how far the player leads it, as a fraction of a lap
   * and in seconds, both negative for a car ahead; and whether the seconds
   * were measured.
   */
  fraction: number;
  lead: number;
  measured: boolean;
  /** The measured interval to it while it is behind, for the forecast. */
  window: IntervalWindow;
}

const newCarState = (): CarState => ({
  closing: new ClosingAverages(),
  fraction: Number.NaN,
  lead: Number.NaN,
  measured: false,
  window: new IntervalWindow(),
});

const restart = (car: CarState): void => {
  car.closing.restart();
  car.fraction = Number.NaN;
  car.lead = Number.NaN;
  car.measured = false;
  car.window.clear();
};

const newPick = (): TrafficPick => ({
  carIdx: -1,
  gapS: 0,
  laps: null,
  thisLap: false,
});

type PickKey = 'slowerAhead' | 'leader' | 'fasterBehind';

/**
 * Who is coming, and when.
 *
 * Three things in one channel, all about the player's own car:
 *
 * - The table of contacts, TinyPedal's: the car ahead the player reaches
 *   soonest, the race leader coming round to lap them, and the car behind
 *   that reaches them soonest, each as laps until the two meet. Over the
 *   whole lap and every class.
 * - The mirror: the cars behind inside the listing window, told apart by the
 *   rule the flag panel uses for a blue, with the interval to each, how fast
 *   it is closing, and a forecast of when and where the soonest arrives.
 * - The cars that will come by while the player is in the pit lane, has just
 *   left it, or is slow or off the road.
 *
 * Gaps are intervals measured from the player's own running wherever that
 * is on record: how long ago the player was where the other car is now.
 * Nothing here reads a lap time the sim states. Under Le Mans Ultimate that
 * figure is one constant for the whole grid, so pace is what
 * `lap-times.snapshot` has measured, and before any lap is complete, what
 * the player's own record gives.
 *
 * A car's closing is not measured while it or the player is in the pit lane,
 * and starts again when it rejoins, so a stop does not read as closing.
 *
 * Nothing outlasts a session and nothing is aggregated beyond a lap, so it
 * runs the same over a replay; a clock that steps back starts it again.
 */
export class TrafficProcessor implements TelemetryProcessor<
  TrafficSnapshot,
  'traffic.snapshot'
> {
  readonly channel = 'traffic.snapshot';
  readonly tickRateHz = TRAFFIC_TICK_HZ;

  private readonly carSpeeds: () => readonly number[];
  private readonly lapTimes: () => readonly number[];

  private trackLength = 0;
  private readonly sessionTypes = new Map<number, string>();
  /** The pace car and spectators: never traffic. */
  private readonly excluded = new Set<number>();
  private classes: CarClassEntry[] = [];

  /** The cars behind and the lapping rule, as the flag processor has them. */
  private readonly queue = new TrafficQueue();
  private readonly field: TrafficField = {
    pcts: NO_VALUES,
    laps: NO_VALUES,
    surfaces: NO_VALUES,
    onPitRoad: NO_VALUES,
    speedsKmh: NO_NUMBERS,
    player: -1,
    playerPct: -1,
    trackLength: 0,
    raceRule: false,
    isLmu: false,
    classes: [],
    excluded: this.excluded,
  };

  /** The player's own running: where they were when. */
  private readonly trace = new RunningTrace();
  /** The player's progress in laps, counted on from the first frame seen. */
  private progress = 0;
  private lastPct = -1;
  /**
   * Progress up to which the player's running was not racing: the pit lane,
   * a crawl, a spin. An interval measured across it would count the time
   * lost there as a gap, so only what lies after it is measured from.
   */
  private dirtyProgress = Number.NEGATIVE_INFINITY;

  private lastTime: number | null = null;
  private lastSampleAt: number | null = null;
  private wasInPitLane = false;
  private lastState = -1;
  /** SessionTime at which the race was seen to go green; null when not seen. */
  private racingSince: number | null = null;

  private readonly cars: (CarState | undefined)[] = [];
  /** Scratch, indexed by car slot; an entry counts while `seenOf` is set. */
  private readonly seenOf: boolean[] = [];
  /** Fraction of a lap the car is behind the player, 0..1. */
  private readonly behindFractionOf: number[] = [];
  /** The measured interval to a car behind; NaN where there is none. */
  private readonly intervalOf: number[] = [];
  /**
   * Seconds the player leads the car by on its nearer side, negative for a
   * car ahead; NaN without a figure. `measuredOf` says it was measured.
   */
  private readonly leadOf: number[] = [];
  private readonly measuredOf: boolean[] = [];
  private readonly gapBehindOf: number[] = [];
  private readonly gapAheadOf: number[] = [];
  private readonly reachOf: number[] = [];
  private readonly reachSpeedOf: number[] = [];
  private readonly pool: number[] = [];
  private readonly arrivals: number[] = [];

  private readonly byReach = (a: number, b: number): number =>
    this.reachOf[a] - this.reachOf[b] || a - b;

  /** The one input the forecast is asked with, refilled per car. */
  private readonly catchInput: CatchInput = {
    gapS: 0,
    closingS: 0,
    closingQuickS: 0,
    closingSlowS: 0,
    measuredS: 0,
    lapS: null,
    chaserLapS: null,
    pct: 0,
    travel: (seconds) => this.travelled(seconds),
  };

  private readonly picks: Record<PickKey, TrafficPick> = {
    slowerAhead: newPick(),
    leader: newPick(),
    fasterBehind: newPick(),
  };
  private readonly nearest = { carIdx: -1, gapS: 0 };
  private readonly behind: TrafficCar[] = [];
  private readonly rowPool: TrafficCar[] = [];
  private readonly arriving: TrafficArrival[] = [];
  private readonly arrivalPool: TrafficArrival[] = [];
  private readonly forecast: TrafficForecast = {
    carIdx: -1,
    etaS: 0,
    lowS: 0,
    highS: 0,
    steady: false,
    laps: null,
    meetPct: null,
    meetLowPct: null,
    meetHighPct: null,
  };

  private readonly latest: TrafficSnapshot = {
    slowerAhead: null,
    leader: null,
    fasterBehind: null,
    nearestBehind: null,
    slowAt: null,
    exitedAt: null,
    inPitLane: false,
    behind: this.behind,
    moreBehind: 0,
    forecast: null,
    arriving: this.arriving,
    lapS: null,
    sessionNum: null,
    version: 0,
  };

  constructor(dependencies: TrafficDependencies = {}) {
    this.carSpeeds = dependencies.carSpeeds ?? (() => NO_NUMBERS);
    this.lapTimes = dependencies.lapTimes ?? (() => NO_NUMBERS);
  }

  init(session: Session): void {
    this.trackLength = parseTrackLength(session?.WeekendInfo?.TrackLength);
    this.sessionTypes.clear();
    for (const entry of session?.SessionInfo?.Sessions ?? []) {
      this.sessionTypes.set(entry.SessionNum, entry.SessionType);
    }
    this.excluded.clear();
    const paceCarIdx = session?.DriverInfo?.PaceCarIdx ?? -1;
    if (paceCarIdx >= 0) this.excluded.add(paceCarIdx);
    for (const driver of session?.DriverInfo?.Drivers ?? []) {
      if (driver.CarIsPaceCar === 1 || driver.IsSpectator === 1) {
        this.excluded.add(driver.CarIdx);
      }
    }
    this.classes = carClassesFrom(session);
  }

  onFrame(frame: Telemetry): void {
    const cells = frame as unknown as Cells;
    const latest = this.latest;
    const time = scalarOf(cells, 'SessionTime');
    if (time === undefined) return;
    let changed = false;

    const sessionNum = scalarOf(cells, 'SessionNum') ?? null;
    if (latest.sessionNum !== null && sessionNum !== latest.sessionNum) {
      changed = this.clear() || changed;
    }
    // A clock that steps back is a new session or a replay being scrubbed.
    if (this.lastTime !== null && time < this.lastTime) {
      changed = this.clear() || changed;
    }
    const broken =
      this.lastTime !== null && time - this.lastTime > MAX_FRAME_GAP_S;
    this.lastTime = time;
    if (sessionNum !== latest.sessionNum) {
      latest.sessionNum = sessionNum;
      changed = true;
    }

    const isLmu = scalarOf(cells, 'LmuGamePhase') !== undefined;
    const live =
      !isLmu ||
      (valuesOf(cells, 'LmuDataStale')[0] !== true &&
        valuesOf(cells, 'LmuNotInSession')[0] !== true);
    const player = scalarOf(cells, 'PlayerCarIdx') ?? -1;
    const pcts = valuesOf(cells, 'CarIdxLapDistPct');
    const laps = valuesOf(cells, 'CarIdxLapCompleted');
    const surfaces = valuesOf(cells, 'CarIdxTrackSurface');
    const onPitRoad = valuesOf(cells, 'CarIdxOnPitRoad');
    const speeds = this.carSpeeds();
    const playerPct = player >= 0 && live ? (finiteAt(pcts, player) ?? -1) : -1;
    const playerSurface = surfaces[player];
    // LMU holds a car's lap fraction at exactly 0 until it first reaches the
    // line: until then where it is on the lap is not known.
    const placed =
      playerPct >= 0 &&
      !(isLmu && playerPct === 0) &&
      this.trackLength > 0 &&
      playerSurface !== TrackLocation.NotInWorld &&
      playerSurface !== undefined;

    const sessionState = scalarOf(cells, 'SessionState') ?? 0;
    const isRace =
      sessionNum !== null && this.sessionTypes.get(sessionNum) === 'Race';
    if (
      this.lastState >= 0 &&
      this.lastState < SessionState.Racing &&
      sessionState === SessionState.Racing
    ) {
      this.racingSince = time;
    }
    this.lastState = sessionState;

    if (!placed) {
      // No car on the lap: nothing is measured, and what was is forgotten.
      this.forgetRunning();
      changed = this.publishNothing() || changed;
      changed = this.setInPitLane(false) || changed;
      this.wasInPitLane = false;
      if (changed) latest.version += 1;
      return;
    }

    const inPitLane =
      onPitRoad[player] === true || playerSurface === TrackLocation.InPitStall;
    const onSurface =
      playerSurface === TrackLocation.OnTrack ||
      playerSurface === TrackLocation.OffTrack;
    // The player's own speed where the sim gives it, which is at the wheel;
    // otherwise the speed their car's lap fraction moves at.
    const ownSpeed =
      valuesOf(cells, 'IsOnTrack')[0] === true
        ? scalarOf(cells, 'Speed')
        : undefined;
    const playerSpeed = ownSpeed ?? speedOf(speeds, player);

    // The player's running. A fraction that jumps is a car that was moved,
    // and a hole in the frames is a hole in the record.
    let step = 0;
    if (this.lastPct >= 0) {
      step = playerPct - this.lastPct;
      if (step < -0.5) step += 1;
      else if (step > 0.5) step -= 1;
    }
    if (this.lastPct < 0 || broken || Math.abs(step) > JUMP_LAPS) {
      this.forgetRunning();
      this.progress = playerPct;
    } else {
      this.progress += step;
    }
    this.lastPct = playerPct;
    this.trace.push(time, this.progress);

    const racing =
      sessionState >= SessionState.Racing &&
      !(
        this.racingSince !== null &&
        time - this.racingSince < RACE_START_QUIET_S
      );
    const slow =
      playerSpeed !== undefined && playerSpeed < TRAFFIC_SLOW_SPEED_MS;
    const offRoad = this.isOffRoad(cells, isLmu);
    if (inPitLane || slow || offRoad) this.dirtyProgress = this.progress;

    // The two anchors of the pit exit and rejoin block.
    if (this.wasInPitLane && !inPitLane && onSurface) {
      if (latest.exitedAt !== round1(time)) {
        latest.exitedAt = round1(time);
        changed = true;
      }
    }
    this.wasInPitLane = inPitLane;
    if (!inPitLane && onSurface && racing && (slow || offRoad)) {
      if (latest.slowAt !== round1(time)) {
        latest.slowAt = round1(time);
        changed = true;
      }
    }
    changed = this.setInPitLane(inPitLane) || changed;

    // What a lap of the player's takes, to turn seconds into laps.
    const lapTimes = this.lapTimes();
    const rolling = this.rollingLap(time);
    const lapS = this.lapSeconds(lapTimes, player, rolling, time, isLmu);
    const lapRef = rolling ?? lapS;
    const publishedLap = lapS === null ? null : round1(lapS);
    if (latest.lapS !== publishedLap) {
      latest.lapS = publishedLap;
      changed = true;
    }

    // Every car on the track: how far behind it is, and the gap to it. The
    // gap is measured on the side the car is nearer on: behind, how long ago
    // the player was where it is; ahead, how long the player took a lap ago
    // from here to where it is. The other side is the rest of the lap.
    const { seenOf, behindFractionOf, intervalOf, gapBehindOf, gapAheadOf } =
      this;
    const count = pcts.length;
    let nearest = -1;
    this.arrivals.length = 0;
    for (let carIdx = 0; carIdx < count; carIdx += 1) {
      seenOf[carIdx] = false;
      if (carIdx === player) continue;
      const pct = finiteAt(pcts, carIdx);
      if (pct === undefined || pct < 0 || (isLmu && pct === 0)) continue;
      if (!isOnRacingSurface(carIdx, surfaces, onPitRoad, this.excluded)) {
        continue;
      }
      let fraction = playerPct - pct;
      if (fraction < 0) fraction += 1;
      const isBehind = fraction <= 0.5;
      const interval = isBehind
        ? this.intervalBehind(fraction, time)
        : Number.NaN;
      const near = isBehind ? interval : this.gapAhead(1 - fraction);
      const measured = !Number.isNaN(near);
      const share = isBehind ? fraction : 1 - fraction;
      const nearGap = measured
        ? near
        : lapS !== null
          ? share * lapS
          : Number.NaN;
      const farGap =
        lapRef !== null ? Math.max(0, lapRef - nearGap) : Number.NaN;
      seenOf[carIdx] = true;
      behindFractionOf[carIdx] = fraction;
      intervalOf[carIdx] = interval;
      gapBehindOf[carIdx] = isBehind ? nearGap : farGap;
      gapAheadOf[carIdx] = isBehind ? farGap : nearGap;
      this.leadOf[carIdx] = isBehind ? nearGap : -nearGap;
      this.measuredOf[carIdx] = measured;

      // When it gets to where the player is, at the best it can do: its own
      // speed, the player's, or its lap average, whichever is highest.
      this.reachOf[carIdx] = Number.POSITIVE_INFINITY;
      if (fraction <= 0.5) {
        const lapTime = lapTimes[carIdx];
        const average = lapTime > 0 ? this.trackLength / lapTime : 0;
        const speed = Math.max(
          speedOf(speeds, carIdx) ?? 0,
          playerSpeed ?? 0,
          average
        );
        if (speed >= 1) {
          const reach = (fraction * this.trackLength) / speed;
          this.reachOf[carIdx] = reach;
          this.reachSpeedOf[carIdx] = speed;
          if (reach <= NEAREST_BEHIND_MAX_S) {
            this.arrivals.push(carIdx);
            if (nearest < 0 || reach < this.reachOf[nearest]) nearest = carIdx;
          }
        }
      }
    }

    // Once a second each gap is read into its running averages.
    const sampleDue =
      this.lastSampleAt === null || time - this.lastSampleAt >= 0.999;
    if (sampleDue) {
      const seconds = this.lastSampleAt === null ? 1 : time - this.lastSampleAt;
      this.lastSampleAt = time;
      this.sample(count, time, seconds, lapS, inPitLane);
    }

    changed = this.publishNearest(nearest) || changed;
    changed =
      this.publishArriving(inPitLane, time, latest.exitedAt, latest.slowAt) ||
      changed;
    changed =
      this.publishPicks(cells, pcts, player, playerPct, lapS, inPitLane) ||
      changed;

    // The mirror and the forecast, on the track only.
    const raceRule =
      isRace &&
      (sessionState === SessionState.Racing ||
        sessionState === SessionState.Checkered);
    const field = this.field;
    field.pcts = pcts;
    field.laps = laps;
    field.surfaces = surfaces;
    field.onPitRoad = onPitRoad;
    field.speedsKmh = speeds;
    field.player = player;
    field.playerPct = playerPct;
    field.trackLength = this.trackLength;
    field.raceRule = raceRule;
    field.isLmu = isLmu;
    field.classes = this.classes;
    changed = this.publishMirror(inPitLane) || changed;
    changed =
      this.publishForecast(count, lapTimes, playerPct, lapS, inPitLane) ||
      changed;

    if (changed) latest.version += 1;
  }

  onLifecycle(event: SessionLifecycleEvent): void {
    // Nothing here outlasts a session, so a replay is read like a live one
    // and every lifecycle event simply starts over.
    void event;
    this.clear();
    this.latest.sessionNum = null;
    this.lastTime = null;
    this.latest.version += 1;
  }

  snapshot(): TrafficSnapshot {
    return this.latest;
  }

  /** Forgets everything measured and published; true when that showed. */
  private clear(): boolean {
    this.forgetRunning();
    this.lastState = -1;
    this.racingSince = null;
    this.wasInPitLane = false;
    const latest = this.latest;
    let changed = this.publishNothing();
    if (latest.slowAt !== null || latest.exitedAt !== null) {
      latest.slowAt = null;
      latest.exitedAt = null;
      changed = true;
    }
    return this.setInPitLane(false) || changed;
  }

  /** The player's record and every car's closing: what a jump invalidates. */
  private forgetRunning(): void {
    this.trace.clear();
    this.lastPct = -1;
    this.progress = 0;
    this.dirtyProgress = Number.NEGATIVE_INFINITY;
    this.lastSampleAt = null;
    this.queue.drop();
    for (const car of this.cars) {
      if (car) restart(car);
    }
  }

  private setInPitLane(inPitLane: boolean): boolean {
    if (this.latest.inPitLane === inPitLane) return false;
    this.latest.inPitLane = inPitLane;
    return true;
  }

  /** Clears what is published about other cars; true when something was. */
  private publishNothing(): boolean {
    const latest = this.latest;
    const had =
      latest.slowerAhead !== null ||
      latest.leader !== null ||
      latest.fasterBehind !== null ||
      latest.nearestBehind !== null ||
      latest.forecast !== null ||
      latest.lapS !== null ||
      latest.moreBehind !== 0 ||
      this.behind.length > 0 ||
      this.arriving.length > 0;
    latest.slowerAhead = null;
    latest.leader = null;
    latest.fasterBehind = null;
    latest.nearestBehind = null;
    latest.forecast = null;
    latest.lapS = null;
    latest.moreBehind = 0;
    this.behind.length = 0;
    this.arriving.length = 0;
    return had;
  }

  /** All four wheels off the road, or the sim saying the car is. */
  private isOffRoad(cells: Cells, isLmu: boolean): boolean {
    if (!isLmu) {
      return scalarOf(cells, 'PlayerTrackSurface') === TrackLocation.OffTrack;
    }
    const wheels = valuesOf(cells, 'LmuWheelSurfaceType');
    if (wheels.length < 4) return false;
    for (let wheel = 0; wheel < 4; wheel += 1) {
      const surface = wheels[wheel];
      if (
        typeof surface !== 'number' ||
        surface < SURFACE_GRASS ||
        surface > SURFACE_GRAVEL
      ) {
        return false;
      }
    }
    return true;
  }

  /**
   * How long ago the player was where a car this fraction of a lap behind
   * is now. NaN where the record does not reach back that far, or reaches
   * across running that was not racing.
   */
  private intervalBehind(fraction: number, time: number): number {
    const where = this.progress - fraction;
    if (!(where > this.dirtyProgress)) return Number.NaN;
    const then = this.trace.timeAt(where);
    return then === null ? Number.NaN : time - then;
  }

  /**
   * How long the player took, a lap ago, from where they are now to where
   * a car this fraction of a lap ahead is. NaN where that lap is not on
   * record, or was not all racing.
   */
  private gapAhead(fraction: number): number {
    const lapAgo = this.progress - 1;
    if (!(lapAgo > this.dirtyProgress)) return Number.NaN;
    const from = this.trace.timeAt(lapAgo);
    const to = this.trace.timeAt(lapAgo + fraction);
    return from === null || to === null ? Number.NaN : to - from;
  }

  /** The time the player's last full lap up to here took; null without. */
  private rollingLap(time: number): number | null {
    const interval = this.intervalBehind(1, time);
    return Number.isNaN(interval) ? null : interval;
  }

  /**
   * The player's lap time: the pace measured over their laps; before one is
   * complete the lap up to here, or what the record so far works out to;
   * and under iRacing, failing those, the class's own estimate. LMU's
   * estimate is one constant for every class and is not a pace.
   */
  private lapSeconds(
    lapTimes: readonly number[],
    player: number,
    rolling: number | null,
    time: number,
    isLmu: boolean
  ): number | null {
    const measured = lapTimes[player];
    if (measured > 0) return measured;
    if (rolling !== null) return rolling;
    const covered = this.progress - this.trace.firstProgress;
    if (
      covered >= MIN_RECORD_LAPS &&
      this.trace.firstProgress > this.dirtyProgress
    ) {
      return (time - this.trace.firstTime) / covered;
    }
    const estimate = isLmu ? 0 : (this.classes[player]?.estLapTime ?? 0);
    return estimate > 0 ? estimate : null;
  }

  /**
   * Laps the player covers in the next `seconds`, read off what they did
   * from this point a lap ago. Null where that lap is not on record.
   */
  private travelled(seconds: number): number | null {
    const lapAgo = this.progress - 1;
    if (!(lapAgo > this.dirtyProgress)) return null;
    const then = this.trace.timeAt(lapAgo);
    if (then === null) return null;
    const reached = this.trace.progressAt(then + seconds);
    return reached === null ? null : reached - lapAgo;
  }

  private carState(carIdx: number): CarState {
    let car = this.cars[carIdx];
    if (!car) {
      car = newCarState();
      this.cars[carIdx] = car;
    }
    return car;
  }

  /**
   * The once-a-second reading of every car's gap.
   *
   * What is read is how far the player leads the car, on the side it is
   * nearer on, and the closing is the fall of that: it runs on unbroken as
   * a car goes by. Where either reading was not a measured one the fall is
   * taken from the lap fractions, at the player's lap time: taken from the
   * seconds it would count a change of the lap time itself as closing. A
   * fall of 3 s or more is the car coming round the far side of the lap,
   * or two cars swapping places, and is left out.
   */
  private sample(
    count: number,
    time: number,
    seconds: number,
    lapS: number | null,
    inPitLane: boolean
  ): void {
    const length = Math.max(count, this.cars.length);
    for (let carIdx = 0; carIdx < length; carIdx += 1) {
      if (this.seenOf[carIdx] !== true || inPitLane) {
        const gone = this.cars[carIdx];
        if (gone) restart(gone);
        continue;
      }
      const car = this.carState(carIdx);
      const behind = this.behindFractionOf[carIdx];
      const fraction = behind <= 0.5 ? behind : behind - 1;
      const lead = this.leadOf[carIdx];
      const measured = this.measuredOf[carIdx];
      const previousFraction = car.fraction;
      const previousLead = car.lead;
      const wasMeasured = car.measured;
      car.fraction = fraction;
      car.lead = lead;
      car.measured = measured;
      // The forecast's own record: the measured interval, while the car is
      // behind and near enough for its arrival to be worth a line.
      const interval = this.intervalOf[carIdx];
      if (!Number.isNaN(interval) && interval <= FORECAST_RANGE_S) {
        car.window.push(time, interval);
      } else {
        car.window.clear();
      }
      if (Number.isNaN(previousFraction) || !(seconds > 0)) continue;

      let fall: number;
      if (measured && wasMeasured) {
        fall = previousLead - lead;
      } else if (lapS !== null) {
        fall = (previousFraction - fraction) * lapS;
      } else {
        continue;
      }
      if (Math.abs(fall) >= SWAP_JUMP_S) continue;
      car.closing.feed(fall / seconds);
    }
  }

  private publishNearest(nearest: number): boolean {
    const latest = this.latest;
    if (nearest < 0) {
      if (latest.nearestBehind === null) return false;
      latest.nearestBehind = null;
      return true;
    }
    const gapS = round1(this.reachOf[nearest]);
    const target = this.nearest;
    if (
      latest.nearestBehind === target &&
      target.carIdx === nearest &&
      target.gapS === gapS
    ) {
      return false;
    }
    target.carIdx = nearest;
    target.gapS = gapS;
    latest.nearestBehind = target;
    return true;
  }

  /**
   * The cars that will come by, while that is what the player needs to
   * know: in the pit lane, and for a while after it or after being slow.
   */
  private publishArriving(
    inPitLane: boolean,
    time: number,
    exitedAt: number | null,
    slowAt: number | null
  ): boolean {
    const wanted =
      inPitLane ||
      (exitedAt !== null && time - exitedAt <= ARRIVING_HOLD_S) ||
      (slowAt !== null && time - slowAt <= ARRIVING_HOLD_S);
    const { arrivals, arriving, arrivalPool } = this;
    if (!wanted) {
      if (arriving.length === 0) return false;
      arriving.length = 0;
      return true;
    }
    arrivals.sort(this.byReach);
    const length = Math.min(arrivals.length, ARRIVING_MAX);
    let changed = arriving.length !== length;
    arriving.length = length;
    for (let index = 0; index < length; index += 1) {
      const carIdx = arrivals[index];
      let row = arrivalPool[index];
      if (!row) {
        row = { carIdx: -1, gapS: 0, speedMs: 0 };
        arrivalPool[index] = row;
      }
      const gapS = round1(this.reachOf[carIdx]);
      const speedMs = round1(this.reachSpeedOf[carIdx]);
      if (
        arriving[index] !== row ||
        row.carIdx !== carIdx ||
        row.gapS !== gapS ||
        row.speedMs !== speedMs
      ) {
        row.carIdx = carIdx;
        row.gapS = gapS;
        row.speedMs = speedMs;
        arriving[index] = row;
        changed = true;
      }
    }
    return changed;
  }

  private setPick(
    key: PickKey,
    carIdx: number,
    gapS: number,
    laps: number | null,
    thisLap: boolean
  ): boolean {
    const latest = this.latest;
    if (carIdx < 0 || Number.isNaN(gapS)) {
      if (latest[key] === null) return false;
      latest[key] = null;
      return true;
    }
    const pick = this.picks[key];
    const gap = round1(gapS);
    const rounded = laps === null ? null : round2(laps);
    if (
      latest[key] === pick &&
      pick.carIdx === carIdx &&
      pick.gapS === gap &&
      pick.laps === rounded &&
      pick.thisLap === thisLap
    ) {
      return false;
    }
    pick.carIdx = carIdx;
    pick.gapS = gap;
    pick.laps = rounded;
    pick.thisLap = thisLap;
    latest[key] = pick;
    return true;
  }

  /**
   * The table of contacts: on each side the car whose gap closes to nothing
   * soonest, and the leader's own figure from behind.
   */
  private publishPicks(
    cells: Cells,
    pcts: readonly unknown[],
    player: number,
    playerPct: number,
    lapS: number | null,
    inPitLane: boolean
  ): boolean {
    let ahead = -1;
    let aheadIn = Number.POSITIVE_INFINITY;
    let behind = -1;
    let behindIn = Number.POSITIVE_INFINITY;
    if (!inPitLane) {
      for (let carIdx = 0; carIdx < this.cars.length; carIdx += 1) {
        const car = this.cars[carIdx];
        if (!car || this.seenOf[carIdx] !== true) continue;
        if (car.closing.samples < MIN_RATE_SAMPLES) continue;
        // Closing from behind is opening ahead, and the other way round, so
        // each car is a candidate on one side only.
        const rate = car.closing.longRate;
        if (rate > 0) {
          const contact = this.gapBehindOf[carIdx] / rate;
          if (contact < behindIn) {
            behindIn = contact;
            behind = carIdx;
          }
        } else if (rate < 0) {
          const contact = this.gapAheadOf[carIdx] / -rate;
          if (contact < aheadIn) {
            aheadIn = contact;
            ahead = carIdx;
          }
        }
      }
    }

    const aheadLaps =
      ahead >= 0 && lapS !== null && aheadIn / lapS <= FORECAST_MAX_LAPS
        ? aheadIn / lapS
        : null;
    const behindLaps =
      behind >= 0 && lapS !== null && behindIn / lapS <= FORECAST_MAX_LAPS
        ? behindIn / lapS
        : null;
    let changed = this.setPick(
      'slowerAhead',
      ahead,
      ahead >= 0 ? this.gapAheadOf[ahead] : Number.NaN,
      aheadLaps,
      ahead >= 0 && meetsThisLap(aheadLaps, finiteAt(pcts, ahead) ?? 0)
    );
    changed =
      this.setPick(
        'fasterBehind',
        behind,
        behind >= 0 ? this.gapBehindOf[behind] : Number.NaN,
        behindLaps,
        meetsThisLap(behindLaps, playerPct)
      ) || changed;

    // The leader: the car in first place, unless that is the player.
    let leader = -1;
    if (!inPitLane) {
      const positions = valuesOf(cells, 'CarIdxPosition');
      for (let carIdx = 0; carIdx < positions.length; carIdx += 1) {
        if (positions[carIdx] !== 1 || this.excluded.has(carIdx)) continue;
        if (carIdx !== player && this.seenOf[carIdx] === true) leader = carIdx;
        break;
      }
    }
    const leaderCar = leader >= 0 ? this.cars[leader] : undefined;
    const leaderLaps =
      leaderCar && leaderCar.closing.samples >= MIN_RATE_SAMPLES
        ? lapsToContact(
            this.gapBehindOf[leader],
            leaderCar.closing.longRate,
            lapS,
            FORECAST_MAX_LAPS
          )
        : null;
    return (
      this.setPick(
        'leader',
        leader,
        leader >= 0 ? this.gapBehindOf[leader] : Number.NaN,
        leaderLaps,
        meetsThisLap(leaderLaps, playerPct)
      ) || changed
    );
  }

  /**
   * The mirror: the cars of traffic inside the listing window in the order
   * they queue, and in front of them the car racing the player for
   * position when it is the one right behind.
   */
  private publishMirror(inPitLane: boolean): boolean {
    const latest = this.latest;
    const { queue, field, pool, behind } = this;
    pool.length = 0;
    let head = -1;
    let rival = -1;
    if (!inPitLane) {
      queue.scan(field);
      for (const carIdx of queue.listed) {
        if (this.isInMirror(carIdx, TRAFFIC_QUEUE_GAP_S)) pool.push(carIdx);
      }
      head = queue.settle(pool);
      const headDist =
        head >= 0 ? queue.distOf[head] : Number.POSITIVE_INFINITY;
      for (const carIdx of queue.candidates) {
        if (queue.relationOf[carIdx] !== 'position') continue;
        const dist = queue.distOf[carIdx];
        if (dist >= headDist) continue;
        if (rival < 0 || dist < queue.distOf[rival]) rival = carIdx;
      }
      if (rival >= 0 && !this.isInMirror(rival, RIVAL_GAP_S)) rival = -1;
    } else {
      queue.drop();
    }

    let length = 0;
    let changed = false;
    if (rival >= 0) {
      changed = this.putRow(length, rival) || changed;
      length += 1;
    }
    let listed = 0;
    if (head >= 0) {
      changed = this.putRow(length, head) || changed;
      length += 1;
      listed += 1;
      for (const carIdx of pool) {
        if (length >= MIRROR_ROWS) break;
        if (carIdx === head) continue;
        changed = this.putRow(length, carIdx) || changed;
        length += 1;
        listed += 1;
      }
    }
    if (behind.length !== length) {
      behind.length = length;
      changed = true;
    }
    const more = pool.length - listed;
    if (latest.moreBehind !== more) {
      latest.moreBehind = more;
      changed = true;
    }
    return changed;
  }

  /**
   * Whether a scanned car is no more than `limitS` behind: by the measured
   * interval where there is one, which holds still through a corner, and
   * otherwise by the metres over the higher speed, as the flag panel's
   * queue is counted.
   */
  private isInMirror(carIdx: number, limitS: number): boolean {
    const interval = this.intervalOf[carIdx];
    if (this.seenOf[carIdx] === true && !Number.isNaN(interval)) {
      return interval <= limitS;
    }
    const gap = relativeTimeGap(
      this.queue.distOf[carIdx],
      speedOf(this.field.speedsKmh, carIdx),
      this.queue.playerSpeed
    );
    return gap === null || gap <= limitS;
  }

  /** Writes one row of the mirror; true when what it shows moved. */
  private putRow(index: number, carIdx: number): boolean {
    const { queue, field, behind, rowPool } = this;
    let row = rowPool[index];
    if (!row) {
      row = {
        carIdx: -1,
        relation: 'behind',
        distanceM: 0,
        gapS: null,
        measured: false,
        closingS: null,
        lapsAhead: 0,
      };
      rowPool[index] = row;
    }
    const interval = this.intervalOf[carIdx];
    const measured = this.seenOf[carIdx] === true && !Number.isNaN(interval);
    const gapS = measured
      ? round1(Math.max(0, interval))
      : relativeTimeGap(
          queue.distOf[carIdx],
          speedOf(field.speedsKmh, carIdx),
          queue.playerSpeed
        );
    const window = this.cars[carIdx]?.window;
    const closingS =
      window && window.measuredS >= CLOSING_SHOWN_AFTER_S
        ? round2(window.closingOver(CLOSING_SHOWN_OVER_S))
        : null;
    const relation = queue.relationOf[carIdx];
    const distanceM = Math.round(queue.distOf[carIdx]);
    const lapsAhead = queue.lapsOf[carIdx];
    if (
      behind[index] === row &&
      row.carIdx === carIdx &&
      row.relation === relation &&
      row.distanceM === distanceM &&
      row.gapS === gapS &&
      row.measured === measured &&
      row.closingS === closingS &&
      row.lapsAhead === lapsAhead
    ) {
      return false;
    }
    row.carIdx = carIdx;
    row.relation = relation;
    row.distanceM = distanceM;
    row.gapS = gapS;
    row.measured = measured;
    row.closingS = closingS;
    row.lapsAhead = lapsAhead;
    behind[index] = row;
    return true;
  }

  /**
   * The forecast for the car that arrives soonest of those whose interval
   * has closed steadily: when, and where on the lap.
   */
  private publishForecast(
    count: number,
    lapTimes: readonly number[],
    playerPct: number,
    lapS: number | null,
    inPitLane: boolean
  ): boolean {
    const latest = this.latest;
    let best: CatchForecast | null = null;
    let bestCar = -1;
    if (!inPitLane) {
      const input = this.catchInput;
      input.lapS = lapS;
      input.pct = playerPct;
      for (let carIdx = 0; carIdx < count; carIdx += 1) {
        const window = this.cars[carIdx]?.window;
        if (!window || this.seenOf[carIdx] !== true) continue;
        const interval = this.intervalOf[carIdx];
        const span = window.measuredS;
        if (Number.isNaN(interval) || span < FORECAST_STEADY_S) continue;
        // The fall over the last twenty seconds; for a car closing too
        // slowly for that to show, over everything the window holds.
        let over = Math.min(span, FORECAST_WINDOW_S);
        let closing = window.closingOver(over);
        if (closing * over < FORECAST_MIN_FALL_S && span > over) {
          over = Math.min(span, INTERVAL_WINDOW_S);
          closing = window.closingOver(over);
        }
        input.gapS = interval;
        input.closingS = closing;
        // Its newer half and its older half: where they agree it is steady.
        input.closingQuickS = window.closingBetween(over / 2, 0);
        input.closingSlowS = window.closingBetween(over, over / 2);
        input.measuredS = over;
        const chaserLap = lapTimes[carIdx];
        input.chaserLapS = chaserLap > 0 ? chaserLap : null;
        const forecast = forecastCatch(input);
        if (forecast && (best === null || forecast.etaS < best.etaS)) {
          best = forecast;
          bestCar = carIdx;
        }
      }
    }
    if (best === null) {
      if (latest.forecast === null) return false;
      latest.forecast = null;
      return true;
    }
    const target = this.forecast;
    const etaS = Math.round(best.etaS);
    const lowS = Math.round(best.lowS);
    const highS = Math.round(best.highS);
    const lapsOn = best.laps === null ? null : round2(best.laps);
    const meetPct = roundPct(best.meetPct);
    const meetLowPct = roundPct(best.meetLowPct);
    const meetHighPct = roundPct(best.meetHighPct);
    if (
      latest.forecast === target &&
      target.carIdx === bestCar &&
      target.etaS === etaS &&
      target.lowS === lowS &&
      target.highS === highS &&
      target.steady === best.steady &&
      target.laps === lapsOn &&
      target.meetPct === meetPct &&
      target.meetLowPct === meetLowPct &&
      target.meetHighPct === meetHighPct
    ) {
      return false;
    }
    target.carIdx = bestCar;
    target.etaS = etaS;
    target.lowS = lowS;
    target.highS = highS;
    target.steady = best.steady;
    target.laps = lapsOn;
    target.meetPct = meetPct;
    target.meetLowPct = meetLowPct;
    target.meetHighPct = meetHighPct;
    latest.forecast = target;
    return true;
  }
}
