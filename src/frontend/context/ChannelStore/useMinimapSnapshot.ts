import type { ChannelBridge } from '@irdashies/types';
import { useChannelSnapshot } from './useChannelSnapshot';

export const useMinimapSnapshot = (enabled = true, bridge?: ChannelBridge) =>
  useChannelSnapshot('minimap.snapshot', undefined, bridge, enabled);
