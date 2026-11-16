import type { ChannelBridge } from '@irdashies/types';
import { useChannelSnapshot } from './useChannelSnapshot';

export const useCarSectorsSnapshot = (enabled = true, bridge?: ChannelBridge) =>
  useChannelSnapshot('car-sectors.snapshot', undefined, bridge, enabled);
