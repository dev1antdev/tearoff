import type { ChannelBridge } from '@irdashies/types';
import { useChannelSnapshot } from './useChannelSnapshot';

/**
 * How the race is heading for the class of the user's own entry: every
 * running class car with the stops it owes and the lap its next is due, the
 * order they finish in, and the own entry's stint, pit window and rejoin.
 */
export const useRaceForecastSnapshot = (
  enabled = true,
  bridge?: ChannelBridge
) => useChannelSnapshot('race-forecast.snapshot', undefined, bridge, enabled);
