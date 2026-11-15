import { useMemo } from 'react';
import { useDashboard } from '@irdashies/context';
import { getWidgetDefaultConfig, type ChassisConfig } from '@irdashies/types';

const DEFAULTS = getWidgetDefaultConfig('chassis');

/** A length to divide by: anything but a positive number is the default. */
const positive = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;

/** A threshold: anything but a number is the default. */
const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * The chassis widget's settings, complete.
 *
 * Dashboards are filled in from the manifest when they load, so a saved
 * config normally has every field. The nested groups are merged here as well,
 * and the lengths the angles are divided by fall back to their defaults when
 * they are not positive numbers, because a widget that threw or drew "NaN" on
 * a hand-edited config would take the whole overlay window with it.
 */
export const useChassisSettings = (): ChassisConfig => {
  const { currentDashboard } = useDashboard();

  const saved = currentDashboard?.widgets.find(
    (widget) => widget.id === 'chassis'
  )?.config as Partial<ChassisConfig> | undefined;

  return useMemo(() => {
    if (!saved || typeof saved !== 'object') return DEFAULTS;
    return {
      ...DEFAULTS,
      ...saved,
      rideHeightScale: positive(
        saved.rideHeightScale,
        DEFAULTS.rideHeightScale
      ),
      bottomingFront: finite(saved.bottomingFront, DEFAULTS.bottomingFront),
      bottomingRear: finite(saved.bottomingRear, DEFAULTS.bottomingRear),
      wheelbase: positive(saved.wheelbase, DEFAULTS.wheelbase),
      trackFront: positive(saved.trackFront, DEFAULTS.trackFront),
      trackRear: positive(saved.trackRear, DEFAULTS.trackRear),
      toeDisplay: saved.toeDisplay === 'wheel' ? 'wheel' : 'axle',
      background: { ...DEFAULTS.background, ...saved.background },
      sessionVisibility: {
        ...DEFAULTS.sessionVisibility,
        ...saved.sessionVisibility,
      },
    };
  }, [saved]);
};
