import type { ChannelBridge } from '@irdashies/types';
import { useChannelSnapshot } from './useChannelSnapshot';

export const useTrackProfileSnapshot = (
  enabled = true,
  bridge?: ChannelBridge
) => useChannelSnapshot('track-profile.snapshot', undefined, bridge, enabled);
