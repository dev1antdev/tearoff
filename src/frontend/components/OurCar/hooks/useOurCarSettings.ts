import { useMemo } from 'react';
import { useDashboard } from '@irdashies/context';
import { getWidgetDefaultConfig, type OurCarConfig } from '@irdashies/types';

const DEFAULTS = getWidgetDefaultConfig('ourcar');

/**
 * Our Car's settings, complete.
 *
 * Dashboards are filled in from the manifest when they load, so a saved
 * config normally has every field. The nested groups are merged here as well
 * because a widget that crashed on a config saved by an older build would
 * take the whole window with it.
 */
export const useOurCarSettings = (): OurCarConfig => {
  const { currentDashboard } = useDashboard();

  const saved = currentDashboard?.widgets.find(
    (widget) => (widget.type ?? widget.id) === 'ourcar'
  )?.config as Partial<OurCarConfig> | undefined;

  return useMemo(() => {
    if (!saved || typeof saved !== 'object') return DEFAULTS;
    return {
      ...DEFAULTS,
      ...saved,
      background: { ...DEFAULTS.background, ...saved.background },
      sessionVisibility: {
        ...DEFAULTS.sessionVisibility,
        ...saved.sessionVisibility,
      },
    };
  }, [saved]);
};
