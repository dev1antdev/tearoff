import { describe, expect, it } from 'vitest';
import {
  PIT_WALL_LAYOUTS,
  PIT_WALL_LAYOUT_LIST,
  PIT_WALL_ROWS,
  pitWallGrid,
  pitWallHostedDashboard,
  resolvePitWall,
  sanitizePitWallConfig,
  type PitWallLayout,
} from './pitWall';
import { getWidgetDefaultConfig } from './defaultDashboard';
import {
  DEFAULT_SIM_WIDGET_SUPPORT,
  IRACING_DISABLED_WIDGETS,
  LMU_DISABLED_WIDGETS,
} from './simWidgetSupport';
import { WIDGET_MANIFESTS } from './widgets';
import type { DashboardLayout, DashboardWidget } from './dashboardLayout';

describe('sanitizePitWallConfig', () => {
  it('falls back to the Race layout for missing or broken values', () => {
    const expected = { layout: 'race' };
    expect(sanitizePitWallConfig(undefined)).toEqual(expected);
    expect(sanitizePitWallConfig(null)).toEqual(expected);
    expect(sanitizePitWallConfig('watching')).toEqual(expected);
    expect(sanitizePitWallConfig(['compact'])).toEqual(expected);
    expect(sanitizePitWallConfig({})).toEqual(expected);
    expect(sanitizePitWallConfig({ layout: 'grid' })).toEqual(expected);
    expect(sanitizePitWallConfig({ layout: 2 })).toEqual(expected);
    expect(sanitizePitWallConfig({ layout: 'toString' })).toEqual(expected);
  });

  it('matches the default dashboard config', () => {
    const config = getWidgetDefaultConfig('pitwall');
    expect(sanitizePitWallConfig(config)).toEqual(config);
  });

  it('keeps each known layout and drops what it does not know', () => {
    for (const layout of ['race', 'watching', 'compact']) {
      expect(sanitizePitWallConfig({ layout, panels: ['x'] })).toEqual({
        layout,
      });
    }
  });
});

/** The rows each area of a template covers, checked to be one rectangle. */
const areaRectangles = (areas: string) => {
  const rows = [...areas.matchAll(/"([^"]*)"/g)].map((match) =>
    match[1].split(' ')
  );
  const cells = new Map<string, { row: number; column: number }[]>();
  rows.forEach((names, row) =>
    names.forEach((name, column) => {
      cells.set(name, [...(cells.get(name) ?? []), { row, column }]);
    })
  );
  return {
    rows,
    rectangles: [...cells].map(([name, list]) => {
      const rowsOf = list.map((cell) => cell.row);
      const columnsOf = list.map((cell) => cell.column);
      const height = Math.max(...rowsOf) - Math.min(...rowsOf) + 1;
      const width = Math.max(...columnsOf) - Math.min(...columnsOf) + 1;
      return { name, height, width, filled: list.length === height * width };
    }),
  };
};

describe('PIT_WALL_LAYOUTS', () => {
  const widgetIds = WIDGET_MANIFESTS.map((manifest) => manifest.id as string);

  it('lists the three layouts in the order the header shows them', () => {
    expect(PIT_WALL_LAYOUT_LIST.map((layout) => layout.id)).toEqual([
      'race',
      'watching',
      'compact',
    ]);
    for (const layout of PIT_WALL_LAYOUT_LIST) {
      expect(PIT_WALL_LAYOUTS[layout.id]).toBe(layout);
      expect(layout.label).not.toBe('');
    }
  });

  it.each(PIT_WALL_LAYOUT_LIST)(
    '$id hosts real widgets, each once, in full columns',
    (layout: PitWallLayout) => {
      const hosted = layout.columns.flatMap((column) =>
        column.slots.map((slot) => slot.widget as string)
      );
      expect(hosted.filter((id) => !widgetIds.includes(id))).toEqual([]);
      expect(new Set(hosted).size).toBe(hosted.length);
      // A page of pages is not a panel.
      expect(hosted).not.toContain('pitwall');
      expect(hosted).not.toContain('gantry');
      for (const column of layout.columns) {
        expect(column.width).toBeGreaterThan(0);
        expect(column.slots.reduce((sum, slot) => sum + slot.rows, 0)).toBe(
          PIT_WALL_ROWS
        );
        for (const slot of column.slots) {
          expect(slot.rows).toBeGreaterThanOrEqual(1);
          expect(slot.minWidth).toBeGreaterThan(0);
        }
      }
    }
  );

  it('holds these widgets in each layout', () => {
    const hosted = (layout: PitWallLayout) =>
      layout.columns
        .flatMap((column) => column.slots.map((slot) => slot.widget))
        .sort();
    expect(hosted(PIT_WALL_LAYOUTS.race)).toEqual(
      [
        'standings',
        'fuel',
        'pitstop',
        'finishorder',
        'stinthistory',
        'wear',
        'weatherforecast',
        'flagpanel',
        'traffic',
        'map',
      ].sort()
    );
    expect(hosted(PIT_WALL_LAYOUTS.watching)).toEqual(
      [
        'finishorder',
        'pitstop',
        'stinthistory',
        'laptimelog',
        'timing',
        'tyres',
        'damage',
        'standings',
        'weatherforecast',
      ].sort()
    );
    expect(hosted(PIT_WALL_LAYOUTS.compact)).toEqual(
      ['standings', 'fuel', 'pitstop', 'finishorder', 'weather'].sort()
    );
  });
});

describe('pitWallGrid', () => {
  it('describes the Race layout with every panel shown', () => {
    const grid = pitWallGrid(PIT_WALL_LAYOUTS.race);
    expect(grid.columns).toBe(
      'minmax(0, 1.5fr) minmax(0, 0.9fr) minmax(0, 1.2fr) minmax(0, 0.9fr)'
    );
    expect(grid.rows).toBe('repeat(12, minmax(0, 1fr))');
    const { rows } = areaRectangles(grid.areas);
    expect(rows).toHaveLength(PIT_WALL_ROWS);
    expect(rows[0]).toEqual(['standings', 'fuel', 'flagpanel', 'map']);
    expect(rows[6]).toEqual(['standings', 'fuel', 'stinthistory', 'traffic']);
    expect(rows[8]).toEqual(['standings', 'pitstop', 'stinthistory', 'wear']);
    expect(rows[11]).toEqual([
      'standings',
      'pitstop',
      'weatherforecast',
      'wear',
    ]);
    expect(grid.slots.map((slot) => slot.widget)).toEqual([
      'standings',
      'fuel',
      'pitstop',
      'flagpanel',
      'finishorder',
      'stinthistory',
      'weatherforecast',
      'map',
      'traffic',
      'wear',
    ]);
  });

  it('gives a left-out panel’s rows to the rest of its column', () => {
    const grid = pitWallGrid(
      PIT_WALL_LAYOUTS.race,
      (slot) => slot.widget !== 'map'
    );
    const column = areaRectangles(grid.areas).rows.map((row) => row[3]);
    // Traffic 4 and wear 5 of nine: 5.33 and 6.67 rows.
    expect(column).toEqual([
      ...Array<string>(5).fill('traffic'),
      ...Array<string>(7).fill('wear'),
    ]);
    expect(grid.slots.map((slot) => slot.widget)).not.toContain('map');
  });

  it('shares rows that do not divide evenly without losing any', () => {
    // Flag 2, finish 4 and stints 3 of nine: 2.67, 5.33 and 4 rows.
    const grid = pitWallGrid(
      PIT_WALL_LAYOUTS.race,
      (slot) => slot.widget !== 'weatherforecast'
    );
    const column = areaRectangles(grid.areas).rows.map((row) => row[2]);
    const count = (name: string) =>
      column.filter((area) => area === name).length;
    expect(count('flagpanel')).toBe(3);
    expect(count('finishorder')).toBe(5);
    expect(count('stinthistory')).toBe(4);
  });

  it('drops a column that has no panel left', () => {
    const grid = pitWallGrid(
      PIT_WALL_LAYOUTS.watching,
      (slot) => slot.widget !== 'tyres' && slot.widget !== 'damage'
    );
    expect(grid.columns).toBe(
      'minmax(0, 1.25fr) minmax(0, 0.85fr) minmax(0, 1.6fr)'
    );
    expect(areaRectangles(grid.areas).rows[0]).toHaveLength(3);
  });

  it('is empty when nothing is shown', () => {
    expect(pitWallGrid(PIT_WALL_LAYOUTS.compact, () => false)).toEqual({
      columns: '',
      rows: 'repeat(12, minmax(0, 1fr))',
      areas: '',
      slots: [],
    });
  });

  const sims: readonly (readonly [string, readonly string[]])[] = [
    ['with every panel', []],
    ['under Le Mans Ultimate', LMU_DISABLED_WIDGETS],
    ['under iRacing', IRACING_DISABLED_WIDGETS],
  ];
  const simCases = PIT_WALL_LAYOUT_LIST.flatMap((layout) =>
    sims.map(([name, disabled]) => ({ layout, name, disabled }))
  );

  it.each(simCases)(
    '$layout.id stays a grid of whole rectangles $name',
    ({ layout, disabled }) => {
      const grid = pitWallGrid(
        layout,
        (slot) => !disabled.includes(slot.widget)
      );
      const { rows, rectangles } = areaRectangles(grid.areas);
      expect(rows).toHaveLength(PIT_WALL_ROWS);
      const width = grid.columns.split(') ').length;
      for (const row of rows) expect(row).toHaveLength(width);
      expect(rectangles.map((area) => area.name).sort()).toEqual(
        grid.slots.map((slot) => slot.widget as string).sort()
      );
      for (const area of rectangles) {
        expect(area.filled, area.name).toBe(true);
        expect(area.width, area.name).toBe(1);
      }
    }
  );
});

const layout = { x: 0, y: 0, width: 100, height: 100 };
const widget = (
  id: string,
  extra: Partial<DashboardWidget> = {}
): DashboardWidget => ({ id, enabled: false, layout, ...extra });

const dashboardWith = (
  config: unknown,
  widgets: DashboardWidget[] = []
): DashboardLayout => ({
  widgets: [
    widget('pitwall', {
      enabled: true,
      config: config as Record<string, unknown>,
    }),
    ...widgets,
  ],
});

describe('resolvePitWall', () => {
  it('falls back to the Race layout without a dashboard or a saved config', () => {
    expect(resolvePitWall(undefined).layout.id).toBe('race');
    expect(resolvePitWall(null).layout.id).toBe('race');
    expect(resolvePitWall({ widgets: [] }).layout.id).toBe('race');
    expect(resolvePitWall(dashboardWith({ layout: 'nope' })).layout.id).toBe(
      'race'
    );
  });

  it('shows the saved layout', () => {
    const resolved = resolvePitWall(dashboardWith({ layout: 'compact' }));
    expect(resolved.layout).toBe(PIT_WALL_LAYOUTS.compact);
    expect(resolved.panels.map((panel) => panel.slot.widget)).toEqual([
      'standings',
      'fuel',
      'pitstop',
      'finishorder',
      'weather',
    ]);
  });

  it('hosts the profile’s widget of each type whether or not it is on', () => {
    const fuel = widget('fuel', {
      enabled: false,
      config: { safetyMargin: 1 },
    });
    const standings = widget('standings', { enabled: true });
    const resolved = resolvePitWall(
      dashboardWith({ layout: 'compact' }, [fuel, standings])
    );
    const byType = new Map(
      resolved.panels.map((panel) => [panel.slot.widget, panel])
    );
    expect(byType.get('fuel')).toEqual({
      slot: expect.objectContaining({ widget: 'fuel' }),
      status: 'ready',
      widget: fuel,
    });
    expect(byType.get('standings')).toMatchObject({
      status: 'ready',
      widget: standings,
    });
    expect(byType.get('weather')).toMatchObject({ status: 'missing' });
    expect(byType.get('weather')).not.toHaveProperty('widget');
  });

  it('takes the entry named after the type before a copy of it', () => {
    const copy = widget('fuel-2', { type: 'fuel' });
    const own = widget('fuel');
    const resolved = resolvePitWall(
      dashboardWith({ layout: 'compact' }, [copy, own])
    );
    expect(
      resolved.panels.find((panel) => panel.slot.widget === 'fuel')
    ).toMatchObject({ status: 'ready', widget: own });
  });

  it('takes a copy when it is all the profile has, but never a Gantry layout', () => {
    const copy = widget('fuel-2', { type: 'fuel' });
    const gantryOnly = widget('standings-g1', {
      type: 'standings',
      placement: 'gantry',
    });
    const resolved = resolvePitWall(
      dashboardWith({ layout: 'compact' }, [gantryOnly, copy])
    );
    const find = (type: string) =>
      resolved.panels.find((panel) => panel.slot.widget === type);
    expect(find('fuel')).toMatchObject({ status: 'ready', widget: copy });
    expect(find('standings')).toMatchObject({ status: 'missing' });
  });

  it('leaves out the panels the running sim cannot support', () => {
    const dashboard = dashboardWith({ layout: 'race' }, [widget('map')]);
    // A list of its own, so the case does not move with what each sim gains.
    const support = {
      message: 'Not under this sim',
      disabledWidgets: { lmu: ['map'], iracing: ['wear', 'weatherforecast'] },
    };
    const shown = (simulator: 'lmu' | 'iracing' | null) =>
      resolvePitWall(dashboard, { support, simulator }).panels.map(
        (panel) => panel.slot.widget
      );

    expect(shown(null)).toHaveLength(10);
    expect(shown('lmu')).not.toContain('map');
    expect(shown('lmu')).toContain('wear');
    expect(shown('lmu')).toHaveLength(9);
    expect(shown('iracing')).toContain('map');
    expect(shown('iracing')).not.toContain('wear');
    expect(shown('iracing')).not.toContain('weatherforecast');
  });

  it('shows every panel of every layout under Le Mans Ultimate as shipped', () => {
    for (const layout of PIT_WALL_LAYOUT_LIST) {
      const resolved = resolvePitWall(dashboardWith({ layout: layout.id }), {
        support: DEFAULT_SIM_WIDGET_SUPPORT,
        simulator: 'lmu',
      });
      expect(resolved.panels.map((panel) => panel.slot)).toEqual(
        layout.columns.flatMap((column) => column.slots)
      );
    }
  });

  it('leaves out under iRacing the panels it has no data for', () => {
    const shown = (layout: string) =>
      resolvePitWall(dashboardWith({ layout }), {
        support: DEFAULT_SIM_WIDGET_SUPPORT,
        simulator: 'iracing',
      }).panels.map((panel) => panel.slot.widget);

    expect(shown('race')).toEqual([
      'standings',
      'fuel',
      'pitstop',
      'flagpanel',
      'finishorder',
      'stinthistory',
      'map',
      'traffic',
    ]);
    expect(shown('watching')).toEqual([
      'finishorder',
      'stinthistory',
      'pitstop',
      'timing',
      'laptimelog',
      'standings',
    ]);
    expect(shown('compact')).toHaveLength(5);
  });

  it('keeps the grid and the panels in step', () => {
    const resolved = resolvePitWall(dashboardWith({ layout: 'watching' }), {
      support: DEFAULT_SIM_WIDGET_SUPPORT,
      simulator: 'iracing',
    });
    expect(resolved.panels.map((panel) => panel.slot)).toEqual(
      resolved.grid.slots
    );
    expect(resolved.grid.areas).not.toContain('tyres');
  });
});

describe('pitWallHostedDashboard', () => {
  const fuel = widget('fuel', {
    config: {
      safetyMargin: 2,
      showOnlyWhenOnTrack: true,
      sessionVisibility: { race: true, practice: false },
    },
  });
  const relative = widget('relative', {
    config: { showOnlyWhenOnTrack: true },
  });
  const dashboard: DashboardLayout = {
    widgets: [fuel, relative],
    generalSettings: { fontSize: 'sm' },
  } as DashboardLayout;

  it('has nothing to hand out without a dashboard', () => {
    expect(pitWallHostedDashboard(undefined, new Set(['fuel']))).toBe(
      undefined
    );
    expect(pitWallHostedDashboard(null, new Set(['fuel']))).toBe(undefined);
  });

  it('lifts the on-track and session rules of the hosted widgets only', () => {
    const hosted = pitWallHostedDashboard(dashboard, new Set(['fuel']));
    expect(hosted?.widgets[0].config).toEqual({
      safetyMargin: 2,
      showOnlyWhenOnTrack: false,
      sessionVisibility: {
        race: true,
        loneQualify: true,
        openQualify: true,
        practice: true,
        offlineTesting: true,
        warmup: true,
      },
    });
    expect(hosted?.widgets[1]).toBe(relative);
    expect(hosted?.generalSettings).toBe(dashboard.generalSettings);
  });

  it('leaves the saved dashboard as it was', () => {
    const before = JSON.stringify(dashboard);
    pitWallHostedDashboard(dashboard, new Set(['fuel', 'relative']));
    expect(JSON.stringify(dashboard)).toBe(before);
  });

  it('gives a widget saved without a config the lifted rules too', () => {
    const bare = widget('standings');
    const hosted = pitWallHostedDashboard(
      { widgets: [bare] },
      new Set(['standings'])
    );
    expect(hosted?.widgets[0].config).toMatchObject({
      showOnlyWhenOnTrack: false,
    });
  });
});
