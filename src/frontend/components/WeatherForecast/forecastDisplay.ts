import { formatTrackClock } from '@irdashies/domain/trackClock/trackClock';
import { speedFromMs } from '@irdashies/utils/units';

/** Drawn where a reading is missing, so a column keeps its shape. */
export const NO_READING = '--';

/**
 * Put in front of a time that is an estimate, as elsewhere in the app. Le
 * Mans Ultimate publishes no times for its forecast: when a point starts is
 * worked out from where the points sit in the session, which has been
 * measured on one recording of one dry race and is assumed for the rest.
 */
export const ESTIMATE_MARK = '~';

/**
 * The time until a forecast point starts: "<1m" under a minute, whole
 * minutes below an hour ("12m"), hours to one decimal from there ("1.4h").
 */
export const formatForecastCountdown = (
  minutes: number | null | undefined
): string => {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0) {
    return NO_READING;
  }
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${Math.floor(minutes)}m`;
  return `${(minutes / 60).toFixed(1)}h`;
};

/**
 * The heading of a forecast column: how long until its point starts, or the
 * in-game clock time it starts at, marked as an estimate. "<1m" is left as it is,
 * since it already says it is not exact, and so is a missing time.
 */
export const forecastTimeLabel = (
  mode: 'countdown' | 'clock',
  startsInMinutes: number | null | undefined,
  startsAtTimeOfDay: number | null | undefined
): string => {
  if (mode === 'clock') {
    const clock = formatTrackClock(startsAtTimeOfDay, '24h');
    return clock ? `${ESTIMATE_MARK}${clock}` : NO_READING;
  }
  const countdown = formatForecastCountdown(startsInMinutes);
  return countdown === NO_READING || countdown.startsWith('<')
    ? countdown
    : `${ESTIMATE_MARK}${countdown}`;
};

/** "17°" in the unit asked for; no unit letter, to keep a column narrow. */
export const formatForecastTemperature = (
  celsius: number | null | undefined,
  metric: boolean
): string => {
  if (typeof celsius !== 'number' || !Number.isFinite(celsius)) {
    return NO_READING;
  }
  return `${Math.round(metric ? celsius : (celsius * 9) / 5 + 32)}°`;
};

/** A 0..1 share as a whole percentage, or the placeholder. */
export const formatForecastPercent = (
  fraction: number | null | undefined
): string =>
  typeof fraction === 'number' && Number.isFinite(fraction)
    ? `${Math.round(Math.min(Math.max(fraction, 0), 1) * 100)}%`
    : NO_READING;

/** A wind speed in km/h or mph, whole, without the unit. */
export const formatForecastWind = (
  metresPerSecond: number | null | undefined,
  metric: boolean
): string =>
  typeof metresPerSecond === 'number' && Number.isFinite(metresPerSecond)
    ? String(Math.round(speedFromMs(metresPerSecond, metric ? 'km/h' : 'mph')))
    : NO_READING;

/** How wide to draw a rain bar, as a CSS percentage. */
export const rainBarWidth = (fraction: number | null | undefined): string =>
  typeof fraction === 'number' && Number.isFinite(fraction)
    ? `${Math.round(Math.min(Math.max(fraction, 0), 1) * 100)}%`
    : '0%';

export type SkyGlyph =
  'sun' | 'cloudSun' | 'cloud' | 'cloudRain' | 'cloudLightning' | 'unknown';

export interface SkyAppearance {
  glyph: SkyGlyph;
  /** Thin outline for a lighter sky, the regular stroke for a heavier one. */
  weight: 'light' | 'regular';
  /** Tailwind text colour. */
  className: string;
  /** What the sim calls it, for a tooltip and for screen readers. */
  label: string;
}

const SKY_APPEARANCE: readonly SkyAppearance[] = [
  {
    glyph: 'sun',
    weight: 'regular',
    className: 'text-amber-300',
    label: 'Clear',
  },
  {
    glyph: 'cloudSun',
    weight: 'light',
    className: 'text-amber-200',
    label: 'Light clouds',
  },
  {
    glyph: 'cloudSun',
    weight: 'regular',
    className: 'text-slate-200',
    label: 'Partially cloudy',
  },
  {
    glyph: 'cloud',
    weight: 'light',
    className: 'text-slate-200',
    label: 'Mostly cloudy',
  },
  {
    glyph: 'cloud',
    weight: 'regular',
    className: 'text-slate-400',
    label: 'Overcast',
  },
  {
    glyph: 'cloudRain',
    weight: 'light',
    className: 'text-sky-300',
    label: 'Drizzle',
  },
  {
    glyph: 'cloudRain',
    weight: 'light',
    className: 'text-sky-300',
    label: 'Light rain',
  },
  {
    glyph: 'cloudRain',
    weight: 'regular',
    className: 'text-sky-400',
    label: 'Overcast and light rain',
  },
  {
    glyph: 'cloudRain',
    weight: 'regular',
    className: 'text-sky-400',
    label: 'Rain',
  },
  {
    glyph: 'cloudRain',
    weight: 'regular',
    className: 'text-sky-500',
    label: 'Heavy rain',
  },
  {
    glyph: 'cloudLightning',
    weight: 'regular',
    className: 'text-red-400',
    label: 'Storm',
  },
];

const SKY_UNKNOWN: SkyAppearance = {
  glyph: 'unknown',
  weight: 'light',
  className: 'text-white/40',
  label: 'Unknown',
};

/** The first sky type that is rain: drizzle. */
export const FIRST_WET_SKY = 5;

/** How one of LMU's eleven sky types is drawn; anything else is unknown. */
export const skyAppearance = (
  skyType: number | null | undefined
): SkyAppearance =>
  (typeof skyType === 'number' && Number.isInteger(skyType)
    ? SKY_APPEARANCE[skyType]
    : undefined) ?? SKY_UNKNOWN;

/** Whether a sky type is one of the wet ones, which a column is ringed for. */
export const isWetSky = (skyType: number | null | undefined): boolean =>
  typeof skyType === 'number' && skyType >= FIRST_WET_SKY && skyType <= 10;
