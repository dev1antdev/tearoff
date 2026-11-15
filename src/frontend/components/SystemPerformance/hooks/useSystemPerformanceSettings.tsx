import { useMemo } from 'react';
import { useDashboard } from '@irdashies/context';
import {
  getWidgetDefaultConfig,
  type SystemPerformanceConfig,
} from '@irdashies/types';

const DEFAULTS = getWidgetDefaultConfig('systemperformance');

/**
 * The system performance widget's settings, complete.
 *
 * Dashboards are filled in from the manifest when they load, so a saved config
 * normally has every field. The nested groups are merged here as well because
 * a widget that crashed on a config saved by an older build would take the
 * whole overlay window with it.
 */
export const useSystemPerformanceSettings = (): SystemPerformanceConfig => {
  const { currentDashboard } = useDashboard();

  const saved = currentDashboard?.widgets.find(
    (widget) => widget.id === 'systemperformance'
  )?.config as Partial<SystemPerformanceConfig> | undefined;

  return useMemo(() => {
    if (!saved || typeof saved !== 'object') return DEFAULTS;
    return {
      ...DEFAULTS,
      ...saved,
      background: { ...DEFAULTS.background, ...saved.background },
      system: { ...DEFAULTS.system, ...saved.system },
      app: { ...DEFAULTS.app, ...saved.app },
      sim: { ...DEFAULTS.sim, ...saved.sim },
      warn: { ...DEFAULTS.warn, ...saved.warn },
      sessionVisibility: {
        ...DEFAULTS.sessionVisibility,
        ...saved.sessionVisibility,
      },
    };
  }, [saved]);
};
