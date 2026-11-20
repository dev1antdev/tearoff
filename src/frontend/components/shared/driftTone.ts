import type { RacePlanDriftLevel } from '@irdashies/domain';

/**
 * How far the race runs from its plan, as every widget that says so colours
 * it: behind a caution, ahead a gain, on plan neutral.
 */
export const DRIFT_CLASS: Record<RacePlanDriftLevel, string> = {
  behind: 'text-amber-400',
  ahead: 'text-green-400',
  'on-plan': 'text-slate-300',
};
