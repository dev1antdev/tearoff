import { useMemo } from 'react';
import { useDashboard } from '@irdashies/context';
import {
  CREW_DRIVE_TIME_MAX_MINUTES,
  getWidgetDefaultConfig,
  type CrewConfig,
} from '@irdashies/types';

const DEFAULTS = getWidgetDefaultConfig('crew');

/** A number of minutes fit to use, or the default where the saved one is not. */
const minutes = (value: unknown, least: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(Math.max(Math.round(value), least), CREW_DRIVE_TIME_MAX_MINUTES)
    : fallback;

/**
 * The saved config over the defaults, with the two limits made fit to use:
 * a widget that crashed on a config saved by an older build or edited by
 * hand would take the whole window with it.
 */
export const completeCrewConfig = (saved: unknown): CrewConfig => {
  if (!saved || typeof saved !== 'object') return DEFAULTS;
  const config = saved as Partial<CrewConfig>;
  const driveTime: Partial<CrewConfig['driveTime']> =
    config.driveTime && typeof config.driveTime === 'object'
      ? config.driveTime
      : {};
  return {
    ...DEFAULTS,
    ...config,
    background: { ...DEFAULTS.background, ...config.background },
    driveTime: {
      enabled: driveTime.enabled === true,
      // A maximum of nothing would divide by it.
      maxMinutes: minutes(
        driveTime.maxMinutes,
        1,
        DEFAULTS.driveTime.maxMinutes
      ),
      minMinutes: minutes(
        driveTime.minMinutes,
        0,
        DEFAULTS.driveTime.minMinutes
      ),
    },
    sessionVisibility: {
      ...DEFAULTS.sessionVisibility,
      ...config.sessionVisibility,
    },
  };
};

/** Crew and Stints' settings, complete. */
export const useCrewSettings = (): CrewConfig => {
  const { currentDashboard } = useDashboard();

  const saved = currentDashboard?.widgets.find(
    (widget) => (widget.type ?? widget.id) === 'crew'
  )?.config;

  return useMemo(() => completeCrewConfig(saved), [saved]);
};
