import { useMemo } from 'react';
import { useDashboard } from '@irdashies/context';
import {
  getWidgetDefaultConfig,
  type TrackNotesConfig,
} from '@irdashies/types';

const DEFAULTS = getWidgetDefaultConfig('tracknotes');

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
 * The track notes widget's settings, complete.
 *
 * Dashboards are filled in from the manifest when they load, so a saved
 * config normally has every field. The three numbers are held to their
 * limits here as well: a lead saved by hand as text would otherwise move
 * every pace note to nowhere.
 */
export const useTrackNotesSettings = (): TrackNotesConfig => {
  const { currentDashboard } = useDashboard();

  const saved = currentDashboard?.widgets.find(
    (widget) => widget.id === 'tracknotes'
  )?.config as Partial<TrackNotesConfig> | undefined;

  return useMemo(() => {
    if (!saved || typeof saved !== 'object') return DEFAULTS;
    return {
      ...DEFAULTS,
      ...saved,
      paceLeadMeters: within(
        saved.paceLeadMeters,
        -500,
        500,
        DEFAULTS.paceLeadMeters
      ),
      paceLeadSeconds: within(
        saved.paceLeadSeconds,
        0,
        10,
        DEFAULTS.paceLeadSeconds
      ),
      displaySeconds: within(
        saved.displaySeconds,
        0,
        60,
        DEFAULTS.displaySeconds
      ),
      background: { ...DEFAULTS.background, ...saved.background },
      sessionVisibility: {
        ...DEFAULTS.sessionVisibility,
        ...saved.sessionVisibility,
      },
    };
  }, [saved]);
};
