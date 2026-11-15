import { useMemo } from 'react';
import { useDashboard } from '@irdashies/context';
import { getWidgetDefaultConfig, type FuelSaverConfig } from '@irdashies/types';

const DEFAULTS = getWidgetDefaultConfig('fuelsaver');

/**
 * The fuel saver's settings, complete: a config saved by an older build is
 * filled in from the manifest's defaults rather than trusted to have every
 * field.
 */
export const useFuelSaverSettings = (): FuelSaverConfig => {
  const { currentDashboard } = useDashboard();

  const saved = currentDashboard?.widgets.find(
    (widget) => widget.id === 'fuelsaver'
  )?.config as Partial<FuelSaverConfig> | undefined;

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
