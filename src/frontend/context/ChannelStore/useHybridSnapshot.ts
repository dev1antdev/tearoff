import type { ChannelBridge } from '@irdashies/types';
import { useChannelSnapshot } from './useChannelSnapshot';

export const useHybridSnapshot = (enabled = true, bridge?: ChannelBridge) =>
  useChannelSnapshot('hybrid.snapshot', undefined, bridge, enabled);
