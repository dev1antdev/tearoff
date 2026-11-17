import { describe, expect, it } from 'vitest';
import {
  PIT_WALL_CUSTOM_COLUMNS,
  PIT_WALL_CUSTOM_ROWS,
  PIT_WALL_GAP_PX,
  type PitWallCustomPanel,
} from '@irdashies/types';
import {
  cellPitch,
  cellSizeLabel,
  cellsDragged,
  cellsText,
  cellsOnGrid,
  draggedCells,
  keyStep,
  refusalReason,
  withPanelOn,
} from './pitWallCustomEdit';

const panel = (
  widget: string,
  x: number,
  y: number,
  w: number,
  h: number
): PitWallCustomPanel => ({ widget, x, y, w, h }) as PitWallCustomPanel;

describe('cellPitch', () => {
  it('is a cell and the gap beside it, from the box the grid is drawn in', () => {
    // 24 cells of 50 with 23 gaps of 12 between them and a margin of 12
    // each side; 16 cells of 30 the same way.
    const width = 24 * 50 + 23 * PIT_WALL_GAP_PX + 2 * PIT_WALL_GAP_PX;
    const height = 16 * 30 + 15 * PIT_WALL_GAP_PX + 2 * PIT_WALL_GAP_PX;
    expect(cellPitch({ width, height })).toEqual({ x: 62, y: 42 });
  });

  it('comes to the box again, counted across the cells', () => {
    const box = { width: 1600, height: 843 };
    const pitch = cellPitch(box);
    // Every cell with its gap, less the one gap too many, and the margins.
    expect(
      (pitch?.x ?? 0) * PIT_WALL_CUSTOM_COLUMNS -
        PIT_WALL_GAP_PX +
        2 * PIT_WALL_GAP_PX
    ).toBeCloseTo(box.width, 6);
    expect(
      (pitch?.y ?? 0) * PIT_WALL_CUSTOM_ROWS -
        PIT_WALL_GAP_PX +
        2 * PIT_WALL_GAP_PX
    ).toBeCloseTo(box.height, 6);
  });

  it('counts the gap as it is drawn on a page shown larger or smaller than laid out', () => {
    // At 150 % a gap of 12 is 18 of the pointer's pixels.
    const scaled = cellPitch({ width: 2400, height: 1200 }, 1.5);
    expect(scaled?.x).toBeCloseTo((2400 - 18) / 24, 6);
    expect(scaled?.y).toBeCloseTo((1200 - 18) / 16, 6);
    // And is the pitch of the page as laid out, times the scale.
    const laidOut = cellPitch({ width: 1600, height: 800 });
    expect(scaled?.x).toBeCloseTo((laidOut?.x ?? 0) * 1.5, 6);
    expect(scaled?.y).toBeCloseTo((laidOut?.y ?? 0) * 1.5, 6);
  });

  it('has no answer for a box that has not been laid out', () => {
    expect(cellPitch({ width: 0, height: 0 })).toBeUndefined();
    expect(cellPitch({ width: 1600, height: 0 })).toBeUndefined();
    expect(cellPitch({ width: 10, height: 900 })).toBeUndefined();
    expect(cellPitch({ width: Number.NaN, height: 900 })).toBeUndefined();
    expect(cellPitch({ width: 1600, height: 900 }, Number.NaN)).toBeUndefined();
  });
});

describe('cellsDragged', () => {
  it('snaps a drag to the nearest whole cell', () => {
    expect(cellsDragged(0, 60)).toBe(0);
    expect(cellsDragged(29, 60)).toBe(0);
    expect(cellsDragged(31, 60)).toBe(1);
    expect(cellsDragged(60, 60)).toBe(1);
    expect(cellsDragged(149, 60)).toBe(2);
    expect(cellsDragged(151, 60)).toBe(3);
  });

  it('snaps a drag back the same way', () => {
    expect(cellsDragged(-29, 60)).toBe(0);
    expect(cellsDragged(-31, 60)).toBe(-1);
    expect(cellsDragged(-200, 60)).toBe(-3);
  });

  it('is nought, and never minus nought, for a drag that comes to no cell', () => {
    expect(Object.is(cellsDragged(-10, 60), 0)).toBe(true);
    expect(Object.is(cellsDragged(-0, 60), 0)).toBe(true);
  });
});

describe('draggedCells', () => {
  const cells = { x: 4, y: 2, w: 6, h: 5 };

  it('moves the whole panel by so many cells', () => {
    expect(draggedCells(cells, 'move', 3, -1)).toEqual({
      x: 7,
      y: 1,
      w: 6,
      h: 5,
    });
    expect(draggedCells(cells, 'move', 0, 0)).toEqual(cells);
  });

  it('moves a panel off the page when it is dragged there: the rule says no, not the arithmetic', () => {
    expect(draggedCells(cells, 'move', -6, 0)).toEqual({
      x: -2,
      y: 2,
      w: 6,
      h: 5,
    });
    expect(draggedCells(cells, 'move', 30, 20)).toEqual({
      x: 34,
      y: 22,
      w: 6,
      h: 5,
    });
  });

  it('sizes a panel by its lower right corner, with its upper left where it was', () => {
    expect(draggedCells(cells, 'size', 2, 3)).toEqual({
      x: 4,
      y: 2,
      w: 8,
      h: 8,
    });
    expect(draggedCells(cells, 'size', -2, -1)).toEqual({
      x: 4,
      y: 2,
      w: 4,
      h: 4,
    });
  });

  it('never sizes a panel to less than a cell each way', () => {
    expect(draggedCells(cells, 'size', -6, -5)).toEqual({
      x: 4,
      y: 2,
      w: 1,
      h: 1,
    });
    expect(draggedCells(cells, 'size', -40, -40)).toEqual({
      x: 4,
      y: 2,
      w: 1,
      h: 1,
    });
  });

  it('takes nothing but the cells from what it is given', () => {
    const moved = draggedCells(panel('map', 1, 1, 3, 3), 'move', 1, 1);
    expect(Object.keys(moved)).toEqual(['x', 'y', 'w', 'h']);
  });
});

describe('cellsOnGrid', () => {
  it('is the rectangle itself where it is all on the page', () => {
    expect(cellsOnGrid({ x: 4, y: 2, w: 6, h: 5 })).toEqual({
      x: 4,
      y: 2,
      w: 6,
      h: 5,
    });
    expect(cellsOnGrid({ x: 0, y: 0, w: 24, h: 16 })).toEqual({
      x: 0,
      y: 0,
      w: 24,
      h: 16,
    });
  });

  it('is the part that is on the page where some of it is not', () => {
    expect(cellsOnGrid({ x: -2, y: 2, w: 6, h: 5 })).toEqual({
      x: 0,
      y: 2,
      w: 4,
      h: 5,
    });
    expect(cellsOnGrid({ x: 20, y: 13, w: 6, h: 5 })).toEqual({
      x: 20,
      y: 13,
      w: 4,
      h: 3,
    });
    expect(cellsOnGrid({ x: -1, y: -1, w: 30, h: 20 })).toEqual({
      x: 0,
      y: 0,
      w: 24,
      h: 16,
    });
  });

  it('is nothing where none of it is', () => {
    expect(cellsOnGrid({ x: 24, y: 0, w: 4, h: 4 })).toBeUndefined();
    expect(cellsOnGrid({ x: 0, y: 16, w: 4, h: 4 })).toBeUndefined();
    expect(cellsOnGrid({ x: -4, y: 0, w: 4, h: 4 })).toBeUndefined();
    expect(cellsOnGrid({ x: 0, y: -9, w: 4, h: 4 })).toBeUndefined();
  });
});

describe('keyStep', () => {
  it('moves the panel a cell for an arrow key', () => {
    expect(keyStep('ArrowLeft', false)).toEqual({
      kind: 'move',
      dx: -1,
      dy: 0,
    });
    expect(keyStep('ArrowRight', false)).toEqual({
      kind: 'move',
      dx: 1,
      dy: 0,
    });
    expect(keyStep('ArrowUp', false)).toEqual({ kind: 'move', dx: 0, dy: -1 });
    expect(keyStep('ArrowDown', false)).toEqual({ kind: 'move', dx: 0, dy: 1 });
  });

  it('sizes it by a cell with Shift held', () => {
    expect(keyStep('ArrowLeft', true)).toEqual({ kind: 'size', dx: -1, dy: 0 });
    expect(keyStep('ArrowRight', true)).toEqual({ kind: 'size', dx: 1, dy: 0 });
    expect(keyStep('ArrowUp', true)).toEqual({ kind: 'size', dx: 0, dy: -1 });
    expect(keyStep('ArrowDown', true)).toEqual({ kind: 'size', dx: 0, dy: 1 });
  });

  it('asks nothing of the panel for any other key', () => {
    for (const key of [
      'Enter',
      ' ',
      'Escape',
      'Tab',
      'a',
      'Home',
      'toString',
    ]) {
      expect(keyStep(key, false)).toBeUndefined();
      expect(keyStep(key, true)).toBeUndefined();
    }
  });

  it('comes to the same cells as a drag of that many', () => {
    const cells = { x: 4, y: 2, w: 6, h: 5 };
    const step = keyStep('ArrowDown', true);
    expect(step && draggedCells(cells, step.kind, step.dx, step.dy)).toEqual({
      x: 4,
      y: 2,
      w: 6,
      h: 6,
    });
  });
});

describe('withPanelOn', () => {
  const tower = panel('timingtower', 0, 0, 14, 11);
  const ourCar = panel('ourcar', 14, 0, 5, 5);

  it('puts one panel on other cells and leaves the others, and the order, as they were', () => {
    const list = [tower, ourCar];
    const next = withPanelOn(list, 'ourcar', { x: 19, y: 3, w: 5, h: 6 });
    expect(next).toEqual([tower, panel('ourcar', 19, 3, 5, 6)]);
    expect(next[0]).toBe(tower);
    // The list given is as it was.
    expect(list).toEqual([tower, ourCar]);
    expect(list[1]).toBe(ourCar);
  });

  it('changes nothing for a widget that is not on the page', () => {
    expect(withPanelOn([tower], 'map', { x: 20, y: 0, w: 4, h: 4 })).toEqual([
      tower,
    ]);
  });
});

describe('what the page says of a size and of a refusal', () => {
  it('writes a size as cells across by cells down', () => {
    expect(cellSizeLabel({ w: 14, h: 11 })).toBe('14 × 11');
    expect(cellSizeLabel(panel('map', 3, 3, 5, 4))).toBe('5 × 4');
  });

  it('writes a rectangle of cells as its left, top, width and height', () => {
    expect(cellsText({ x: 14, y: 0, w: 5, h: 4 })).toBe('14,0,5,4');
    expect(cellsText(panel('map', -2, 3, 5, 4))).toBe('-2,3,5,4');
  });

  it('says why a panel was refused its cells', () => {
    const min = { w: 4, h: 3 };
    expect(refusalReason('outside', min)).toBe('would leave the page');
    expect(refusalReason('overlap', min)).toBe('has another panel in the way');
    expect(refusalReason('small', min)).toBe(
      'cannot be smaller than 4 by 3 cells'
    );
  });
});
