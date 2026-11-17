import {
  DEFAULT_CLASS_TYRES_TUNING,
  TYRE_CHANGE_SECONDS_MAX,
  type ClassTyresTuning,
  type DashboardLayout,
} from '@irdashies/types';
import { getCurrentProfileId, getDashboard } from './dashboards';
import { onDashboardUpdated } from './dashboardEvents';

/**
 * How long four tyres take to change, from the `timingtower` widget of a
 * dashboard. One figure serves every table that shows a set's age, so it
 * is kept in one place: the tower's Tyres column.
 *
 * The saved dashboard is untrusted (hand-edited, imported). A figure that
 * is not a sane number of seconds would have every stop read as a change of
 * tyres or none, so it falls back to the default, which leaves the figure
 * to the sim.
 */
export const classTyresTuningOf = (
  dashboard: DashboardLayout | null | undefined
): ClassTyresTuning => {
  const tyres: unknown = dashboard?.widgets.find(
    (widget) => (widget.type ?? widget.id) === 'timingtower'
  )?.config?.tyres;
  const seconds =
    tyres && typeof tyres === 'object'
      ? (tyres as Record<string, unknown>).changeSeconds
      : undefined;
  return {
    tyreChangeSeconds:
      typeof seconds === 'number' &&
      Number.isFinite(seconds) &&
      seconds >= 0 &&
      seconds <= TYRE_CHANGE_SECONDS_MAX
        ? seconds
        : DEFAULT_CLASS_TYRES_TUNING.tyreChangeSeconds,
  };
};

let cached: ClassTyresTuning | null = null;

/**
 * The setting from the current dashboard. Read once a second while a race
 * is recorded, so it is cached and refreshed whenever a dashboard is saved
 * or switched.
 */
export const getClassTyresTuning = (): ClassTyresTuning => {
  if (!cached) {
    cached = classTyresTuningOf(getDashboard(getCurrentProfileId()));
    onDashboardUpdated((dashboard) => {
      cached = classTyresTuningOf(dashboard);
    });
  }
  return cached;
};
