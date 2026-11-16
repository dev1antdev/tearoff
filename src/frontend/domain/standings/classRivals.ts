import {
  CAR_PIT_IN_GARAGE,
  CAR_PIT_IN_LANE,
  TrackLocation,
  lmuFinishStateFromCode,
  lmuPenaltyBadge,
  type CarPitSnapshot,
  type Driver,
  type LapHistorySnapshot,
  type LmuFinishState,
  type LmuPenaltyKind,
  type RelativeGapsSnapshot,
  type SessionResults,
  type StandingsSnapshot,
} from '@irdashies/types';
import { formatGap } from '@irdashies/utils/time';
import type { LastTimeState } from './createStandings';
import { lapsApart } from './lapRule';

/**
 * The class rivals: the car one place ahead of the focus car in its class
 * and the car one place behind, with what matters about each in a fight.
 *
 * Pure, and free of React: the hook that feeds it from the channels is
 * `useClassRivals`, and the recorded race is played through it in the
 * main-process tape spec.
 */

/** Car indices, or -1 where there is no such car. */
export interface ClassNeighbours {
  ahead: number;
  behind: number;
  leader: number;
}

const NO_NEIGHBOURS: ClassNeighbours = { ahead: -1, behind: -1, leader: -1 };

/**
 * Each car's class, or undefined for a slot that is not racing: the pace
 * car, a spectator, an empty slot. Indexed by CarIdx.
 */
export const classIdsByCar = (
  drivers: readonly Driver[] | undefined
): (number | undefined)[] => {
  const classes: (number | undefined)[] = [];
  for (const driver of drivers ?? []) {
    if (!driver || driver.CarIsPaceCar || driver.IsSpectator) continue;
    classes[driver.CarIdx] = driver.CarClassID;
  }
  return classes;
};

/**
 * Each car's place in its class: the live one, worked out from where the
 * cars are on the road, where the snapshot has it, and the sim's own
 * otherwise. Outside a race there is no live order and the sim's stands.
 */
export const classPositionsByCar = (
  snapshot: Pick<StandingsSnapshot, 'liveClassPosition' | 'carIdxClassPosition'>
): (number | undefined)[] => {
  const length = Math.max(
    snapshot.liveClassPosition.length,
    snapshot.carIdxClassPosition.length
  );
  const positions: (number | undefined)[] = new Array(length);
  for (let carIdx = 0; carIdx < length; carIdx += 1) {
    positions[carIdx] =
      snapshot.liveClassPosition[carIdx] ??
      snapshot.carIdxClassPosition[carIdx];
  }
  return positions;
};

const isPlace = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * The focus car's neighbours in its class: the car one place ahead, the car
 * one place behind, and the class leader.
 *
 * One pass, no sort. A car with no place (0 or undefined) and a car with no
 * class (the pace car, a spectator) is never a neighbour. There is no filter
 * for a car in the pits or in its garage: while it holds the place it is the
 * car to beat.
 */
export const classNeighbours = (
  focusCarIdx: number,
  classIdByCar: readonly (number | undefined)[],
  classPositionByCar: readonly (number | undefined)[]
): ClassNeighbours => {
  const classId = classIdByCar[focusCarIdx];
  if (classId === undefined) return NO_NEIGHBOURS;
  const focusPlace = classPositionByCar[focusCarIdx];
  const found = { ...NO_NEIGHBOURS };
  for (let carIdx = 0; carIdx < classPositionByCar.length; carIdx += 1) {
    if (classIdByCar[carIdx] !== classId) continue;
    const place = classPositionByCar[carIdx];
    if (!isPlace(place)) continue;
    if (place === 1) found.leader = carIdx;
    if (!isPlace(focusPlace) || carIdx === focusCarIdx) continue;
    if (place === focusPlace - 1) found.ahead = carIdx;
    else if (place === focusPlace + 1) found.behind = carIdx;
  }
  return found;
};

/** What the gap rules read of `standings.snapshot`. */
export type RaceIntervalSnapshot = Pick<
  StandingsSnapshot,
  'carIdxF2Time' | 'carIdxBestLapTime' | 'carIdxLap' | 'carIdxLapDistPct'
>;

/**
 * A car's race progress, laps plus the fraction of the lap it is on, or null
 * for a car with no lap fraction: in its garage, or not in the world.
 */
export const raceProgress = (
  snapshot: Pick<StandingsSnapshot, 'carIdxLap' | 'carIdxLapDistPct'>,
  carIdx: number
): number | null => {
  const lap = snapshot.carIdxLap[carIdx];
  const fraction = snapshot.carIdxLapDistPct[carIdx];
  if (
    typeof lap !== 'number' ||
    typeof fraction !== 'number' ||
    !Number.isFinite(lap) ||
    !Number.isFinite(fraction) ||
    lap < 0 ||
    fraction < 0 ||
    fraction > 1
  ) {
    return null;
  }
  return lap + fraction;
};

export interface RaceInterval {
  /** Whole laps between the two by the shared lap rule; 0 within a lap. */
  laps: number;
  /** Seconds between the two, never negative; null where nothing says. */
  seconds: number | null;
}

const NO_INTERVAL: RaceInterval = { laps: 0, seconds: null };

const positive = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * The gap between two cars as the race counts it, the car listed ahead
 * first.
 *
 * In a race: whole laps once more than a lap separates them, and the
 * difference of their times behind the leader, which is the sim's own
 * interval and does not wrap round the track the short way. A car with no
 * lap fraction has no seconds: its time behind the leader stopped meaning
 * anything when it left the road.
 *
 * Outside a race there is no order on the road to measure: the gap is the
 * difference of the two best laps.
 *
 * Under Le Mans Ultimate the times behind the leader are worked out per
 * class, so this is exact between two cars of a class and approximate
 * across classes.
 */
export const raceInterval = (
  aheadIdx: number,
  behindIdx: number,
  snapshot: RaceIntervalSnapshot,
  isRace: boolean
): RaceInterval => {
  if (aheadIdx < 0 || behindIdx < 0) return NO_INTERVAL;
  if (!isRace) {
    const aheadBest = snapshot.carIdxBestLapTime[aheadIdx];
    const behindBest = snapshot.carIdxBestLapTime[behindIdx];
    return {
      laps: 0,
      seconds:
        positive(aheadBest) && positive(behindBest)
          ? Math.abs(behindBest - aheadBest)
          : null,
    };
  }
  const aheadProgress = raceProgress(snapshot, aheadIdx);
  const behindProgress = raceProgress(snapshot, behindIdx);
  if (aheadProgress === null || behindProgress === null) return NO_INTERVAL;
  const aheadTime = snapshot.carIdxF2Time[aheadIdx];
  const behindTime = snapshot.carIdxF2Time[behindIdx];
  return {
    laps: lapsApart(aheadProgress, behindProgress),
    seconds:
      Number.isFinite(aheadTime) &&
      Number.isFinite(behindTime) &&
      aheadTime >= 0 &&
      behindTime >= 0
        ? Math.abs(behindTime - aheadTime)
        : null,
  };
};

export type RivalGapSource = 'laps' | 'live' | 'interval' | 'none';

export interface RivalGap {
  /** What the cell prints: "2L", "1.23", "1:00"; empty when nothing says. */
  text: string;
  /** The seconds printed; null for a gap in laps and for no gap. */
  seconds: number | null;
  source: RivalGapSource;
}

/**
 * Which gap a rival's row shows.
 *
 * More than a lap apart: the laps, "2L". Within half a lap of each other on
 * the road, where the relative's reference-lap delta is the finer figure and
 * measures the same thing: that delta. In every other case the race
 * interval, because beyond half a lap the relative measures the short way
 * round and would show a rival 70 s ahead on a 90 s lap as 20 s.
 *
 * `progressDifference` is the car ahead's progress less the car behind's.
 */
export const chooseRivalGap = (
  interval: RaceInterval,
  progressDifference: number | null,
  liveDelta: number | null | undefined,
  decimalPlaces: number
): RivalGap => {
  if (interval.laps > 0) {
    return { text: `${interval.laps}L`, seconds: null, source: 'laps' };
  }
  if (
    progressDifference !== null &&
    progressDifference >= 0 &&
    progressDifference <= 0.5 &&
    typeof liveDelta === 'number' &&
    Number.isFinite(liveDelta)
  ) {
    const seconds = Math.abs(liveDelta);
    return {
      text: formatGap(seconds, decimalPlaces),
      seconds,
      source: 'live',
    };
  }
  if (interval.seconds === null) {
    return { text: '', seconds: null, source: 'none' };
  }
  return {
    text: formatGap(interval.seconds, decimalPlaces),
    seconds: interval.seconds,
    source: 'interval',
  };
};

/** Lap-to-lap changes a trend is averaged over, at most. */
export const TREND_LAPS = 3;
/** Lap-to-lap changes a forecast needs behind it. */
export const FORECAST_MIN_LAPS = 3;
/** Of those, the laps on which the gap has to have closed. */
export const FORECAST_MIN_CLOSING_LAPS = 2;
/** Seconds a lap below which a closing rate is noise, not pace. */
export const FORECAST_MIN_RATE = 0.05;
/** Laps beyond which a forecast says nothing a driver can use. */
export const FORECAST_MAX_LAPS = 50;

export interface LineGap {
  /** The lap both cars had just completed. */
  lap: number;
  /**
   * Seconds from the car ahead crossing the line to the car behind crossing
   * it at the end of the same lap. Negative when the order was the other way
   * round on that lap.
   */
  seconds: number;
}

/**
 * The gap over the line on the most recent laps both cars have completed,
 * oldest first: at most `maxSamples` of them, consecutive laps only, none
 * before `fromLap`.
 *
 * Paired by lap number, so it is the race gap and not the gap on the road:
 * two cars most of a lap apart read their real gap, not the short way round.
 */
export const lineGapSeries = (
  lapHistory: LapHistorySnapshot | undefined,
  aheadIdx: number,
  behindIdx: number,
  maxSamples = TREND_LAPS + 1,
  fromLap = Number.NEGATIVE_INFINITY
): LineGap[] => {
  if (!lapHistory) return [];
  const aheadCount = crossingCount(lapHistory, aheadIdx);
  const behindCount = crossingCount(lapHistory, behindIdx);
  if (aheadCount === 0 || behindCount === 0) return [];

  // Read off the tails of the two rings in place: this runs with every
  // snapshot the box is built from, and a long race holds 300 crossings a
  // car that a decoded copy would allocate each time.
  const series: LineGap[] = [];
  const furthestBack = Math.min(behindCount, maxSamples + SEARCH_DEPTH);
  let expectedLap: number | undefined;
  for (let back = 0; back < furthestBack; back += 1) {
    const slot = crossingSlot(lapHistory, behindIdx, behindCount, back);
    const lap = lapHistory.lap[slot];
    if (series.length >= maxSamples || lap < fromLap) break;
    // Newest first: each sample has to be the lap before the last one taken.
    // The first is whatever lap both cars have most recently completed.
    if (expectedLap !== undefined && lap !== expectedLap) {
      if (lap > expectedLap) continue;
      break;
    }
    const aheadTime = crossingTimeOfLap(lapHistory, aheadIdx, aheadCount, lap);
    if (aheadTime === undefined) {
      if (expectedLap === undefined) continue;
      break;
    }
    series.push({ lap, seconds: lapHistory.sessionTime[slot] - aheadTime });
    expectedLap = lap - 1;
  }
  return series.reverse();
};

/**
 * How far back a car's crossings are searched for one lap. Two cars within
 * a lap of each other are a crossing apart at most; the rest is room for a
 * lap recorded twice after a tow.
 */
const SEARCH_DEPTH = 12;

/** Crossings held for a car; 0 for a slot the buffers do not cover. */
const crossingCount = (history: LapHistorySnapshot, carIdx: number): number => {
  if (!Number.isInteger(carIdx) || carIdx < 0 || carIdx >= history.carCount) {
    return 0;
  }
  // A restored snapshot can carry a count from a build with a larger
  // capacity; past the capacity the ring would repeat itself.
  return Math.max(0, Math.min(history.count[carIdx] ?? 0, history.capacity));
};

/** The flat index of a car's crossing, `back` crossings before its latest. */
const crossingSlot = (
  history: LapHistorySnapshot,
  carIdx: number,
  count: number,
  back: number
): number =>
  carIdx * history.capacity +
  (((history.start[carIdx] ?? 0) + count - 1 - back) % history.capacity);

/** When a car completed a lap: its latest crossing with that lap number. */
const crossingTimeOfLap = (
  history: LapHistorySnapshot,
  carIdx: number,
  count: number,
  lap: number
): number | undefined => {
  const furthestBack = Math.min(count, SEARCH_DEPTH);
  for (let back = 0; back < furthestBack; back += 1) {
    const slot = crossingSlot(history, carIdx, count, back);
    if (history.lap[slot] === lap) return history.sessionTime[slot];
  }
  return undefined;
};

export interface GapTrend {
  /** Seconds the gap moved a lap, averaged; negative is closing. */
  perLap: number;
  /** Lap-to-lap changes the average is over: 1 to TREND_LAPS. */
  laps: number;
  /** Of those laps, the ones on which the gap closed. */
  closingLaps: number;
}

/**
 * How the gap has moved over the recent laps: the mean change from one line
 * crossing to the next. Null until two crossings give one change.
 */
export const gapTrend = (series: readonly LineGap[]): GapTrend | null => {
  const recent = series.slice(-(TREND_LAPS + 1));
  if (recent.length < 2) return null;
  let closingLaps = 0;
  for (let index = 1; index < recent.length; index += 1) {
    if (recent[index].seconds < recent[index - 1].seconds) closingLaps += 1;
  }
  const laps = recent.length - 1;
  return {
    perLap: (recent[laps].seconds - recent[0].seconds) / laps,
    laps,
    closingLaps,
  };
};

/**
 * Laps until the gap is gone at the rate it has been closing, or null where
 * no honest figure exists.
 *
 * Withheld, not guessed: until three lap-to-lap changes are behind it, when
 * the gap closed on fewer than two of them (one slow lap of a rival is not a
 * pace), when the rate is under five hundredths a lap, when the gap is not
 * closing at all, and when the answer is more than fifty laps away. What is
 * returned is whole laps and at least one, to be printed as "about".
 */
export const catchForecast = (
  gapSeconds: number | null,
  trend: GapTrend | null
): number | null => {
  if (gapSeconds === null || !(gapSeconds > 0) || !trend) return null;
  if (trend.laps < FORECAST_MIN_LAPS) return null;
  if (trend.closingLaps < FORECAST_MIN_CLOSING_LAPS) return null;
  if (!(trend.perLap <= -FORECAST_MIN_RATE)) return null;
  const laps = gapSeconds / -trend.perLap;
  if (!Number.isFinite(laps) || laps > FORECAST_MAX_LAPS) return null;
  return Math.max(1, Math.round(laps));
};

/**
 * Places gained (positive) or lost against the class grid, or undefined
 * where the car has no grid result or no place.
 */
export const classGridChange = (
  qualifyingResults: readonly SessionResults[] | undefined,
  carIdx: number,
  classPosition: number | undefined
): number | undefined => {
  if (!isPlace(classPosition)) return undefined;
  const result = qualifyingResults?.find((entry) => entry.CarIdx === carIdx);
  if (
    !result ||
    !Number.isInteger(result.ClassPosition) ||
    result.ClassPosition < 0
  ) {
    return undefined;
  }
  return result.ClassPosition + 1 - classPosition;
};

/**
 * Places gained (positive) or lost against the whole grid. The grid place is
 * the car's rank in the list by `Position`, so a list numbered from 0 and
 * one numbered from 1 give the same answer.
 */
export const overallGridChange = (
  qualifyingResults: readonly SessionResults[] | undefined,
  carIdx: number,
  position: number | undefined
): number | undefined => {
  if (!isPlace(position)) return undefined;
  const result = qualifyingResults?.find((entry) => entry.CarIdx === carIdx);
  if (!result || !Number.isFinite(result.Position)) return undefined;
  let gridPlace = 1;
  for (const entry of qualifyingResults ?? []) {
    if (entry.Position < result.Position) gridPlace += 1;
  }
  return gridPlace - position;
};

/** One car of the rivals box: the focus car, or a class neighbour. */
export interface RivalCar {
  carIdx: number;
  isFocus: boolean;
  classPosition: number | undefined;
  /** Against the class grid; undefined outside a race and with no grid. */
  positionChange: number | undefined;
  name: string;
  carNumber: string;
  carId: number | undefined;
  classColor: number | undefined;
  /** Seconds; 0 or less where the car has none. */
  lastTime: number;
  bestTime: number;
  lastTimeState: LastTimeState;
  /** The best lap is the best of the class. */
  bestIsClassBest: boolean;
  /** Undefined where the sim says nothing about other cars' laps. */
  lastLapInvalid: boolean | undefined;
  tireCompound: number;
  wheelCompounds: number[] | undefined;
  /** In the world at all: false for a car in iRacing's garage. */
  inWorld: boolean;
  offTrack: boolean;
  /** In the pit lane, moving or at its box. */
  inPitLane: boolean;
  inGarage: boolean;
  /** Out of the pits and still on the lap it left them on. */
  onOutLap: boolean;
  /** Seconds in the pit lane on this or the last visit; undefined before one. */
  pitLaneSeconds: number | undefined;
  /** The sim's count of stops; undefined where the sim keeps none. */
  pitStops: number | undefined;
  /** The car has asked for a stop: it will turn in this lap. */
  pitRequested: boolean;
  /** Laps since its last stop; undefined where that cannot be told. */
  stintLaps: number | undefined;
  /** Laps the stint can reach on what is left; undefined without a budget. */
  stintEstimate: number | undefined;
  /** 0..1; undefined where the sim publishes neither energy nor fuel. */
  energyRemaining: number | undefined;
  energyIsVirtual: boolean | undefined;
  /** Share of a full allocation used over the last lap, 0..1. */
  usedLastLap: number | undefined;
  lapsLeft: number | undefined;
  trackLimitsPoints: number | undefined;
  penaltyKind: LmuPenaltyKind | undefined;
  penaltySeconds: number | undefined;
  finishState: LmuFinishState | undefined;
}

/** A class neighbour: the car, and the fight with it. */
export interface Rival extends RivalCar {
  interval: RaceInterval;
  gap: RivalGap;
  /** The gap over the line on the last lap both completed; null before one. */
  previousLineGap: number | null;
  /** Null in laps apart, with a car in the pits, and before two crossings. */
  trend: GapTrend | null;
  /** About this many laps until the gap is gone; null where withheld. */
  forecastLaps: number | null;
}

export interface ClassRivals {
  focusCarIdx: number | undefined;
  isRace: boolean;
  ahead: Rival | undefined;
  focus: RivalCar | undefined;
  behind: Rival | undefined;
  /** What the running sim publishes, so a column of nothing is dropped. */
  available: {
    pitStops: boolean;
    energy: boolean;
    trackLimits: boolean;
  };
  /** Points at which a drive-through is served; 0 when unknown. */
  trackLimitsPointsMax: number;
}

/** What the rivals read of `standings.snapshot`. */
export type ClassRivalsSnapshot = Pick<
  StandingsSnapshot,
  | 'focusCarIdx'
  | 'carIdxF2Time'
  | 'carIdxClassPosition'
  | 'carIdxBestLapTime'
  | 'carIdxLastLapTime'
  | 'carIdxOnPitRoad'
  | 'carIdxLap'
  | 'carIdxLapDistPct'
  | 'carIdxTrackSurface'
  | 'carIdxTireCompound'
  | 'carIdxWheelCompounds'
  | 'carIdxTrackLimitsPoints'
  | 'carIdxEnergyRemaining'
  | 'carIdxEnergyIsVirtual'
  | 'carIdxPenalties'
  | 'carIdxPenaltyKind'
  | 'carIdxPenaltySeconds'
  | 'carIdxFinishStatus'
  | 'carIdxLastLapInvalid'
  | 'carIdxInGarage'
  | 'carIdxPitStops'
  | 'carIdxPitState'
  | 'lastPitLap'
  | 'penaltySeconds'
  | 'trackLimitsPointsMax'
  | 'liveClassPosition'
>;

export interface ClassRivalsInput {
  standings: ClassRivalsSnapshot | undefined;
  drivers: readonly Driver[] | undefined;
  isRace: boolean;
  /** The user's own car, which the pit estimate's penalty describes. */
  ownCarIdx?: number;
  qualifyingResults?: readonly SessionResults[];
  carPit?: CarPitSnapshot;
  lapHistory?: LapHistorySnapshot;
  relativeGaps?: RelativeGapsSnapshot;
  /** Decimal places of a gap in seconds. */
  decimalPlaces?: number;
}

const EMPTY_RIVALS: ClassRivals = {
  focusCarIdx: undefined,
  isRace: false,
  ahead: undefined,
  focus: undefined,
  behind: undefined,
  available: { pitStops: false, energy: false, trackLimits: false },
  trackLimitsPointsMax: 0,
};

const known = (value: number | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;

const wheelCompoundsOf = (
  flat: readonly number[],
  carIdx: number
): number[] | undefined => {
  const base = carIdx * 4;
  if (flat.length === 0 || base + 4 > flat.length) return undefined;
  return [flat[base], flat[base + 1], flat[base + 2], flat[base + 3]];
};

/** The fastest best lap among the cars of one class; 0 when none has one. */
const classBestLap = (
  snapshot: ClassRivalsSnapshot,
  classIdByCar: readonly (number | undefined)[],
  classId: number | undefined
): number => {
  let best = 0;
  if (classId === undefined) return best;
  for (let carIdx = 0; carIdx < classIdByCar.length; carIdx += 1) {
    if (classIdByCar[carIdx] !== classId) continue;
    const time = snapshot.carIdxBestLapTime[carIdx];
    if (positive(time) && (best === 0 || time < best)) best = time;
  }
  return best;
};

interface CarContext {
  input: ClassRivalsInput;
  standings: ClassRivalsSnapshot;
  driversByCar: ReadonlyMap<number, Driver>;
  classPositionByCar: readonly (number | undefined)[];
  classBest: number;
}

/**
 * Where a car is, as far as the pits go. The garage flag and the pit
 * tracker's garage both count; the lane is the tracker's, the sim's pit-road
 * flag, or a stop at the box, whichever has arrived.
 */
const pitPlace = (
  { input, standings }: CarContext,
  carIdx: number
): { inGarage: boolean; inPitLane: boolean } => {
  const where = input.carPit?.where[carIdx];
  const surface = standings.carIdxTrackSurface[carIdx];
  const inWorld =
    (surface ?? TrackLocation.NotInWorld) > TrackLocation.NotInWorld;
  const inGarage =
    standings.carIdxInGarage[carIdx] === true ||
    // The tracker's garage is "garage, or not in the world": only a car the
    // snapshot also has off the road is taken as parked.
    (where === CAR_PIT_IN_GARAGE && !inWorld);
  const inPitLane =
    !inGarage &&
    (where === CAR_PIT_IN_LANE ||
      standings.carIdxOnPitRoad[carIdx] === true ||
      surface === TrackLocation.InPitStall);
  return { inGarage, inPitLane };
};

const buildCar = (
  context: CarContext,
  carIdx: number,
  isFocus: boolean
): RivalCar => {
  const { input, standings, classBest } = context;
  const { carPit } = input;
  const driver = context.driversByCar.get(carIdx);
  const classPosition = context.classPositionByCar[carIdx];
  const lastTime = standings.carIdxLastLapTime[carIdx] ?? 0;
  const bestTime = standings.carIdxBestLapTime[carIdx] ?? 0;
  const bestIsClassBest = bestTime > 0 && bestTime === classBest;
  const surface = standings.carIdxTrackSurface[carIdx];
  const { inGarage, inPitLane } = pitPlace(context, carIdx);
  const inWorld =
    (surface ?? TrackLocation.NotInWorld) > TrackLocation.NotInWorld;
  // The lap the car was on when it was last in the pit lane: while it is
  // still on that lap and back on the road, it is on its out-lap.
  const lastPitLap = standings.lastPitLap[carIdx];
  const onOutLap =
    inWorld &&
    !inPitLane &&
    !inGarage &&
    positive(lastPitLap) &&
    lastPitLap === standings.carIdxLap[carIdx];
  const stintLaps = known(carPit?.stintLaps[carIdx]);
  const lapsLeft = known(carPit?.lapsLeft[carIdx]);
  const laneSeconds = carPit?.laneTimeS[carIdx];
  const hasEnergy = standings.carIdxEnergyRemaining.length > 0;

  return {
    carIdx,
    isFocus,
    classPosition: isPlace(classPosition) ? classPosition : undefined,
    positionChange: input.isRace
      ? classGridChange(input.qualifyingResults, carIdx, classPosition)
      : undefined,
    name: driver?.UserName ?? '',
    carNumber: driver?.CarNumber ?? '',
    carId: driver?.CarID,
    classColor: driver?.CarClassColor,
    lastTime,
    bestTime,
    lastTimeState:
      lastTime > 0 && lastTime === bestTime
        ? bestIsClassBest
          ? 'session-fastest'
          : 'personal-best'
        : undefined,
    bestIsClassBest,
    lastLapInvalid:
      standings.carIdxLastLapInvalid.length > 0
        ? standings.carIdxLastLapInvalid[carIdx] === true
        : undefined,
    tireCompound: standings.carIdxTireCompound[carIdx] ?? 0,
    wheelCompounds: wheelCompoundsOf(standings.carIdxWheelCompounds, carIdx),
    inWorld,
    offTrack: surface === TrackLocation.OffTrack,
    inPitLane,
    inGarage,
    onOutLap,
    pitLaneSeconds:
      (inPitLane || onOutLap) && positive(laneSeconds)
        ? laneSeconds
        : undefined,
    pitStops:
      standings.carIdxPitStops.length > 0
        ? known(standings.carIdxPitStops[carIdx])
        : undefined,
    pitRequested:
      standings.carIdxPitState[carIdx] === 1 ||
      carPit?.requested[carIdx] === true,
    stintLaps,
    stintEstimate:
      stintLaps !== undefined && lapsLeft !== undefined
        ? stintLaps + Math.floor(lapsLeft)
        : undefined,
    energyRemaining: hasEnergy
      ? known(standings.carIdxEnergyRemaining[carIdx])
      : undefined,
    energyIsVirtual: hasEnergy
      ? standings.carIdxEnergyIsVirtual[carIdx]
      : undefined,
    usedLastLap: known(carPit?.usedLastLap[carIdx]),
    lapsLeft,
    trackLimitsPoints: known(standings.carIdxTrackLimitsPoints[carIdx]),
    penaltyKind: lmuPenaltyBadge(
      standings.carIdxPenaltyKind[carIdx],
      carIdx === input.ownCarIdx,
      standings.carIdxPenalties[carIdx],
      standings.penaltySeconds
    ),
    penaltySeconds: standings.carIdxPenaltySeconds[carIdx],
    finishState: lmuFinishStateFromCode(standings.carIdxFinishStatus[carIdx]),
  };
};

/**
 * The first lap whose line gap is clear of a car's last trip through the
 * pits: the lap it was on when it left the lane. The gap at the end of that
 * lap has the whole stop in it, so every change after it is pace again.
 */
const firstCleanLap = (standings: ClassRivalsSnapshot, carIdx: number) => {
  const lastPitLap = standings.lastPitLap[carIdx];
  return positive(lastPitLap) ? lastPitLap : Number.NEGATIVE_INFINITY;
};

const buildRival = (
  context: CarContext,
  aheadIdx: number,
  behindIdx: number,
  rivalIdx: number
): Rival => {
  const { input, standings } = context;
  const car = buildCar(context, rivalIdx, false);
  const focusIdx = rivalIdx === aheadIdx ? behindIdx : aheadIdx;
  const focusPlace = pitPlace(context, focusIdx);
  const interval = raceInterval(aheadIdx, behindIdx, standings, input.isRace);
  const aheadProgress = raceProgress(standings, aheadIdx);
  const behindProgress = raceProgress(standings, behindIdx);
  const gap = chooseRivalGap(
    interval,
    input.isRace && aheadProgress !== null && behindProgress !== null
      ? aheadProgress - behindProgress
      : null,
    input.isRace ? input.relativeGaps?.deltas[rivalIdx] : null,
    input.decimalPlaces ?? 2
  );

  // The line gaps are a race's: outside one two cars lap when they please.
  const history =
    input.isRace && interval.laps === 0
      ? lineGapSeries(input.lapHistory, aheadIdx, behindIdx)
      : [];
  // A gap that is moving because one of the two is in the pits is not a
  // pace, and nothing is forecast from it.
  const inPits =
    car.inPitLane ||
    car.inGarage ||
    focusPlace.inPitLane ||
    focusPlace.inGarage;
  const cleanFrom = Math.max(
    firstCleanLap(standings, aheadIdx),
    firstCleanLap(standings, behindIdx)
  );
  const trend = inPits
    ? null
    : gapTrend(history.filter((sample) => sample.lap >= cleanFrom));

  return {
    ...car,
    interval,
    gap,
    previousLineGap: history.at(-1)?.seconds ?? null,
    trend,
    forecastLaps: catchForecast(gap.seconds, trend),
  };
};

/**
 * The three rows of the rivals box, built from one standings snapshot and
 * whatever else has arrived: the class car ahead, the focus car and the
 * class car behind. Only those three are built; the field is walked once to
 * find them.
 *
 * The focus car is the snapshot's: the car being driven, or the car being
 * watched.
 */
export const buildClassRivals = (input: ClassRivalsInput): ClassRivals => {
  const { standings, drivers } = input;
  const focusCarIdx = standings?.focusCarIdx ?? undefined;
  if (!standings || focusCarIdx === undefined || focusCarIdx < 0) {
    return { ...EMPTY_RIVALS, isRace: input.isRace };
  }

  const classIdByCar = classIdsByCar(drivers);
  const classPositionByCar = classPositionsByCar(standings);
  const neighbours = classNeighbours(
    focusCarIdx,
    classIdByCar,
    classPositionByCar
  );
  const driversByCar = new Map<number, Driver>();
  for (const driver of drivers ?? []) {
    if (driver) driversByCar.set(driver.CarIdx, driver);
  }
  const context: CarContext = {
    input,
    standings,
    driversByCar,
    classPositionByCar,
    classBest: classBestLap(standings, classIdByCar, classIdByCar[focusCarIdx]),
  };

  return {
    focusCarIdx,
    isRace: input.isRace,
    ahead:
      neighbours.ahead >= 0
        ? buildRival(context, neighbours.ahead, focusCarIdx, neighbours.ahead)
        : undefined,
    focus: driversByCar.has(focusCarIdx)
      ? buildCar(context, focusCarIdx, true)
      : undefined,
    behind:
      neighbours.behind >= 0
        ? buildRival(context, focusCarIdx, neighbours.behind, neighbours.behind)
        : undefined,
    available: {
      pitStops: standings.carIdxPitStops.length > 0,
      energy: standings.carIdxEnergyRemaining.length > 0,
      trackLimits: standings.carIdxTrackLimitsPoints.length > 0,
    },
    trackLimitsPointsMax: standings.trackLimitsPointsMax,
  };
};
