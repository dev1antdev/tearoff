import { useMemo } from 'react';
import { useDashboard } from '@irdashies/context';
import { getWidgetDefaultConfig, type TimingConfig } from '@irdashies/types';

const DEFAULTS = getWidgetDefaultConfig('timing');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The saved value when it is one the widget knows, the default otherwise. */
const oneOf = <T>(value: unknown, known: readonly T[], fallback: T): T =>
  known.includes(value as T) ? (value as T) : fallback;

/** A saved number held inside its limits; the default when it is not one. */
const within = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;

/** Every tile switch as a boolean, whatever the saved config holds. */
const tileSwitches = (saved: unknown): TimingConfig['tiles'] => {
  const source = isRecord(saved) ? saved : {};
  return Object.fromEntries(
    Object.entries(DEFAULTS.tiles).map(([tile, fallback]) => [
      tile,
      typeof source[tile] === 'boolean' ? source[tile] : fallback,
    ])
  ) as TimingConfig['tiles'];
};

/**
 * Turns whatever a dashboard holds for the widget into complete settings.
 *
 * Dashboards are filled in from the manifest when they load, so a saved
 * config normally has every field. Each one is checked here as well, because
 * a widget that threw on a config saved by an older build, or edited by hand,
 * would take the whole overlay window with it.
 */
export const resolveTimingSettings = (saved: unknown): TimingConfig => {
  if (!isRecord(saved)) return DEFAULTS;
  const background = isRecord(saved.background) ? saved.background : {};
  return {
    background: {
      opacity: within(background.opacity, 0, 100, DEFAULTS.background.opacity),
    },
    tiles: tileSwitches(saved.tiles),
    // All four are kept: a reference the delta channel does not carry yet
    // reads dashes in the widget rather than being swapped for another.
    deltaReference: oneOf(
      saved.deltaReference,
      ['sessionBest', 'allTime', 'stintBest', 'lastLap'],
      DEFAULTS.deltaReference
    ),
    deltaDecimals: oneOf(saved.deltaDecimals, [2, 3], DEFAULTS.deltaDecimals),
    lapTimeDecimals: oneOf(
      saved.lapTimeDecimals,
      [1, 2, 3],
      DEFAULTS.lapTimeDecimals
    ),
    sectorDecimals: oneOf(
      saved.sectorDecimals,
      [1, 2, 3],
      DEFAULTS.sectorDecimals
    ),
    sectorSource: oneOf(
      saved.sectorSource,
      ['live', 'liveOnly', 'best'],
      DEFAULTS.sectorSource
    ),
    sectorIncidents: oneOf(
      saved.sectorIncidents,
      ['mark', 'drop'],
      DEFAULTS.sectorIncidents
    ),
    sectorTilesMax: Math.round(
      within(saved.sectorTilesMax, 3, 8, DEFAULTS.sectorTilesMax)
    ),
    sessionBestScope: oneOf(
      saved.sessionBestScope,
      ['class', 'overall'],
      DEFAULTS.sessionBestScope
    ),
    scale: within(saved.scale, 50, 200, DEFAULTS.scale),
    showOnlyWhenOnTrack:
      typeof saved.showOnlyWhenOnTrack === 'boolean'
        ? saved.showOnlyWhenOnTrack
        : DEFAULTS.showOnlyWhenOnTrack,
    sessionVisibility: {
      ...DEFAULTS.sessionVisibility,
      ...(isRecord(saved.sessionVisibility)
        ? (saved.sessionVisibility as Partial<
            TimingConfig['sessionVisibility']
          >)
        : {}),
    },
  };
};

/** The timing panel's settings, complete. */
export const useTimingSettings = (): TimingConfig => {
  const { currentDashboard } = useDashboard();

  const saved = currentDashboard?.widgets.find(
    (widget) => widget.id === 'timing'
  )?.config;

  return useMemo(() => resolveTimingSettings(saved), [saved]);
};
