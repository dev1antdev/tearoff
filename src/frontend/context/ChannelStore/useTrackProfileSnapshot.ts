import type { ChannelBridge, TrackProfileSnapshot } from '@irdashies/types';
import {
  useChannelSelector,
  useChannelSnapshot,
  type ChannelSelectorOptions,
} from './useChannelSnapshot';

export const useTrackProfileSnapshot = (
  enabled = true,
  bridge?: ChannelBridge
) => useChannelSnapshot('track-profile.snapshot', undefined, bridge, enabled);

/**
 * One part of the track's profile, for a reader that wants a figure or two
 * of it and not the heights of the whole lap on every change.
 */
export const useTrackProfileSelector = <Selected>(
  selector: (snapshot: TrackProfileSnapshot) => Selected,
  options: ChannelSelectorOptions<Selected> = {}
) => useChannelSelector('track-profile.snapshot', selector, options);
