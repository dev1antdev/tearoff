import type {
  TrackClockFormat,
  TrackClockTimeScaleDisplay,
} from '@irdashies/types';

const SECONDS_PER_DAY = 86_400;
const MINUTES_PER_DAY = 1_440;

const isReading = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/**
 * The in-game clock as text, to the minute: "15:12" on the 24-hour clock,
 * "3:12 PM" on the 12-hour one, and for 'locale' whichever the system uses.
 * Empty without a reading.
 */
export const formatTrackClock = (
  secondsSinceMidnight: number | null | undefined,
  format: TrackClockFormat = 'locale'
): string => {
  if (!isReading(secondsSinceMidnight)) return '';
  const minuteOfDay =
    Math.floor((secondsSinceMidnight % SECONDS_PER_DAY) / 60) % MINUTES_PER_DAY;
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = String(minuteOfDay % 60).padStart(2, '0');

  if (format === '24h') return `${String(hours).padStart(2, '0')}:${minutes}`;
  if (format === '12h') {
    return `${hours % 12 === 0 ? 12 : hours % 12}:${minutes} ${
      hours < 12 ? 'AM' : 'PM'
    }`;
  }
  const date = new Date();
  date.setHours(hours, minuteOfDay % 60, 0, 0);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

export interface TimeScaleLabel {
  /** "x2", "x1", or "x0" for a time of day that stands still. */
  text: string;
  /** The day does not run in real time, which is worth the eye. */
  scaled: boolean;
}

/**
 * What to write beside the clock for the in-game day's speed, or null when
 * nothing belongs there: the setting is off, the scale has not been measured
 * yet, or it is real time and only a scaled day is asked for.
 */
export const timeScaleLabel = (
  timeScale: number | null | undefined,
  display: TrackClockTimeScaleDisplay = 'whenScaled'
): TimeScaleLabel | null => {
  if (display === 'never' || !isReading(timeScale)) return null;
  const scaled = timeScale !== 1;
  if (display === 'whenScaled' && !scaled) return null;
  return { text: `x${timeScale}`, scaled };
};

export type SunPhase = 'sunrise' | 'midday' | 'sunset' | 'midnight';

export interface SunPhaseTimes {
  /** Seconds since midnight. */
  sunrise: number;
  midday: number;
  sunset: number;
  midnight: number;
}

/**
 * The four moments of the day from a sunrise and a sunset, both in minutes
 * since midnight: midday is halfway round the clock from sunrise to sunset,
 * midnight halfway from sunset to the next sunrise.
 */
export const sunPhaseTimes = (
  sunriseMinutes: number,
  sunsetMinutes: number
): SunPhaseTimes => {
  const sunrise = (sunriseMinutes % MINUTES_PER_DAY) * 60;
  const sunset = (sunsetMinutes % MINUTES_PER_DAY) * 60;
  const day = (sunset - sunrise + SECONDS_PER_DAY) % SECONDS_PER_DAY;
  const night = SECONDS_PER_DAY - day;
  return {
    sunrise,
    midday: (sunrise + day / 2) % SECONDS_PER_DAY,
    sunset,
    midnight: (sunset + night / 2) % SECONDS_PER_DAY,
  };
};

export interface SunPhaseCountdown {
  phase: SunPhase;
  /** Seconds until it: of real time, or of in-game time when asked for. */
  seconds: number;
}

export interface SunPhaseCountdownInput {
  /** The in-game clock, seconds since midnight. */
  timeOfDay: number | null | undefined;
  /** In-game seconds per real second. */
  timeScale: number | null | undefined;
  /** Minutes since midnight, from the track's stored times. */
  sunriseMinutes: number | null | undefined;
  sunsetMinutes: number | null | undefined;
  /** Count in in-game time instead of real time. */
  inGameTime?: boolean;
}

const PHASE_ORDER: readonly SunPhase[] = [
  'sunrise',
  'midday',
  'sunset',
  'midnight',
];

/**
 * The next of sunrise, midday, sunset and midnight, and how long until it.
 *
 * Null without a clock or without both of the track's times: there are no
 * defaults, since a guessed sunrise is wrong for most tracks and dates. Also
 * null for a real-time countdown while the scale is unknown or the day stands
 * still, when the moment is not on its way.
 */
export const nextSunPhase = ({
  timeOfDay,
  timeScale,
  sunriseMinutes,
  sunsetMinutes,
  inGameTime = false,
}: SunPhaseCountdownInput): SunPhaseCountdown | null => {
  if (
    !isReading(timeOfDay) ||
    !isReading(sunriseMinutes) ||
    !isReading(sunsetMinutes)
  ) {
    return null;
  }
  if (!inGameTime && !(isReading(timeScale) && timeScale > 0)) return null;

  const clock = timeOfDay % SECONDS_PER_DAY;
  const times = sunPhaseTimes(sunriseMinutes, sunsetMinutes);
  let next: SunPhaseCountdown | null = null;
  for (const phase of PHASE_ORDER) {
    // The first one later than the clock, tomorrow's included.
    const ahead =
      (times[phase] - clock + SECONDS_PER_DAY) % SECONDS_PER_DAY ||
      SECONDS_PER_DAY;
    if (next === null || ahead < next.seconds) next = { phase, seconds: ahead };
  }
  if (next === null) return null;
  return inGameTime || !isReading(timeScale)
    ? next
    : { phase: next.phase, seconds: next.seconds / timeScale };
};

/** A countdown as "4:47:40": hours unpadded, whole seconds. */
export const formatSunCountdown = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = String(Math.floor((whole % 3600) / 60)).padStart(2, '0');
  const rest = String(whole % 60).padStart(2, '0');
  return `${hours}:${minutes}:${rest}`;
};

/**
 * A track's sunrise or sunset, minutes since midnight, as the "06:12" a time
 * field holds; empty for one that is not set.
 */
export const sunTimeFieldValue = (
  minutes: number | null | undefined
): string => {
  if (
    typeof minutes !== 'number' ||
    !Number.isInteger(minutes) ||
    minutes < 0 ||
    minutes >= MINUTES_PER_DAY
  ) {
    return '';
  }
  const hours = String(Math.floor(minutes / 60)).padStart(2, '0');
  return `${hours}:${String(minutes % 60).padStart(2, '0')}`;
};

/**
 * What a time field holds as minutes since midnight; null for an empty one,
 * one still being typed, or anything that is not a time of day.
 */
export const sunTimeFieldMinutes = (value: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
};
