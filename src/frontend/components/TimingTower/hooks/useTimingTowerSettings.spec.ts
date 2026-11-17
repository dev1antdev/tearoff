import { describe, expect, it } from 'vitest';
import { getWidgetDefaultConfig } from '@irdashies/types';
import { completeTimingTowerConfig } from './useTimingTowerSettings';

const DEFAULTS = getWidgetDefaultConfig('timingtower');

describe('completeTimingTowerConfig', () => {
  it('is the defaults for anything that is not a config', () => {
    expect(completeTimingTowerConfig(undefined)).toEqual(DEFAULTS);
    expect(completeTimingTowerConfig(null)).toEqual(DEFAULTS);
    expect(completeTimingTowerConfig('tower')).toEqual(DEFAULTS);
    expect(completeTimingTowerConfig([])).toEqual(DEFAULTS);
  });

  it('keeps what was saved', () => {
    const saved = {
      ...DEFAULTS,
      averagesOver: 'all',
      paceAgainst: 'driver',
      background: { opacity: 40 },
      gap: { enabled: false },
      driver: {
        enabled: true,
        nameFormat: 'surname',
        team: false,
        status: false,
      },
      showOnlyWhenOnTrack: true,
    };

    expect(completeTimingTowerConfig(saved)).toEqual(saved);
  });

  it('fills in a column a build before it did not save', () => {
    const saved: Record<string, unknown> = { ...DEFAULTS };
    delete saved.stintPace;
    delete saved.sectors;

    const config = completeTimingTowerConfig(saved);

    expect(config.stintPace).toEqual({ enabled: true });
    expect(config.sectors).toEqual({ enabled: true });
  });

  it('gives a Tyres column saved before the laps on a set their defaults', () => {
    // All a build before them stored of the column: its switch.
    const config = completeTimingTowerConfig({
      ...DEFAULTS,
      tyres: { enabled: false },
    });

    expect(config.tyres).toEqual({
      enabled: false,
      set: true,
      changeSeconds: 0,
    });
  });

  it('fills in the part of a group that is missing, and keeps the rest of it', () => {
    const config = completeTimingTowerConfig({
      ...DEFAULTS,
      driver: { enabled: true, team: false },
    });

    expect(config.driver).toEqual({
      enabled: true,
      nameFormat: DEFAULTS.driver.nameFormat,
      team: false,
      status: true,
    });
  });

  it('takes the default for an entry of the wrong kind', () => {
    const config = completeTimingTowerConfig({
      ...DEFAULTS,
      gap: null,
      interval: 'on',
      background: 80,
      averagesOver: 5,
      showOnlyWhenOnTrack: 'yes',
    });

    expect(config.gap).toEqual(DEFAULTS.gap);
    expect(config.interval).toEqual(DEFAULTS.interval);
    expect(config.background).toEqual(DEFAULTS.background);
    expect(config.averagesOver).toBe(DEFAULTS.averagesOver);
    expect(config.showOnlyWhenOnTrack).toBe(false);
  });

  it('leaves the defaults themselves as they were', () => {
    const before = structuredClone(DEFAULTS);

    completeTimingTowerConfig({ gap: { enabled: false } });

    expect(getWidgetDefaultConfig('timingtower')).toEqual(before);
  });
});
