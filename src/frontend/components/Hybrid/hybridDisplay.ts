import type { HybridConfig, HybridSnapshot } from '@irdashies/types';

/** Shown in place of a figure the sim has not provided. */
export const NO_READING = '--';

const FAHRENHEIT_PER_CELSIUS = 9 / 5;
const FAHRENHEIT_OFFSET = 32;

/** Horsepower and metric horsepower per kilowatt. */
const POWER_PER_KW: Record<HybridConfig['powerUnit'], number> = {
  kW: 1,
  hp: 1.341,
  ps: 1.3596,
};

/** A whole number as text; a small negative reads "0", not "-0". */
const whole = (value: number): string => String(Math.round(value));

/** Within this many degrees below a threshold a temperature is a caution. */
const TEMPERATURE_CAUTION_C = 10;

/** Where the charge sits against the two thresholds. */
export type ChargeBand = 'low' | 'normal' | 'high';

/**
 * Low at or below the low threshold, high at or above the high one. A full
 * battery is a caution rather than a best: there is nowhere for the next
 * braking zone's energy to go.
 */
export const chargeBand = (
  chargePct: number | null,
  lowPct: number,
  highPct: number
): ChargeBand => {
  if (chargePct === null) return 'normal';
  if (chargePct <= lowPct) return 'low';
  if (chargePct >= highPct) return 'high';
  return 'normal';
};

/** The colour of the charge figure while its band is lit. */
export const CHARGE_TEXT_CLASS: Record<ChargeBand, string> = {
  low: 'text-red-400',
  normal: 'text-white',
  high: 'text-amber-400',
};

/** The fill of the charge bar. */
export const CHARGE_BAR_CLASS: Record<ChargeBand, string> = {
  low: 'bg-red-500',
  // A charge in range is the normal state, so it is neutral.
  normal: 'bg-slate-300',
  high: 'bg-amber-400',
};

/** Decimals as saved, kept inside what the widget has room for. */
export const clampDecimals = (decimals: number | undefined): number =>
  typeof decimals === 'number' && Number.isFinite(decimals)
    ? Math.min(2, Math.max(0, Math.round(decimals)))
    : 1;

export const formatCharge = (
  chargePct: number | null,
  decimals: number
): string =>
  chargePct === null ? NO_READING : chargePct.toFixed(clampDecimals(decimals));

/**
 * A figure with its sign, and without one where it rounds to nothing:
 * "+10.9", "-12.4", "0.0".
 */
export const formatSigned = (
  value: number | null,
  decimals: number
): string => {
  if (value === null) return NO_READING;
  const text = Math.abs(value).toFixed(clampDecimals(decimals));
  if (Number(text) === 0) return text;
  return `${value > 0 ? '+' : '-'}${text}`;
};

export interface LapUse {
  /** True while last lap's totals stand in for this lap's. */
  frozen: boolean;
  /** Percentage points used and recovered, both positive. */
  used: number;
  regen: number;
}

/**
 * What the Used and Regen cells show: last lap's totals for the first
 * seconds after the line, so that they can be read on the straight, then
 * this lap's as they build. Before a lap has been completed there are no
 * totals to hold, and the running figures show from the start.
 */
export const lapUse = (
  snapshot: Pick<
    HybridSnapshot,
    | 'drainLapPct'
    | 'regenLapPct'
    | 'drainLastLapPct'
    | 'regenLastLapPct'
    | 'lapElapsedS'
  >,
  freezeSeconds: number
): LapUse =>
  snapshot.drainLastLapPct !== null &&
  snapshot.regenLastLapPct !== null &&
  snapshot.lapElapsedS < freezeSeconds
    ? {
        frozen: true,
        used: snapshot.drainLastLapPct,
        regen: snapshot.regenLastLapPct,
      }
    : {
        frozen: false,
        used: snapshot.drainLapPct,
        regen: snapshot.regenLapPct,
      };

/** Green for a lap that ends with more charge than it began, amber for less. */
export const netToneClass = (net: number | null): string => {
  if (net === null) return 'text-slate-500';
  return net >= 0 ? 'text-emerald-300' : 'text-amber-400';
};

/** Seconds to a tenth, without the unit. */
export const formatSeconds = (seconds: number | null): string =>
  seconds === null ? NO_READING : seconds.toFixed(1);

/** A temperature in whole degrees of the chosen unit, without the sign. */
export const formatTemperature = (
  celsius: number | null,
  unit: HybridConfig['temperatureUnit']
): string => {
  if (celsius === null) return NO_READING;
  const value =
    unit === 'fahrenheit'
      ? celsius * FAHRENHEIT_PER_CELSIUS + FAHRENHEIT_OFFSET
      : celsius;
  return whole(value);
};

/**
 * Red at or above the threshold, amber within ten degrees below it. Judged
 * in Celsius whatever unit is drawn.
 */
export const temperatureToneClass = (
  celsius: number | null,
  warnC: number
): string => {
  if (celsius === null) return 'text-slate-500';
  if (celsius >= warnC) return 'text-red-400';
  if (celsius >= warnC - TEMPERATURE_CAUTION_C) return 'text-amber-400';
  return 'text-white';
};

/** Kilowatts in the chosen unit, whole. */
export const formatPower = (
  kilowatts: number | null,
  unit: HybridConfig['powerUnit']
): string =>
  kilowatts === null ? NO_READING : whole(kilowatts * POWER_PER_KW[unit]);

/** The same with its sign, for a reading that runs both ways. */
export const formatSignedPower = (
  kilowatts: number | null,
  unit: HybridConfig['powerUnit']
): string =>
  kilowatts === null
    ? NO_READING
    : formatSigned(kilowatts * POWER_PER_KW[unit], 0);

export const formatWhole = (value: number | null): string =>
  value === null ? NO_READING : whole(value);
