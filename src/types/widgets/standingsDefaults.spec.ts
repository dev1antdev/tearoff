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

describe.each(['standings', 'relative'] as const)(
  'the Avg 5 and Avg 10 columns: %s',
  (id) => {
    const NEW_COLUMNS = ['avgLast5', 'avgLast10'];
    const NEW_KEYS = [...NEW_COLUMNS, 'averagesOver'];

    const mergedConfig = (saved: unknown) =>
      deepMergeConfig(
        getWidgetDefaultConfig(id) as unknown as Record<string, unknown>,
        saved
      );
    const without = (config: Record<string, unknown>, keys: string[]) =>
      Object.fromEntries(
        Object.entries(config).filter(([key]) => !keys.includes(key))
      );
    const order = (config: Record<string, unknown>) =>
      config.displayOrder as string[];

    /**
     * The widget's config as a build from before the two columns wrote it:
     * everything it has now but them, at the defaults.
     */
    const olderDefaults = (): Record<string, unknown> => {
      const now = structuredClone(
        getWidgetDefaultConfig(id)
      ) as unknown as Record<string, unknown>;
      return {
        ...without(now, NEW_KEYS),
        displayOrder: order(now).filter((name) => !NEW_COLUMNS.includes(name)),
      };
    };

    it('are off on a new dashboard, over clean laps, in the Last and Best format', () => {
      const defaults = getWidgetDefaultConfig(id);

      expect(defaults.avgLast5).toEqual({ enabled: false, timeFormat: 'full' });
      expect(defaults.avgLast10).toEqual({
        enabled: false,
        timeFormat: 'full',
      });
      expect(defaults.averagesOver).toBe('clean');
      expect(defaults.avgLast5.timeFormat).toBe(defaults.lastTime.timeFormat);
      expect(defaults.avgLast5.timeFormat).toBe(
        defaults.fastestTime.timeFormat
      );
    });

    it('sit after the rolling average on a new dashboard', () => {
      const names = getWidgetDefaultConfig(id).displayOrder;
      const rolling = names.indexOf('avgLapTime');

      expect(rolling).toBeGreaterThan(-1);
      expect(names.slice(rolling + 1, rolling + 3)).toEqual(NEW_COLUMNS);
    });

    it('arrive in a dashboard saved before them and change nothing it holds', () => {
      // Moved well off the defaults: switches flipped, formats changed, the
      // columns reordered and one of them dropped from the order.
      const older = olderDefaults();
      const saved = {
        ...older,
        background: { opacity: 35 },
        lastTime: { enabled: false, timeFormat: 'mixed', markInvalid: false },
        fastestTime: { enabled: true, timeFormat: 'seconds-full' },
        avgLapTime: {
          enabled: true,
          numLaps: 8,
          timeFormat: 'full',
          excludePitLaps: true,
        },
        compound: { enabled: false },
        showOnlyWhenOnTrack: true,
        displayOrder: [
          'pushToPass',
          ...order(older)
            .filter((name) => name !== 'pushToPass' && name !== 'compound')
            .reverse(),
        ],
      };
      const before = structuredClone(saved);

      const merged = mergedConfig(saved);

      // Every value the dashboard held, as it held it.
      expect(without(merged, [...NEW_KEYS, 'displayOrder'])).toEqual(
        without(before, ['displayOrder'])
      );
      // Its columns in its own order, nothing lost and nothing moved, with
      // the two new ones added once each. The column it had dropped comes
      // back as it always did: that is how any missing column is treated.
      expect(
        order(merged).filter(
          (name) => !NEW_COLUMNS.includes(name) && name !== 'compound'
        )
      ).toEqual(before.displayOrder);
      for (const name of NEW_COLUMNS) {
        expect(order(merged).filter((entry) => entry === name)).toHaveLength(1);
      }
      // And the new ones as a new dashboard has them: off.
      expect(merged.avgLast5).toEqual({ enabled: false, timeFormat: 'full' });
      expect(merged.avgLast10).toEqual({ enabled: false, timeFormat: 'full' });
      expect(merged.averagesOver).toBe('clean');
      // The saved object itself is not written to.
      expect(saved).toEqual(before);
    });

    it('land beside the rolling average in an order that was never changed', () => {
      const merged = mergedConfig(olderDefaults());

      expect(order(merged)).toEqual(getWidgetDefaultConfig(id).displayOrder);
    });

    it('keep what was chosen for them from then on', () => {
      const chosen = {
        ...mergedConfig(olderDefaults()),
        avgLast5: { enabled: true, timeFormat: 'mixed' },
        avgLast10: { enabled: true, timeFormat: 'seconds-full' },
        averagesOver: 'all',
        displayOrder: ['position', 'avgLast10', 'driverName', 'avgLast5'],
      };

      const merged = mergedConfig(chosen);

      expect(merged.avgLast5).toEqual({ enabled: true, timeFormat: 'mixed' });
      expect(merged.avgLast10).toEqual({
        enabled: true,
        timeFormat: 'seconds-full',
      });
      expect(merged.averagesOver).toBe('all');
      // The four it named keep its order, Avg 10 ahead of Avg 5; the columns
      // it left out are filled in around them.
      expect(
        order(merged).filter((name) => chosen.displayOrder.includes(name))
      ).toEqual(chosen.displayOrder);
      // Loading it again changes nothing.
      expect(mergedConfig(merged)).toEqual(merged);
    });

    it('fill in a format for a column stored with its switch alone', () => {
      const merged = mergedConfig({
        ...olderDefaults(),
        avgLast5: { enabled: true },
      });

      expect(merged.avgLast5).toEqual({ enabled: true, timeFormat: 'full' });
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
