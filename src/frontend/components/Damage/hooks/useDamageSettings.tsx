import { useMemo } from 'react';
import { useDashboard } from '@irdashies/context';
import { getWidgetDefaultConfig, type DamageConfig } from '@irdashies/types';

const DEFAULTS = getWidgetDefaultConfig('damage');

/**
 * The damage widget's settings, complete.
 *
 * Dashboards are filled in from the manifest when they load, so a saved config
 * normally has every field. The nested groups are merged here as well because
 * a widget that crashed on a config saved by an older build would take the
 * whole overlay window with it.
 */
export const useDamageSettings = (): DamageConfig => {
  const { currentDashboard } = useDashboard();

  const saved = currentDashboard?.widgets.find(
    (widget) => widget.id === 'damage'
  )?.config as Partial<DamageConfig> | undefined;

  return useMemo(() => {
    if (!saved || typeof saved !== 'object') return DEFAULTS;
    return {
      ...DEFAULTS,
      ...saved,
      background: { ...DEFAULTS.background, ...saved.background },
      diagram: { ...DEFAULTS.diagram, ...saved.diagram },
      impact: { ...DEFAULTS.impact, ...saved.impact },
      overheating: { ...DEFAULTS.overheating, ...saved.overheating },
      stats: { ...DEFAULTS.stats, ...saved.stats },
      repair: { ...DEFAULTS.repair, ...saved.repair },
      sessionVisibility: {
        ...DEFAULTS.sessionVisibility,
        ...saved.sessionVisibility,
      },
    };
  }, [saved]);
};
