import { describe, expect, it } from 'vitest';
import {
  PIT_WALL_CUSTOM_COLUMNS,
  PIT_WALL_CUSTOM_MAX_ENTRIES,
  PIT_WALL_CUSTOM_ROWS,
  PIT_WALL_HOSTABLE,
  PIT_WALL_HOSTABLE_WIDGETS,
  isOnPitWallCustomGrid,
  pitWallCellsOverlap,
  pitWallCustomFreeSpace,
  pitWallCustomVerdict,
  pitWallHostable,
  samePitWallCustom,
  sanitizePitWallCustom,
  sortPitWallCustom,
  type PitWallCustomPanel,
} from './pitWallCustom';
import { PIT_WALL_HOSTED_WIDGETS } from './pitWall';
import { WIDGET_MANIFESTS } from './widgets';

const panel = (
  widget: string,
  x: number,
  y: number,
  w: number,
  h: number
): PitWallCustomPanel => ({ widget, x, y, w, h }) as PitWallCustomPanel;

describe('the grid of the Custom layout', () => {
  it('is 24 cells by 16', () => {
    expect(PIT_WALL_CUSTOM_COLUMNS).toBe(24);
    expect(PIT_WALL_CUSTOM_ROWS).toBe(16);
  });

  it('takes a rectangle of whole cells that is all on it', () => {
    expect(isOnPitWallCustomGrid({ x: 0, y: 0, w: 24, h: 16 })).toBe(true);
    expect(isOnPitWallCustomGrid({ x: 23, y: 15, w: 1, h: 1 })).toBe(true);
    expect(isOnPitWallCustomGrid({ x: 5, y: 3, w: 6, h: 4 })).toBe(true);
  });

  it.each([
    ['past the right edge', { x: 20, y: 0, w: 5, h: 2 }],
    ['past the bottom edge', { x: 0, y: 14, w: 2, h: 3 }],
    ['left of the page', { x: -1, y: 0, w: 4, h: 4 }],
    ['above the page', { x: 0, y: -1, w: 4, h: 4 }],
    ['of no width', { x: 0, y: 0, w: 0, h: 4 }],
    ['of no height', { x: 0, y: 0, w: 4, h: 0 }],
    ['of less than no width', { x: 4, y: 0, w: -2, h: 4 }],
    ['on part of a cell', { x: 0.5, y: 0, w: 4, h: 4 }],
    ['of part of a cell', { x: 0, y: 0, w: 4, h: 2.5 }],
    ['of no number', { x: Number.NaN, y: 0, w: 4, h: 4 }],
    ['without an end', { x: 0, y: 0, w: Infinity, h: 4 }],
  ])('refuses one %s', (_name, cells) => {
    expect(isOnPitWallCustomGrid(cells)).toBe(false);
  });

  it('finds two rectangles that share a cell, and not two that only touch', () => {
    const a = { x: 2, y: 2, w: 4, h: 4 };
    expect(pitWallCellsOverlap(a, { x: 5, y: 5, w: 3, h: 3 })).toBe(true);
    expect(pitWallCellsOverlap(a, { x: 3, y: 3, w: 1, h: 1 })).toBe(true);
    expect(pitWallCellsOverlap(a, a)).toBe(true);
    // Side by side, one over the other, and corner to corner.
    expect(pitWallCellsOverlap(a, { x: 6, y: 2, w: 4, h: 4 })).toBe(false);
    expect(pitWallCellsOverlap(a, { x: 2, y: 6, w: 4, h: 4 })).toBe(false);
    expect(pitWallCellsOverlap(a, { x: 6, y: 6, w: 2, h: 2 })).toBe(false);
    expect(pitWallCellsOverlap({ x: 6, y: 6, w: 2, h: 2 }, a)).toBe(false);
  });
});

describe('PIT_WALL_HOSTABLE', () => {
  const known = WIDGET_MANIFESTS.map((manifest) => manifest.id as string);

  it('lists widgets the app has, each once', () => {
    expect(
      PIT_WALL_HOSTABLE_WIDGETS.filter((id) => !known.includes(id))
    ).toEqual([]);
    expect(new Set(PIT_WALL_HOSTABLE_WIDGETS).size).toBe(
      PIT_WALL_HOSTABLE_WIDGETS.length
    );
    expect(PIT_WALL_HOSTABLE_WIDGETS).toEqual(
      PIT_WALL_HOSTABLE.map((entry) => entry.widget)
    );
  });

  it('has no page of pages in it', () => {
    expect(PIT_WALL_HOSTABLE_WIDGETS).not.toContain('pitwall');
    expect(PIT_WALL_HOSTABLE_WIDGETS).not.toContain('gantry');
  });

  it('offers the panels of the fixed layouts first, then the overlay widgets the page hosted before them', () => {
    const kinds = PIT_WALL_HOSTABLE.map((entry) => entry.kind);
    const firstOverlay = kinds.indexOf('overlay');
    expect(kinds.slice(0, firstOverlay)).toEqual(
      Array<string>(firstOverlay).fill('panel')
    );
    expect(kinds.slice(firstOverlay)).toEqual(
      Array<string>(kinds.length - firstOverlay).fill('overlay')
    );
    expect(
      PIT_WALL_HOSTABLE.filter((entry) => entry.kind === 'overlay').map(
        (entry) => entry.widget
      )
    ).toEqual([
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
    ]);
  });

  it('holds every widget a fixed layout hosts, as a panel', () => {
    // A panel added to a fixed layout is to be measured and listed here, or
    // the Custom layout could not start as a copy of Race and could not be
    // given what the other layouts have.
    expect(
      PIT_WALL_HOSTABLE.filter((entry) => entry.kind === 'panel')
        .map((entry) => entry.widget)
        .sort()
    ).toEqual([...PIT_WALL_HOSTED_WIDGETS].sort());
  });

  it('says what each needs, in pixels a panel can have', () => {
    for (const entry of PIT_WALL_HOSTABLE) {
      expect(entry.width, entry.widget).toBeGreaterThanOrEqual(150);
      expect(entry.width, entry.widget).toBeLessThanOrEqual(600);
      expect(entry.height, entry.widget).toBeGreaterThanOrEqual(100);
      expect(entry.height, entry.widget).toBeLessThanOrEqual(400);
    }
  });

  it('has the sizes measured for the panels of the fixed layouts', () => {
    const need = (widget: string) => {
      const entry = pitWallHostable(widget);
      return entry && [entry.width, entry.height];
    };
    expect(need('timingtower')).toEqual([350, 300]);
    expect(need('ourcar')).toEqual([320, 330]);
    expect(need('map')).toEqual([220, 200]);
    expect(need('classrivals')).toEqual([420, 240]);
    expect(need('stinttimeline')).toEqual([350, 220]);
    expect(need('crew')).toEqual([320, 330]);
    expect(need('carlaps')).toEqual([320, 240]);
    expect(need('racecharts')).toEqual([400, 300]);
    expect(need('racelog')).toEqual([280, 150]);
    expect(need('weatherforecast')).toEqual([300, 135]);
  });

  it('knows nothing of a widget no panel can host', () => {
    expect(pitWallHostable('pitwall')).toBeUndefined();
    expect(pitWallHostable('radar')).toBeUndefined();
    expect(pitWallHostable('nope')).toBeUndefined();
    // Names every object has are not widgets.
    expect(pitWallHostable('toString')).toBeUndefined();
    expect(pitWallHostable('constructor')).toBeUndefined();
    expect(pitWallHostable('__proto__')).toBeUndefined();
    expect(pitWallHostable(undefined)).toBeUndefined();
    expect(pitWallHostable(7)).toBeUndefined();
    expect(pitWallHostable(['map'])).toBeUndefined();
  });
});

describe('sanitizePitWallCustom', () => {
  const tower = panel('timingtower', 0, 0, 14, 11);
  const ourCar = panel('ourcar', 14, 0, 5, 5);

  it('reads anything that is not a list as no list at all', () => {
    expect(sanitizePitWallCustom(undefined)).toBeUndefined();
    expect(sanitizePitWallCustom(null)).toBeUndefined();
    expect(sanitizePitWallCustom('custom')).toBeUndefined();
    expect(sanitizePitWallCustom(12)).toBeUndefined();
    expect(sanitizePitWallCustom({ 0: tower, length: 1 })).toBeUndefined();
    expect(sanitizePitWallCustom({ panels: [tower] })).toBeUndefined();
    expect(sanitizePitWallCustom(true)).toBeUndefined();
  });

  it('reads an empty list as an empty page', () => {
    expect(sanitizePitWallCustom([])).toEqual([]);
  });

  it('keeps a list of panels as it is, in its order', () => {
    expect(sanitizePitWallCustom([ourCar, tower])).toEqual([ourCar, tower]);
  });

  it('hands back a list of its own, with nothing but a panel’s five fields', () => {
    const saved = [{ ...tower, colour: 'red', widgetId: 'x', rigid: true }];
    const read = sanitizePitWallCustom(saved);
    expect(read).toEqual([tower]);
    expect(read).not.toBe(saved);
    expect(Object.keys(read?.[0] ?? {})).toEqual([
      'widget',
      'x',
      'y',
      'w',
      'h',
    ]);
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['a number', 4],
    ['a word', 'timingtower'],
    ['a list', ['timingtower', 0, 0, 4, 4]],
    ['a panel with no widget', { x: 0, y: 0, w: 4, h: 4 }],
    ['a widget that is no word', { ...tower, widget: 7 }],
    ['a widget that is a list', { ...tower, widget: ['timingtower'] }],
    ['a place that is a word', { ...tower, x: '0' }],
    ['a size that is a word', { ...tower, w: '14' }],
    ['a place that is missing', { widget: 'timingtower', y: 0, w: 4, h: 4 }],
    ['a size that is missing', { widget: 'timingtower', x: 0, y: 0, w: 4 }],
    ['a size that is null', { ...tower, h: null }],
    ['a place that is no number', { ...tower, y: Number.NaN }],
    ['a size without an end', { ...tower, w: Infinity }],
    ['part of a cell', { ...tower, x: 1.5 }],
  ])('drops an entry that is %s', (_name, entry) => {
    expect(sanitizePitWallCustom([entry, ourCar])).toEqual([ourCar]);
  });

  it.each([
    ['past the right edge', panel('timingtower', 12, 0, 14, 4)],
    ['past the bottom edge', panel('timingtower', 0, 8, 4, 9)],
    ['left of the page', panel('timingtower', -1, 0, 4, 4)],
    ['above the page', panel('timingtower', 0, -3, 4, 4)],
    ['of no width', panel('timingtower', 0, 0, 0, 4)],
    ['of less than no height', panel('timingtower', 0, 4, 4, -2)],
    ['larger than the page', panel('timingtower', 0, 0, 25, 17)],
  ])('drops a panel %s', (_name, entry) => {
    expect(sanitizePitWallCustom([entry, ourCar])).toEqual([ourCar]);
  });

  it.each([
    ['a widget nobody has heard of', 'spaceship'],
    ['the Pit Wall itself', 'pitwall'],
    ['the Gantry', 'gantry'],
    ['a widget of the overlay the page never hosted', 'radar'],
    ['a name every object has', 'toString'],
    ['another such name', '__proto__'],
    ['a widget named in other letters', 'TimingTower'],
  ])('drops a panel of %s', (_name, widget) => {
    expect(sanitizePitWallCustom([panel(widget, 0, 0, 4, 4), ourCar])).toEqual([
      ourCar,
    ]);
  });

  it('keeps an overlay widget the page hosted before its own panels', () => {
    const standings = panel('standings', 0, 0, 8, 16);
    const fuel = panel('fuel', 8, 0, 4, 6);
    expect(sanitizePitWallCustom([standings, fuel])).toEqual([standings, fuel]);
  });

  it('drops the second of two panels of one widget, wherever it is', () => {
    const again = panel('timingtower', 20, 12, 4, 4);
    expect(sanitizePitWallCustom([tower, again, ourCar])).toEqual([
      tower,
      ourCar,
    ]);
  });

  it('drops a panel that lies on a cell an earlier one has', () => {
    // One cell of the tower's is enough.
    const onTheTower = panel('racelog', 13, 10, 4, 4);
    const beside = panel('racecharts', 0, 11, 14, 5);
    expect(sanitizePitWallCustom([tower, onTheTower, beside])).toEqual([
      tower,
      beside,
    ]);
    // The first of the two wins, whichever it is.
    expect(sanitizePitWallCustom([onTheTower, tower, ourCar])).toEqual([
      onTheTower,
      ourCar,
    ]);
  });

  it('judges a panel against the ones kept, not the ones dropped', () => {
    // The second lies on the first and is dropped; the third lies on the
    // second only, and stays.
    const first = panel('timingtower', 0, 0, 4, 4);
    const second = panel('ourcar', 3, 0, 4, 4);
    const third = panel('map', 5, 0, 4, 4);
    expect(sanitizePitWallCustom([first, second, third])).toEqual([
      first,
      third,
    ]);
  });

  it('keeps a panel smaller than its widget would like', () => {
    const tiny = panel('timingtower', 0, 0, 1, 1);
    expect(sanitizePitWallCustom([tiny])).toEqual([tiny]);
  });

  it('reads a list no further than its cap', () => {
    // Rubbish first, then a panel past the cap: it is not looked at.
    const long = [
      ...Array<unknown>(PIT_WALL_CUSTOM_MAX_ENTRIES).fill('rubbish'),
      tower,
    ];
    expect(sanitizePitWallCustom(long)).toEqual([]);
    // The same panel as the last entry read is kept.
    const justInside = [
      ...Array<unknown>(PIT_WALL_CUSTOM_MAX_ENTRIES - 1).fill('rubbish'),
      tower,
    ];
    expect(sanitizePitWallCustom(justInside)).toEqual([tower]);
  });

  it('never holds more panels than there are widgets to host', () => {
    const everything = PIT_WALL_HOSTABLE_WIDGETS.flatMap((widget, index) => [
      panel(widget, index, 0, 1, 1),
      panel(widget, index, 1, 1, 1),
    ]);
    expect(sanitizePitWallCustom(everything)).toHaveLength(
      PIT_WALL_HOSTABLE_WIDGETS.length
    );
  });

  it('does not throw at whatever it is given', () => {
    // A list with holes in it.
    const holed: unknown[] = [];
    holed[1] = tower;
    holed[3] = ourCar;
    const weird: unknown[] = [
      [[]],
      [[[tower]]],
      [{ widget: { toString: () => 'timingtower' }, x: 0, y: 0, w: 1, h: 1 }],
      [Object.create(null)],
      [new Date(), /x/, () => tower, Symbol('x'), BigInt(10)],
      Array(100000).fill(tower),
      Object.assign([tower], { extra: 'x' }),
      holed,
      [{ ...tower, x: Number.MAX_SAFE_INTEGER }],
      [{ ...tower, w: -Number.MAX_VALUE }],
      [JSON.parse('{"__proto__": {"widget": "map"}, "x": 0}')],
    ];
    for (const value of weird) {
      expect(() => sanitizePitWallCustom(value)).not.toThrow();
    }
    expect(sanitizePitWallCustom(Array(100000).fill(tower))).toEqual([tower]);
    expect(sanitizePitWallCustom(holed)).toEqual([tower, ourCar]);
  });

  it('leaves what it was given as it was', () => {
    const saved = [tower, panel('timingtower', 0, 0, 2, 2), 'x'];
    const before = JSON.stringify(saved);
    sanitizePitWallCustom(saved);
    expect(JSON.stringify(saved)).toBe(before);
  });

  it('gives the same list when it reads its own answer', () => {
    const once = sanitizePitWallCustom([
      tower,
      'x',
      panel('ourcar', 13, 0, 5, 5),
      ourCar,
      panel('map', 19, 0, 5, 5),
    ]);
    expect(sanitizePitWallCustom(once)).toEqual(once);
  });
});

describe('pitWallCustomVerdict', () => {
  const min = { w: 4, h: 3 };
  const page = [
    panel('timingtower', 0, 0, 10, 8),
    panel('ourcar', 10, 0, 6, 6),
    panel('racelog', 10, 6, 6, 4),
  ];
  const verdict = (candidate: PitWallCustomPanel, least = min) =>
    pitWallCustomVerdict(page, candidate, least);

  it('lets a panel have free cells', () => {
    expect(verdict(panel('map', 16, 0, 8, 8))).toBe('fits');
    expect(verdict(panel('map', 0, 8, 10, 8))).toBe('fits');
    // Edge to edge with its neighbours is not on them.
    expect(verdict(panel('map', 16, 6, 4, 3))).toBe('fits');
  });

  it('is not in a panel’s way itself', () => {
    // Moved a cell, the tower lies on the cells it has now.
    expect(verdict(panel('timingtower', 0, 1, 10, 8))).toBe('fits');
    expect(verdict(panel('timingtower', 0, 0, 10, 8))).toBe('fits');
  });

  it('refuses cells another panel has', () => {
    expect(verdict(panel('map', 15, 5, 4, 4))).toBe('overlap');
    expect(verdict(panel('timingtower', 1, 0, 10, 8))).toBe('overlap');
    expect(verdict(panel('racelog', 10, 5, 6, 4))).toBe('overlap');
  });

  it('refuses cells that are off the page', () => {
    expect(verdict(panel('map', 21, 0, 4, 4))).toBe('outside');
    expect(verdict(panel('map', 16, 14, 4, 3))).toBe('outside');
    expect(verdict(panel('timingtower', -1, 0, 10, 8))).toBe('outside');
    expect(verdict(panel('timingtower', 0, -1, 10, 8))).toBe('outside');
    // Off the page comes before everything else that is wrong with it.
    expect(verdict(panel('map', -2, 0, 14, 2))).toBe('outside');
  });

  it('refuses a size under the minimum, either way', () => {
    expect(verdict(panel('map', 16, 0, 3, 3))).toBe('small');
    expect(verdict(panel('map', 16, 0, 4, 2))).toBe('small');
    expect(verdict(panel('map', 16, 0, 4, 3))).toBe('fits');
    // Too small comes before what is in the way.
    expect(verdict(panel('map', 0, 0, 2, 2))).toBe('small');
  });

  it('lets a panel that is under its minimum already be moved', () => {
    // The log is 6 by 4 where 8 by 6 is asked of it.
    const least = { w: 8, h: 6 };
    expect(verdict(panel('racelog', 16, 6, 6, 4), least)).toBe('fits');
    expect(verdict(panel('racelog', 10, 12, 6, 4), least)).toBe('fits');
  });

  it('lets such a panel grow, and not shrink further', () => {
    const least = { w: 8, h: 6 };
    // Grown a cell each way, still under the minimum: nearer to it.
    expect(verdict(panel('racelog', 16, 6, 7, 5), least)).toBe('fits');
    expect(verdict(panel('racelog', 16, 6, 8, 6), least)).toBe('fits');
    expect(verdict(panel('racelog', 16, 6, 5, 4), least)).toBe('small');
    expect(verdict(panel('racelog', 16, 6, 6, 3), least)).toBe('small');
    // Wider but shorter is still shorter.
    expect(verdict(panel('racelog', 16, 6, 8, 3), least)).toBe('small');
  });

  it('holds a panel that is not on the page yet to the whole minimum', () => {
    expect(verdict(panel('map', 16, 0, 4, 3))).toBe('fits');
    expect(verdict(panel('map', 16, 0, 3, 3))).toBe('small');
  });

  it('takes a list of one panel, or of none', () => {
    expect(
      pitWallCustomVerdict([], panel('map', 0, 0, 24, 16), { w: 1, h: 1 })
    ).toBe('fits');
    expect(
      pitWallCustomVerdict(
        [panel('map', 0, 0, 4, 4)],
        panel('map', 20, 12, 4, 4),
        { w: 1, h: 1 }
      )
    ).toBe('fits');
  });
});

describe('pitWallCustomFreeSpace', () => {
  it('is the top left corner of an empty page', () => {
    expect(pitWallCustomFreeSpace([], { w: 4, h: 4 })).toEqual({ x: 0, y: 0 });
    expect(pitWallCustomFreeSpace([], { w: 24, h: 16 })).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('is the highest free place, and of those the furthest left', () => {
    const page = [panel('timingtower', 0, 0, 10, 8)];
    // Beside the tower at the top, before under it on the left.
    expect(pitWallCustomFreeSpace(page, { w: 4, h: 4 })).toEqual({
      x: 10,
      y: 0,
    });
    // Too wide to go beside it: under it.
    expect(pitWallCustomFreeSpace(page, { w: 16, h: 4 })).toEqual({
      x: 0,
      y: 8,
    });
  });

  it('finds a gap between panels that is just large enough', () => {
    const page = [
      panel('timingtower', 0, 0, 24, 6),
      panel('ourcar', 0, 6, 10, 10),
      panel('map', 14, 6, 10, 10),
    ];
    expect(pitWallCustomFreeSpace(page, { w: 4, h: 10 })).toEqual({
      x: 10,
      y: 6,
    });
    expect(pitWallCustomFreeSpace(page, { w: 5, h: 10 })).toBeUndefined();
    expect(pitWallCustomFreeSpace(page, { w: 4, h: 11 })).toBeUndefined();
  });

  it('has no place on a page that is full', () => {
    const full = [panel('timingtower', 0, 0, 24, 16)];
    expect(pitWallCustomFreeSpace(full, { w: 1, h: 1 })).toBeUndefined();
  });

  it('has no place for a panel larger than the page', () => {
    expect(pitWallCustomFreeSpace([], { w: 25, h: 1 })).toBeUndefined();
    expect(pitWallCustomFreeSpace([], { w: 1, h: 17 })).toBeUndefined();
  });

  it('gives a place the panel may have', () => {
    const page = [
      panel('timingtower', 0, 0, 14, 11),
      panel('racecharts', 0, 11, 14, 5),
      panel('ourcar', 14, 0, 5, 5),
    ];
    const size = { w: 5, h: 5 };
    const place = pitWallCustomFreeSpace(page, size) ?? { x: -1, y: -1 };
    expect(place).toEqual({ x: 19, y: 0 });
    expect(
      pitWallCustomVerdict(page, { widget: 'map', ...size, ...place }, size)
    ).toBe('fits');
  });
});

describe('sortPitWallCustom', () => {
  it('puts the panels in the order they are read: row by row, left to right', () => {
    const tower = panel('timingtower', 0, 0, 14, 11);
    const charts = panel('racecharts', 0, 11, 14, 5);
    const ourCar = panel('ourcar', 14, 0, 5, 5);
    const map = panel('map', 19, 0, 5, 5);
    const rivals = panel('classrivals', 14, 5, 10, 4);
    const list = [charts, map, rivals, tower, ourCar];
    expect(sortPitWallCustom(list)).toEqual([
      tower,
      ourCar,
      map,
      rivals,
      charts,
    ]);
    // A list of its own: the one given is as it was.
    expect(list[0]).toBe(charts);
  });
});

describe('samePitWallCustom', () => {
  const tower = panel('timingtower', 0, 0, 14, 11);
  const ourCar = panel('ourcar', 14, 0, 5, 5);

  it('takes two lists of the same panels for one page, in any order', () => {
    expect(
      samePitWallCustom([tower, ourCar], [{ ...ourCar }, { ...tower }])
    ).toBe(true);
    expect(samePitWallCustom([], [])).toBe(true);
  });

  it('tells apart a panel moved, sized, added, removed or swapped', () => {
    expect(samePitWallCustom([tower], [{ ...tower, x: 1 }])).toBe(false);
    expect(samePitWallCustom([tower], [{ ...tower, h: 10 }])).toBe(false);
    expect(samePitWallCustom([tower], [tower, ourCar])).toBe(false);
    expect(samePitWallCustom([tower, ourCar], [tower])).toBe(false);
    expect(samePitWallCustom([tower], [panel('standings', 0, 0, 14, 11)])).toBe(
      false
    );
  });
});
