import type { ChannelBridge } from '@irdashies/types';
import { useChannelSnapshot } from './useChannelSnapshot';

export const useCruiseSnapshot = (enabled = true, bridge?: ChannelBridge) =>
  useChannelSnapshot('cruise.snapshot', undefined, bridge, enabled);
