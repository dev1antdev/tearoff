import type { ChannelBridge } from '@irdashies/types';
import { useChannelSnapshot } from './useChannelSnapshot';

export const useCarPitSnapshot = (enabled = true, bridge?: ChannelBridge) =>
  useChannelSnapshot('car-pit.snapshot', undefined, bridge, enabled);
