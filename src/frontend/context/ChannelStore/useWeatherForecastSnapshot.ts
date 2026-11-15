import type { ChannelBridge } from '@irdashies/types';
import { useChannelSnapshot } from './useChannelSnapshot';

export const useWeatherForecastSnapshot = (
  enabled = true,
  bridge?: ChannelBridge
) =>
  useChannelSnapshot('weather-forecast.snapshot', undefined, bridge, enabled);
