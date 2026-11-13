import { useMemo } from 'react';
import { useDashboard } from '@irdashies/context';
import { getWidgetDefaultConfig, type MinimapConfig } from '@irdashies/types';

const DEFAULTS = getWidgetDefaultConfig('minimap');

/**
 * The minimap's settings, complete.
 *
 * Dashboards are filled in from the manifest when they load, so a saved config
 * normally has every field. The nested groups are merged here as well, so a
 * config saved by an older build cannot take the overlay window down with it.
 */
export const useMinimapSettings = (): MinimapConfig => {
  const { currentDashboard } = useDashboard();

  const saved = currentDashboard?.widgets.find(
    (widget) => widget.id === 'minimap'
  )?.config as Partial<MinimapConfig> | undefined;

  return useMemo(() => {
    if (!saved || typeof saved !== 'object') return DEFAULTS;
    return {
      ...DEFAULTS,
      ...saved,
      background: { ...DEFAULTS.background, ...saved.background },
      sessionVisibility: {
        ...DEFAULTS.sessionVisibility,
        ...saved.sessionVisibility,
      },
    };
  }, [saved]);
};
