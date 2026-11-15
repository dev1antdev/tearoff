import { describe, expect, it } from 'vitest';
import { deepMergeConfig, getWidgetDefaultConfig } from '../defaultDashboard';
import {
  IRACING_DISABLED_WIDGETS,
  LMU_DISABLED_WIDGETS,
  LMU_SUPPORTED_WIDGETS,
} from '../simWidgetSupport';

const merged = (id: 'standings' | 'relative' | 'battle', saved: unknown) =>
  deepMergeConfig(
    getWidgetDefaultConfig(id) as unknown as Record<string, unknown>,
    saved
  ) as {
    interval?: Record<string, unknown>;
    lastTime: Record<string, unknown>;
  };

describe('standings interval display', () => {
  it('shows a lapped car in laps on a new dashboard', () => {
    expect(getWidgetDefaultConfig('standings').interval.displayMode).toBe(
      'laps'
    );
    // Nothing saved at all: the defaults as they stand.
    expect(merged('standings', undefined).interval?.displayMode).toBe('laps');
  });

  it('keeps a dashboard that stores Time on Time', () => {
    const saved = {
      interval: { enabled: true, decimalPlaces: 2, displayMode: 'time' },
    };

    expect(merged('standings', saved).interval).toEqual({
      enabled: true,
      decimalPlaces: 2,
      displayMode: 'time',
    });
  });

  it('keeps a dashboard that stores Laps on Laps', () => {
    const saved = { interval: { enabled: true, displayMode: 'laps' } };

    expect(merged('standings', saved).interval?.displayMode).toBe('laps');
  });

  it('gives laps to a dashboard saved before the option existed', () => {
    // No stored choice to respect: the field is missing, so it is filled.
    const saved = { interval: { enabled: true } };

    expect(merged('standings', saved).interval).toMatchObject({
      enabled: true,
      displayMode: 'laps',
    });
  });
});

describe.each(['standings', 'relative', 'battle'] as const)(
  'the mark on a lap that did not count: %s',
  (id) => {
    it('is on by default', () => {
      expect(getWidgetDefaultConfig(id).lastTime.markInvalid).toBe(true);
    });

    it('is switched on for a dashboard saved before it existed', () => {
      const saved = { lastTime: { enabled: true, timeFormat: 'mixed' } };

      expect(merged(id, saved).lastTime).toEqual({
        enabled: true,
        timeFormat: 'mixed',
        markInvalid: true,
      });
    });

    it('stays off where it was switched off', () => {
      const saved = {
        lastTime: { enabled: true, timeFormat: 'full', markInvalid: false },
      };

      expect(merged(id, saved).lastTime.markInvalid).toBe(false);
    });
  }
);

describe('class fields widget', () => {
  it('ships with the defaults of its settings table', () => {
    expect(getWidgetDefaultConfig('classfields')).toEqual({
      background: { opacity: 80 },
      orientation: 'horizontal',
      maxClasses: 5,
      order: 'leaderPosition',
      showTotal: true,
      showInactive: false,
      showInPitLane: false,
      highlightOwnClass: true,
      showOnlyWhenOnTrack: false,
      sessionVisibility: {
        race: true,
        loneQualify: true,
        openQualify: true,
        practice: true,
        offlineTesting: true,
      },
    });
  });

  it('is available under both sims', () => {
    expect(LMU_SUPPORTED_WIDGETS).toContain('classfields');
    expect(LMU_DISABLED_WIDGETS).not.toContain('classfields');
    expect(IRACING_DISABLED_WIDGETS).not.toContain('classfields');
  });
});
