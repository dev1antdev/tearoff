import {
  stateOf,
  type RejoinState,
} from '@irdashies/domain/traffic/pitExitTraffic';
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
 * The state a gap behind puts a rejoin in, the clear threshold checked first
 * as this widget always has: a Care Gap set below the Stop Gap leaves no
 * caution band rather than turning gaps it calls clear red. Traffic's own
 * `stateOf` checks danger first; the min gives the same answer here.
 */
export const rejoinStateOf = (
  gap: number | undefined,
  { careGap, stopGap }: { careGap: number; stopGap: number }
): RejoinState => stateOf(gap, careGap, Math.min(stopGap, careGap));

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
