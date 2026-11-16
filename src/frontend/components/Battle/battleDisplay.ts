import { formatGap } from '@irdashies/utils/time';
import type { GapTrend, Rival, RivalCar } from '@irdashies/domain';

/** What a cell prints when there is nothing to say. */
export const DASH = '—';

/** Which rival a row is: the class car ahead, or the one behind. */
export type RivalSide = 'ahead' | 'behind';

export type Tone = 'good' | 'bad' | 'flat' | 'none';

/** Below this a lap, a gap is holding: half a hundredth, as it rounds. */
const FLAT_SECONDS = 0.005;

/**
 * "7", or "7/24" where the car's remaining budget says how far the stint
 * can go: the laps since its last stop, and the lap it can reach.
 */
export const stintText = (car: RivalCar, showEstimate: boolean): string => {
  if (car.stintLaps === undefined) return DASH;
  if (
    showEstimate &&
    car.stintEstimate !== undefined &&
    car.stintEstimate >= car.stintLaps
  ) {
    return `${car.stintLaps}/${car.stintEstimate}`;
  }
  return `${car.stintLaps}`;
};

/** The stops a car has made; a dash at none, and where the sim keeps none. */
export const pitStopsText = (car: RivalCar): string =>
  car.pitStops !== undefined && car.pitStops > 0 ? `${car.pitStops}` : DASH;

/** Seconds in the pit lane: "12.3", and "1:05" from a minute. */
export const pitTimeText = (car: RivalCar): string | undefined =>
  car.pitLaneSeconds === undefined
    ? undefined
    : formatGap(car.pitLaneSeconds, 1);

/** The last lap's usage as a percentage of a full allocation: "2.3". */
export const energyUseText = (car: RivalCar): string =>
  car.usedLastLap === undefined ? DASH : (car.usedLastLap * 100).toFixed(1);

export interface TrendDisplay {
  /** Seconds a lap, unsigned: "0.31"; a dash when holding; empty for none. */
  text: string;
  /** Which way the gap is going: closing, opening, or neither. */
  direction: 'closing' | 'opening' | 'flat' | 'none';
  tone: Tone;
}

/**
 * How the gap to a rival has moved a lap over the recent laps.
 *
 * The same movement means opposite things on the two rows: a gap that is
 * closing is good against the car ahead and bad against the car behind.
 */
export const trendDisplay = (
  trend: GapTrend | null,
  side: RivalSide,
  decimalPlaces: number
): TrendDisplay => {
  if (!trend) return { text: '', direction: 'none', tone: 'none' };
  if (Math.abs(trend.perLap) < FLAT_SECONDS) {
    return { text: DASH, direction: 'flat', tone: 'flat' };
  }
  const closing = trend.perLap < 0;
  return {
    text: Math.abs(trend.perLap).toFixed(decimalPlaces),
    direction: closing ? 'closing' : 'opening',
    tone: closing === (side === 'ahead') ? 'good' : 'bad',
  };
};

export interface ForecastDisplay {
  /** "~6L": about six laps. A dash where no honest figure exists. */
  text: string;
  /** The same in words, for the cell's title. */
  title: string;
  tone: Tone;
}

/**
 * When the gap will be gone, said as "about": catching the car ahead is
 * good, being caught by the car behind is bad. Never a figure where the
 * rule that makes it withholds one.
 */
export const forecastDisplay = (
  rival: Rival,
  side: RivalSide
): ForecastDisplay => {
  const laps = rival.forecastLaps;
  if (laps === null) {
    return { text: DASH, title: 'No forecast', tone: 'none' };
  }
  const lapWord = laps === 1 ? 'lap' : 'laps';
  return {
    text: `~${laps}L`,
    title:
      side === 'ahead'
        ? `Catching in about ${laps} ${lapWord}`
        : `Caught in about ${laps} ${lapWord}`,
    tone: side === 'ahead' ? 'good' : 'bad',
  };
};

export const toneClass = (tone: Tone): string => {
  if (tone === 'good') return 'text-green-400';
  if (tone === 'bad') return 'text-red-400';
  if (tone === 'flat') return 'text-slate-400';
  return 'text-white/30';
};
