import { describe, expect, it } from 'vitest';
import { compareDumps, type TableDump } from './dbCompare.ts';
import {
  compareWidgets,
  isUserData,
  turnAutoStartOff,
  widgetsByProfile,
} from './profile.ts';

describe('isUserData', () => {
  it('takes the user’s files and folders', () => {
    for (const name of [
      'config.json',
      'simWidgetSupport.json',
      'laps.db',
      'laps.db-wal',
      'pitLaneData.json',
      'playerReferenceLaps.json',
      'track-profiles',
      'Local Storage',
    ]) {
      expect(isUserData(name)).toBe(true);
    }
  });

  it('leaves Chromium’s caches and the logs behind', () => {
    for (const name of [
      'Cache',
      'Code Cache',
      'GPUCache',
      'Network',
      'Session Storage',
      'DIPS-wal',
      'Local State',
      'logs',
      'DevToolsActivePort',
    ]) {
      expect(isUserData(name)).toBe(false);
    }
  });
});

const widget = (id: string, enabled: boolean, config: object = {}) => ({
  id,
  enabled,
  layout: { x: 0, y: 0, width: 10, height: 10 },
  config,
});

describe('turnAutoStartOff', () => {
  it('turns it off in every dashboard that had it on, and says so', () => {
    const config = {
      dashboards: {
        a: { widgets: [], generalSettings: { enableAutoStart: true } },
        b: { widgets: [], generalSettings: { enableAutoStart: false } },
        c: { widgets: [] },
      },
    };

    expect(turnAutoStartOff(config)).toBe(true);
    expect(config.dashboards.a.generalSettings.enableAutoStart).toBe(false);
    expect(turnAutoStartOff(config)).toBe(false);
  });
});

describe('compareWidgets', () => {
  const before = widgetsByProfile({
    dashboards: {
      default: {
        widgets: [
          widget('standings', true, { background: { opacity: 40 }, rows: 5 }),
          widget('fuel', false, { unit: 'L' }),
        ],
      },
    },
  });

  it('accepts a build that adds widgets and settings', () => {
    const after = widgetsByProfile({
      dashboards: {
        default: {
          widgets: [
            widget('standings', true, {
              background: { opacity: 40 },
              rows: 5,
              newSetting: true,
            }),
            widget('fuel', false, { unit: 'L' }),
            widget('chassis', false),
          ],
        },
      },
    });

    expect(compareWidgets(before, after)).toMatchObject({
      widgetsBefore: 2,
      widgetsAfter: 3,
      lost: [],
      gained: ['default/chassis'],
      enabledChanged: [],
      settingsChanged: [],
    });
  });

  it('reports a widget that is gone, a flipped switch and a changed value', () => {
    const after = widgetsByProfile({
      dashboards: {
        default: {
          widgets: [
            widget('standings', false, {
              background: { opacity: 80 },
              rows: 5,
            }),
          ],
        },
      },
    });
    const comparison = compareWidgets(before, after);

    expect(comparison.lost).toEqual(['default/fuel']);
    expect(comparison.enabledChanged).toEqual([
      'default/standings (on -> off)',
    ]);
    expect(comparison.settingsChanged).toEqual([
      'default/standings: background.opacity',
    ]);
  });

  it('reports a whole profile that is gone', () => {
    expect(compareWidgets(before, new Map()).lost).toEqual([
      'default/standings',
      'default/fuel',
    ]);
  });

  it('uses the id as the type of a widget that names none', () => {
    expect(before.get('default')?.[0]).toMatchObject({
      id: 'standings',
      type: 'standings',
    });
  });
});

describe('compareDumps', () => {
  const dump = (tables: Record<string, TableDump>) =>
    new Map(Object.entries(tables));
  const laps = { columns: ['id', 'lap_time'], rows: ['a', 'b', 'c'] };

  it('is equal for the same tables, columns and rows', () => {
    expect(
      compareDumps(dump({ lap: laps }), dump({ lap: { ...laps } }))
    ).toEqual({ equal: true, differences: [] });
  });

  it('names a missing table, a lost row and a changed row', () => {
    expect(
      compareDumps(
        dump({ lap: laps, session: { columns: ['id'], rows: ['s'] } }),
        dump({ lap: { columns: ['id', 'lap_time'], rows: ['a', 'x', 'c'] } })
      ).differences
    ).toEqual(['table lap: 1 rows differ', 'table session is missing']);
    expect(
      compareDumps(
        dump({ lap: laps }),
        dump({ lap: { columns: ['id', 'lap_time'], rows: ['a', 'b'] } })
      ).differences
    ).toEqual(['table lap has 2 rows, not 3']);
  });

  it('names a table the second file has on top', () => {
    expect(
      compareDumps(dump({ lap: laps }), dump({ lap: laps, stint: laps }))
        .differences
    ).toEqual(['table stint is extra']);
  });
});
