import type { PitStopParts, PitStopSnapshot } from '@irdashies/types';

/**
 * How the pit stop widget draws what the channel and the plan give it:
 * which face it wears, the chips a stop is made of, and how a figure is
 * written. The arithmetic of the stop itself is in `src/shared/pitStop/`.
 */

/** Within this of the plan a finished stop went as planned, s. */
export const STOP_ON_PLAN_S = 1;

type Estimate = PitStopSnapshot['estimate'];
/** What the widget is showing. */
export type PitStopMode = 'idle' | 'planning' | 'inPits' | 'result';

/**
 * Which face the widget wears: the plan out on the circuit, the timer in
 * the pit lane, and the finished stop for `resultHoldS` after the exit.
 */
export const pitStopMode = (
  snapshot: PitStopSnapshot,
  sessionTime: number,
  resultHoldS: number
): PitStopMode => {
  if (snapshot.phase === 'idle') return 'idle';
  if (snapshot.phase !== 'planning') return 'inPits';
  const exitedAt = snapshot.timer.exitedAt;
  if (
    snapshot.last !== null &&
    exitedAt !== null &&
    sessionTime >= exitedAt &&
    sessionTime - exitedAt < resultHoldS
  ) {
    return 'result';
  }
  return 'planning';
};

export type PitStopChipKind =
  | 'fuel'
  | 'energy'
  | 'tyres'
  | 'repair'
  | 'optionalRepair'
  | 'driver'
  | 'brakes'
  | 'brakeDucts'
  | 'penalty'
  | 'driveThrough';

export interface PitStopChip {
  kind: PitStopChipKind;
  /** Seconds; null for a drive-through, which stands for none. */
  seconds: number | null;
  /** `main` is the longest of the work; `penalty` is time served. */
  tone: 'main' | 'part' | 'penalty';
}

const WORK: readonly (readonly [keyof PitStopParts, PitStopChipKind])[] = [
  ['fuel', 'fuel'],
  ['energy', 'energy'],
  ['tyres', 'tyres'],
  ['damage', 'repair'],
  ['driverSwap', 'driver'],
  ['brakes', 'brakes'],
  ['brakeDucts', 'brakeDucts'],
];

/**
 * One chip per part of the stop that takes time, the longest marked.
 *
 * A drive-through to serve is a chip of its own and the only one: the visit
 * it calls for is a pass down the lane, whatever the pit menu is set to do
 * at the stop after it.
 */
export const pitStopChips = (estimate: Estimate): PitStopChip[] => {
  if (estimate.penalty === 'DT') {
    return [{ kind: 'driveThrough', seconds: null, tone: 'penalty' }];
  }
  const chips: PitStopChip[] = [];
  const parts = estimate.parts;
  if (parts) {
    let longest = 0;
    for (const [part] of WORK) longest = Math.max(longest, parts[part]);
    let marked = false;
    for (const [part, kind] of WORK) {
      const seconds = parts[part];
      if (!(seconds > 0)) continue;
      const main = !marked && seconds === longest;
      if (main) marked = true;
      chips.push({ kind, seconds, tone: main ? 'main' : 'part' });
    }
  }
  if (estimate.optionalRepairS !== null && estimate.optionalRepairS > 0) {
    chips.push({
      kind: 'optionalRepair',
      seconds: estimate.optionalRepairS,
      tone: 'part',
    });
  }
  if (parts && parts.penalties > 0) {
    chips.push({ kind: 'penalty', seconds: parts.penalties, tone: 'penalty' });
  }
  return chips;
};

/** Seconds to a tenth, or the placeholder. */
export const formatPitSeconds = (seconds: number | null): string =>
  seconds === null || !Number.isFinite(seconds) ? '--' : seconds.toFixed(1);

/** A signed gap to a tenth: "+0.4". */
export const formatPitGap = (seconds: number): string =>
  `${seconds < 0 ? '-' : '+'}${Math.abs(seconds).toFixed(1)}`;
