import type { ChannelBridge } from '@irdashies/types';
import { useChannelSnapshot } from './useChannelSnapshot';

/**
 * The stint under way: its start and present levels, the lap being driven,
 * the per-lap rates and how many laps the budget lasts at them.
 */
export const usePlayerStintSnapshot = (
  enabled = true,
  bridge?: ChannelBridge
) => useChannelSnapshot('player-stint.snapshot', undefined, bridge, enabled);
