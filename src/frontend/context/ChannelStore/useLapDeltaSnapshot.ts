import type { ChannelBridge } from '@irdashies/types';
import { useChannelSnapshot } from './useChannelSnapshot';

export const useLapDeltaSnapshot = (enabled = true, bridge?: ChannelBridge) =>
  useChannelSnapshot('lap-delta.snapshot', undefined, bridge, enabled);
