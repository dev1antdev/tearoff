import type { TyresConfig, TyreWheelState } from '@irdashies/types';

/**
 * Pure display logic for the tyre widget: unit conversion, which reading to
 * draw, and what colour it is. Kept apart from the component so each rule can
 * be tested without rendering anything.
 */

const KPA_PER_PSI = 6.894757;
const KPA_PER_BAR = 100;

export const PRESSURE_UNIT_LABELS: Record<TyresConfig['pressureUnit'], string> =
  {
    psi: 'PSI',
    kpa: 'kPa',
    bar: 'bar',
  };

/** Decimals worth showing in each unit: all three land near 0.1 psi. */
const PRESSURE_DECIMALS: Record<TyresConfig['pressureUnit'], number> = {
  psi: 1,
  kpa: 0,
  bar: 2,
};

export const TEMPERATURE_UNIT_LABELS: Record<
  TyresConfig['temperatureUnit'],
  string
> = {
  celsius: '°C',
  fahrenheit: '°F',
};

/** Shown where the sim has given no reading. */
export const NO_READING = '--';

export const pressureFromKpa = (
  kpa: number,
  unit: TyresConfig['pressureUnit']
): number => {
  if (unit === 'psi') return kpa / KPA_PER_PSI;
  if (unit === 'bar') return kpa / KPA_PER_BAR;
  return kpa;
};

export const pressureToKpa = (
  value: number,
  unit: TyresConfig['pressureUnit']
): number => {
  if (unit === 'psi') return value * KPA_PER_PSI;
  if (unit === 'bar') return value * KPA_PER_BAR;
  return value;
};

export const formatPressure = (
  kpa: number | null | undefined,
  unit: TyresConfig['pressureUnit']
): string =>
  typeof kpa === 'number'
    ? pressureFromKpa(kpa, unit).toFixed(PRESSURE_DECIMALS[unit])
    : NO_READING;

export const temperatureFromCelsius = (
  celsius: number,
  unit: TyresConfig['temperatureUnit']
): number => (unit === 'fahrenheit' ? (celsius * 9) / 5 + 32 : celsius);

export const formatTemperature = (
  celsius: number | null | undefined,
  unit: TyresConfig['temperatureUnit']
): string =>
  typeof celsius === 'number'
    ? temperatureFromCelsius(celsius, unit).toFixed(0)
    : NO_READING;

/**
 * The three readings across the tyre for the chosen layer, outer shoulder
 * first, or null when the sim has not given them.
 *
 * The carcass is one reading for the whole tyre, so it fills all three.
 */
export const tyreZones = (
  wheel: TyreWheelState | undefined,
  source: TyresConfig['temperatureSource']
): readonly number[] | null => {
  if (!wheel) return null;
  if (source === 'carcass') {
    const carcass = wheel.carcassTempC;
    return carcass === null ? null : [carcass, carcass, carcass];
  }
  return source === 'innerLayer' ? wheel.innerLayerTempC : wheel.surfaceTempC;
};

export const mean = (values: readonly number[] | null): number | null =>
  values && values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;

export interface TemperatureWindow {
  min: number;
  max: number;
}

/**
 * The tyre's working window for one wheel.
 *
 * Centred on the working temperature the sim states for the fitted compound
 * when asked to follow it, and the configured window otherwise -- including
 * for a car whose compound states none.
 */
export const tyreWindow = (
  config: TyresConfig['tyreWindow'],
  optimalTempC: number | null | undefined
): TemperatureWindow => {
  if (config.followCompound && typeof optimalTempC === 'number') {
    return {
      min: optimalTempC - config.range,
      max: optimalTempC + config.range,
    };
  }
  return orderedWindow(config);
};

/** A window the right way round, whatever order the settings were typed in. */
export const orderedWindow = ({
  min,
  max,
}: TemperatureWindow): TemperatureWindow =>
  min <= max ? { min, max } : { min: max, max: min };

type Rgb = readonly [number, number, number];

const BLUE: Rgb = [59, 130, 246];
const CYAN: Rgb = [34, 211, 238];
const GREEN: Rgb = [34, 197, 94];
const YELLOW: Rgb = [250, 204, 21];
const ORANGE: Rgb = [249, 115, 22];
const RED: Rgb = [239, 68, 68];

/** Drawn for a reading that is not there. */
export const NO_READING_COLOR = 'rgb(71 85 105)';

/**
 * Colour stops as multiples of the fade distance either side of the window.
 * Zero is "inside the window", on both sides.
 */
const COLD_STOPS: readonly (readonly [number, Rgb])[] = [
  [0, GREEN],
  [0.4, CYAN],
  [1, BLUE],
];
const HOT_STOPS: readonly (readonly [number, Rgb])[] = [
  [0, GREEN],
  [0.33, YELLOW],
  [0.66, ORANGE],
  [1, RED],
];

const mix = (from: Rgb, to: Rgb, amount: number): string => {
  const channel = (index: 0 | 1 | 2) =>
    Math.round(from[index] + (to[index] - from[index]) * amount);
  return `rgb(${channel(0)} ${channel(1)} ${channel(2)})`;
};

const along = (
  stops: readonly (readonly [number, Rgb])[],
  position: number
): string => {
  const clamped = Math.min(Math.max(position, 0), 1);
  for (let index = 1; index < stops.length; index += 1) {
    const [end, endColor] = stops[index];
    const [start, startColor] = stops[index - 1];
    if (clamped <= end) {
      return mix(startColor, endColor, (clamped - start) / (end - start));
    }
  }
  const [, last] = stops[stops.length - 1];
  return mix(last, last, 0);
};

/** How far outside the window a tyre is fully blue or fully red. */
export const TYRE_FADE_C = 30;
/** The same for a brake disc, which works over a far wider range. */
export const BRAKE_FADE_C = 200;

/**
 * The colour of a temperature against its working window: green inside,
 * fading through cyan to blue below it and through yellow and orange to red
 * above it, over `fade` degrees.
 */
export const temperatureColor = (
  celsius: number | null | undefined,
  window: TemperatureWindow,
  fade: number
): string => {
  if (typeof celsius !== 'number') return NO_READING_COLOR;
  const { min, max } = orderedWindow(window);
  if (celsius < min) return along(COLD_STOPS, (min - celsius) / fade);
  if (celsius > max) return along(HOT_STOPS, (celsius - max) / fade);
  return along(HOT_STOPS, 0);
};

export type PressureTone = 'low' | 'onTarget' | 'high' | 'plain';

/** Where a pressure sits against its target; plain when there is no target. */
export const pressureTone = (
  kpa: number | null | undefined,
  target: number,
  tolerance: number,
  enabled: boolean
): PressureTone => {
  if (!enabled || typeof kpa !== 'number') return 'plain';
  if (kpa < target - tolerance) return 'low';
  if (kpa > target + tolerance) return 'high';
  return 'onTarget';
};

/** Tread left as a whole percentage, or the placeholder. */
export const formatTread = (remaining: number | null | undefined): string =>
  typeof remaining === 'number'
    ? `${Math.round(remaining * 100)}%`
    : NO_READING;
