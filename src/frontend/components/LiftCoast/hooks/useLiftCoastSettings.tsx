import { useMemo } from 'react';
import { useDashboard } from '@irdashies/context';
import { getWidgetDefaultConfig, type LiftCoastConfig } from '@irdashies/types';

const DEFAULTS = getWidgetDefaultConfig('liftcoast');

/**
 * The lift-and-coast strip's settings, complete.
 *
 * Dashboards are filled in from the manifest when they load, so a saved
 * config normally has every field. The nested groups are merged here as well
 * because a widget that crashed on a config saved by an older build would
 * take the whole overlay window with it.
 */
export const useLiftCoastSettings = (): LiftCoastConfig => {
  const { currentDashboard } = useDashboard();

  const saved = currentDashboard?.widgets.find(
    (widget) => widget.id === 'liftcoast'
  )?.config as Partial<LiftCoastConfig> | undefined;

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
