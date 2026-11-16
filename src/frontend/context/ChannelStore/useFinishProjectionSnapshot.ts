import type { ChannelBridge } from '@irdashies/types';
import { useChannelSnapshot } from './useChannelSnapshot';

/**
 * How the race ends for the user's own entry: the leader's and its own pace
 * and progress, what a stop costs it, and its class rivals' remaining stops.
 */
export const useFinishProjectionSnapshot = (
  enabled = true,
  bridge?: ChannelBridge
) =>
  useChannelSnapshot('finish-projection.snapshot', undefined, bridge, enabled);
