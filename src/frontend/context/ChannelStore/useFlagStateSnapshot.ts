import type { ChannelBridge } from '@irdashies/types';
import { useChannelSnapshot } from './useChannelSnapshot';

export const useFlagStateSnapshot = (enabled = true, bridge?: ChannelBridge) =>
  useChannelSnapshot('flag-state.snapshot', undefined, bridge, enabled);
