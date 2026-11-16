import type { ChannelBridge } from '@irdashies/types';
import { useChannelSnapshot } from './useChannelSnapshot';

export const useTrafficSnapshot = (enabled = true, bridge?: ChannelBridge) =>
  useChannelSnapshot('traffic.snapshot', undefined, bridge, enabled);
