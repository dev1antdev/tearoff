import { useMemo } from 'react';
import { useDashboard } from '@irdashies/context';
import {
  getWidgetDefaultConfig,
  type WeatherForecastConfig,
} from '@irdashies/types';

const DEFAULTS = getWidgetDefaultConfig('weatherforecast');

/**
 * The forecast widget's settings, complete.
 *
 * Dashboards are filled in from the manifest when they load, so a saved config
 * normally has every field. The nested groups are merged here as well because
 * a widget that crashed on a config saved by an older build would take the
 * whole overlay window with it.
 */
export const useWeatherForecastSettings = (): WeatherForecastConfig => {
  const { currentDashboard } = useDashboard();

  const saved = currentDashboard?.widgets.find(
    (widget) => widget.id === 'weatherforecast'
  )?.config as Partial<WeatherForecastConfig> | undefined;

  return useMemo(() => {
    if (!saved || typeof saved !== 'object') return DEFAULTS;
    return {
      ...DEFAULTS,
      ...saved,
      background: { ...DEFAULTS.background, ...saved.background },
      temperature: { ...DEFAULTS.temperature, ...saved.temperature },
      rainChance: { ...DEFAULTS.rainChance, ...saved.rainChance },
      humidity: { ...DEFAULTS.humidity, ...saved.humidity },
      wind: { ...DEFAULTS.wind, ...saved.wind },
      trend: { ...DEFAULTS.trend, ...saved.trend },
      sessionVisibility: {
        ...DEFAULTS.sessionVisibility,
        ...saved.sessionVisibility,
      },
    };
  }, [saved]);
};
