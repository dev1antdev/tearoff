import type {
  LapLibraryLap,
  LapLibrarySession,
  LapLibraryUnavailableReason,
} from '@irdashies/types';
import { formatTime } from '@irdashies/utils/time';

/**
 * How the lap library page words what it lists. Kept apart from the page so
 * the rules can be tested without rendering it.
 */

export type LapFlagTone = 'neutral' | 'warning' | 'bad';

export interface LapFlag {
  label: string;
  /** Shown on hover: what the flag means for the lap. */
  hint: string;
  tone: LapFlagTone;
}

const SIMULATOR_LABELS: Record<string, string> = {
  iracing: 'iRacing',
  lmu: 'Le Mans Ultimate',
};

/** The simulator as a person would name it; an unknown id is shown as it is. */
export const simulatorLabel = (simulator: string): string =>
  SIMULATOR_LABELS[simulator] ?? simulator;

/** A lap time as m:ss.mmm. */
export const formatLapTime = (seconds: number | null): string =>
  seconds === null || !(seconds > 0) ? '-:--.---' : formatTime(seconds, 'full');

/**
 * How far a lap is off the best of its session, signed. The best lap itself
 * shows a dash rather than +0.000, which would read as a gap.
 */
export const formatGap = (lapTime: number, best: number | null): string => {
  if (best === null) return '';
  const gap = lapTime - best;
  if (Math.abs(gap) < 0.0005) return '-';
  return `${gap > 0 ? '+' : '-'}${Math.abs(gap).toFixed(3)}`;
};

/** The track with its layout, where the sim names one apart from the track. */
export const trackLabel = (session: LapLibrarySession): string =>
  session.trackConfig && !session.trackName.includes(session.trackConfig)
    ? `${session.trackName} - ${session.trackConfig}`
    : session.trackName;

/** When the session began, in the reader's own date and time format. */
export const formatSessionStart = (startedAt: number): string =>
  new Date(startedAt).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * Why a lap is not fit to be a reference, as short labels. A lap with none
 * is a clean one.
 */
export const lapFlags = (lap: LapLibraryLap): LapFlag[] => {
  const flags: LapFlag[] = [];
  if (lap.pit) {
    flags.push({
      label: 'Pit',
      hint: 'The car was on pit road during this lap.',
      tone: 'neutral',
    });
  }
  if (lap.voided) {
    flags.push({
      label: 'Voided',
      hint: 'The sim voided this lap, for track limits for instance.',
      tone: 'bad',
    });
  }
  if (lap.incidents !== null && lap.incidents > 0) {
    flags.push({
      label: `${lap.incidents}x`,
      hint: 'Incident points picked up on this lap.',
      tone: 'warning',
    });
  }
  if (!lap.own) {
    flags.push({
      label: 'Not driving',
      hint: 'You were not at the wheel for all of this lap.',
      tone: 'neutral',
    });
  }
  if (!lap.complete) {
    flags.push({
      label: 'No trace',
      hint: 'The lap was timed, but part of it was not sampled, so it cannot serve as a reference.',
      tone: 'neutral',
    });
  }
  return flags;
};

/** What the lap burned: virtual energy where the car runs on it, else fuel. */
export const formatConsumption = (lap: LapLibraryLap): string => {
  if (lap.energyUsed !== null)
    return `${(lap.energyUsed * 100).toFixed(1)}% VE`;
  if (lap.fuelUsed !== null) return `${lap.fuelUsed.toFixed(2)} L`;
  return '';
};

export interface LapLibraryNotice {
  title: string;
  body: string;
}

/**
 * What the page says in place of the laps when the library is not in use.
 * In every case the laps on disk have been left alone, and the page says so:
 * an empty list on its own would read as the laps being gone.
 */
export const unavailableNotice = (
  reason: LapLibraryUnavailableReason | null
): LapLibraryNotice => {
  switch (reason) {
    case 'newer':
      return {
        title: 'These laps were recorded by a newer version of Tearoff',
        body: 'This version cannot read them, so it has left the lap library exactly as it is and is not recording laps. Update Tearoff to see your laps and record again.',
      };
    case 'upgrade':
      return {
        title: 'The lap library could not be updated for this version',
        body: 'Your laps are still on disk, unchanged, but they are not listed and no laps are being recorded. The log file says what went wrong.',
      };
    default:
      return {
        title: 'The lap library could not be opened',
        body: 'Laps are not listed and no laps are being recorded. Any laps on disk have been left as they are. The log file says what went wrong.',
      };
  }
};

/** "1 lap", "12 laps". */
export const lapCountLabel = (count: number): string =>
  `${count} ${count === 1 ? 'lap' : 'laps'}`;
