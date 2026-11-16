import type { ChannelBridge } from '@irdashies/types';
import { useChannelSnapshot } from './useChannelSnapshot';

/**
 * The most recent events of the race's log. Subscribing is also what keeps
 * the race recorded while a reader is on screen.
 */
export const useRaceLogSnapshot = (enabled = true, bridge?: ChannelBridge) =>
  useChannelSnapshot('race-log.snapshot', undefined, bridge, enabled);
