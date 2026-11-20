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

// Demo data for rejoin indicator
export const getDemoRejoinData = (
  settings: RejoinIndicatorSettings | undefined
): RejoinIndicatorDemoData => {
  // Demo: car behind at 1.5 seconds - should show "Caution" status
  const gap = 1.5;
  const cfg = settings?.config || { careGap: 2, stopGap: 1 };

  const state = stateOf(gap, cfg.careGap, cfg.stopGap);

  return {
    gap: gap.toFixed(1),
    state,
  };
};
