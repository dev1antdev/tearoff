import { useMemo } from 'react';
import { useDashboard } from '@irdashies/context';
import {
  getWidgetDefaultConfig,
  type TimingTowerConfig,
} from '@irdashies/types';

const DEFAULTS = getWidgetDefaultConfig('timingtower');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The saved config over the defaults, group by group: every key of the
 * defaults is there afterwards, with the saved value where there is one of
 * the same kind.
 */
export const completeTimingTowerConfig = (
  saved: unknown
): TimingTowerConfig => {
  if (!isRecord(saved)) return DEFAULTS;
  const merged: Record<string, unknown> = { ...DEFAULTS };
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const value = saved[key];
    if (isRecord(fallback)) {
      merged[key] = isRecord(value) ? { ...fallback, ...value } : fallback;
    } else if (typeof value === typeof fallback) {
      merged[key] = value;
    }
  }
  return merged as unknown as TimingTowerConfig;
};

/**
 * The timing tower's settings, complete.
 *
 * Dashboards are filled in from the manifest when they load, so a saved
 * config normally has every field. The groups are merged here as well,
 * because a widget that crashed on a config saved by an older build would
 * take the whole window with it.
 */
export const useTimingTowerSettings = (): TimingTowerConfig => {
  const { currentDashboard } = useDashboard();

  const saved = currentDashboard?.widgets.find(
    (widget) => (widget.type ?? widget.id) === 'timingtower'
  )?.config;

  return useMemo(() => completeTimingTowerConfig(saved), [saved]);
};
