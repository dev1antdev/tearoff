import { useMemo } from 'react';
import { useDashboard } from '@irdashies/context';
import { getWidgetDefaultConfig, type TyresConfig } from '@irdashies/types';

const DEFAULTS = getWidgetDefaultConfig('tyres');

/**
 * The tyre widget's settings, complete.
 *
 * Dashboards are filled in from the manifest when they load, so a saved config
 * normally has every field. The nested groups are merged here as well because
 * a widget that crashed on a config saved by an older build would take the
 * whole overlay window with it.
 */
export const useTyresSettings = (): TyresConfig => {
  const { currentDashboard } = useDashboard();

  const saved = currentDashboard?.widgets.find(
    (widget) => widget.id === 'tyres'
  )?.config as Partial<TyresConfig> | undefined;

  return useMemo(() => {
    if (!saved || typeof saved !== 'object') return DEFAULTS;
    return {
      ...DEFAULTS,
      ...saved,
      background: { ...DEFAULTS.background, ...saved.background },
      tyreWindow: { ...DEFAULTS.tyreWindow, ...saved.tyreWindow },
      brakeWindow: { ...DEFAULTS.brakeWindow, ...saved.brakeWindow },
      pressureTarget: { ...DEFAULTS.pressureTarget, ...saved.pressureTarget },
      sessionVisibility: {
        ...DEFAULTS.sessionVisibility,
        ...saved.sessionVisibility,
      },
    };
  }, [saved]);
};
