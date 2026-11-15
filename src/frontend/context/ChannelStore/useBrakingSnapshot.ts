import type { ChannelBridge } from '@irdashies/types';
import { useChannelSnapshot } from './useChannelSnapshot';

export const useBrakingSnapshot = (enabled = true, bridge?: ChannelBridge) =>
  useChannelSnapshot('braking.snapshot', undefined, bridge, enabled);
