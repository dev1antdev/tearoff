import { useMemo } from 'react';
import { useDashboard } from '@irdashies/context';
import { getWidgetDefaultConfig, type LapDeltaConfig } from '@irdashies/types';

const DEFAULTS = getWidgetDefaultConfig('lapdelta');

/**
 * The lap delta widget's settings, complete.
 *
 * Dashboards are filled in from the manifest when they load, so a saved
 * config normally has every field. The nested groups are merged here as well,
 * because a widget that threw on a config saved by an older build would take
 * the whole overlay window with it.
 */
export const useLapDeltaSettings = (): LapDeltaConfig => {
  const { currentDashboard } = useDashboard();

  const saved = currentDashboard?.widgets.find(
    (widget) => widget.id === 'lapdelta'
  )?.config as Partial<LapDeltaConfig> | undefined;

  return useMemo(() => {
    if (!saved || typeof saved !== 'object') return DEFAULTS;
    return {
      ...DEFAULTS,
      ...saved,
      // Anything but the two known values falls back, so a hand-edited
      // config cannot ask the snapshot for a reference it does not carry.
      reference: saved.reference === 'allTime' ? 'allTime' : 'sessionBest',
      decimals: saved.decimals === 3 ? 3 : 2,
      background: { ...DEFAULTS.background, ...saved.background },
      sessionVisibility: {
        ...DEFAULTS.sessionVisibility,
        ...saved.sessionVisibility,
      },
    };
  }, [saved]);
};
