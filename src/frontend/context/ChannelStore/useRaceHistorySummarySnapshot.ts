import type { ChannelBridge } from '@irdashies/types';
import { useChannelSnapshot } from './useChannelSnapshot';

export const useRaceHistorySummarySnapshot = (
  enabled = true,
  bridge?: ChannelBridge
) => useChannelSnapshot('race-history.summary', undefined, bridge, enabled);
