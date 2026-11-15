import type { ChannelBridge } from '@irdashies/types';
import { useChannelSnapshot } from './useChannelSnapshot';

/**
 * The player's next pit stop: its estimate, the lane, the timer and the
 * rejoin. Not `usePitStopsSnapshot`, which is every car's finished stops.
 */
export const usePitStopSnapshot = (enabled = true, bridge?: ChannelBridge) =>
  useChannelSnapshot('pit-stop.snapshot', undefined, bridge, enabled);
