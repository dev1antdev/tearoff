import { useMemo } from 'react';
import { useDashboard } from '@irdashies/context';
import { getWidgetDefaultConfig, type ElevationConfig } from '@irdashies/types';

const DEFAULTS = getWidgetDefaultConfig('elevation');

/**
 * The elevation widget's settings, complete.
 *
 * Dashboards are filled in from the manifest when they load, so a saved
 * config normally has every field. The two choices are held to their options
 * here as well: a unit saved by hand as anything else would print nothing.
 */
export const useElevationSettings = (): ElevationConfig => {
  const { currentDashboard } = useDashboard();

  const saved = currentDashboard?.widgets.find(
    (widget) => widget.id === 'elevation'
  )?.config as Partial<ElevationConfig> | undefined;

  return useMemo(() => {
    if (!saved || typeof saved !== 'object') return DEFAULTS;
    return {
      ...DEFAULTS,
      ...saved,
      zero: saved.zero === 'line' ? 'line' : 'lowest',
      unit: saved.unit === 'm' || saved.unit === 'ft' ? saved.unit : 'auto',
      background: { ...DEFAULTS.background, ...saved.background },
      sessionVisibility: {
        ...DEFAULTS.sessionVisibility,
        ...saved.sessionVisibility,
      },
    };
  }, [saved]);
};
