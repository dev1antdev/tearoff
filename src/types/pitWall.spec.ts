import { describe, expect, it } from 'vitest';
import {
  PIT_WALL_HOSTED_WIDGETS,
  PIT_WALL_LAYOUTS,
  PIT_WALL_LAYOUT_LIST,
  PIT_WALL_PHONE_LAYOUT,
  PIT_WALL_ROWS,
  pitWallBandSlots,
  pitWallGrid,
  pitWallHostedDashboard,
  pitWallStack,
  pitWallTabSlots,
  resolvePitWall,
  sanitizePitWallConfig,
  type PitWallLayout,
  type PitWallSlot,
  type PitWallTab,
} from './pitWall';
import { getWidgetDefaultConfig } from './defaultDashboard';
import {
  DEFAULT_SIM_WIDGET_SUPPORT,
  IRACING_DISABLED_WIDGETS,
  LMU_DISABLED_WIDGETS,
} from './simWidgetSupport';
import { WIDGET_MANIFESTS } from './widgets';
import type { DashboardLayout, DashboardWidget } from './dashboardLayout';
import {
  PIT_WALL_TAB_IDS,
  type PitWallLayoutId,
  type PitWallTabId,
} from './widgetConfigs';

describe('sanitizePitWallConfig', () => {
  it('falls back to the Race layout and the first tab for missing or broken values', () => {
    const expected = { layout: 'race', tab: 'overview' };
    expect(sanitizePitWallConfig(undefined)).toEqual(expected);
    expect(sanitizePitWallConfig(null)).toEqual(expected);
    expect(sanitizePitWallConfig('watching')).toEqual(expected);
    expect(sanitizePitWallConfig(['compact'])).toEqual(expected);
    expect(sanitizePitWallConfig({})).toEqual(expected);
    expect(sanitizePitWallConfig({ layout: 'grid' })).toEqual(expected);
    expect(sanitizePitWallConfig({ layout: 2 })).toEqual(expected);
    expect(sanitizePitWallConfig({ layout: 'toString' })).toEqual(expected);
    expect(sanitizePitWallConfig({ tab: 'pits' })).toEqual(expected);
    expect(sanitizePitWallConfig({ tab: 3 })).toEqual(expected);
    expect(sanitizePitWallConfig({ tab: ['log'] })).toEqual(expected);
    expect(sanitizePitWallConfig({ tab: 'constructor' })).toEqual(expected);
  });

  it('matches the default dashboard config', () => {
    const config = getWidgetDefaultConfig('pitwall');
    expect(sanitizePitWallConfig(config)).toEqual(config);
  });

  it('keeps each known layout and tab and drops what it does not know', () => {
    for (const layout of ['race', 'watching', 'compact']) {
      expect(sanitizePitWallConfig({ layout, panels: ['x'] })).toEqual({
        layout,
        tab: 'overview',
      });
    }
    for (const tab of PIT_WALL_TAB_IDS) {
      expect(
        sanitizePitWallConfig({ layout: 'compact', tab, columns: [] })
      ).toEqual({ layout: 'compact', tab });
    }
  });

  it('takes a good layout beside a broken tab, and a good tab beside a broken layout', () => {
    expect(sanitizePitWallConfig({ layout: 'compact', tab: 'nope' })).toEqual({
      layout: 'compact',
      tab: 'overview',
    });
    expect(sanitizePitWallConfig({ layout: 'nope', tab: 'log' })).toEqual({
      layout: 'race',
      tab: 'log',
    });
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

/** Every tab of every layout, named for a test's title. */
const ALL_TABS = PIT_WALL_LAYOUT_LIST.flatMap((layout) =>
  layout.tabs.map((tab) => ({ name: `${layout.id}/${tab.id}`, layout, tab }))
);

const hostedBy = (tab: PitWallTab): string[] =>
  pitWallTabSlots(tab).map((slot) => slot.widget as string);

const tabOf = (layout: PitWallLayoutId, id: PitWallTabId): PitWallTab => {
  const tab = PIT_WALL_LAYOUTS[layout].tabs.find((entry) => entry.id === id);
  if (!tab) throw new Error(`${layout} has no ${id} tab`);
  return tab;
};

/** The share of the page each track of a grid takes, left to right. */
const shares = (columns: string): string[] =>
  [...columns.matchAll(/, ([\d.]+fr)\)/g)].map((match) => match[1]);

/** The least width of each track, in pixels, while the page has the room. */
const leasts = (columns: string): number[] =>
  [...columns.matchAll(/minmax\(min\(([\d.]+)px/g)].map((match) =>
    Number(match[1])
  );

const RACE = tabOf('race', 'overview');
const WATCHING = tabOf('watching', 'overview');

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
    '$id has tabs of different ids, the first of them the one every layout has',
    (layout: PitWallLayout) => {
      const ids = layout.tabs.map((tab) => tab.id);
      expect(ids.length).toBeGreaterThanOrEqual(1);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids[0]).toBe('overview');
      for (const tab of layout.tabs) {
        expect(PIT_WALL_TAB_IDS).toContain(tab.id);
        expect(tab.label).not.toBe('');
      }
    }
  );

  it('makes Race and Watching one page each and Compact a page of seven tabs', () => {
    expect(PIT_WALL_LAYOUTS.race.tabs).toHaveLength(1);
    expect(PIT_WALL_LAYOUTS.watching.tabs).toHaveLength(1);
    // In the order of the tab bar, which is the order of the ids.
    expect(PIT_WALL_LAYOUTS.compact.tabs.map((tab) => tab.id)).toEqual([
      ...PIT_WALL_TAB_IDS,
    ]);
    expect(PIT_WALL_LAYOUTS.compact.tabs.map((tab) => tab.label)).toEqual([
      'Overview',
      'Timing',
      'Strategy',
      'Crew',
      'Map',
      'Charts',
      'Log',
    ]);
  });

  it.each(ALL_TABS)(
    '$name hosts real widgets, each once, in full columns',
    ({ tab }) => {
      const hosted = hostedBy(tab);
      expect(hosted.length).toBeGreaterThanOrEqual(1);
      expect(hosted.filter((id) => !widgetIds.includes(id))).toEqual([]);
      // The type is the panel's key and its grid area.
      expect(new Set(hosted).size).toBe(hosted.length);
      // A page of pages is not a panel.
      expect(hosted).not.toContain('pitwall');
      expect(hosted).not.toContain('gantry');
      for (const column of tab.columns) {
        expect(column.width).toBeGreaterThan(0);
        expect(
          column.bands.reduce(
            (sum, band) => sum + pitWallBandSlots(band)[0].rows,
            0
          )
        ).toBe(PIT_WALL_ROWS);
        for (const band of column.bands) {
          const slots = pitWallBandSlots(band);
          // Side by side means two at least, and one height.
          if (Array.isArray(band)) expect(slots.length).toBeGreaterThan(1);
          expect(new Set(slots.map((slot) => slot.rows)).size).toBe(1);
          for (const slot of slots) {
            expect(Number.isInteger(slot.rows)).toBe(true);
            expect(slot.rows).toBeGreaterThanOrEqual(1);
            expect(slot.minWidth).toBeGreaterThan(0);
          }
        }
      }
    }
  );

  it('holds these widgets on each tab', () => {
    const hosted = (layout: PitWallLayoutId, tab: PitWallTabId) =>
      hostedBy(tabOf(layout, tab));
    expect(hosted('race', 'overview')).toEqual([
      'timingtower',
      'ourcar',
      'map',
      'classrivals',
      'racecharts',
      'crew',
      'weatherforecast',
      'racelog',
    ]);
    expect(hosted('watching', 'overview')).toEqual([
      'ourcar',
      'carlaps',
      'stinttimeline',
      'crew',
      'timingtower',
      'weatherforecast',
      'racelog',
    ]);
    expect(hosted('compact', 'overview')).toEqual([
      'timingtower',
      'ourcar',
      'weatherforecast',
      'racelog',
    ]);
    expect(hosted('compact', 'timing')).toEqual(['timingtower']);
    expect(hosted('compact', 'strategy')).toEqual([
      'classrivals',
      'stinttimeline',
    ]);
    expect(hosted('compact', 'crew')).toEqual(['crew', 'carlaps']);
    expect(hosted('compact', 'map')).toEqual(['map']);
    expect(hosted('compact', 'charts')).toEqual(['racecharts']);
    expect(hosted('compact', 'log')).toEqual(['racelog']);
  });

  it('lists every hosted widget once', () => {
    expect([...PIT_WALL_HOSTED_WIDGETS].sort()).toEqual(
      [...new Set(ALL_TABS.flatMap(({ tab }) => hostedBy(tab)))].sort()
    );
    expect(new Set(PIT_WALL_HOSTED_WIDGETS).size).toBe(
      PIT_WALL_HOSTED_WIDGETS.length
    );
  });

  it('no longer holds the widgets a panel made for the page says better', () => {
    const left = [
      'standings',
      'fuel',
      'pitstop',
      'finishorder',
      'stinthistory',
      'wear',
      'traffic',
      'flagpanel',
      'timing',
      'laptimelog',
      'tyres',
      'damage',
      'weather',
    ];
    expect(left.filter((id) => !widgetIds.includes(id))).toEqual([]);
    expect(PIT_WALL_HOSTED_WIDGETS.filter((id) => left.includes(id))).toEqual(
      []
    );
  });

  it('hosts nothing Le Mans Ultimate cannot show, and one panel iRacing cannot', () => {
    expect(
      PIT_WALL_HOSTED_WIDGETS.filter((id) => LMU_DISABLED_WIDGETS.includes(id))
    ).toEqual([]);
    expect(
      PIT_WALL_HOSTED_WIDGETS.filter((id) =>
        IRACING_DISABLED_WIDGETS.includes(id)
      )
    ).toEqual(['weatherforecast']);
  });
});

const slot = (widget: string, rows: number): PitWallSlot =>
  ({ widget, rows, minWidth: 100 }) as PitWallSlot;

describe('pitWallGrid', () => {
  it('describes the Race layout with every panel shown', () => {
    const grid = pitWallGrid(RACE);
    // The right column is two tracks: its panels sit two abreast.
    expect(shares(grid.columns)).toEqual(['4fr', '1.5fr', '1.5fr']);
    expect(grid.rows).toBe('repeat(12, minmax(0, 1fr))');
    const { rows } = areaRectangles(grid.areas);
    expect(rows).toHaveLength(PIT_WALL_ROWS);
    expect(rows[0]).toEqual(['timingtower', 'ourcar', 'map']);
    expect(rows[3]).toEqual(['timingtower', 'ourcar', 'map']);
    expect(rows[4]).toEqual(['timingtower', 'classrivals', 'classrivals']);
    expect(rows[6]).toEqual(['timingtower', 'classrivals', 'classrivals']);
    expect(rows[7]).toEqual(['timingtower', 'racecharts', 'crew']);
    expect(rows[10]).toEqual(['timingtower', 'weatherforecast', 'racelog']);
    expect(rows[11]).toEqual(['timingtower', 'weatherforecast', 'racelog']);
    expect(grid.slots.map((entry) => entry.widget)).toEqual([
      'timingtower',
      'ourcar',
      'map',
      'classrivals',
      'racecharts',
      'crew',
      'weatherforecast',
      'racelog',
    ]);
  });

  it('lets a panel across its column span the panels two abreast', () => {
    const { rectangles } = areaRectangles(pitWallGrid(RACE).areas);
    const area = (name: string) =>
      rectangles.find((entry) => entry.name === name);
    expect(area('classrivals')).toMatchObject({ width: 2, height: 3 });
    expect(area('ourcar')).toMatchObject({ width: 1, height: 4 });
    expect(area('timingtower')).toMatchObject({ width: 1, height: 12 });
  });

  it('gives a left-out panel’s half of a band to its neighbour', () => {
    const grid = pitWallGrid(
      RACE,
      (entry) => entry.widget !== 'weatherforecast'
    );
    const { rows, rectangles } = areaRectangles(grid.areas);
    expect(rows[11]).toEqual(['timingtower', 'racelog', 'racelog']);
    expect(rectangles.find((area) => area.name === 'racelog')).toMatchObject({
      width: 2,
      height: 2,
      filled: true,
    });
    expect(grid.slots.map((entry) => entry.widget)).not.toContain(
      'weatherforecast'
    );
  });

  it('gives a band with nobody left to the rest of its column', () => {
    const grid = pitWallGrid(
      RACE,
      (entry) =>
        entry.widget !== 'weatherforecast' && entry.widget !== 'racelog'
    );
    const column = areaRectangles(grid.areas).rows.map((row) => row[1]);
    // Four, three and three of ten: 4.8, 3.6 and 3.6 rows.
    expect(column).toEqual([
      ...Array<string>(5).fill('ourcar'),
      ...Array<string>(4).fill('classrivals'),
      ...Array<string>(3).fill('racecharts'),
    ]);
  });

  it('shares rows that do not divide evenly without losing any', () => {
    // Seven and three of ten: 8.4 and 3.6 rows.
    const grid = pitWallGrid(
      WATCHING,
      (entry) => entry.widget !== 'weatherforecast'
    );
    const column = areaRectangles(grid.areas).rows.map((row) => row[2]);
    const count = (name: string) =>
      column.filter((area) => area === name).length;
    expect(count('timingtower')).toBe(8);
    expect(count('racelog')).toBe(4);
  });

  it('drops a column that has no panel left', () => {
    const grid = pitWallGrid(
      WATCHING,
      (entry) =>
        !['timingtower', 'weatherforecast', 'racelog'].includes(entry.widget)
    );
    expect(shares(grid.columns)).toEqual(['5fr', '5fr']);
    expect(areaRectangles(grid.areas).rows[0]).toHaveLength(2);
  });

  it('makes a column as many tracks as split its bands evenly', () => {
    const tab = {
      columns: [
        {
          width: 3,
          bands: [
            [slot('a', 4), slot('b', 4)],
            [slot('c', 4), slot('d', 4), slot('e', 4)],
            slot('f', 4),
          ],
        },
        { width: 1, bands: [slot('g', 12)] },
      ],
    };
    const grid = pitWallGrid(tab);
    // Two and three abreast: six tracks of half a fraction each.
    expect(shares(grid.columns)).toEqual([
      ...Array<string>(6).fill('0.5fr'),
      '1fr',
    ]);
    const { rows, rectangles } = areaRectangles(grid.areas);
    expect(rows[0]).toEqual(['a', 'a', 'a', 'b', 'b', 'b', 'g']);
    expect(rows[4]).toEqual(['c', 'c', 'd', 'd', 'e', 'e', 'g']);
    expect(rows[8]).toEqual(['f', 'f', 'f', 'f', 'f', 'f', 'g']);
    for (const area of rectangles) expect(area.filled, area.name).toBe(true);

    // With one of the three gone the column needs two tracks, not six.
    const fewer = pitWallGrid(tab, (entry) => (entry.widget as string) !== 'd');
    expect(shares(fewer.columns)).toEqual(['1.5fr', '1.5fr', '1fr']);
    expect(areaRectangles(fewer.areas).rows[4]).toEqual(['c', 'e', 'g']);
  });

  it('keeps a track as wide as the widest least width of the panels in it', () => {
    // Each with the two pixels of its frame. The tower's own; then Our
    // Car's, the most of the panels two abreast.
    expect(leasts(pitWallGrid(RACE).columns)).toEqual([422, 322, 322]);
    // Car Laps'; the Stint Timeline's; the tower's.
    expect(leasts(pitWallGrid(WATCHING).columns)).toEqual([362, 422, 422]);
  });

  it('counts the gap a panel over two tracks has between them', () => {
    const tab = {
      columns: [
        {
          width: 1,
          bands: [
            { ...slot('wide', 6), minWidth: 510 },
            [slot('a', 6), slot('b', 6)],
          ],
        },
      ],
    };
    // 510 and its frame of 2, less the gap of 12, over two tracks; the
    // pair ask for 100 each.
    expect(leasts(pitWallGrid(tab).columns)).toEqual([250, 250]);
  });

  it('lets no track’s least width take the grid past the page', () => {
    const { columns } = pitWallGrid(RACE);
    // On a page with no room for every least width, each track's is its
    // share of the page less the gaps, and the shares come to the whole.
    const parts = [
      ...columns.matchAll(/calc\(\(100% - (\d+)px\) \* ([\d.]+)\)/g),
    ];
    expect(parts).toHaveLength(3);
    for (const part of parts) expect(part[1]).toBe('24');
    expect(parts.reduce((sum, part) => sum + Number(part[2]), 0)).toBeCloseTo(
      1,
      3
    );
  });

  it('is empty when nothing is shown', () => {
    expect(pitWallGrid(RACE, () => false)).toEqual({
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
  const simCases = ALL_TABS.flatMap(({ name, tab }) =>
    sims.map(([sim, disabled]) => ({ name, tab, sim, disabled }))
  );

  it.each(simCases)(
    '$name stays a grid of whole rectangles with no hole $sim',
    ({ tab, disabled }) => {
      const grid = pitWallGrid(
        tab,
        (entry) => !disabled.includes(entry.widget)
      );
      const { rows, rectangles } = areaRectangles(grid.areas);
      expect(rows).toHaveLength(PIT_WALL_ROWS);
      const width = shares(grid.columns).length;
      for (const row of rows) expect(row).toHaveLength(width);
      // Every cell is a shown panel's, and every shown panel has cells.
      expect(rectangles.map((area) => area.name).sort()).toEqual(
        grid.slots.map((entry) => entry.widget as string).sort()
      );
      for (const area of rectangles) {
        expect(area.filled, area.name).toBe(true);
      }
    }
  );
});

describe('pitWallStack', () => {
  it('gives a panel alone the whole page', () => {
    expect(pitWallStack([slot('a', 12)])).toEqual(['100%']);
    expect(pitWallStack([slot('a', 2)])).toEqual(['100%']);
  });

  it('gives several the height of their rows, and none the whole page', () => {
    // Sixty pixels a row, and never more than 86 % of the page, so the
    // top of the next panel is in sight.
    expect(pitWallStack([slot('a', 12), slot('b', 6), slot('c', 3)])).toEqual([
      'min(720px, 86%)',
      'min(360px, 86%)',
      'min(180px, 86%)',
    ]);
  });

  it('has nothing to share out between no panels', () => {
    expect(pitWallStack([])).toEqual([]);
  });
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

const shownBy = (resolved: { panels: { slot: PitWallSlot }[] }) =>
  resolved.panels.map((panel) => panel.slot.widget);

describe('resolvePitWall', () => {
  it('falls back to the Race layout without a dashboard or a saved config', () => {
    expect(resolvePitWall(undefined).layout.id).toBe('race');
    expect(resolvePitWall(null).layout.id).toBe('race');
    expect(resolvePitWall({ widgets: [] }).layout.id).toBe('race');
    expect(resolvePitWall(dashboardWith({ layout: 'nope' })).layout.id).toBe(
      'race'
    );
  });

  it('shows a layout chosen where the page is shown in place of the saved one', () => {
    const saved = dashboardWith({ layout: 'race' });

    expect(resolvePitWall(saved, undefined, { layout: 'compact' }).layout).toBe(
      PIT_WALL_LAYOUTS.compact
    );
    expect(
      resolvePitWall(undefined, undefined, { layout: 'watching' }).layout.id
    ).toBe('watching');
    // What a device remembered is as untrusted as what a profile saved.
    expect(
      resolvePitWall(saved, undefined, {
        layout: 'nope' as PitWallLayoutId,
      }).layout.id
    ).toBe('race');
    expect(resolvePitWall(saved, undefined, {}).layout.id).toBe('race');
    expect(resolvePitWall(saved, undefined, undefined).layout.id).toBe('race');
  });

  it('shows the saved layout', () => {
    const resolved = resolvePitWall(dashboardWith({ layout: 'watching' }));
    expect(resolved.layout).toBe(PIT_WALL_LAYOUTS.watching);
    expect(shownBy(resolved)).toEqual(hostedBy(WATCHING));
    expect(resolved.stack).toBeUndefined();
  });

  describe('tabs', () => {
    it('offers one tab for a layout that is one page, and seven for Compact', () => {
      const race = resolvePitWall(dashboardWith({ layout: 'race' }));
      expect(race.tabs).toHaveLength(1);
      expect(race.tab).toBe(race.tabs[0]);

      const compact = resolvePitWall(dashboardWith({ layout: 'compact' }));
      expect(compact.tabs).toBe(PIT_WALL_LAYOUTS.compact.tabs);
      expect(compact.tabs).toHaveLength(7);
    });

    it('opens Compact on Overview until a tab is chosen', () => {
      const resolved = resolvePitWall(dashboardWith({ layout: 'compact' }));
      expect(resolved.tab.id).toBe('overview');
      expect(shownBy(resolved)).toEqual([
        'timingtower',
        'ourcar',
        'weatherforecast',
        'racelog',
      ]);
    });

    it('shows the saved tab and only its panels', () => {
      const resolved = resolvePitWall(
        dashboardWith({ layout: 'compact', tab: 'crew' })
      );
      expect(resolved.tab.id).toBe('crew');
      expect(shownBy(resolved)).toEqual(['crew', 'carlaps']);
      expect(resolved.grid.slots).toEqual(
        resolved.panels.map((panel) => panel.slot)
      );
    });

    it.each(PIT_WALL_LAYOUTS.compact.tabs)(
      'gives the $id tab a grid of its own panels',
      (tab) => {
        const resolved = resolvePitWall(
          dashboardWith({ layout: 'compact', tab: tab.id })
        );
        expect(resolved.tab).toBe(tab);
        expect(shownBy(resolved)).toEqual(hostedBy(tab));
        for (const name of hostedBy(tab)) {
          expect(resolved.grid.areas).toContain(name);
        }
      }
    );

    it('shows a tab chosen where the page is shown in place of the saved one', () => {
      const saved = dashboardWith({ layout: 'compact', tab: 'crew' });
      expect(resolvePitWall(saved, undefined, { tab: 'log' }).tab.id).toBe(
        'log'
      );
      // Untrusted, like the layout.
      expect(
        resolvePitWall(saved, undefined, { tab: 'nope' as PitWallTabId }).tab.id
      ).toBe('crew');
    });

    it('falls back to the first tab for a tab the layout does not have', () => {
      // Saved while Compact was shown, read while Race is.
      const resolved = resolvePitWall(
        dashboardWith({ layout: 'race', tab: 'charts' })
      );
      expect(resolved.tab.id).toBe('overview');
      expect(shownBy(resolved)).toEqual(hostedBy(RACE));
      expect(
        resolvePitWall(dashboardWith({ layout: 'compact', tab: 'pits' })).tab.id
      ).toBe('overview');
    });
  });

  describe('on a phone', () => {
    it.each(['race', 'watching', 'compact'] as const)(
      'gives the tabs whatever layout is chosen: %s',
      (chosen) => {
        const resolved = resolvePitWall(
          dashboardWith({ layout: chosen }),
          undefined,
          { phone: true }
        );
        expect(PIT_WALL_PHONE_LAYOUT).toBe('compact');
        expect(resolved.layout).toBe(PIT_WALL_LAYOUTS.compact);
        expect(resolved.tabs).toBe(PIT_WALL_LAYOUTS.compact.tabs);
        expect(resolved.tab.id).toBe('overview');
      }
    );

    it('gives them over a layout chosen on the device as well', () => {
      const resolved = resolvePitWall(undefined, undefined, {
        layout: 'watching',
        tab: 'strategy',
        phone: true,
      });
      expect(resolved.layout.id).toBe('compact');
      expect(resolved.tab.id).toBe('strategy');
    });

    it('stacks the panels of the tab in front, one share of the page each', () => {
      const resolved = resolvePitWall(
        dashboardWith({ layout: 'race', tab: 'overview' }),
        undefined,
        { phone: true }
      );
      expect(shownBy(resolved)).toEqual([
        'timingtower',
        'ourcar',
        'weatherforecast',
        'racelog',
      ]);
      expect(resolved.stack).toHaveLength(4);
      for (const height of resolved.stack ?? []) {
        expect(height).toMatch(/^min\(\d+px, 86%\)$/);
      }
    });

    it.each(['timing', 'map', 'charts', 'log'] as const)(
      'gives the one panel of the %s tab the whole page',
      (tab) => {
        const resolved = resolvePitWall(undefined, undefined, {
          tab,
          phone: true,
        });
        expect(resolved.panels).toHaveLength(1);
        expect(resolved.stack).toEqual(['100%']);
      }
    );

    it('stacks only what the running sim can show', () => {
      const resolved = resolvePitWall(
        undefined,
        { support: DEFAULT_SIM_WIDGET_SUPPORT, simulator: 'iracing' },
        { phone: true }
      );
      expect(shownBy(resolved)).toEqual(['timingtower', 'ourcar', 'racelog']);
      expect(resolved.stack).toHaveLength(3);
    });

    it('is not stacked on a page wide enough for a grid', () => {
      expect(
        resolvePitWall(undefined, undefined, { phone: false }).stack
      ).toBeUndefined();
    });
  });

  it('hosts the profile’s widget of each type whether or not it is on', () => {
    const ourCar = widget('ourcar', {
      enabled: false,
      config: { showDamage: false },
    });
    const tower = widget('timingtower', { enabled: true });
    const resolved = resolvePitWall(
      dashboardWith({ layout: 'compact' }, [ourCar, tower])
    );
    const byType = new Map(
      resolved.panels.map((panel) => [panel.slot.widget, panel])
    );
    expect(byType.get('ourcar')).toEqual({
      slot: expect.objectContaining({ widget: 'ourcar' }),
      status: 'ready',
      widget: ourCar,
    });
    expect(byType.get('timingtower')).toMatchObject({
      status: 'ready',
      widget: tower,
    });
    expect(byType.get('racelog')).toMatchObject({ status: 'missing' });
    expect(byType.get('racelog')).not.toHaveProperty('widget');
  });

  it('takes the entry named after the type before a copy of it', () => {
    const copy = widget('ourcar-2', { type: 'ourcar' });
    const own = widget('ourcar');
    const resolved = resolvePitWall(
      dashboardWith({ layout: 'compact' }, [copy, own])
    );
    expect(
      resolved.panels.find((panel) => panel.slot.widget === 'ourcar')
    ).toMatchObject({ status: 'ready', widget: own });
  });

  it('takes a copy when it is all the profile has, but never a Gantry layout', () => {
    const copy = widget('ourcar-2', { type: 'ourcar' });
    const gantryOnly = widget('timingtower-g1', {
      type: 'timingtower',
      placement: 'gantry',
    });
    const resolved = resolvePitWall(
      dashboardWith({ layout: 'compact' }, [gantryOnly, copy])
    );
    const find = (type: string) =>
      resolved.panels.find((panel) => panel.slot.widget === type);
    expect(find('ourcar')).toMatchObject({ status: 'ready', widget: copy });
    expect(find('timingtower')).toMatchObject({ status: 'missing' });
  });

  it('leaves out the panels the running sim cannot support', () => {
    const dashboard = dashboardWith({ layout: 'race' }, [widget('map')]);
    // A list of its own, so the case does not move with what each sim gains.
    const support = {
      message: 'Not under this sim',
      disabledWidgets: {
        lmu: ['map'],
        iracing: ['crew', 'weatherforecast'],
      },
    };
    const shown = (simulator: 'lmu' | 'iracing' | null) =>
      shownBy(resolvePitWall(dashboard, { support, simulator }));

    expect(shown(null)).toHaveLength(8);
    expect(shown('lmu')).not.toContain('map');
    expect(shown('lmu')).toContain('crew');
    expect(shown('lmu')).toHaveLength(7);
    expect(shown('iracing')).toContain('map');
    expect(shown('iracing')).not.toContain('crew');
    expect(shown('iracing')).not.toContain('weatherforecast');
  });

  it('shows every panel of every tab under Le Mans Ultimate as shipped', () => {
    for (const { layout: entry, tab } of ALL_TABS) {
      const resolved = resolvePitWall(
        dashboardWith({ layout: entry.id, tab: tab.id }),
        { support: DEFAULT_SIM_WIDGET_SUPPORT, simulator: 'lmu' }
      );
      expect(resolved.panels.map((panel) => panel.slot)).toEqual(
        pitWallTabSlots(tab)
      );
    }
  });

  it('leaves out under iRacing the one panel it has no data for', () => {
    const shown = (config: Record<string, string>) =>
      shownBy(
        resolvePitWall(dashboardWith(config), {
          support: DEFAULT_SIM_WIDGET_SUPPORT,
          simulator: 'iracing',
        })
      );

    expect(shown({ layout: 'race' })).toEqual([
      'timingtower',
      'ourcar',
      'map',
      'classrivals',
      'racecharts',
      'crew',
      'racelog',
    ]);
    expect(shown({ layout: 'watching' })).toEqual([
      'ourcar',
      'carlaps',
      'stinttimeline',
      'crew',
      'timingtower',
      'racelog',
    ]);
    expect(shown({ layout: 'compact' })).toEqual([
      'timingtower',
      'ourcar',
      'racelog',
    ]);
    // The tabs it has nothing to do with are as under Le Mans Ultimate.
    expect(shown({ layout: 'compact', tab: 'strategy' })).toEqual([
      'classrivals',
      'stinttimeline',
    ]);
  });

  it('gives the forecast’s place to the Race Log beside it under iRacing', () => {
    const resolved = resolvePitWall(dashboardWith({ layout: 'race' }), {
      support: DEFAULT_SIM_WIDGET_SUPPORT,
      simulator: 'iracing',
    });
    const { rows, rectangles } = areaRectangles(resolved.grid.areas);
    expect(rows[11]).toEqual(['timingtower', 'racelog', 'racelog']);
    for (const area of rectangles) expect(area.filled, area.name).toBe(true);
  });

  describe('what the page hosts on every tab', () => {
    const profile = (config: Record<string, string>) =>
      dashboardWith(config, [
        widget('timingtower'),
        widget('ourcar'),
        widget('weatherforecast'),
        widget('racelog'),
        widget('classrivals'),
        widget('carlaps'),
        widget('map'),
        // Not a panel of any layout.
        widget('standings'),
      ]);
    const hosted = (resolved: { hosted: readonly DashboardWidget[] }) =>
      resolved.hosted.map((entry) => entry.id);

    it('is the widget of the profile behind every panel of every tab, each once', () => {
      const resolved = resolvePitWall(profile({ layout: 'compact' }));
      // In the order the tabs first show them; the profile has no Stint
      // Timeline, Crew or Race Charts to host.
      expect(hosted(resolved)).toEqual([
        'timingtower',
        'ourcar',
        'weatherforecast',
        'racelog',
        'classrivals',
        'carlaps',
        'map',
      ]);
    });

    it('is the same whichever tab is in front', () => {
      const overview = resolvePitWall(profile({ layout: 'compact' }));
      const log = resolvePitWall(profile({ layout: 'compact', tab: 'log' }));
      expect(hosted(log)).toEqual(hosted(overview));
      expect(shownBy(log)).toEqual(['racelog']);
    });

    it('is only the panels of the one page for a layout without tabs', () => {
      const resolved = resolvePitWall(profile({ layout: 'race' }));
      expect(hosted(resolved)).toEqual([
        'timingtower',
        'ourcar',
        'map',
        'classrivals',
        'weatherforecast',
        'racelog',
      ]);
    });

    it('leaves out what the running sim cannot show', () => {
      const resolved = resolvePitWall(profile({ layout: 'compact' }), {
        support: DEFAULT_SIM_WIDGET_SUPPORT,
        simulator: 'iracing',
      });
      expect(hosted(resolved)).not.toContain('weatherforecast');
      expect(hosted(resolved)).toContain('racelog');
    });

    it('is nothing without a dashboard', () => {
      expect(resolvePitWall(undefined).hosted).toEqual([]);
    });
  });

  it('keeps the grid and the panels in step', () => {
    const resolved = resolvePitWall(dashboardWith({ layout: 'watching' }), {
      support: DEFAULT_SIM_WIDGET_SUPPORT,
      simulator: 'iracing',
    });
    expect(resolved.panels.map((panel) => panel.slot)).toEqual(
      resolved.grid.slots
    );
    expect(resolved.grid.areas).not.toContain('weatherforecast');
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
