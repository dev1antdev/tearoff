import type { FlagDetail, FlagKind } from '@irdashies/types';
import { flagTitle } from '@irdashies/domain/flags';

/** What the header prints where a figure has no source. */
export const NO_VALUE = '--';

const isCount = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * Time left on the session clock: `3:26:56`, and `26:56` inside the last
 * hour. A clock that has not started, has run out past zero or is not a
 * number has nothing to show.
 */
export const formatTimeLeft = (seconds: number | null | undefined): string => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    return NO_VALUE;
  }
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}`
    : `${minutes}:${rest}`;
};

/** "RACE" as the sim writes it reads better as "Race". */
const sentenceCase = (text: string): string =>
  text === text.toUpperCase()
    ? text.charAt(0) + text.slice(1).toLowerCase()
    : text;

export interface SessionLabelInput {
  sessionName?: string;
  sessionType?: string;
  trackName?: string;
}

/**
 * The line over the clock: the session's name, its type when the name does
 * not already say it, and the track. Empty when the sim has named none.
 */
export const sessionLabel = ({
  sessionName,
  sessionType,
  trackName,
}: SessionLabelInput): string => {
  const name = sessionName?.trim() ?? '';
  const type = sessionType?.trim() ?? '';
  const session =
    name && type && !name.toLowerCase().includes(type.toLowerCase())
      ? `${sentenceCase(name)}, ${type}`
      : sentenceCase(name || type);
  return [session, trackName?.trim()].filter(Boolean).join(' · ');
};

export interface CarPlaceInput {
  /** The sim ranks the car. */
  classified: boolean;
  classPosition: number;
  classSize: number;
  overallPosition: number;
  className?: string;
}

export interface CarPlace {
  /** "P4", or the placeholder while the car has no place in its class. */
  position: string;
  /** "of 14 in LMGT3"; empty while there is no class to count. */
  field: string;
  /** "P12 overall"; empty while the sim has not ranked the car. */
  overall: string;
}

/** Our car's place in its class and overall, as the header's two lines. */
export const carPlace = ({
  classified,
  classPosition,
  classSize,
  overallPosition,
  className,
}: CarPlaceInput): CarPlace => {
  const ranked = classified && isCount(classPosition);
  const name = className?.trim();
  return {
    position: ranked ? `P${classPosition}` : NO_VALUE,
    field:
      ranked && isCount(classSize)
        ? `of ${classSize}${name ? ` in ${name}` : ''}`
        : (name ?? ''),
    overall:
      classified && isCount(overallPosition)
        ? `P${overallPosition} overall`
        : '',
  };
};

/** How a flag is coloured in the header. */
export type FlagTone =
  'green' | 'yellow' | 'blue' | 'red' | 'white' | 'orange' | 'neutral';

const FLAG_TONES: Record<FlagKind, FlagTone> = {
  none: 'neutral',
  start: 'neutral',
  green: 'green',
  yellow: 'yellow',
  fullCourseYellow: 'yellow',
  debris: 'yellow',
  blue: 'blue',
  white: 'white',
  chequered: 'white',
  red: 'red',
  disqualified: 'red',
  penalty: 'neutral',
  meatball: 'orange',
};

export interface FlagPill {
  label: string;
  tone: FlagTone;
}

/**
 * The flag as the header shows it, or null when there is none to show.
 *
 * The flag panel's own name for it, without the word FLAG where the colour
 * says the rest: "GREEN", "FULL COURSE YELLOW", "DRIVE-THROUGH". `caution`
 * uses iRacing's word for a full-course yellow.
 */
export const flagPill = (
  kind: FlagKind | undefined,
  detail: FlagDetail | undefined,
  caution = false
): FlagPill | null => {
  if (!kind || kind === 'none') return null;
  return {
    label: flagTitle(kind, detail ?? 'noSession', { caution }).replace(
      / FLAG$/,
      ''
    ),
    tone: FLAG_TONES[kind],
  };
};
