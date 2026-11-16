import {
  DEFAULT_WEAR_TUNING,
  type BrakeLimitStore,
  type DashboardLayout,
  type WearForecastTuning,
} from '@irdashies/types';
import { getCurrentProfileId, getDashboard } from './dashboards';
import { onDashboardUpdated } from './dashboardEvents';
import { getTrackCarStore } from './trackCarStore';

/** No tyre is finished with more tread than this, percent. */
const MAX_FLOOR_PCT = 60;
/** No disc is thicker than this, millimetres. */
const MAX_FAILURE_MM = 60;

const within = (value: unknown, max: number, fallback: number): number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= max
    ? value
    : fallback;

const group = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

/**
 * Where a tyre and a brake disc are finished, from the `wear` widget of a
 * dashboard.
 *
 * The saved dashboard is untrusted (hand-edited, imported), and a floor that
 * is not a number would leave every forecast without one, so anything that
 * is not a sane figure falls back to the default.
 */
export const wearTuningOf = (
  dashboard: DashboardLayout | null | undefined
): WearForecastTuning => {
  const config = group(
    dashboard?.widgets.find((widget) => (widget.type ?? widget.id) === 'wear')
      ?.config
  );
  const tyres = group(config.tyres);
  const brakes = group(config.brakes);
  return {
    floorPct: within(
      tyres.floorPct,
      MAX_FLOOR_PCT,
      DEFAULT_WEAR_TUNING.floorPct
    ),
    failureFrontMm: within(
      brakes.failureFrontMm,
      MAX_FAILURE_MM,
      DEFAULT_WEAR_TUNING.failureFrontMm
    ),
    failureRearMm: within(
      brakes.failureRearMm,
      MAX_FAILURE_MM,
      DEFAULT_WEAR_TUNING.failureRearMm
    ),
  };
};

let cached: WearForecastTuning | null = null;

/**
 * The wear widget's end-of-life settings from the current dashboard. Read
 * each time the forecast is rebuilt, so it is cached and refreshed whenever
 * a dashboard is saved or switched.
 */
export const getWearTuning = (): WearForecastTuning => {
  if (!cached) {
    cached = wearTuningOf(getDashboard(getCurrentProfileId()));
    onDashboardUpdated((dashboard) => {
      cached = wearTuningOf(dashboard);
    });
  }
  return cached;
};

/**
 * Failure thicknesses learned from brakes that failed, kept per car and
 * axle in the installation's track-and-car store.
 */
export const brakeLimitStore: BrakeLimitStore = {
  get: (key) => {
    const value = getTrackCarStore().get<unknown>('brakeLimits', key);
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined;
  },
  set: (key, mm) => getTrackCarStore().set('brakeLimits', key, mm),
};
