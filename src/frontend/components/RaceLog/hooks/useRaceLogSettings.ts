import { useMemo } from 'react';
import { useDashboard } from '@irdashies/context';
import {
  getWidgetDefaultConfig,
  type RaceLogConfig,
  type RaceLogKinds,
  type RaceLogScope,
} from '@irdashies/types';

const DEFAULTS = getWidgetDefaultConfig('racelog');

const SCOPES: readonly RaceLogScope[] = ['all', 'class', 'car'];
const KINDS = Object.keys(DEFAULTS.kinds) as (keyof RaceLogKinds)[];

/**
 * The race log's settings, complete.
 *
 * Dashboards are filled in from the manifest when they load, so a saved
 * config normally has every field. The nested groups are merged here as
 * well, and the two choices are checked against what they can be, because a
 * widget that crashed on a config saved by an older build or edited by hand
 * would take the whole window with it.
 */
export const useRaceLogSettings = (): RaceLogConfig => {
  const { currentDashboard } = useDashboard();

  const saved = currentDashboard?.widgets.find(
    (widget) => (widget.type ?? widget.id) === 'racelog'
  )?.config as Partial<RaceLogConfig> | undefined;

  return useMemo(() => {
    if (!saved || typeof saved !== 'object') return DEFAULTS;
    const kinds = { ...DEFAULTS.kinds };
    for (const kind of KINDS) {
      const value = saved.kinds?.[kind];
      if (typeof value === 'boolean') kinds[kind] = value;
    }
    return {
      ...DEFAULTS,
      ...saved,
      time: saved.time === 'session' ? 'session' : DEFAULTS.time,
      scope:
        saved.scope !== undefined && SCOPES.includes(saved.scope)
          ? saved.scope
          : DEFAULTS.scope,
      kinds,
      showFilters:
        typeof saved.showFilters === 'boolean'
          ? saved.showFilters
          : DEFAULTS.showFilters,
      background: { ...DEFAULTS.background, ...saved.background },
      sessionVisibility: {
        ...DEFAULTS.sessionVisibility,
        ...saved.sessionVisibility,
      },
    };
  }, [saved]);
};
