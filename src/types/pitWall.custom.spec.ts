import { describe, expect, it } from 'vitest';
import {
  PIT_WALL_CUSTOM_LAYOUT,
  PIT_WALL_CUSTOM_START,
  PIT_WALL_GAP_PX,
  PIT_WALL_LAYOUTS,
  PIT_WALL_LAYOUT_CHOICE_LIST,
  PIT_WALL_LAYOUT_LIST,
  pitWallCustomGrid,
  pitWallCustomLayout,
  pitWallCustomPanels,
  pitWallPanelMinCells,
  pitWallTabAsCustom,
  pitWallTabSlots,
  resolvePitWall,
  sanitizePitWallConfig,
  type PitWallSlot,
  type PitWallTab,
} from './pitWall';
import {
  PIT_WALL_CUSTOM_COLUMNS,
  PIT_WALL_CUSTOM_ROWS,
  PIT_WALL_HOSTABLE,
  isOnPitWallCustomGrid,
  pitWallCellsOverlap,
  pitWallCustomVerdict,
  sanitizePitWallCustom,
  type PitWallCustomPanel,
} from './pitWallCustom';
import { getWidgetDefaultConfig } from './defaultDashboard';
import { DEFAULT_SIM_WIDGET_SUPPORT } from './simWidgetSupport';
import type { DashboardLayout, DashboardWidget } from './dashboardLayout';
import {
  PIT_WALL_LAYOUT_CHOICES,
  PIT_WALL_LAYOUT_IDS,
  type PitWallLayoutChoice,
} from './widgetConfigs';

// The layout the user arranges, as the page makes it of a saved list. The
// three fixed layouts and what was said of them are in `pitWall.spec.ts`,
// which this stage left as it was.

const panel = (
  widget: string,
  x: number,
  y: number,
  w: number,
  h: number
): PitWallCustomPanel => ({ widget, x, y, w, h }) as PitWallCustomPanel;

const slot = (widget: string, rows: number): PitWallSlot =>
  ({ widget, rows, minWidth: 100 }) as PitWallSlot;

const RACE = PIT_WALL_LAYOUTS.race.tabs[0];

/** The panel of a widget in a list, or a failure that says which is not there. */
const find = (panels: readonly PitWallCustomPanel[], widget: string) => {
  const found = panels.find((entry) => entry.widget === widget);
  if (!found) throw new Error(`No ${widget} panel in the list`);
  return found;
};

/** The cells a list covers, and whether any is covered twice. */
const coverage = (panels: readonly PitWallCustomPanel[]) => ({
  cells: panels.reduce((sum, entry) => sum + entry.w * entry.h, 0),
  overlapping: panels.some((a, index) =>
    panels.slice(index + 1).some((b) => pitWallCellsOverlap(a, b))
  ),
  outside: panels.filter((entry) => !isOnPitWallCustomGrid(entry)),
});

const WHOLE_GRID = PIT_WALL_CUSTOM_COLUMNS * PIT_WALL_CUSTOM_ROWS;

/** Each area of a template as the rectangle of cells it covers. */
const areasOf = (areas: string) => {
  const rows = [...areas.matchAll(/"([^"]*)"/g)].map((match) =>
    match[1].split(' ')
  );
  const found = new Map<string, { x: number; y: number }[]>();
  rows.forEach((names, y) =>
    names.forEach((name, x) => {
      found.set(name, [...(found.get(name) ?? []), { x, y }]);
    })
  );
  return {
    rows,
    rectangles: Object.fromEntries(
      [...found].map(([name, list]) => {
        const xs = list.map((cell) => cell.x);
        const ys = list.map((cell) => cell.y);
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        const w = Math.max(...xs) - x + 1;
        const h = Math.max(...ys) - y + 1;
        return [name, { x, y, w, h, filled: list.length === w * h }];
      })
    ),
  };
};

describe('the layouts the page can be set to', () => {
  it('are the three fixed ones and then Custom', () => {
    expect([...PIT_WALL_LAYOUT_CHOICES]).toEqual([
      'race',
      'watching',
      'compact',
      'custom',
    ]);
    expect(PIT_WALL_LAYOUT_CHOICE_LIST.map((choice) => choice.id)).toEqual([
      ...PIT_WALL_LAYOUT_CHOICES,
    ]);
    expect(PIT_WALL_LAYOUT_CHOICE_LIST.slice(0, 3)).toEqual([
      ...PIT_WALL_LAYOUT_LIST,
    ]);
    expect(PIT_WALL_LAYOUT_CHOICE_LIST[3]).toBe(PIT_WALL_CUSTOM_LAYOUT);
    for (const choice of PIT_WALL_LAYOUT_CHOICE_LIST) {
      expect(choice.label).not.toBe('');
      expect(choice.description).not.toBe('');
    }
  });

  it('keep Custom out of the fixed ones', () => {
    expect([...PIT_WALL_LAYOUT_IDS]).toEqual(['race', 'watching', 'compact']);
    expect(Object.keys(PIT_WALL_LAYOUTS)).toEqual([...PIT_WALL_LAYOUT_IDS]);
    expect(PIT_WALL_CUSTOM_LAYOUT).toMatchObject({
      id: 'custom',
      label: 'Custom',
    });
  });
});

describe('sanitizePitWallConfig and the Custom layout', () => {
  const tower = panel('timingtower', 0, 0, 14, 11);
  const ourCar = panel('ourcar', 14, 0, 5, 5);

  it('keeps Custom as a layout', () => {
    expect(sanitizePitWallConfig({ layout: 'custom' })).toEqual({
      layout: 'custom',
      tab: 'overview',
    });
    expect(sanitizePitWallConfig({ layout: 'custom', tab: 'log' })).toEqual({
      layout: 'custom',
      tab: 'log',
    });
  });

  it('reads a config saved before the Custom layout with no list of panels', () => {
    for (const saved of [
      { layout: 'race' },
      { layout: 'compact', tab: 'crew' },
      { layout: 'custom' },
      getWidgetDefaultConfig('pitwall'),
      {},
      undefined,
    ]) {
      expect(sanitizePitWallConfig(saved)).not.toHaveProperty('custom');
    }
  });

  it('keeps a saved list of panels beside whichever layout is chosen', () => {
    expect(
      sanitizePitWallConfig({ layout: 'custom', custom: [tower, ourCar] })
    ).toEqual({ layout: 'custom', tab: 'overview', custom: [tower, ourCar] });
    // Arranged, then switched away from: the arrangement is kept.
    expect(
      sanitizePitWallConfig({ layout: 'watching', custom: [tower] })
    ).toEqual({ layout: 'watching', tab: 'overview', custom: [tower] });
  });

  it('keeps an empty list, which is a page the user emptied', () => {
    expect(sanitizePitWallConfig({ layout: 'custom', custom: [] })).toEqual({
      layout: 'custom',
      tab: 'overview',
      custom: [],
    });
  });

  it.each([
    ['a word', 'race'],
    ['a number', 3],
    ['null', null],
    ['an object', { 0: { widget: 'map', x: 0, y: 0, w: 4, h: 4 } }],
    ['true', true],
  ])('reads a list that is %s as no list', (_name, custom) => {
    expect(sanitizePitWallConfig({ layout: 'custom', custom })).toEqual({
      layout: 'custom',
      tab: 'overview',
    });
  });

  it('drops from a list what is not a panel the page can show', () => {
    const config = sanitizePitWallConfig({
      layout: 'custom',
      custom: [
        tower,
        'rubbish',
        // On the tower.
        panel('racelog', 10, 4, 6, 4),
        // Off the page.
        panel('map', 22, 0, 5, 5),
        // The tower again.
        panel('timingtower', 14, 11, 4, 4),
        // No widget of the app, and one no panel can host.
        panel('spaceship', 14, 6, 4, 4),
        panel('pitwall', 14, 6, 4, 4),
        ourCar,
      ],
    });
    expect(config.custom).toEqual([tower, ourCar]);
  });

  it('takes a good list beside a broken layout, and a good layout beside a broken list', () => {
    expect(sanitizePitWallConfig({ layout: 'nope', custom: [tower] })).toEqual({
      layout: 'race',
      tab: 'overview',
      custom: [tower],
    });
    expect(sanitizePitWallConfig({ layout: 'custom', custom: 'nope' })).toEqual(
      { layout: 'custom', tab: 'overview' }
    );
  });

  it('gives the same config when it reads its own answer', () => {
    const once = sanitizePitWallConfig({
      layout: 'custom',
      tab: 'nope',
      custom: [tower, 'x', ourCar, panel('ourcar', 0, 12, 4, 4)],
    });
    expect(sanitizePitWallConfig(once)).toEqual(once);
  });
});

describe('pitWallTabAsCustom', () => {
  it('puts a tab of columns and bands on the cells, in the tab’s order', () => {
    const tab = {
      columns: [
        { width: 1, bands: [slot('a', 9), slot('b', 3)] },
        {
          width: 2,
          bands: [[slot('c', 6), slot('d', 6)], slot('e', 6)],
        },
      ],
    };
    // A third of 24 columns and two thirds; 9 and 3 of 12 rows are 12 and
    // 4 of 16; the two abreast have half of sixteen columns each.
    expect(pitWallTabAsCustom(tab)).toEqual([
      panel('a', 0, 0, 8, 12),
      panel('b', 0, 12, 8, 4),
      panel('c', 8, 0, 8, 8),
      panel('d', 16, 0, 8, 8),
      panel('e', 8, 8, 16, 8),
    ]);
  });

  it('shares cells that do not divide evenly without losing any', () => {
    const tab = {
      columns: [
        { width: 4, bands: [slot('a', 8), slot('b', 4)] },
        {
          width: 3,
          bands: [[slot('c', 5), slot('d', 5), slot('e', 5)], slot('f', 7)],
        },
      ],
    };
    const panels = pitWallTabAsCustom(tab);
    // Four sevenths of 24 is 13.7 and three sevenths 10.3: fourteen and
    // ten. Ten columns between three: four, three and three.
    expect(panels.map((entry) => [entry.widget, entry.x, entry.w])).toEqual([
      ['a', 0, 14],
      ['b', 0, 14],
      ['c', 14, 4],
      ['d', 18, 3],
      ['e', 21, 3],
      ['f', 14, 10],
    ]);
    // Eight and four of twelve rows are 10.7 and 5.3: eleven and five.
    // Five and seven are 6.7 and 9.3: seven and nine.
    expect(panels.map((entry) => [entry.widget, entry.y, entry.h])).toEqual([
      ['a', 0, 11],
      ['b', 11, 5],
      ['c', 0, 7],
      ['d', 0, 7],
      ['e', 0, 7],
      ['f', 7, 9],
    ]);
  });

  it('rounds a band that keeps its rows up before any other', () => {
    // A third, a quarter, a quarter and a sixth of sixteen rows: 5.3, 4, 4
    // and 2.7. One row is left over.
    const bands = (keeps: boolean) => ({
      columns: [
        {
          width: 1,
          bands: [
            { ...slot('whole', 4), rigid: keeps },
            slot('b', 3),
            slot('c', 3),
            slot('d', 2),
          ],
        },
      ],
    });
    const heights = (keeps: boolean) =>
      pitWallTabAsCustom(bands(keeps)).map((entry) => entry.h);
    // By the remainders alone it goes to the last band.
    expect(heights(false)).toEqual([5, 4, 4, 3]);
    // A band that is whole at its share and cut below it has it first.
    expect(heights(true)).toEqual([6, 4, 4, 2]);
  });

  it('holds a band to its rows through one panel of it, as the grid does', () => {
    const tab = {
      columns: [
        {
          width: 1,
          bands: [
            [{ ...slot('whole', 4), rigid: true }, slot('beside', 4)],
            slot('b', 3),
            slot('c', 3),
            slot('d', 2),
          ],
        },
      ],
    };
    expect(pitWallTabAsCustom(tab).map((entry) => entry.h)).toEqual([
      6, 6, 4, 4, 2,
    ]);
  });

  it('gives a band that keeps its rows no more than its share where that is whole rows', () => {
    // Six, three and three of twelve are eight, four and four of sixteen:
    // nothing is left over, and nothing is taken from the others.
    const tab = {
      columns: [
        {
          width: 1,
          bands: [
            { ...slot('whole', 6), rigid: true },
            slot('b', 3),
            slot('c', 3),
          ],
        },
      ],
    };
    expect(pitWallTabAsCustom(tab).map((entry) => entry.h)).toEqual([8, 4, 4]);
    // A half and two quarters and a bit: the band that keeps its rows is
    // whole at eight, and the row left over goes by the remainders.
    const uneven = {
      columns: [
        {
          width: 1,
          bands: [
            { ...slot('whole', 6), rigid: true },
            slot('b', 2.5),
            slot('c', 3.5),
          ],
        },
      ],
    };
    expect(pitWallTabAsCustom(uneven).map((entry) => entry.h)).toEqual([
      8, 3, 5,
    ]);
  });

  it('follows the tab it is given: bands changed over change places', () => {
    const tab = (first: string, second: string) => ({
      columns: [{ width: 1, bands: [slot(first, 6), slot(second, 6)] }],
    });
    expect(pitWallTabAsCustom(tab('a', 'b'))).toEqual([
      panel('a', 0, 0, 24, 8),
      panel('b', 0, 8, 24, 8),
    ]);
    expect(pitWallTabAsCustom(tab('b', 'a'))).toEqual([
      panel('b', 0, 0, 24, 8),
      panel('a', 0, 8, 24, 8),
    ]);
  });

  it('makes nothing of a tab with nothing in it', () => {
    expect(pitWallTabAsCustom({ columns: [] })).toEqual([]);
    expect(pitWallTabAsCustom({ columns: [{ width: 1, bands: [] }] })).toEqual(
      []
    );
    // A column with no band takes no part, and the other has the page.
    expect(
      pitWallTabAsCustom({
        columns: [
          { width: 3, bands: [] },
          { width: 1, bands: [slot('a', 12)] },
        ],
      })
    ).toEqual([panel('a', 0, 0, 24, 16)]);
  });

  const tabs = PIT_WALL_LAYOUT_LIST.flatMap((layout) =>
    layout.tabs.map((tab) => ({ name: `${layout.id}/${tab.id}`, tab }))
  );

  it.each(tabs)(
    '$name fills the grid with whole panels, none on another',
    ({ tab }: { tab: PitWallTab }) => {
      const panels = pitWallTabAsCustom(tab);
      expect(panels.map((entry) => entry.widget)).toEqual(
        pitWallTabSlots(tab).map((entry) => entry.widget)
      );
      const covered = coverage(panels);
      expect(covered.outside).toEqual([]);
      expect(covered.overlapping).toBe(false);
      expect(covered.cells).toBe(WHOLE_GRID);
    }
  );
});

describe('PIT_WALL_CUSTOM_START', () => {
  it('is the Race layout as it is, worked out from Race’s own data', () => {
    // No number of the starting point is written down anywhere: change a
    // width, a band or a row of Race, and this is what the Custom layout
    // starts as.
    expect(PIT_WALL_CUSTOM_START).toEqual(pitWallTabAsCustom(RACE));
  });

  it('has Race’s panels, each once, in Race’s order', () => {
    expect(PIT_WALL_CUSTOM_START.map((entry) => entry.widget)).toEqual(
      pitWallTabSlots(RACE).map((entry) => entry.widget)
    );
    expect(PIT_WALL_CUSTOM_START.length).toBeGreaterThan(0);
  });

  it('has the tower over the Race Charts on the left', () => {
    const tower = find(PIT_WALL_CUSTOM_START, 'timingtower');
    const charts = find(PIT_WALL_CUSTOM_START, 'racecharts');
    expect(tower).toMatchObject({ x: 0, y: 0 });
    expect(charts).toMatchObject({ x: 0, w: tower.w, y: tower.h });
    expect(charts.y + charts.h).toBe(PIT_WALL_CUSTOM_ROWS);
    // The tower is the taller of the two, and the left side the wider.
    expect(tower.h).toBeGreaterThan(charts.h);
    expect(tower.w).toBeGreaterThan(PIT_WALL_CUSTOM_COLUMNS / 2);
  });

  it('has Our Car beside the Track Map, Class Rivals, Crew and Stints beside the Race Log, and the forecast on the right', () => {
    const at = (widget: string) => find(PIT_WALL_CUSTOM_START, widget);
    const tower = at('timingtower');
    const ourCar = at('ourcar');
    const map = at('map');
    const rivals = at('classrivals');
    const crew = at('crew');
    const log = at('racelog');
    const forecast = at('weatherforecast');
    const rightWidth = PIT_WALL_CUSTOM_COLUMNS - tower.w;

    // Top of the right side: two abreast.
    expect(ourCar).toMatchObject({ x: tower.w, y: 0 });
    expect(map).toMatchObject({ x: ourCar.x + ourCar.w, y: 0, h: ourCar.h });
    expect(ourCar.w + map.w).toBe(rightWidth);
    // Across, under them.
    expect(rivals).toMatchObject({ x: tower.w, y: ourCar.h, w: rightWidth });
    // Two abreast again.
    expect(crew).toMatchObject({ x: tower.w, y: rivals.y + rivals.h });
    expect(log).toMatchObject({ x: crew.x + crew.w, y: crew.y, h: crew.h });
    expect(crew.w + log.w).toBe(rightWidth);
    // Across, to the foot of the page.
    expect(forecast).toMatchObject({
      x: tower.w,
      y: crew.y + crew.h,
      w: rightWidth,
    });
    expect(forecast.y + forecast.h).toBe(PIT_WALL_CUSTOM_ROWS);
  });

  it('keeps Our Car whole: the row sixteen leave over is its, not the forecast’s', () => {
    // Race gives Our Car a third of the page's height and keeps it there.
    // A third of sixteen rows is five and a bit: six, not five.
    const ourCar = find(PIT_WALL_CUSTOM_START, 'ourcar');
    const forecast = find(PIT_WALL_CUSTOM_START, 'weatherforecast');
    expect(ourCar.h / PIT_WALL_CUSTOM_ROWS).toBeGreaterThanOrEqual(4 / 12);
    expect(ourCar.h).toBe(6);
    expect(forecast.h).toBe(2);
  });

  it('fills the page with no hole and no panel on another', () => {
    const covered = coverage(PIT_WALL_CUSTOM_START);
    expect(covered.outside).toEqual([]);
    expect(covered.overlapping).toBe(false);
    expect(covered.cells).toBe(WHOLE_GRID);
  });

  it('is a list the reader of saved lists keeps whole', () => {
    expect(sanitizePitWallCustom([...PIT_WALL_CUSTOM_START])).toEqual([
      ...PIT_WALL_CUSTOM_START,
    ]);
  });

  it('starts with no panel under the least its widget may be sized to', () => {
    // The rule a panel is sized by must hold for the panels the layout
    // starts with, or the first thing dragged would be refused its own
    // size. It is why the minimum is reckoned on a large page: see
    // MINIMUM_REFERENCE_PX in pitWall.ts.
    for (const entry of PIT_WALL_CUSTOM_START) {
      const min = pitWallPanelMinCells(entry.widget);
      expect(entry.w, `${entry.widget} across`).toBeGreaterThanOrEqual(min.w);
      expect(entry.h, `${entry.widget} down`).toBeGreaterThanOrEqual(min.h);
      expect(
        pitWallCustomVerdict(PIT_WALL_CUSTOM_START, entry, min),
        entry.widget
      ).toBe('fits');
    }
  });

  it('is what a config with no list shows, and gives way to a saved one', () => {
    expect(pitWallCustomPanels({})).toBe(PIT_WALL_CUSTOM_START);
    expect(pitWallCustomPanels(sanitizePitWallConfig({ layout: 'race' }))).toBe(
      PIT_WALL_CUSTOM_START
    );
    const saved = [panel('map', 0, 0, 24, 16)];
    expect(pitWallCustomPanels({ custom: saved })).toBe(saved);
    expect(pitWallCustomPanels({ custom: [] })).toEqual([]);
  });
});

describe('pitWallPanelMinCells', () => {
  it('is the least each panel of the fixed layouts may be sized to', () => {
    const least = (widget: string) =>
      pitWallPanelMinCells(widget as PitWallCustomPanel['widget']);
    expect(least('timingtower')).toEqual({ w: 4, h: 4 });
    expect(least('ourcar')).toEqual({ w: 4, h: 4 });
    expect(least('map')).toEqual({ w: 3, h: 3 });
    expect(least('classrivals')).toEqual({ w: 5, h: 3 });
    expect(least('stinttimeline')).toEqual({ w: 4, h: 3 });
    expect(least('crew')).toEqual({ w: 4, h: 4 });
    expect(least('carlaps')).toEqual({ w: 4, h: 3 });
    expect(least('racecharts')).toEqual({ w: 4, h: 4 });
    expect(least('racelog')).toEqual({ w: 3, h: 2 });
    expect(least('weatherforecast')).toEqual({ w: 3, h: 2 });
  });

  it('gives a widget nobody measured the height all such have', () => {
    const least = (widget: string) =>
      pitWallPanelMinCells(widget as PitWallCustomPanel['widget']);
    // Three rows for the 200 pixels taken for granted; the width is the
    // one the page laid the widget out at before.
    expect(least('fuel')).toEqual({ w: 3, h: 3 });
    expect(least('standings')).toEqual({ w: 6, h: 3 });
    expect(least('weather')).toEqual({ w: 2, h: 3 });
  });

  it('is what the widget needs on a page of 2560 by 1440, and not a cell more', () => {
    // The page's panels have 2560 by 1383 of it, the header the rest. A
    // panel of n cells is n cells and the gaps between them.
    const acrossPx = (cells: number) =>
      (cells * (2560 - PIT_WALL_GAP_PX)) / PIT_WALL_CUSTOM_COLUMNS -
      PIT_WALL_GAP_PX;
    const downPx = (cells: number) =>
      (cells * (1383 - PIT_WALL_GAP_PX)) / PIT_WALL_CUSTOM_ROWS -
      PIT_WALL_GAP_PX;
    for (const { widget, width, height } of PIT_WALL_HOSTABLE) {
      const min = pitWallPanelMinCells(widget);
      expect(acrossPx(min.w), `${widget} across`).toBeGreaterThanOrEqual(width);
      expect(downPx(min.h), `${widget} down`).toBeGreaterThanOrEqual(height);
      expect(acrossPx(min.w - 1), `${widget} a cell narrower`).toBeLessThan(
        width
      );
      expect(downPx(min.h - 1), `${widget} a cell shorter`).toBeLessThan(
        height
      );
    }
  });

  it('is whole cells, at least one and never more than the page has', () => {
    for (const { widget } of PIT_WALL_HOSTABLE) {
      const min = pitWallPanelMinCells(widget);
      expect(Number.isInteger(min.w) && Number.isInteger(min.h)).toBe(true);
      expect(min.w).toBeGreaterThanOrEqual(1);
      expect(min.h).toBeGreaterThanOrEqual(1);
      expect(min.w).toBeLessThanOrEqual(PIT_WALL_CUSTOM_COLUMNS);
      expect(min.h).toBeLessThanOrEqual(PIT_WALL_CUSTOM_ROWS);
    }
  });

  it('is a cell each way for a widget no panel can host', () => {
    expect(pitWallPanelMinCells('pitwall')).toEqual({ w: 1, h: 1 });
  });

  it('leaves room for every panel of the fixed layouts on one page', () => {
    // At their least, all ten are fewer cells than the grid has: the user
    // is not kept from a page of everything by the minimums alone.
    const cells = PIT_WALL_HOSTABLE.filter(
      (entry) => entry.kind === 'panel'
    ).reduce((sum, { widget }) => {
      const min = pitWallPanelMinCells(widget);
      return sum + min.w * min.h;
    }, 0);
    expect(cells).toBeLessThan(WHOLE_GRID / 2);
  });
});

describe('pitWallCustomGrid', () => {
  const tower = panel('timingtower', 0, 0, 14, 11);
  const ourCar = panel('ourcar', 14, 0, 5, 5);
  const map = panel('map', 20, 12, 4, 4);

  it('makes every cell a track', () => {
    const grid = pitWallCustomGrid([tower]);
    expect(grid.columns).toBe('repeat(24, minmax(0, 1fr))');
    expect(grid.rows).toBe('repeat(16, minmax(0, 1fr))');
    const { rows } = areasOf(grid.areas);
    expect(rows).toHaveLength(PIT_WALL_CUSTOM_ROWS);
    for (const row of rows) expect(row).toHaveLength(PIT_WALL_CUSTOM_COLUMNS);
  });

  it('names each panel’s cells after its widget and leaves the rest empty', () => {
    const { rectangles } = areasOf(
      pitWallCustomGrid([tower, ourCar, map]).areas
    );
    expect(rectangles.timingtower).toEqual({ ...cellsOf(tower), filled: true });
    expect(rectangles.ourcar).toEqual({ ...cellsOf(ourCar), filled: true });
    expect(rectangles.map).toEqual({ ...cellsOf(map), filled: true });
    // What is left is nobody's: a dot is a cell no area has.
    expect(Object.keys(rectangles).sort()).toEqual([
      '.',
      'map',
      'ourcar',
      'timingtower',
    ]);
  });

  it('gives the slots in the list’s order, each as tall as its panel and as wide as its widget needs', () => {
    const grid = pitWallCustomGrid([ourCar, tower, map]);
    expect(grid.slots).toEqual([
      { widget: 'ourcar', rows: 5, minWidth: 320 },
      { widget: 'timingtower', rows: 11, minWidth: 350 },
      { widget: 'map', rows: 4, minWidth: 220 },
    ]);
  });

  it('keeps the shape a widget is drawn in', () => {
    const [damage] = pitWallCustomGrid([panel('damage', 0, 0, 6, 6)]).slots;
    expect(damage).toEqual({
      widget: 'damage',
      rows: 6,
      minWidth: 220,
      aspect: 5 / 3,
    });
  });

  it('leaves a hole where a panel is left out, and moves nothing else', () => {
    const all = areasOf(pitWallCustomGrid([tower, ourCar, map]).areas);
    const grid = pitWallCustomGrid(
      [tower, ourCar, map],
      (entry) => entry.widget !== 'ourcar'
    );
    const without = areasOf(grid.areas);
    expect(without.rectangles.ourcar).toBeUndefined();
    expect(without.rectangles.timingtower).toEqual(all.rectangles.timingtower);
    expect(without.rectangles.map).toEqual(all.rectangles.map);
    // The cells Our Car had are empty.
    expect(without.rows[0].slice(14, 19)).toEqual(Array<string>(5).fill('.'));
    expect(grid.slots.map((entry) => entry.widget)).toEqual([
      'timingtower',
      'map',
    ]);
  });

  it('is a grid with no area where no panel is shown', () => {
    for (const grid of [
      pitWallCustomGrid([]),
      pitWallCustomGrid([tower], () => false),
    ]) {
      expect(grid).toEqual({
        columns: 'repeat(24, minmax(0, 1fr))',
        rows: 'repeat(16, minmax(0, 1fr))',
        areas: '',
        slots: [],
      });
    }
  });

  it('draws the starting point as rectangles that fill the page', () => {
    const { rectangles } = areasOf(
      pitWallCustomGrid(PIT_WALL_CUSTOM_START).areas
    );
    expect(Object.keys(rectangles).sort()).toEqual(
      PIT_WALL_CUSTOM_START.map((entry) => entry.widget as string).sort()
    );
    for (const entry of PIT_WALL_CUSTOM_START) {
      expect(rectangles[entry.widget], entry.widget).toEqual({
        ...cellsOf(entry),
        filled: true,
      });
    }
  });
});

function cellsOf({ x, y, w, h }: PitWallCustomPanel) {
  return { x, y, w, h };
}

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
  resolved.panels.map((entry) => entry.slot.widget);

describe('resolvePitWall and the Custom layout', () => {
  const standings = panel('standings', 0, 0, 12, 16);
  const fuel = panel('fuel', 12, 0, 6, 8);
  const forecast = panel('weatherforecast', 12, 8, 12, 4);
  const saved = [standings, fuel, forecast];

  it('is one page, with no tab bar and no stack', () => {
    const resolved = resolvePitWall(dashboardWith({ layout: 'custom' }));
    expect(resolved.layout).toMatchObject({ id: 'custom', label: 'Custom' });
    expect(resolved.tabs).toHaveLength(1);
    expect(resolved.tab).toBe(resolved.tabs[0]);
    expect(resolved.tab.id).toBe('overview');
    expect(resolved.stack).toBeUndefined();
  });

  it('starts as the copy of Race for a profile that has arranged nothing', () => {
    const resolved = resolvePitWall(dashboardWith({ layout: 'custom' }));
    expect(resolved.tab.cells).toBe(PIT_WALL_CUSTOM_START);
    expect(shownBy(resolved)).toEqual(
      pitWallTabSlots(RACE).map((entry) => entry.widget)
    );
    expect(resolved.grid.areas).toBe(
      pitWallCustomGrid(PIT_WALL_CUSTOM_START).areas
    );
  });

  it('shows the list the profile saved, in its order', () => {
    const resolved = resolvePitWall(
      dashboardWith({ layout: 'custom', custom: saved })
    );
    expect(resolved.tab.cells).toEqual(saved);
    expect(shownBy(resolved)).toEqual(['standings', 'fuel', 'weatherforecast']);
    expect(resolved.grid.slots).toEqual(
      resolved.panels.map((entry) => entry.slot)
    );
    expect(areasOf(resolved.grid.areas).rectangles.fuel).toEqual({
      x: 12,
      y: 0,
      w: 6,
      h: 8,
      filled: true,
    });
  });

  it('shows what is left of a saved list that is partly rubbish', () => {
    const resolved = resolvePitWall(
      dashboardWith({
        layout: 'custom',
        custom: [standings, 'x', panel('fuel', 11, 0, 6, 8), forecast],
      })
    );
    expect(shownBy(resolved)).toEqual(['standings', 'weatherforecast']);
  });

  it('shows an empty page for a list the user emptied, not the copy of Race', () => {
    const resolved = resolvePitWall(
      dashboardWith({ layout: 'custom', custom: [] })
    );
    expect(resolved.panels).toEqual([]);
    expect(resolved.grid.areas).toBe('');
    expect(resolved.tab.cells).toEqual([]);
  });

  it('keeps the saved list while another layout is shown, and shows it again', () => {
    const dashboard = dashboardWith({ layout: 'race', custom: saved });
    expect(resolvePitWall(dashboard).layout).toBe(PIT_WALL_LAYOUTS.race);
    // Chosen where the page is shown, as a browser does: the panels are
    // still the profile's.
    const resolved = resolvePitWall(dashboard, undefined, { layout: 'custom' });
    expect(resolved.layout.id).toBe('custom');
    expect(shownBy(resolved)).toEqual(['standings', 'fuel', 'weatherforecast']);
  });

  it('takes Custom from a device, and nothing that is not a layout', () => {
    expect(
      resolvePitWall(undefined, undefined, { layout: 'custom' }).layout.id
    ).toBe('custom');
    expect(
      resolvePitWall(dashboardWith({ layout: 'custom' }), undefined, {
        layout: 'customs' as PitWallLayoutChoice,
      }).layout.id
    ).toBe('custom');
    expect(
      resolvePitWall(dashboardWith({ layout: 'race' }), undefined, {
        layout: 'customs' as PitWallLayoutChoice,
      }).layout.id
    ).toBe('race');
  });

  it('hosts the profile’s widget behind each panel, and says which it lacks', () => {
    const fuelWidget = widget('fuel', { config: { safetyMargin: 2 } });
    const resolved = resolvePitWall(
      dashboardWith({ layout: 'custom', custom: saved }, [fuelWidget])
    );
    const byType = new Map(
      resolved.panels.map((entry) => [entry.slot.widget, entry])
    );
    expect(byType.get('fuel')).toEqual({
      slot: { widget: 'fuel', rows: 8, minWidth: 300 },
      status: 'ready',
      widget: fuelWidget,
    });
    expect(byType.get('standings')).toMatchObject({ status: 'missing' });
    expect(resolved.hosted).toEqual([fuelWidget]);
  });

  it('leaves out a panel the running sim cannot show, and leaves its cells empty', () => {
    const dashboard = dashboardWith({ layout: 'custom', custom: saved }, [
      widget('standings'),
      widget('fuel'),
      widget('weatherforecast'),
    ]);
    const under = (simulator: 'lmu' | 'iracing') =>
      resolvePitWall(dashboard, {
        support: DEFAULT_SIM_WIDGET_SUPPORT,
        simulator,
      });

    expect(shownBy(under('lmu'))).toEqual([
      'standings',
      'fuel',
      'weatherforecast',
    ]);
    const iracing = under('iracing');
    expect(shownBy(iracing)).toEqual(['standings', 'fuel']);
    expect(iracing.hosted.map((entry) => entry.id)).toEqual([
      'standings',
      'fuel',
    ]);
    const { rectangles, rows } = areasOf(iracing.grid.areas);
    expect(rectangles.weatherforecast).toBeUndefined();
    expect(rows[8].slice(12)).toEqual(Array<string>(12).fill('.'));
    // Nothing else has moved or grown into the room.
    expect(rectangles.standings).toEqual({
      ...cellsOf(standings),
      filled: true,
    });
    expect(rectangles.fuel).toEqual({ ...cellsOf(fuel), filled: true });
    // The list itself is the saved one: the panel is back under the sim
    // that can show it.
    expect(iracing.tab.cells).toEqual(saved);
  });

  it('gives a phone the tabs, as for every layout', () => {
    const resolved = resolvePitWall(
      dashboardWith({ layout: 'custom', custom: saved }),
      undefined,
      { phone: true }
    );
    expect(resolved.layout).toBe(PIT_WALL_LAYOUTS.compact);
    expect(resolved.tabs).toHaveLength(7);
    expect(resolved.tab.cells).toBeUndefined();
    expect(resolved.stack).toBeDefined();
    // The same over a choice of the device.
    expect(
      resolvePitWall(undefined, undefined, { layout: 'custom', phone: true })
        .layout.id
    ).toBe('compact');
  });

  it('opens on its one page whatever tab was saved', () => {
    const resolved = resolvePitWall(
      dashboardWith({ layout: 'custom', tab: 'charts', custom: saved })
    );
    expect(resolved.tab.id).toBe('overview');
    expect(shownBy(resolved)).toHaveLength(3);
  });
});

describe('a layout made of a list', () => {
  it('is one tab that holds the list in place of columns', () => {
    const list = [panel('map', 0, 0, 24, 16)];
    const made = pitWallCustomLayout(list);
    expect(made).toMatchObject({ id: 'custom', label: 'Custom' });
    expect(made.tabs).toEqual([
      { id: 'overview', label: 'Custom', columns: [], cells: list },
    ]);
    expect(pitWallTabSlots(made.tabs[0])).toEqual([
      { widget: 'map', rows: 16, minWidth: 220 },
    ]);
  });
});
