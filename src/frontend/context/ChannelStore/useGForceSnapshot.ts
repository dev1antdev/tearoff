import type { ChannelBridge } from '@irdashies/types';
import { useChannelSnapshot } from './useChannelSnapshot';

export const useGForceSnapshot = (enabled = true, bridge?: ChannelBridge) =>
  useChannelSnapshot('g-force.snapshot', undefined, bridge, enabled);
