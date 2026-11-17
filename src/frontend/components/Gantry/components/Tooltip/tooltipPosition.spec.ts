import { describe, expect, it } from 'vitest';
import { clampToBounds, placeVertically } from './tooltipPosition';

const BOUNDS = { width: 1000, height: 600 };
const SIZE = { width: 200, height: 40 };

describe('clampToBounds', () => {
  it('leaves a box that already fits where it is', () => {
    expect(clampToBounds({ left: 100, top: 100 }, SIZE, BOUNDS)).toEqual({
      left: 100,
      top: 100,
    });
  });

  it('pulls a box back inside the right and bottom edges', () => {
    expect(clampToBounds({ left: 980, top: 590 }, SIZE, BOUNDS)).toEqual({
      left: 792,
      top: 552,
    });
  });

  it('pulls a box back inside the left and top edges', () => {
    expect(clampToBounds({ left: -50, top: -50 }, SIZE, BOUNDS)).toEqual({
      left: 8,
      top: 8,
    });
  });
});

describe('placeVertically', () => {
  const anchor = { top: 300, bottom: 320 };

  it('sits above the anchor when asked and there is room', () => {
    expect(placeVertically(anchor, 40, 'top', 600)).toBe(252);
  });

  it('sits below the anchor when asked and there is room', () => {
    expect(placeVertically(anchor, 40, 'bottom', 600)).toBe(328);
  });

  it('flips below when there is no room above', () => {
    const highAnchor = { top: 4, bottom: 24 };

    expect(placeVertically(highAnchor, 40, 'top', 600)).toBe(32);
  });

  it('flips above when there is no room below', () => {
    const lowAnchor = { top: 560, bottom: 580 };

    expect(placeVertically(lowAnchor, 40, 'bottom', 600)).toBe(512);
  });
});
