/**
 * Distance and height unit conversion.
 *
 * Snapshots carry metres. The driver's preference comes from the sim's
 * DisplayUnits (0 = imperial, 1 = metric) unless a widget's own setting
 * names a unit.
 */
import { DISPLAY_UNITS_METRIC } from './speed';

export const METRES_TO_FEET = 3.28084;
export const METRES_PER_KILOMETRE = 1000;
export const METRES_PER_MILE = 1609.344;

/** A widget's unit choice: the sim's own, or one named in either spelling. */
export type DistanceUnitSetting = 'auto' | 'm' | 'ft' | 'Metric' | 'Imperial';

/**
 * Whether to draw metres and kilometres, resolving 'auto' against the sim's
 * own setting. Telemetry not yet in falls back to metric, as speed does.
 */
export const isMetricDistance = (
  setting: DistanceUnitSetting,
  displayUnits: number | undefined
): boolean => {
  if (setting === 'm' || setting === 'Metric') return true;
  if (setting === 'ft' || setting === 'Imperial') return false;
  return displayUnits === undefined || displayUnits === DISPLAY_UNITS_METRIC;
};
