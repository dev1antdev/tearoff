import {
  DEFAULT_FLAG_TUNING,
  type DashboardLayout,
  type FlagProcessorTuning,
} from '@irdashies/types';
import { getCurrentProfileId, getDashboard } from './dashboards';
import { onDashboardUpdated } from './dashboardEvents';

/** No track is long enough for a yellow further away than this to matter. */
const MAX_RANGE_M = 2000;

const rangeOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= MAX_RANGE_M
    ? value
    : fallback;

/**
 * The yellow settings the flag processor ranks with, from the `flagpanel`
 * widget of a dashboard.
 *
 * The saved dashboard is untrusted (hand-edited, imported), and a range that
 * is not a number would make every yellow the player's or none of them, so
 * anything that is not a sane distance falls back to the default.
 */
export const flagTuningOf = (
  dashboard: DashboardLayout | null | undefined
): FlagProcessorTuning => {
  const saved: unknown = dashboard?.widgets.find(
    (widget) => (widget.type ?? widget.id) === 'flagpanel'
  )?.config?.yellow;
  if (!saved || typeof saved !== 'object') return { ...DEFAULT_FLAG_TUNING };
  const yellow = saved as Record<string, unknown>;
  return {
    yellowRangeAheadM: rangeOr(
      yellow.rangeAhead,
      DEFAULT_FLAG_TUNING.yellowRangeAheadM
    ),
    yellowRangeBehindM: rangeOr(
      yellow.rangeBehind,
      DEFAULT_FLAG_TUNING.yellowRangeBehindM
    ),
    yellowInOwnSector:
      typeof yellow.nameSector === 'boolean'
        ? yellow.nameSector
        : DEFAULT_FLAG_TUNING.yellowInOwnSector,
  };
};

let cached: FlagProcessorTuning | null = null;

/**
 * The flag panel's yellow settings from the current dashboard. Read on every
 * tick that has a yellow out, so it is cached and refreshed whenever a
 * dashboard is saved or switched.
 */
export const getFlagTuning = (): FlagProcessorTuning => {
  if (!cached) {
    cached = flagTuningOf(getDashboard(getCurrentProfileId()));
    onDashboardUpdated((dashboard) => {
      cached = flagTuningOf(dashboard);
    });
  }
  return cached;
};
