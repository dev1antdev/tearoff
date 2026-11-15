import { useMemo } from 'react';
import { useDashboard } from '@irdashies/context';
import { getWidgetDefaultConfig, type WearConfig } from '@irdashies/types';

const DEFAULTS = getWidgetDefaultConfig('wear');

/**
 * The wear widget's settings, complete.
 *
 * Dashboards are filled in from the manifest when they load, so a saved
 * config normally has every field. The nested groups are merged here as well
 * because a widget that crashed on a config saved by an older build would
 * take the whole overlay window with it.
 */
export const useWearSettings = (): WearConfig => {
  const { currentDashboard } = useDashboard();

  const saved = currentDashboard?.widgets.find((widget) => widget.id === 'wear')
    ?.config as Partial<WearConfig> | undefined;

  return useMemo(() => {
    if (!saved || typeof saved !== 'object') return DEFAULTS;
    return {
      ...DEFAULTS,
      ...saved,
      background: { ...DEFAULTS.background, ...saved.background },
      tyres: { ...DEFAULTS.tyres, ...saved.tyres },
      brakes: { ...DEFAULTS.brakes, ...saved.brakes },
      sessionVisibility: {
        ...DEFAULTS.sessionVisibility,
        ...saved.sessionVisibility,
      },
    };
  }, [saved]);
};
