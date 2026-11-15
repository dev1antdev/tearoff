import type {
  CarPitSnapshot,
  Session,
  SessionLifecycleEvent,
  Telemetry,
} from '@irdashies/types';
import {
  CAR_PIT_IN_GARAGE,
  CAR_PIT_IN_LANE,
  CAR_PIT_ON_TRACK,
  TrackLocation,
} from '@irdashies/types';
import type { TelemetryProcessor } from './TelemetryProcessor';
import { isStandingStill, PIT_LAP_SECONDS, STOP_SECONDS } from './pitVisit';

/**
 * Two frames further apart than this are not neighbours: the session was
 * paused, or frames stopped arriving. Nothing is added to a standing time
 * across the gap.
 */
const MAX_FRAME_GAP_SECONDS = 2;
/**
 * How long after a lap completion the reading that goes with it is taken.
 *
 * Not at the line itself: on the recorded race LMU's fuel byte reads 255, a
 * full tank, for one scoring update as a car crosses it (slot 11 at 293.4 s,
 * slot 28 at 224.4 s), and a baseline taken there made the next lap cost two
 * thirds of a tank. A second later the reading is the car's own again, and
 * every sample is still exactly one lap long.
 */
const ENERGY_SETTLE_SECONDS = 1;
/** LMU's pit state for a car that has asked for a stop. */
const PIT_STATE_REQUESTED = 1;
/** LMU's pit state for a car stationary at its box. */
const PIT_STATE_STOPPED = 3;

/** A car not seen in the world yet. */
const UNSEEN = -1;
/** No lap, no reading, no figure: what every "unknown" is published as. */
const UNKNOWN = -1;

const LANE_DECIMALS = 1;
const USAGE_DECIMALS = 4;
const LAPS_LEFT_DECIMALS = 1;

const round = (value: number, decimals: number): number => {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
};

type Frame = Record<string, { value?: unknown[] } | undefined>;

const arrayOf = (
  frame: Telemetry,
  key: keyof Telemetry
): readonly unknown[] | undefined => {
  const value = (frame as unknown as Frame)[key]?.value;
  return Array.isArray(value) ? value : undefined;
};

const scalarOf = (frame: Telemetry, key: keyof Telemetry): number | null => {
  const value = (frame as unknown as Frame)[key]?.value?.[0];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const numberAt = (
  values: readonly unknown[] | undefined,
  index: number,
  fallback: number
): number => {
  const value = values?.[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

const flagAt = (
  values: readonly unknown[] | undefined,
  index: number
): boolean => values?.[index] === true || values?.[index] === 1;

/** What is kept about one car. Made once per car, then changed in place. */
interface Car {
  /** Where the car was last seen, or UNSEEN. */
  place: number;
  /** Session time at which `place` last changed. */
  visitStart: number;
  /** Seconds of the current or most recent visit to the lane, unrounded. */
  laneS: number;
  standingS: number;
  /** Standing in the lane on the last frame it was seen. */
  standing: boolean;
  /** The visit under way has already made its lap a pit lap, or a stop. */
  visitIsPitLap: boolean;
  visitIsStop: boolean;
  /** Stops seen here, whatever the sim counts. */
  observedStops: number;
  /** Laps completed, as last read; UNKNOWN before the first reading. */
  lap: number;
  /** Laps completed when the stint began; UNKNOWN when that was not seen. */
  stintStartLap: number;
  lastPitLap: number;
  lastStopLap: number;
  longestStintLaps: number;
  /** Lap count the energy rules last saw; UNKNOWN before the first. */
  energyLap: number;
  /** Which budget the readings are of. */
  energyIsVirtual: boolean;
  /** Laps completed whose reading has not been taken yet. */
  energyLapsDue: number;
  /** Session time at which that reading is taken. */
  energyDueAt: number;
  /** What was left at the last lap completion; UNKNOWN before one. */
  energyBase: number;
  usedLastLap: number;
  usedAverage: number;
  lapsLeft: number;
}

const newCar = (): Car => ({
  place: UNSEEN,
  visitStart: 0,
  laneS: 0,
  standingS: 0,
  standing: false,
  visitIsPitLap: false,
  visitIsStop: false,
  observedStops: 0,
  lap: UNKNOWN,
  stintStartLap: 0,
  lastPitLap: UNKNOWN,
  lastStopLap: UNKNOWN,
  longestStintLaps: 0,
  energyLap: UNKNOWN,
  energyIsVirtual: false,
  energyLapsDue: 0,
  energyDueAt: 0,
  energyBase: UNKNOWN,
  usedLastLap: UNKNOWN,
  usedAverage: UNKNOWN,
  lapsLeft: UNKNOWN,
});

const forgetEnergy = (car: Car): void => {
  car.energyLap = UNKNOWN;
  car.energyLapsDue = 0;
  car.energyBase = UNKNOWN;
  car.usedLastLap = UNKNOWN;
  car.usedAverage = UNKNOWN;
  car.lapsLeft = UNKNOWN;
};

/** Writes one entry of a published array; true when it moved. */
const put = <T>(target: T[], index: number, value: T): boolean => {
  if (target[index] === value) return false;
  target[index] = value;
  return true;
};

/** Brings a published array to a length; true when it was another. */
const resize = <T>(target: T[], length: number, fill: T): boolean => {
  if (target.length === length) return false;
  const from = target.length;
  target.length = length;
  for (let index = from; index < length; index += 1) target[index] = fill;
  return true;
};

/**
 * Follows every car through the pits: where it is, how long its visit to the
 * pit lane has lasted and how much of that it stood still, how many times it
 * has stopped, how long its stint is, and what a lap costs it in energy or
 * fuel where the sim says what it has left.
 *
 * A car stands when LMU's pit state says it is stopped, or under iRacing
 * when its track surface is the pit stall; the player's own car, whose speed
 * is known, from below half a metre per second until it is above one again
 * (`pitVisit.ts`, the definition the stint record and the pit stop timer
 * share). Standing for more than a second is a stop and restarts the stint. Frames in which a car is not in the
 * world are skipped, so a driver change is one stop and not two.
 *
 * Energy is sampled from one lap completion to the next, each reading taken
 * a second after the line. A reading that went up is a refuel and gives no
 * sample; a lap count that jumps takes a new baseline without one.
 *
 * Everything is forgotten when the session changes or its clock runs
 * backwards, and nothing is taken from a replay. Nothing is kept on disk.
 */
export class CarPitProcessor implements TelemetryProcessor<
  CarPitSnapshot,
  'car-pit.snapshot'
> {
  readonly channel = 'car-pit.snapshot';
  // Sortable, not positional: pit timers are read to a tenth of a second.
  readonly tickRateHz = 5;

  private enabled = true;
  private lastTime: number | null = null;
  private readonly cars: (Car | undefined)[] = [];
  /** What the session names each slot's entry, to see a slot change hands. */
  private readonly entries = new Map<number, string>();
  /** Slots that are not competitors: the pace car, spectators. */
  private readonly ignored = new Set<number>();

  private readonly where: number[] = [];
  private readonly laneTimeS: number[] = [];
  private readonly standingS: number[] = [];
  private readonly stops: number[] = [];
  private readonly lastPitLap: number[] = [];
  private readonly lastStopLap: number[] = [];
  private readonly stintLaps: number[] = [];
  private readonly longestStintLaps: number[] = [];
  private readonly usedLastLap: number[] = [];
  private readonly usedAverage: number[] = [];
  private readonly lapsLeft: number[] = [];
  private readonly requested: boolean[] = [];
  private readonly counts: CarPitSnapshot['counts'] = {
    onTrack: 0,
    inLane: 0,
    standingInLane: 0,
    requested: 0,
    inGarage: 0,
  };
  private readonly latest: CarPitSnapshot = {
    where: this.where,
    laneTimeS: this.laneTimeS,
    standingS: this.standingS,
    stops: this.stops,
    lastPitLap: this.lastPitLap,
    lastStopLap: this.lastStopLap,
    stintLaps: this.stintLaps,
    longestStintLaps: this.longestStintLaps,
    usedLastLap: this.usedLastLap,
    usedAverage: this.usedAverage,
    lapsLeft: this.lapsLeft,
    requested: this.requested,
    counts: this.counts,
    sessionNum: null,
    version: 0,
  };

  /**
   * Reads who holds each slot. A slot whose entry is another one than
   * before was reused: what was seen of the car that left is not the new
   * car's.
   */
  init(session: Session): void {
    const seen = new Set<number>();
    let changed = false;
    this.ignored.clear();
    for (const driver of session?.DriverInfo?.Drivers ?? []) {
      const carIdx = driver?.CarIdx;
      if (typeof carIdx !== 'number' || carIdx < 0) continue;
      if (driver.CarIsPaceCar === 1 || driver.IsSpectator === 1) {
        this.ignored.add(carIdx);
        continue;
      }
      seen.add(carIdx);
      // The car and not the driver: a team's car keeps both through a
      // driver change.
      const entry = `${driver.CarPath ?? ''}|${driver.CarNumber ?? ''}`;
      const previous = this.entries.get(carIdx);
      if (previous !== undefined && previous !== entry) {
        this.cars[carIdx] = undefined;
        changed = this.blankSlot(carIdx) || changed;
      }
      this.entries.set(carIdx, entry);
    }
    for (const carIdx of this.entries.keys()) {
      if (!seen.has(carIdx)) this.entries.delete(carIdx);
    }
    if (changed) this.latest.version += 1;
  }

  onFrame(frame: Telemetry): void {
    if (!this.enabled) return;
    const surfaces = arrayOf(frame, 'CarIdxTrackSurface');
    const now = scalarOf(frame, 'SessionTime');
    if (!surfaces || now === null) return;

    let changed = false;
    const sessionNum = scalarOf(frame, 'SessionNum');
    if (sessionNum !== null && sessionNum !== this.latest.sessionNum) {
      if (this.latest.sessionNum !== null) this.forgetCars();
      this.latest.sessionNum = sessionNum;
      changed = true;
    }
    // A clock that ran backwards is a session started again.
    if (this.lastTime !== null && now < this.lastTime) {
      this.forgetCars();
      changed = true;
    }
    const elapsed = this.lastTime === null ? 0 : now - this.lastTime;
    const step = elapsed > 0 && elapsed <= MAX_FRAME_GAP_SECONDS ? elapsed : 0;
    this.lastTime = now;

    const onPitRoad = arrayOf(frame, 'CarIdxOnPitRoad');
    const laps = arrayOf(frame, 'CarIdxLapCompleted');
    // Present under Le Mans Ultimate only, where the sim says what a car is
    // doing in the pits rather than leaving it to be read off its surface.
    const pitStates = arrayOf(frame, 'LmuCarIdxPitState');
    const simStops = arrayOf(frame, 'LmuCarIdxPitStops');
    const inGarage = arrayOf(frame, 'LmuCarIdxInGarage');
    const remaining = arrayOf(frame, 'LmuCarIdxEnergyRemaining');
    const isVirtual = arrayOf(frame, 'LmuCarIdxEnergyIsVirtual');
    const playerCarIdx = scalarOf(frame, 'PlayerCarIdx') ?? -1;
    // The player's speed is the player's only while they are in the car.
    const playerSpeed =
      (frame as unknown as Frame).IsOnTrack?.value?.[0] === true
        ? scalarOf(frame, 'Speed')
        : null;

    const carCount = surfaces.length;
    changed = this.resizePitArrays(carCount) || changed;
    changed =
      resize(this.requested, pitStates ? carCount : 0, false) || changed;

    let onTrack = 0;
    let inLane = 0;
    let standingInLane = 0;
    let requested = 0;
    let garaged = 0;

    for (let carIdx = 0; carIdx < carCount; carIdx += 1) {
      const surface = numberAt(surfaces, carIdx, TrackLocation.NotInWorld);
      const competitor = !this.ignored.has(carIdx);
      if (pitStates) {
        const asked =
          competitor && numberAt(pitStates, carIdx, 0) === PIT_STATE_REQUESTED;
        changed = put(this.requested, carIdx, asked) || changed;
        if (asked) requested += 1;
      }
      if (!competitor) {
        changed = put(this.where, carIdx, CAR_PIT_IN_GARAGE) || changed;
        continue;
      }
      if (surface === TrackLocation.NotInWorld) {
        // Not a change of place: the visit under way, if there is one, goes
        // on when the car is back.
        changed = put(this.where, carIdx, CAR_PIT_IN_GARAGE) || changed;
        if (this.cars[carIdx] || this.entries.has(carIdx)) garaged += 1;
        continue;
      }

      const lap = Math.max(0, Math.trunc(numberAt(laps, carIdx, 0)));
      let car = this.cars[carIdx];
      // Fewer laps than before is another car in the slot, or the same one
      // in a session started again: either way a car not seen before.
      if (!car || lap < car.lap) {
        car = newCar();
        this.cars[carIdx] = car;
        if (numberAt(simStops, carIdx, 0) > 0) {
          // LMU says it has stopped already, and when was not seen: how
          // long this stint is cannot be told until the car stops again.
          car.stintStartLap = UNKNOWN;
        }
      }
      car.lap = lap;

      const place = flagAt(inGarage, carIdx)
        ? CAR_PIT_IN_GARAGE
        : flagAt(onPitRoad, carIdx) ||
            (!pitStates && surface === TrackLocation.InPitStall)
          ? CAR_PIT_IN_LANE
          : CAR_PIT_ON_TRACK;
      const standing =
        carIdx === playerCarIdx && playerSpeed !== null
          ? isStandingStill(car.standing, playerSpeed)
          : pitStates
            ? numberAt(pitStates, carIdx, 0) === PIT_STATE_STOPPED
            : surface === TrackLocation.InPitStall;
      this.follow(car, place, standing, now, step);

      if (place === CAR_PIT_ON_TRACK) onTrack += 1;
      else if (place === CAR_PIT_IN_LANE) {
        inLane += 1;
        if (standing) standingInLane += 1;
      } else garaged += 1;

      changed = this.publishCar(carIdx, car, place, simStops) || changed;
    }

    changed = this.followEnergy(laps, remaining, isVirtual, now) || changed;

    changed = this.setCount('onTrack', onTrack) || changed;
    changed = this.setCount('inLane', inLane) || changed;
    changed = this.setCount('standingInLane', standingInLane) || changed;
    changed = this.setCount('requested', requested) || changed;
    changed = this.setCount('inGarage', garaged) || changed;

    if (changed) this.latest.version += 1;
  }

  onLifecycle(event: SessionLifecycleEvent): void {
    if (event.type === 'enter') {
      // A replay is somebody's finished session being looked at: scrubbed
      // through, its pit visits are not visits.
      this.enabled = !event.replay;
      if (!this.enabled) this.reset();
      return;
    }
    if (event.type === 'disconnect') {
      this.entries.clear();
      this.ignored.clear();
    }
    this.reset();
  }

  snapshot(): CarPitSnapshot {
    return this.latest;
  }

  /** One frame of a car that is in the world. */
  private follow(
    car: Car,
    place: number,
    standing: boolean,
    now: number,
    step: number
  ): void {
    // The time since the last frame belongs to what the car was doing then:
    // counted from the frame it was first seen standing on, a stop would be
    // a tick longer than it was.
    if (car.standing) {
      car.standingS += step;
      if (!car.visitIsStop && car.standingS > STOP_SECONDS) {
        car.visitIsStop = true;
        car.observedStops += 1;
        car.lastStopLap = car.lap;
        this.endStint(car);
      }
    }

    if (place !== car.place) {
      // Leaving the lane closes the visit at this frame.
      if (car.place === CAR_PIT_IN_LANE) car.laneS = now - car.visitStart;
      car.visitStart = now;
      if (place === CAR_PIT_IN_LANE) {
        car.laneS = 0;
        car.standingS = 0;
        car.visitIsPitLap = false;
        car.visitIsStop = false;
      }
      car.place = place;
    }

    car.standing = place === CAR_PIT_IN_LANE && standing;
    if (place === CAR_PIT_IN_LANE) {
      car.laneS = now - car.visitStart;
      if (!car.visitIsPitLap && car.laneS > PIT_LAP_SECONDS) {
        car.visitIsPitLap = true;
        car.lastPitLap = car.lap;
      }
    } else if (place === CAR_PIT_IN_GARAGE) {
      // Out of the garage the car is on a new stint, with no visit behind
      // it.
      car.laneS = 0;
      car.standingS = 0;
      if (car.stintStartLap !== car.lap) this.endStint(car);
    }
  }

  private endStint(car: Car): void {
    if (car.stintStartLap !== UNKNOWN) {
      car.longestStintLaps = Math.max(
        car.longestStintLaps,
        car.lap - car.stintStartLap
      );
    }
    car.stintStartLap = car.lap;
  }

  /** Writes a car's pit and stint figures; true when one of them moved. */
  private publishCar(
    carIdx: number,
    car: Car,
    place: number,
    simStops: readonly unknown[] | undefined
  ): boolean {
    const stated = numberAt(simStops, carIdx, UNKNOWN);
    let changed = put(this.where, carIdx, place);
    changed =
      put(this.laneTimeS, carIdx, round(car.laneS, LANE_DECIMALS)) || changed;
    changed =
      put(this.standingS, carIdx, round(car.standingS, LANE_DECIMALS)) ||
      changed;
    changed =
      put(this.stops, carIdx, stated >= 0 ? stated : car.observedStops) ||
      changed;
    changed = put(this.lastPitLap, carIdx, car.lastPitLap) || changed;
    changed = put(this.lastStopLap, carIdx, car.lastStopLap) || changed;
    changed =
      put(
        this.stintLaps,
        carIdx,
        car.stintStartLap === UNKNOWN ? UNKNOWN : car.lap - car.stintStartLap
      ) || changed;
    changed =
      put(this.longestStintLaps, carIdx, car.longestStintLaps) || changed;
    return changed;
  }

  /**
   * The energy rules, for every slot the sim gives a budget for. With no
   * budget on the frame at all, which is iRacing, the three arrays are
   * empty.
   */
  private followEnergy(
    laps: readonly unknown[] | undefined,
    remaining: readonly unknown[] | undefined,
    isVirtual: readonly unknown[] | undefined,
    now: number
  ): boolean {
    const count = remaining?.length ?? 0;
    let changed = resize(this.usedLastLap, count, UNKNOWN);
    changed = resize(this.usedAverage, count, UNKNOWN) || changed;
    changed = resize(this.lapsLeft, count, UNKNOWN) || changed;

    for (let carIdx = 0; carIdx < count; carIdx += 1) {
      const car = this.cars[carIdx];
      if (car) {
        this.sampleEnergy(
          car,
          Math.trunc(numberAt(laps, carIdx, UNKNOWN)),
          numberAt(remaining, carIdx, UNKNOWN),
          flagAt(isVirtual, carIdx),
          now
        );
      }
      changed =
        put(
          this.usedLastLap,
          carIdx,
          car && car.usedLastLap !== UNKNOWN
            ? round(car.usedLastLap, USAGE_DECIMALS)
            : UNKNOWN
        ) || changed;
      changed =
        put(
          this.usedAverage,
          carIdx,
          car && car.usedAverage !== UNKNOWN
            ? round(car.usedAverage, USAGE_DECIMALS)
            : UNKNOWN
        ) || changed;
      changed =
        put(
          this.lapsLeft,
          carIdx,
          car && car.lapsLeft !== UNKNOWN
            ? round(car.lapsLeft, LAPS_LEFT_DECIMALS)
            : UNKNOWN
        ) || changed;
    }
    return changed;
  }

  private sampleEnergy(
    car: Car,
    lap: number,
    left: number,
    virtual: boolean,
    now: number
  ): void {
    if (left < 0 || lap < 0) {
      // No reading: the sim withholds it, or the car has gone.
      forgetEnergy(car);
      return;
    }
    if (car.energyLap === UNKNOWN) {
      // First sight. No baseline: one is only ever taken at a completion.
      car.energyLap = lap;
      car.energyIsVirtual = virtual;
      return;
    }
    if (virtual !== car.energyIsVirtual || lap < car.energyLap) {
      // Another budget, or fewer laps than before: not the same count.
      forgetEnergy(car);
      car.energyLap = lap;
      car.energyIsVirtual = virtual;
      return;
    }
    if (lap !== car.energyLap) {
      car.energyLapsDue += lap - car.energyLap;
      car.energyLap = lap;
      car.energyDueAt = now + ENERGY_SETTLE_SECONDS;
    }
    if (car.energyLapsDue === 0 || now < car.energyDueAt) return;

    const completed = car.energyLapsDue;
    car.energyLapsDue = 0;
    if (
      completed === 1 &&
      car.energyBase !== UNKNOWN &&
      left < car.energyBase
    ) {
      const used = car.energyBase - left;
      car.usedLastLap = used;
      car.usedAverage =
        car.usedAverage === UNKNOWN
          ? used
          : car.usedAverage + (used - car.usedAverage) / 3;
    }
    // More than at the last completion is a refuel, and several laps at
    // once are not one lap's usage: either way the last usage stands and
    // only the baseline moves.
    car.energyBase = left;
    car.lapsLeft = car.usedLastLap > 0 ? left / car.usedLastLap : UNKNOWN;
  }

  /**
   * Puts a slot's published figures back to those of a car not seen yet,
   * for a slot that has changed hands; true when one of them moved. Where
   * the slot's car is stays the next frame's to say.
   */
  private blankSlot(carIdx: number): boolean {
    let changed = false;
    if (carIdx < this.stops.length) {
      changed = put(this.laneTimeS, carIdx, 0) || changed;
      changed = put(this.standingS, carIdx, 0) || changed;
      changed = put(this.stops, carIdx, 0) || changed;
      changed = put(this.lastPitLap, carIdx, UNKNOWN) || changed;
      changed = put(this.lastStopLap, carIdx, UNKNOWN) || changed;
      changed = put(this.stintLaps, carIdx, 0) || changed;
      changed = put(this.longestStintLaps, carIdx, 0) || changed;
    }
    if (carIdx < this.usedLastLap.length) {
      changed = put(this.usedLastLap, carIdx, UNKNOWN) || changed;
      changed = put(this.usedAverage, carIdx, UNKNOWN) || changed;
      changed = put(this.lapsLeft, carIdx, UNKNOWN) || changed;
    }
    return changed;
  }

  private resizePitArrays(length: number): boolean {
    let changed = resize(this.where, length, CAR_PIT_IN_GARAGE);
    changed = resize(this.laneTimeS, length, 0) || changed;
    changed = resize(this.standingS, length, 0) || changed;
    changed = resize(this.stops, length, 0) || changed;
    changed = resize(this.lastPitLap, length, UNKNOWN) || changed;
    changed = resize(this.lastStopLap, length, UNKNOWN) || changed;
    changed = resize(this.stintLaps, length, 0) || changed;
    changed = resize(this.longestStintLaps, length, 0) || changed;
    return changed;
  }

  private setCount(
    key: keyof CarPitSnapshot['counts'],
    value: number
  ): boolean {
    if (this.counts[key] === value) return false;
    this.counts[key] = value;
    return true;
  }

  /** Forgets every car, keeping who the session says holds each slot. */
  private forgetCars(): void {
    this.cars.length = 0;
    this.lastTime = null;
    this.where.length = 0;
    this.laneTimeS.length = 0;
    this.standingS.length = 0;
    this.stops.length = 0;
    this.lastPitLap.length = 0;
    this.lastStopLap.length = 0;
    this.stintLaps.length = 0;
    this.longestStintLaps.length = 0;
    this.usedLastLap.length = 0;
    this.usedAverage.length = 0;
    this.lapsLeft.length = 0;
    this.requested.length = 0;
    this.counts.onTrack = 0;
    this.counts.inLane = 0;
    this.counts.standingInLane = 0;
    this.counts.requested = 0;
    this.counts.inGarage = 0;
  }

  private reset(): void {
    this.forgetCars();
    this.latest.sessionNum = null;
    this.latest.version += 1;
  }
}
