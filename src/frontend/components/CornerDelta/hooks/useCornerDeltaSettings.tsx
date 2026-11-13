import { useMemo } from 'react';
import { useDashboard } from '@irdashies/context';
import {
  getWidgetDefaultConfig,
  type CornerDeltaConfig,
} from '@irdashies/types';

const DEFAULTS = getWidgetDefaultConfig('cornerdelta');

/** The most earlier corners the widget lists, whatever the config says. */
export const MAX_CORNER_HISTORY = 4;

const REFERENCES: readonly CornerDeltaConfig['reference'][] = [
  'allTime',
  'sessionBest',
  'lastLap',
];

const SPEED_UNITS: readonly CornerDeltaConfig['speedUnit'][] = [
  'auto',
  'km/h',
  'mph',
];

/**
 * The corner delta widget's settings, complete.
 *
 * Dashboards are filled in from the manifest when they load, so a saved
 * config normally has every field. The nested groups are merged here as well,
 * and anything but a known value falls back to the default, because a widget
 * that threw on a hand-edited config, or one saved by an older build, would
 * take the whole overlay window with it.
 */
export const useCornerDeltaSettings = (): CornerDeltaConfig => {
  const { currentDashboard } = useDashboard();

  const saved = currentDashboard?.widgets.find(
    (widget) => widget.id === 'cornerdelta'
  )?.config as Partial<CornerDeltaConfig> | undefined;

  return useMemo(() => {
    if (!saved || typeof saved !== 'object') return DEFAULTS;
    const historyCount = Number(saved.historyCount);
    return {
      ...DEFAULTS,
      ...saved,
      reference:
        saved.reference && REFERENCES.includes(saved.reference)
          ? saved.reference
          : DEFAULTS.reference,
      cornerLabel: saved.cornerLabel === 'number' ? 'number' : 'name',
      decimals: saved.decimals === 3 ? 3 : 2,
      speedUnit:
        saved.speedUnit && SPEED_UNITS.includes(saved.speedUnit)
          ? saved.speedUnit
          : DEFAULTS.speedUnit,
      historyCount: Number.isFinite(historyCount)
        ? Math.min(Math.max(Math.round(historyCount), 0), MAX_CORNER_HISTORY)
        : DEFAULTS.historyCount,
      background: { ...DEFAULTS.background, ...saved.background },
      sessionVisibility: {
        ...DEFAULTS.sessionVisibility,
        ...saved.sessionVisibility,
      },
    };
  }, [saved]);
};
