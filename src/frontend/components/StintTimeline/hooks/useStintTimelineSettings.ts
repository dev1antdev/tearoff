import { useMemo } from 'react';
import { useDashboard } from '@irdashies/context';
import {
  STINT_TIMELINE_RIVALS_MAX,
  getWidgetDefaultConfig,
  type StintTimelineConfig,
} from '@irdashies/types';

const DEFAULTS = getWidgetDefaultConfig('stinttimeline');

/**
 * The stint timeline's settings, complete.
 *
 * Dashboards are filled in from the manifest when they load, so a saved
 * config normally has every field. The nested groups are merged here as
 * well, and the number of rivals is made fit to use, because a widget that
 * crashed on a config saved by an older build or edited by hand would take
 * the whole window with it.
 */
export const useStintTimelineSettings = (): StintTimelineConfig => {
  const { currentDashboard } = useDashboard();

  const saved = currentDashboard?.widgets.find(
    (widget) => (widget.type ?? widget.id) === 'stinttimeline'
  )?.config as Partial<StintTimelineConfig> | undefined;

  return useMemo(() => {
    if (!saved || typeof saved !== 'object') return DEFAULTS;
    return {
      ...DEFAULTS,
      ...saved,
      rivals:
        typeof saved.rivals === 'number' && Number.isFinite(saved.rivals)
          ? Math.min(
              Math.max(Math.round(saved.rivals), 0),
              STINT_TIMELINE_RIVALS_MAX
            )
          : DEFAULTS.rivals,
      background: { ...DEFAULTS.background, ...saved.background },
      sessionVisibility: {
        ...DEFAULTS.sessionVisibility,
        ...saved.sessionVisibility,
      },
    };
  }, [saved]);
};
