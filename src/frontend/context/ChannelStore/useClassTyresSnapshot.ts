import type { ChannelBridge } from '@irdashies/types';
import { useChannelSnapshot } from './useChannelSnapshot';

/**
 * For every car of the class the user is entered in: the compounds it is
 * on, the laps it has run on the set and what is left of the tread. Reading
 * it has the race recorded, since the laps are counted from the stops.
 */
export const useClassTyresSnapshot = (enabled = true, bridge?: ChannelBridge) =>
  useChannelSnapshot('class-tyres.snapshot', undefined, bridge, enabled);
