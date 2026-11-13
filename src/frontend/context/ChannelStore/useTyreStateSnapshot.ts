import type { ChannelBridge } from '@irdashies/types';
import { useChannelSnapshot } from './useChannelSnapshot';

export const useTyreStateSnapshot = (enabled = true, bridge?: ChannelBridge) =>
  useChannelSnapshot('tyre-state.snapshot', undefined, bridge, enabled);
