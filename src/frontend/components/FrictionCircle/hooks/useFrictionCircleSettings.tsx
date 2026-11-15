import { useMemo } from 'react';
import { useDashboard } from '@irdashies/context';
import {
  getWidgetDefaultConfig,
  type FrictionCircleConfig,
} from '@irdashies/types';

const DEFAULTS = getWidgetDefaultConfig('frictioncircle');

const SCALE_MIN = 1;
const SCALE_MAX = 6;
const TRACE_MIN = 1;
const TRACE_MAX = 10;

const within = (
  value: unknown,
  min: number,
  max: number,
  fallback: number
): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(Math.max(value, min), max)
    : fallback;

/**
 * The friction circle's settings, complete.
 *
 * Dashboards are filled in from the manifest when they load, so a saved
 * config normally has every field. The two numbers are held to their limits
 * here as well: a scale of 0 saved by hand would divide every reading by it.
 */
export const useFrictionCircleSettings = (): FrictionCircleConfig => {
  const { currentDashboard } = useDashboard();

  const saved = currentDashboard?.widgets.find(
    (widget) => widget.id === 'frictioncircle'
  )?.config as Partial<FrictionCircleConfig> | undefined;

  return useMemo(() => {
    if (!saved || typeof saved !== 'object') return DEFAULTS;
    return {
      ...DEFAULTS,
      ...saved,
      scaleG: within(saved.scaleG, SCALE_MIN, SCALE_MAX, DEFAULTS.scaleG),
      traceSeconds: within(
        saved.traceSeconds,
        TRACE_MIN,
        TRACE_MAX,
        DEFAULTS.traceSeconds
      ),
      orientation:
        saved.orientation === 'acceleration' ? 'acceleration' : 'force',
      background: { ...DEFAULTS.background, ...saved.background },
      sessionVisibility: {
        ...DEFAULTS.sessionVisibility,
        ...saved.sessionVisibility,
      },
    };
  }, [saved]);
};
