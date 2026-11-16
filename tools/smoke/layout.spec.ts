import { describe, expect, it } from 'vitest';
import { planGrid, rectsOverlap } from './layout.ts';

const box = (id: string, width: number, height: number) => ({
  id,
  width,
  height,
});

describe('planGrid', () => {
  it('places widgets side by side without any two sharing area', () => {
    const plan = planGrid({ width: 1920, height: 1080 }, [
      box('standings', 560, 774),
      box('relative', 402, 300),
      box('input', 396, 92),
      box('fuel', 300, 520),
    ]);

    expect(plan.layers).toBe(1);
    for (const a of plan.placements) {
      for (const b of plan.placements) {
        if (a.id !== b.id) expect(rectsOverlap(a, b)).toBe(false);
      }
    }
  });

  it('keeps every box inside the display', () => {
    const display = { width: 1024, height: 768 };
    const plan = planGrid(
      display,
      Array.from({ length: 30 }, (_, i) => box(`w${i}`, 300, 200))
    );

    for (const place of plan.placements) {
      expect(place.x).toBeGreaterThanOrEqual(0);
      expect(place.y).toBeGreaterThanOrEqual(0);
      expect(place.x + place.width).toBeLessThanOrEqual(display.width);
      expect(place.y + place.height).toBeLessThanOrEqual(display.height);
    }
  });

  it('starts a further sheet when the display is full', () => {
    const plan = planGrid(
      { width: 1024, height: 768 },
      Array.from({ length: 30 }, (_, i) => box(`w${i}`, 300, 200))
    );

    expect(plan.layers).toBeGreaterThan(1);
    // Within one sheet nothing overlaps.
    for (const a of plan.placements) {
      for (const b of plan.placements) {
        if (a.id !== b.id && a.layer === b.layer) {
          expect(rectsOverlap(a, b)).toBe(false);
        }
      }
    }
  });

  it('scales a widget larger than the display, in steps the app accepts', () => {
    const plan = planGrid({ width: 1024, height: 768 }, [
      box('standings', 560, 774),
      box('ticker', 1920, 72),
    ]);
    const standings = plan.placements.find((p) => p.id === 'standings');
    const ticker = plan.placements.find((p) => p.id === 'ticker');

    expect(standings?.scale).toBe(95);
    expect(standings?.height).toBeLessThanOrEqual(768 - 16);
    expect(ticker?.scale).toBe(50);
    expect(ticker?.width).toBe(960);
  });

  it('never scales below the app minimum; the box is cut instead', () => {
    const plan = planGrid({ width: 800, height: 600 }, [
      box('wall', 4000, 300),
    ]);

    expect(plan.placements[0].scale).toBe(50);
    expect(plan.placements[0].width).toBe(800 - 16);
  });

  it('leaves a widget that fits at its own size', () => {
    const plan = planGrid({ width: 1920, height: 1080 }, [box('a', 300, 100)]);

    expect(plan.placements[0]).toMatchObject({
      scale: 100,
      width: 300,
      height: 100,
      layer: 0,
    });
  });

  it('has no sheets for no widgets', () => {
    expect(planGrid({ width: 1920, height: 1080 }, [])).toEqual({
      placements: [],
      layers: 0,
    });
  });
});

describe('rectsOverlap', () => {
  it('does not count touching edges as overlap', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };

    expect(rectsOverlap(a, { x: 10, y: 0, width: 10, height: 10 })).toBe(false);
    expect(rectsOverlap(a, { x: 9, y: 9, width: 10, height: 10 })).toBe(true);
  });
});
