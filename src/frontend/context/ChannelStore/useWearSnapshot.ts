import type { ChannelBridge } from '@irdashies/types';
import { useChannelSnapshot } from './useChannelSnapshot';

/**
 * How much tread and brake disc the player's car has left, how fast each is
 * going and how many laps that makes.
 */
export const useWearSnapshot = (enabled = true, bridge?: ChannelBridge) =>
  useChannelSnapshot('wear.snapshot', undefined, bridge, enabled);
