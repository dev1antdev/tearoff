import { useMemo } from 'react';
import { useDashboard } from '@irdashies/context';
import {
  CLASS_RIVALS_PER_SIDE_MAX,
  getWidgetDefaultConfig,
  type ClassRivalsConfig,
} from '@irdashies/types';

const DEFAULTS = getWidgetDefaultConfig('classrivals');

/** A count of cars a side from a saved config: 0 for all, else 1 to the most. */
const perSide = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(Math.max(Math.round(value), 0), CLASS_RIVALS_PER_SIDE_MAX)
    : fallback;

/**
 * Class Rivals' settings, complete.
 *
 * Dashboards are filled in from the manifest when they load, so a saved
 * config normally has every field. The nested groups are merged here as
 * well, and the two counts are made fit to use, because a widget that
 * crashed on a config saved by an older build or edited by hand would take
 * the whole window with it.
 */
export const useClassRivalsSettings = (): ClassRivalsConfig => {
  const { currentDashboard } = useDashboard();

  const saved = currentDashboard?.widgets.find(
    (widget) => (widget.type ?? widget.id) === 'classrivals'
  )?.config as Partial<ClassRivalsConfig> | undefined;

  return useMemo(() => {
    if (!saved || typeof saved !== 'object') return DEFAULTS;
    return {
      ...DEFAULTS,
      ...saved,
      carsAhead: perSide(saved.carsAhead, DEFAULTS.carsAhead),
      carsBehind: perSide(saved.carsBehind, DEFAULTS.carsBehind),
      background: { ...DEFAULTS.background, ...saved.background },
      sessionVisibility: {
        ...DEFAULTS.sessionVisibility,
        ...saved.sessionVisibility,
      },
    };
  }, [saved]);
};
