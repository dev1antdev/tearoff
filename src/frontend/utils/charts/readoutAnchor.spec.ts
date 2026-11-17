import { describe, expect, it } from 'vitest';
import { anchorInsideBounds } from './readoutAnchor';

const BOUNDS = { width: 1000, height: 600 };

describe('anchorInsideBounds', () => {
  it('anchors to the top left in the top-left quadrant', () => {
    expect(anchorInsideBounds({ x: 100, y: 100 }, BOUNDS, 14)).toEqual({
      left: 114,
      top: 114,
    });
  });

  it('anchors to the bottom right in the bottom-right quadrant', () => {
    expect(anchorInsideBounds({ x: 900, y: 500 }, BOUNDS, 14)).toEqual({
      right: 114,
      bottom: 114,
    });
  });

  it('never anchors to an edge the pointer is closest to', () => {
    const corners = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 0, y: 600 },
      { x: 1000, y: 600 },
    ];

    for (const corner of corners) {
      const anchor = anchorInsideBounds(corner, BOUNDS, 14);
      expect(Object.values(anchor).every((value) => value >= 14)).toBe(true);
    }
  });
});
