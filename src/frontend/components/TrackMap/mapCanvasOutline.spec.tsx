import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadTrackDrawing } from '@irdashies/domain/track/trackDrawingLoader';
import { FlatTrackMapCanvas } from './FlatTrackMapCanvas';
import { TrackCanvas, type TrackDrawing } from './TrackCanvas';

/**
 * The two canvases given a track and stretches to colour by their caller,
 * as they are for a session that carries its own outline. Neither is told
 * which sim that is; what is checked is what they paint.
 */
vi.mock('@irdashies/domain/track/trackDrawingLoader', () => ({
  loadTrackDrawing: vi.fn(async () => null),
}));
vi.mock('@irdashies/context', () => ({
  useTrackStateSnapshot: () => null,
  useCarIdxOffTrack: () => [],
  usePaintingPaused: () => false,
}));
vi.mock('@irdashies/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn() },
}));
// Theme colours come from CSS variables, which jsdom does not resolve.
vi.mock('@irdashies/utils/colors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@irdashies/utils/colors')>()),
  getColor: (color?: string, value = 500) => `${color}-${value}`,
}));

/** A square circuit: four samples and the first again, as an outline is. */
const outline: TrackDrawing = {
  active: {
    inside: 'M0,0 L100,0 L100,100 L0,100 Z',
    outside: 'M0,0 L100,0 L100,100 L0,100 Z',
    trackPathPoints: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 0 },
    ],
    totalLength: 4,
  },
  startFinish: {
    line: 'M0,-30 L0,30',
    point: { x: 0, y: 0, length: 0 },
    direction: 'anticlockwise',
  },
};
const TRACK_ID = 1_694_510_461;
const YELLOW = 'yellow-400';
const SECTORS = [
  { SectorNum: 0, SectorStartPct: 0 },
  { SectorNum: 1, SectorStartPct: 0.25 },
  { SectorNum: 2, SectorStartPct: 0.5 },
];
const SECOND_SECTOR = [{ from: 0.25, to: 0.5 }];

class DrawingPath {
  constructor(readonly source: string) {}
}

interface Stroke {
  /** The Path2D stroked, or the points of a path built by hand. */
  shape: string | [string, number, number][];
  color: unknown;
  width: number;
  cap: string;
}

let strokes: Stroke[];

/** A 2D context that remembers what was stroked, and with what. */
const createContext = () => {
  let path: [string, number, number][] = [];
  const context: Record<string, unknown> = {
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
    beginPath: () => {
      path = [];
    },
    moveTo: (x: number, y: number) => path.push(['move', x, y]),
    lineTo: (x: number, y: number) => path.push(['line', x, y]),
    stroke: (shape?: unknown) =>
      strokes.push({
        shape: shape instanceof DrawingPath ? shape.source : path,
        color: context.strokeStyle,
        width: context.lineWidth as number,
        cap: context.lineCap as string,
      }),
  };
  // Everything else a canvas is asked for here is drawing nobody checks.
  return new Proxy(context, {
    get: (target, key: string) => target[key] ?? (() => undefined),
  }) as unknown as CanvasRenderingContext2D;
};

beforeEach(() => {
  strokes = [];
  vi.mocked(loadTrackDrawing).mockClear();
  vi.stubGlobal('Path2D', DrawingPath);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    }
  );
  // Nothing moves in these: a settled map is painted on the commit.
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  const context = createContext();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(360);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const yellowStrokes = () => strokes.filter((stroke) => stroke.color === YELLOW);

describe('TrackCanvas with a drawing of its caller’s', () => {
  it('paints the outline without loading a drawing for the track id', () => {
    const { container } = render(
      <TrackCanvas trackId={TRACK_ID} trackDrawing={outline} drivers={[]} />
    );

    expect(container.querySelector('canvas')).not.toBeNull();
    expect(loadTrackDrawing).not.toHaveBeenCalled();
    expect(strokes.map((stroke) => stroke.shape)).toContain(
      outline.active.inside
    );
  });

  it('still loads the drawing for the track id when it is given none', () => {
    render(<TrackCanvas trackId={47} drivers={[]} />);

    expect(loadTrackDrawing).toHaveBeenCalledWith(47);
  });

  it('paints a stretch under yellow over the whole width of the road', () => {
    render(
      <TrackCanvas
        trackId={TRACK_ID}
        trackDrawing={outline}
        drivers={[]}
        yellowSpans={SECOND_SECTOR}
        trackLineWidth={20}
        trackOutlineWidth={40}
      />
    );

    const [band] = yellowStrokes();
    // The second side of the square, corner to corner.
    expect(band.shape).toEqual([
      ['move', 100, 0],
      ['line', 100, 100],
    ]);
    // As wide as the outline, so it is not taken for a sector coloured
    // for its pace, which is the line inside a dark edge.
    expect(band.width).toBe(40);
    expect(band.cap).toBe('butt');
    expect(yellowStrokes()).toHaveLength(1);
  });

  it('paints it over the road and under the sector ticks', () => {
    render(
      <TrackCanvas
        trackId={TRACK_ID}
        trackDrawing={outline}
        drivers={[]}
        sectors={SECTORS}
        sectorColors={['default', 'default', 'default']}
        yellowSpans={SECOND_SECTOR}
      />
    );

    const band = strokes.findIndex((stroke) => stroke.color === YELLOW);
    const road = strokes.findLastIndex(
      (stroke) => stroke.shape === outline.active.inside
    );
    const ticks = strokes
      .map((stroke, index) => ({ stroke, index }))
      .filter(({ stroke }) => stroke.color === 'rgba(255, 255, 255, 0.85)');

    expect(road).toBeGreaterThanOrEqual(0);
    expect(band).toBeGreaterThan(road);
    // One tick at each start but the line, which has its own mark.
    expect(ticks).toHaveLength(2);
    expect(Math.min(...ticks.map(({ index }) => index))).toBeGreaterThan(band);
  });

  it('paints none where the caller has no stretch to give', () => {
    render(
      <TrackCanvas
        trackId={TRACK_ID}
        trackDrawing={outline}
        drivers={[]}
        yellowSpans={[]}
      />
    );

    expect(yellowStrokes()).toEqual([]);
  });

  it('repaints the track when the flag goes in, on the same canvas', () => {
    const map = (yellowSpans: typeof SECOND_SECTOR) => (
      <TrackCanvas
        trackId={TRACK_ID}
        trackDrawing={outline}
        drivers={[]}
        yellowSpans={yellowSpans}
      />
    );
    const { container, rerender } = render(map(SECOND_SECTOR));
    const canvas = container.querySelector('canvas');
    expect(yellowStrokes()).toHaveLength(1);

    strokes = [];
    rerender(map([]));

    expect(container.querySelector('canvas')).toBe(canvas);
    expect(strokes.map((stroke) => stroke.shape)).toContain(
      outline.active.inside
    );
    expect(yellowStrokes()).toEqual([]);
  });
});

describe('FlatTrackMapCanvas', () => {
  it('needs no drawing: the lap is a straight line', () => {
    const { container } = render(<FlatTrackMapCanvas drivers={[]} />);

    expect(container.querySelector('canvas')).not.toBeNull();
    // The line itself, edge and all, and the start/finish mark.
    expect(strokes.length).toBeGreaterThanOrEqual(3);
    expect(yellowStrokes()).toEqual([]);
  });

  it('paints a stretch under yellow between its two ends on the line', () => {
    render(
      <FlatTrackMapCanvas
        drivers={[]}
        yellowSpans={SECOND_SECTOR}
        trackLineWidth={20}
        trackOutlineWidth={40}
      />
    );

    const [band] = yellowStrokes();
    // 640 wide with 40 either side: a quarter and a half of 560 from 40.
    expect(band.shape).toEqual([
      ['move', 180, 180],
      ['line', 320, 180],
    ]);
    // The outline's width at this map's quarter scale.
    expect(band.width).toBe(10);
    expect(band.cap).toBe('butt');
  });
});
