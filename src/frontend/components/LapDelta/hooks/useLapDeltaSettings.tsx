import { useMemo } from 'react';
import { useDashboard } from '@irdashies/context';
import { getWidgetDefaultConfig, type LapDeltaConfig } from '@irdashies/types';
import { REFERENCE_KEYS } from '../lapDeltaDisplay';

const DEFAULTS = getWidgetDefaultConfig('lapdelta');

/** The longest the result of a lap is held after the line, in seconds. */
const MAX_FREEZE_SECONDS = 10;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Each of the strip's switches as a boolean, whatever was saved. */
const secondarySwitches = (saved: unknown): LapDeltaConfig['secondary'] => {
  const source = isRecord(saved) ? saved : {};
  return Object.fromEntries(
    REFERENCE_KEYS.map((key) => [
      key,
      typeof source[key] === 'boolean' ? source[key] : DEFAULTS.secondary[key],
    ])
  ) as LapDeltaConfig['secondary'];
};

/**
 * Turns whatever a dashboard holds for the widget into complete settings.
 *
 * Dashboards are filled in from the manifest when they load, so a saved
 * config normally has every field. The nested groups are merged here as well,
 * because a widget that threw on a config saved by an older build would take
 * the whole overlay window with it.
 */
export const resolveLapDeltaSettings = (saved: unknown): LapDeltaConfig => {
  if (!isRecord(saved)) return DEFAULTS;
  const config = saved as Partial<LapDeltaConfig>;
  return {
    ...DEFAULTS,
    ...config,
    // Anything but the known values falls back, so a hand-edited config
    // cannot ask the snapshot for a reference it does not carry.
    reference: REFERENCE_KEYS.includes(config.reference as never)
      ? (config.reference as LapDeltaConfig['reference'])
      : DEFAULTS.reference,
    secondary: secondarySwitches(config.secondary),
    freezeSeconds:
      typeof config.freezeSeconds === 'number' &&
      Number.isFinite(config.freezeSeconds)
        ? Math.min(MAX_FREEZE_SECONDS, Math.max(0, config.freezeSeconds))
        : DEFAULTS.freezeSeconds,
    decimals: config.decimals === 3 ? 3 : 2,
    background: { ...DEFAULTS.background, ...config.background },
    sessionVisibility: {
      ...DEFAULTS.sessionVisibility,
      ...config.sessionVisibility,
    },
  };
};

/** The lap delta widget's settings, complete. */
export const useLapDeltaSettings = (): LapDeltaConfig => {
  const { currentDashboard } = useDashboard();

  const saved = currentDashboard?.widgets.find(
    (widget) => widget.id === 'lapdelta'
  )?.config;

  return useMemo(() => resolveLapDeltaSettings(saved), [saved]);
};
