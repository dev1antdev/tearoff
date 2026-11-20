import type { RejoinState } from '@irdashies/domain/traffic/pitExitTraffic';
// Demo data for Rejoin Indicator component

export interface RejoinIndicatorSettings {
  config: {
    careGap: number;
    stopGap: number;
    showAtSpeed: number;
    sessionVisibility: {
      race: boolean;
      loneQualify: boolean;
      openQualify: boolean;
      practice: boolean;
      offlineTesting: boolean;
    };
  };
  enabled: boolean;
}

export interface RejoinIndicatorDemoData {
  gap: string;
  state: RejoinState;
}

/**
 * The state a gap behind puts a rejoin in, by this widget's own ladder, the
 * clear threshold first (Traffic's `stateOf` checks danger first). A Care Gap
 * set below the Stop Gap leaves no caution band rather than turning gaps it
 * calls clear red, and a Care Gap that is not a number never hides a red the
 * Stop Gap calls.
 */
export const rejoinStateOf = (
  gap: number | undefined,
  { careGap, stopGap }: { careGap: number; stopGap: number }
): RejoinState =>
  gap === undefined || gap >= careGap
    ? 'clear'
    : gap >= stopGap
      ? 'caution'
      : 'danger';

// Demo data for rejoin indicator
export const getDemoRejoinData = (
  settings: RejoinIndicatorSettings | undefined
): RejoinIndicatorDemoData => {
  // Demo: car behind at 1.5 seconds - should show "Caution" status
  const gap = 1.5;
  const cfg = settings?.config || { careGap: 2, stopGap: 1 };

  const state = rejoinStateOf(gap, cfg);

  return {
    gap: gap.toFixed(1),
    state,
  };
};
