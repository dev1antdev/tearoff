import type { ChannelBridge } from '@irdashies/types';
import { useChannelSnapshot } from './useChannelSnapshot';

export const useDamageSnapshot = (enabled = true, bridge?: ChannelBridge) =>
  useChannelSnapshot('damage.snapshot', undefined, bridge, enabled);
