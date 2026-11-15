import type { ChannelBridge } from '@irdashies/types';
import { useChannelSnapshot } from './useChannelSnapshot';

/**
 * The player's wheels and the attitude of the chassis. Pass `enabled: false`
 * while nothing on screen reads it, so the processor behind it stops too.
 */
export const useWheelDynamicsSnapshot = (
  enabled = true,
  bridge?: ChannelBridge
) => useChannelSnapshot('wheel-dynamics.snapshot', undefined, bridge, enabled);
