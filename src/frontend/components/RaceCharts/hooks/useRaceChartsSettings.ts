import { useMemo } from 'react';
import { useDashboard } from '@irdashies/context';
import {
  RACE_CHARTS_LAPS,
  getWidgetDefaultConfig,
  type RaceChartsConfig,
  type RaceChartsLaps,
  type RaceChartsTab,
} from '@irdashies/types';

const DEFAULTS = getWidgetDefaultConfig('racecharts');

const TABS: readonly RaceChartsTab[] = ['pace', 'gap', 'usage'];

/**
 * The Race Charts' settings, complete.
 *
 * Dashboards are filled in from the manifest when they load, so a saved
 * config normally has every field. The nested groups are merged here as
 * well, and each choice is checked against what it can be, because a widget
 * that crashed on a config saved by an older build or edited by hand would
 * take the whole window with it.
 */
export const useRaceChartsSettings = (): RaceChartsConfig => {
  const { currentDashboard } = useDashboard();

  const saved = currentDashboard?.widgets.find(
    (widget) => (widget.type ?? widget.id) === 'racecharts'
  )?.config as Partial<RaceChartsConfig> | undefined;

  return useMemo(() => {
    if (!saved || typeof saved !== 'object') return DEFAULTS;
    return {
      ...DEFAULTS,
      ...saved,
      tab:
        saved.tab !== undefined && TABS.includes(saved.tab)
          ? saved.tab
          : DEFAULTS.tab,
      laps: RACE_CHARTS_LAPS.includes(saved.laps as RaceChartsLaps)
        ? (saved.laps as RaceChartsLaps)
        : DEFAULTS.laps,
      others: saved.others === 'chosen' ? 'chosen' : DEFAULTS.others,
      carNumbers:
        typeof saved.carNumbers === 'string'
          ? saved.carNumbers
          : DEFAULTS.carNumbers,
      background: { ...DEFAULTS.background, ...saved.background },
      sessionVisibility: {
        ...DEFAULTS.sessionVisibility,
        ...saved.sessionVisibility,
      },
    };
  }, [saved]);
};
