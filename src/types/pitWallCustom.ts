import type { WidgetId } from './widgetId';

/*
 * The Custom layout of the Pit Wall: the page the user arranges. Its panels
 * sit on a grid of cells that fills the page, each on a rectangle of whole
 * cells, no two on the same cell. This file is the arrangement itself, in
 * cells: what a panel is, which widgets one can host, how a saved list is
 * read, and the rules a list keeps while it is edited. What an arrangement
 * comes to in pixels, and the page made of it, are in `pitWall.ts`.
 */

/** The grid's cells across the page. */
export const PIT_WALL_CUSTOM_COLUMNS = 24;

/** The grid's cells down the page. */
export const PIT_WALL_CUSTOM_ROWS = 16;

/**
 * A saved list is read this far and no further. A page holds one panel a
 * widget, which is far fewer; the rest of a list longer than this is not
 * looked at.
 */
export const PIT_WALL_CUSTOM_MAX_ENTRIES = 64;

/** So many cells across and down. */
export interface PitWallCellSize {
  w: number;
  h: number;
}

/** A rectangle of cells: its left column and top row, from 0, and its size. */
export interface PitWallCells extends PitWallCellSize {
  x: number;
  y: number;
}

/**
 * One panel of the Custom layout. A widget type appears at most once, so
 * the type is the panel's key, as it is in the fixed layouts.
 */
export interface PitWallCustomPanel extends PitWallCells {
  /** The overlay widget the panel hosts. */
  widget: WidgetId;
}

export interface PitWallHostable {
  widget: WidgetId;
  /**
   * `panel` for what the fixed layouts are made of, `overlay` for a widget
   * of the overlay the page hosted before those panels were built.
   */
  kind: 'panel' | 'overlay';
  /**
   * The size of panel the widget needs to be usable, CSS pixels, the
   * panel's frame and title bar included. A narrower panel shows it drawn
   * smaller; a shorter one scrolls.
   */
  width: number;
  height: number;
  /** See `PitWallSlot.aspect`. */
  aspect?: number;
}

/** What a widget nobody has measured is taken to need. */
const DEFAULT_HEIGHT = 200;

const panelOf = (
  widget: WidgetId,
  width: number,
  height: number
): PitWallHostable => ({ widget, kind: 'panel', width, height });

const overlayOf = (
  widget: WidgetId,
  width: number,
  aspect?: number
): PitWallHostable => ({
  widget,
  kind: 'overlay',
  width,
  height: DEFAULT_HEIGHT,
  ...(aspect === undefined ? {} : { aspect }),
});

/**
 * Every widget a panel of the Custom layout can host, in the order the
 * page offers them: the panels the fixed layouts are made of, then the
 * overlay widgets the page hosted before those were built. A page of pages
 * (the Gantry, the Pit Wall itself) is not a panel.
 *
 * The sizes of the first ten were measured on the page when the fixed
 * layouts were arranged. The others have the width the page laid them out
 * at before, and a height nobody has measured.
 */
export const PIT_WALL_HOSTABLE: readonly PitWallHostable[] = [
  panelOf('timingtower', 350, 300),
  panelOf('ourcar', 320, 330),
  panelOf('classrivals', 420, 240),
  panelOf('stinttimeline', 350, 220),
  panelOf('crew', 320, 330),
  panelOf('carlaps', 320, 240),
  panelOf('racecharts', 400, 300),
  panelOf('racelog', 280, 150),
  panelOf('map', 220, 200),
  panelOf('weatherforecast', 300, 135),
  overlayOf('standings', 520),
  overlayOf('fuel', 300),
  overlayOf('pitstop', 300),
  overlayOf('finishorder', 440),
  overlayOf('stinthistory', 380),
  overlayOf('wear', 260),
  overlayOf('traffic', 330),
  overlayOf('flagpanel', 400),
  overlayOf('timing', 300),
  overlayOf('laptimelog', 250),
  overlayOf('tyres', 240),
  // The car is drawn as tall as its box, with its figures beside it.
  overlayOf('damage', 220, 5 / 3),
  overlayOf('weather', 170),
];

const HOSTABLE_BY_WIDGET: ReadonlyMap<string, PitWallHostable> = new Map(
  PIT_WALL_HOSTABLE.map((entry) => [entry.widget, entry])
);

/** The widgets of PIT_WALL_HOSTABLE, in its order. */
export const PIT_WALL_HOSTABLE_WIDGETS: readonly WidgetId[] =
  PIT_WALL_HOSTABLE.map((entry) => entry.widget);

/** What is known of a widget a panel can host; undefined for any other. */
export const pitWallHostable = (
  widget: unknown
): PitWallHostable | undefined =>
  typeof widget === 'string' ? HOSTABLE_BY_WIDGET.get(widget) : undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isWhole = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value);

/** The rectangle is whole cells, at least one each way, all on the grid. */
export const isOnPitWallCustomGrid = (cells: PitWallCells): boolean =>
  isWhole(cells.x) &&
  isWhole(cells.y) &&
  isWhole(cells.w) &&
  isWhole(cells.h) &&
  cells.w >= 1 &&
  cells.h >= 1 &&
  cells.x >= 0 &&
  cells.y >= 0 &&
  cells.x + cells.w <= PIT_WALL_CUSTOM_COLUMNS &&
  cells.y + cells.h <= PIT_WALL_CUSTOM_ROWS;

/** The two rectangles share a cell. */
export const pitWallCellsOverlap = (a: PitWallCells, b: PitWallCells) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Reads a saved list of panels, which is untrusted. An entry is dropped
 * when it is not a panel at all, names a widget the page cannot host, is
 * not whole cells on the grid, repeats a widget, or lies on a cell an
 * earlier entry has: the first of two wins. Nothing else of an entry is
 * kept, and nothing here throws.
 *
 * Undefined for anything that is not a list, which is how a profile saved
 * before the Custom layout reads: the page then shows the layout as it
 * starts. A list with nothing left in it is an empty page, which the user
 * can have made.
 *
 * A panel smaller than its widget's minimum is kept. The minimum is a rule
 * for the hand that sizes a panel, and it can change between versions; a
 * panel the user placed is not thrown away for it.
 */
export const sanitizePitWallCustom = (
  value: unknown
): PitWallCustomPanel[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const kept: PitWallCustomPanel[] = [];
  for (const entry of value.slice(0, PIT_WALL_CUSTOM_MAX_ENTRIES)) {
    if (!isRecord(entry)) continue;
    const hostable = pitWallHostable(entry.widget);
    const { x, y, w, h } = entry;
    if (!hostable || !isWhole(x) || !isWhole(y) || !isWhole(w) || !isWhole(h)) {
      continue;
    }
    const candidate: PitWallCustomPanel = {
      widget: hostable.widget,
      x,
      y,
      w,
      h,
    };
    if (
      !isOnPitWallCustomGrid(candidate) ||
      kept.some(
        (other) =>
          other.widget === candidate.widget ||
          pitWallCellsOverlap(other, candidate)
      )
    ) {
      continue;
    }
    kept.push(candidate);
  }
  return kept;
};

/**
 * - `fits`: the panel may take the cells.
 * - `outside`: some of them are off the grid.
 * - `small`: the panel would be smaller than it may be made.
 * - `overlap`: another panel has one of them.
 */
export type PitWallCustomVerdict = 'fits' | 'outside' | 'small' | 'overlap';

/**
 * Whether a panel may take these cells among the others of a list: the one
 * rule for a panel dragged, sized, moved by a key or added.
 *
 * `min` is the least the panel's widget may be sized to. A panel that is
 * already smaller one way, as a list saved by hand or under other minimums
 * can have it, keeps what it has that way: it can be moved and made larger,
 * and not smaller still. The list's own entry for the widget is what the
 * panel is now, and is not in its own way.
 */
export const pitWallCustomVerdict = (
  panels: readonly PitWallCustomPanel[],
  candidate: PitWallCustomPanel,
  min: PitWallCellSize
): PitWallCustomVerdict => {
  if (!isOnPitWallCustomGrid(candidate)) return 'outside';
  const now = panels.find((entry) => entry.widget === candidate.widget);
  if (
    candidate.w < Math.min(min.w, now?.w ?? min.w) ||
    candidate.h < Math.min(min.h, now?.h ?? min.h)
  ) {
    return 'small';
  }
  return panels.some(
    (other) =>
      other.widget !== candidate.widget && pitWallCellsOverlap(other, candidate)
  )
    ? 'overlap'
    : 'fits';
};

/**
 * The first free place for a panel of this size: the highest, and of those
 * the furthest left. Undefined where the page has no room for it.
 */
export const pitWallCustomFreeSpace = (
  panels: readonly PitWallCells[],
  size: PitWallCellSize
): Pick<PitWallCells, 'x' | 'y'> | undefined => {
  for (let y = 0; y + size.h <= PIT_WALL_CUSTOM_ROWS; y++) {
    for (let x = 0; x + size.w <= PIT_WALL_CUSTOM_COLUMNS; x++) {
      const place = { x, y, ...size };
      if (!panels.some((other) => pitWallCellsOverlap(other, place))) {
        return { x, y };
      }
    }
  }
  return undefined;
};

/**
 * The panels as they are read on the page: row by row, left to right. A
 * list is saved in this order, so that the panels are drawn, and reached
 * with the Tab key, in the order they are seen.
 */
export const sortPitWallCustom = (
  panels: readonly PitWallCustomPanel[]
): PitWallCustomPanel[] => [...panels].sort((a, b) => a.y - b.y || a.x - b.x);

/** The two lists are the same page: the same widgets on the same cells. */
export const samePitWallCustom = (
  a: readonly PitWallCustomPanel[],
  b: readonly PitWallCustomPanel[]
): boolean =>
  a.length === b.length &&
  a.every((panel) =>
    b.some(
      (other) =>
        other.widget === panel.widget &&
        other.x === panel.x &&
        other.y === panel.y &&
        other.w === panel.w &&
        other.h === panel.h
    )
  );
