import { useMemo } from 'react';
import { useDashboard } from '@irdashies/context';
import { normalizeFinishScenarios } from '@irdashies/domain/finishProjection';
import {
  getWidgetDefaultConfig,
  type FinishProjectionConfig,
} from '@irdashies/types';

const DEFAULTS = getWidgetDefaultConfig('finishorder');

/**
 * The finish projection's settings, complete.
 *
 * Dashboards are filled in from the manifest when they load, so a saved
 * config normally has every field. The nested groups are merged here as
 * well, and the list of stop lengths is made fit to use, because a widget
 * that crashed on a config saved by an older build or edited by hand would
 * take the whole overlay window with it.
 */
export const useFinishProjectionSettings = (): FinishProjectionConfig => {
  const { currentDashboard } = useDashboard();

  const saved = currentDashboard?.widgets.find(
    (widget) => (widget.type ?? widget.id) === 'finishorder'
  )?.config as Partial<FinishProjectionConfig> | undefined;

  return useMemo(() => {
    if (!saved || typeof saved !== 'object') return DEFAULTS;
    return {
      ...DEFAULTS,
      ...saved,
      scenarios: normalizeFinishScenarios(saved.scenarios, DEFAULTS.scenarios),
      background: { ...DEFAULTS.background, ...saved.background },
      sessionVisibility: {
        ...DEFAULTS.sessionVisibility,
        ...saved.sessionVisibility,
      },
    };
  }, [saved]);
};
