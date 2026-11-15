import { useMemo } from 'react';
import { useDashboard } from '@irdashies/context';
import {
  getWidgetDefaultConfig,
  type CruiseCellId,
  type CruiseConfig,
  type CruiseScope,
} from '@irdashies/types';

const DEFAULTS = getWidgetDefaultConfig('cruise');

export const CRUISE_CELLS: readonly CruiseCellId[] = [
  'compass',
  'elevation',
  'odometer',
  'timeOnTrack',
  'lapDistance',
];

const isCell = (value: unknown): value is CruiseCellId =>
  CRUISE_CELLS.includes(value as CruiseCellId);

/** The saved order, each cell once: what is unknown dropped, what is missing added. */
export const cruiseCellOrder = (saved: unknown): CruiseCellId[] => {
  const known = Array.isArray(saved)
    ? saved.filter(isCell).filter((id, index, all) => all.indexOf(id) === index)
    : [];
  return [...known, ...CRUISE_CELLS.filter((id) => !known.includes(id))];
};

const scopeOf = (value: unknown): CruiseScope =>
  value === 'session' ? 'session' : 'allTime';

export interface CruiseSettings extends CruiseConfig {
  /** `displayOrder` as cells, complete. */
  cells: readonly CruiseCellId[];
}

/**
 * The cruise block's settings, complete.
 *
 * Dashboards are filled in from the manifest when they load, so a saved
 * config normally has every field. The order and the choices are held to
 * what the widget knows here as well: a cell saved under another name would
 * otherwise be a hole in the grid.
 */
export const useCruiseSettings = (): CruiseSettings => {
  const { currentDashboard } = useDashboard();

  const saved = currentDashboard?.widgets.find(
    (widget) => widget.id === 'cruise'
  )?.config as Partial<CruiseConfig> | undefined;

  return useMemo(() => {
    const config = saved && typeof saved === 'object' ? saved : {};
    const cells = cruiseCellOrder(config.displayOrder ?? DEFAULTS.displayOrder);
    return {
      ...DEFAULTS,
      ...config,
      layout: config.layout === 'row' ? 'row' : 'grid',
      units:
        config.units === 'Metric' || config.units === 'Imperial'
          ? config.units
          : 'auto',
      displayOrder: cells,
      cells,
      compass: { ...DEFAULTS.compass, ...config.compass },
      elevation: { ...DEFAULTS.elevation, ...config.elevation },
      odometer: {
        ...DEFAULTS.odometer,
        ...config.odometer,
        scope: scopeOf(config.odometer?.scope),
      },
      timeOnTrack: {
        ...DEFAULTS.timeOnTrack,
        ...config.timeOnTrack,
        scope: scopeOf(config.timeOnTrack?.scope),
      },
      lapDistance: { ...DEFAULTS.lapDistance, ...config.lapDistance },
      background: { ...DEFAULTS.background, ...config.background },
      sessionVisibility: {
        ...DEFAULTS.sessionVisibility,
        ...config.sessionVisibility,
      },
    };
  }, [saved]);
};
