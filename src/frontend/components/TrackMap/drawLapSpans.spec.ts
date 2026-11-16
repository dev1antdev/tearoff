import { describe, expect, it } from 'vitest';
import { drawLapSpans } from './trackDrawingUtils';

/**
 * A square circuit a hundred units a side, as a path that closes on itself:
 * four corners and the first again. Each side is a quarter of the lap.
 */
const square = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
  { x: 0, y: 0 },
];
const LENGTH = 400;

type Step = ['move' | 'line', number, number];

/** A context that only remembers what was stroked, and how. */
const recorder = () => {
  const strokes: {
    path: Step[];
    color: unknown;
    width: number;
    cap: string;
  }[] = [];
  let path: Step[] = [];
  const context = {
    strokeStyle: '' as unknown,
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
    save: () => undefined,
    restore: () => undefined,
    beginPath: () => {
      path = [];
    },
    moveTo: (x: number, y: number) => path.push(['move', x, y]),
    lineTo: (x: number, y: number) => path.push(['line', x, y]),
    stroke: () =>
      strokes.push({
        path,
        color: context.strokeStyle,
        width: context.lineWidth,
        cap: context.lineCap,
      }),
  };
  return {
    context: context as unknown as CanvasRenderingContext2D,
    strokes,
  };
};

const draw = (
  spans: { from: number; to: number }[],
  direction: 'clockwise' | 'anticlockwise' = 'anticlockwise',
  startLength = 0
) => {
  const { context, strokes } = recorder();
  drawLapSpans(
    context,
    square,
    LENGTH,
    startLength,
    direction,
    spans,
    'yellow',
    40
  );
  return strokes;
};

/** Rounded, so a sum of floats reads as the place it is. */
const places = (path: Step[]) =>
  path.map(([kind, x, y]) => [kind, Math.round(x), Math.round(y)]);

describe('drawLapSpans', () => {
  it('strokes a stretch from its start to its end through the corners between', () => {
    const [stroke] = draw([{ from: 0.125, to: 0.625 }]);

    expect(places(stroke.path)).toEqual([
      ['move', 50, 0],
      ['line', 100, 0],
      ['line', 100, 100],
      ['line', 50, 100],
    ]);
  });

  it('stops between two points, not at the nearest one', () => {
    const [stroke] = draw([{ from: 0.3, to: 0.4 }]);

    // A tenth of a lap on one side of the square: no corner in it.
    expect(places(stroke.path)).toEqual([
      ['move', 100, 20],
      ['line', 100, 60],
    ]);
  });

  it('runs the last stretch of the lap up to the line', () => {
    const [stroke] = draw([{ from: 0.75, to: 1 }]);

    expect(places(stroke.path)).toEqual([
      ['move', 0, 100],
      ['line', 0, 0],
    ]);
  });

  it('carries on round the end of the path where the line is not its first point', () => {
    // The line half-way down the second side, so half a lap on is half-way
    // up the fourth: the stretch runs through the place where the array
    // ends and begins again.
    const [stroke] = draw([{ from: 0.5, to: 0.875 }], 'anticlockwise', 150);

    expect(places(stroke.path)).toEqual([
      ['move', 0, 50],
      ['line', 0, 0],
      ['line', 100, 0],
    ]);
  });

  it('walks the path backwards for a circuit drawn the other way round', () => {
    const [stroke] = draw([{ from: 0.125, to: 0.625 }], 'clockwise');

    // From the line the lap goes up the fourth side first.
    expect(places(stroke.path)).toEqual([
      ['move', 0, 50],
      ['line', 0, 100],
      ['line', 100, 100],
      ['line', 100, 50],
    ]);
  });

  it('strokes each stretch on its own, in the colour and width it is given', () => {
    const strokes = draw([
      { from: 0, to: 0.25 },
      { from: 0.5, to: 0.75 },
    ]);

    expect(strokes).toHaveLength(2);
    expect(places(strokes[0].path)).toEqual([
      ['move', 0, 0],
      ['line', 100, 0],
    ]);
    expect(places(strokes[1].path)).toEqual([
      ['move', 100, 100],
      ['line', 0, 100],
    ]);
    for (const stroke of strokes) {
      expect(stroke.color).toBe('yellow');
      expect(stroke.width).toBe(40);
      // Cut square: a round end would reach into the next sector.
      expect(stroke.cap).toBe('butt');
    }
  });

  it('covers the whole lap once for a stretch that is all of it', () => {
    const [stroke] = draw([{ from: 0, to: 1 }]);

    expect(places(stroke.path)).toEqual([
      ['move', 0, 0],
      ['line', 100, 0],
      ['line', 100, 100],
      ['line', 0, 100],
      ['line', 0, 0],
    ]);
  });

  it('draws nothing for no stretch, an empty one or a path too short to have one', () => {
    expect(draw([])).toEqual([]);
    expect(draw([{ from: 0.5, to: 0.5 }])).toEqual([]);
    expect(draw([{ from: 0.6, to: 0.4 }])).toEqual([]);

    const { context, strokes } = recorder();
    drawLapSpans(
      context,
      [{ x: 0, y: 0 }],
      LENGTH,
      0,
      'anticlockwise',
      [{ from: 0, to: 1 }],
      'yellow',
      40
    );
    expect(strokes).toEqual([]);
  });
});
