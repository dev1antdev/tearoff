import {
  PIT_WALL_CUSTOM_COLUMNS,
  PIT_WALL_CUSTOM_ROWS,
  PIT_WALL_GAP_PX,
  type PitWallCells,
  type PitWallCustomPanel,
  type PitWallCustomVerdict,
} from '@irdashies/types';

/*
 * The arithmetic of arranging the Custom layout by hand: what a drag of so
 * many pixels, or a key, asks of a panel. Whether the panel may have what
 * is asked is `pitWallCustomVerdict` in `src/types/pitWallCustom.ts`; the
 * component only wires pointer and key events to the two.
 */

/** A cell and the gap beside it, in the pixels a pointer is reported in. */
export interface CellPitch {
  x: number;
  y: number;
}

/**
 * The pitch of the cells of a grid drawn in a box of this size, margins
 * included. `scale` is how many times larger than laid out the page is
 * drawn, which is how many pixels of the pointer's a pixel of the gap is.
 *
 * Undefined for a box that has not been laid out, where a drag has nothing
 * to be measured against.
 */
export const cellPitch = (
  box: { width: number; height: number },
  scale = 1
): CellPitch | undefined => {
  // The margin is a gap each side, and the cells have one gap fewer than
  // there are cells: so a cell and its gap is the box less one gap, shared.
  const gap = PIT_WALL_GAP_PX * scale;
  const x = (box.width - gap) / PIT_WALL_CUSTOM_COLUMNS;
  const y = (box.height - gap) / PIT_WALL_CUSTOM_ROWS;
  return x > 0 && y > 0 && Number.isFinite(x) && Number.isFinite(y)
    ? { x, y }
    : undefined;
};

/** How many whole cells a drag of so many pixels comes to: the nearest. */
export const cellsDragged = (pixels: number, pitch: number): number => {
  const cells = Math.round(pixels / pitch);
  // Never the minus nought a short drag back rounds to.
  return cells === 0 ? 0 : cells;
};

/** A panel is dragged by its title bar to move it, by its corner to size it. */
export type PanelDragKind = 'move' | 'size';

/**
 * The cells a panel would take dragged by so many cells: moved whole, or
 * with its lower right corner taken that far and its upper left left where
 * it is. A panel sized is never less than a cell each way, so that there is
 * always a rectangle to show.
 */
export const draggedCells = (
  cells: PitWallCells,
  kind: PanelDragKind,
  dx: number,
  dy: number
): PitWallCells =>
  kind === 'move'
    ? { x: cells.x + dx, y: cells.y + dy, w: cells.w, h: cells.h }
    : {
        x: cells.x,
        y: cells.y,
        w: Math.max(1, cells.w + dx),
        h: Math.max(1, cells.h + dy),
      };

/**
 * The part of a rectangle of cells that is on the grid, which is the part
 * that can be drawn there. Undefined where none of it is.
 */
export const cellsOnGrid = (cells: PitWallCells): PitWallCells | undefined => {
  const left = Math.max(0, cells.x);
  const top = Math.max(0, cells.y);
  const right = Math.min(PIT_WALL_CUSTOM_COLUMNS, cells.x + cells.w);
  const bottom = Math.min(PIT_WALL_CUSTOM_ROWS, cells.y + cells.h);
  return right > left && bottom > top
    ? { x: left, y: top, w: right - left, h: bottom - top }
    : undefined;
};

const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * What a key asks of the panel in focus: an arrow moves it a cell, and with
 * Shift held sizes it by a cell. Undefined for any other key.
 */
export const keyStep = (
  key: string,
  shift: boolean
): { kind: PanelDragKind; dx: number; dy: number } | undefined => {
  const arrow = Object.hasOwn(ARROWS, key) ? ARROWS[key] : undefined;
  return arrow
    ? { kind: shift ? 'size' : 'move', dx: arrow[0], dy: arrow[1] }
    : undefined;
};

/** The list with one panel on other cells, and every other as it was. */
export const withPanelOn = (
  panels: readonly PitWallCustomPanel[],
  widget: string,
  cells: PitWallCells
): PitWallCustomPanel[] =>
  panels.map((panel) =>
    panel.widget === widget
      ? { widget: panel.widget, x: cells.x, y: cells.y, w: cells.w, h: cells.h }
      : panel
  );

/** `14,0,5,4`: a rectangle of cells as text, left, top, across and down. */
export const cellsText = (cells: PitWallCells): string =>
  `${cells.x},${cells.y},${cells.w},${cells.h}`;

/** `4 × 3`: a size in cells as the page writes it. */
export const cellSizeLabel = (size: { w: number; h: number }): string =>
  `${size.w} × ${size.h}`;

/**
 * Why a panel was not let have the cells asked for, as the end of a
 * sentence that begins with the panel's name. `min` is the least the panel
 * may be sized to.
 */
export const refusalReason = (
  verdict: Exclude<PitWallCustomVerdict, 'fits'>,
  min: { w: number; h: number }
): string => {
  switch (verdict) {
    case 'outside':
      return 'would leave the page';
    case 'overlap':
      return 'has another panel in the way';
    case 'small':
      return `cannot be smaller than ${min.w} by ${min.h} cells`;
  }
};
