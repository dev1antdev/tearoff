import { act, cleanup, render } from '@testing-library/react';
import { pathRound } from 'd3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetScale } from '@irdashies/domain/widgetPresentation/WidgetScale';
import { InputTrace, type InputTraceProps } from './InputTrace';

vi.mock('@irdashies/utils/colors', () => ({
  getColor: (name: string) => name,
}));

const settings = {
  includeBrake: true,
  includeThrottle: true,
  includeClutch: true,
  includeSteer: true,
  includeAbs: true,
  absStyle: 'bar' as const,
};
const activeInput = {
  brake: 0.8,
  throttle: 0.6,
  clutch: 0.4,
  steer: Math.PI,
  brakeAbsActive: true,
};
const idleInput = {
  brake: 0,
  throttle: 0,
  clutch: 0,
  steer: 0,
  brakeAbsActive: false,
};

interface DrawnPath {
  kind: 'stroke' | 'fill';
  color: string;
  path: string;
  width: number;
  alpha: number;
}

// Record the numeric Canvas commands as paths, at the SVG generator's former
// precision. Tests exercise curves/history without depending on jsdom rasterization.
function recordContext(canvas: HTMLCanvasElement) {
  let currentPath = pathRound(3);
  const drawn: DrawnPath[] = [];
  const ctx = {
    canvas,
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    setTransform: vi.fn(),
    setLineDash: vi.fn(),
    clearRect: () => {
      drawn.length = 0;
    },
    beginPath: () => {
      currentPath = pathRound(3);
    },
    moveTo: (x: number, y: number) => currentPath.moveTo(x, y),
    lineTo: (x: number, y: number) => currentPath.lineTo(x, y),
    bezierCurveTo: (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      x: number,
      y: number
    ) => currentPath.bezierCurveTo(x1, y1, x2, y2, x, y),
    closePath: () => currentPath.closePath(),
    stroke: () =>
      drawn.push({
        kind: 'stroke',
        color: ctx.strokeStyle,
        path: currentPath.toString(),
        width: ctx.lineWidth,
        alpha: ctx.globalAlpha,
      }),
    fill: () =>
      drawn.push({
        kind: 'fill',
        color: ctx.fillStyle,
        path: currentPath.toString(),
        width: ctx.lineWidth,
        alpha: ctx.globalAlpha,
      }),
  };
  return { ctx, drawn };
}

describe('InputTrace Canvas', () => {
  let callbacks: Map<number, FrameRequestCallback>;
  let contexts: Map<HTMLCanvasElement, ReturnType<typeof recordContext>>;
  let observers: Map<Element, ResizeObserverCallback>;
  let nextId: number;
  const recordMeasure = vi.fn();

  const resize = (canvas: HTMLCanvasElement, width: number, height: number) => {
    act(() =>
      observers.get(canvas)?.(
        [{ contentRect: { width, height } }] as ResizeObserverEntry[],
        {} as ResizeObserver
      )
    );
  };
  const canvasFor = (container: HTMLElement) => {
    const canvas = container.querySelector('canvas');
    if (!canvas) throw new Error('Expected the trace canvas');
    return canvas;
  };
  const contextFor = (canvas: HTMLCanvasElement) => {
    const context = contexts.get(canvas);
    if (!context) throw new Error('Expected a recorded Canvas context');
    return context;
  };
  const paths = (container: HTMLElement) =>
    contextFor(canvasFor(container)).drawn;
  const drawFrame = () => {
    act(() => {
      const pending = Array.from(callbacks.values());
      callbacks.clear();
      pending.forEach((callback) => callback(performance.now()));
    });
  };
  const trace = (input: InputTraceProps['input'], maxSamples: number) => (
    <InputTrace input={input} settings={{ ...settings, maxSamples }} />
  );

  beforeEach(() => {
    callbacks = new Map();
    contexts = new Map();
    observers = new Map();
    nextId = 0;
    recordMeasure.mockClear();
    window.rendererPerfBridge = { recordMeasure };
    vi.stubGlobal('devicePixelRatio', 1);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      function (this: HTMLCanvasElement) {
        const recording = contexts.get(this) ?? recordContext(this);
        contexts.set(this, recording);
        return recording.ctx as unknown as CanvasRenderingContext2D;
      }
    );
    vi.stubGlobal(
      'ResizeObserver',
      class {
        private element?: Element;
        constructor(private callback: ResizeObserverCallback) {}
        observe(element: Element) {
          this.element = element;
          observers.set(element, this.callback);
          this.callback(
            [
              { contentRect: { width: 400, height: 100 } },
            ] as ResizeObserverEntry[],
            this as unknown as ResizeObserver
          );
        }
        disconnect() {
          if (this.element) observers.delete(this.element);
        }
      }
    );
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++nextId;
      callbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete window.rendererPerfBridge;
  });

  it('retains history until samples leave the circular buffer', () => {
    const existing = render(trace(activeInput, 40));
    drawFrame();
    existing.rerender(trace({ ...idleInput }, 40));
    drawFrame();
    const fresh = render(trace(idleInput, 40));
    drawFrame();
    expect(paths(existing.container)).not.toEqual(paths(fresh.container));
    for (let index = 1; index < 40; index++) {
      existing.rerender(trace({ ...idleInput }, 40));
      drawFrame();
    }
    expect(paths(existing.container)).toEqual(paths(fresh.container));
  });

  it.each([
    [40, 80],
    [80, 40],
  ])('resets every channel when capacity changes from %i to %i', (from, to) => {
    const existing = render(trace(activeInput, from));
    drawFrame();
    for (let index = 1; index < from - 5; index++) {
      existing.rerender(trace({ ...activeInput }, from));
      drawFrame();
    }
    existing.rerender(trace(idleInput, to));
    drawFrame();
    const fresh = render(trace(idleInput, to));
    drawFrame();
    expect(paths(existing.container)).toEqual(paths(fresh.container));
    expect(JSON.stringify(paths(existing.container))).not.toMatch(
      /NaN|Infinity/
    );
    existing.rerender(trace(activeInput, to));
    fresh.rerender(trace(activeInput, to));
    drawFrame();
    expect(paths(existing.container)).toEqual(paths(fresh.container));
  });

  it('retains every input update while coalescing paints and cancels on unmount', () => {
    const existing = render(trace(activeInput, 40));
    recordMeasure.mockClear();
    existing.rerender(trace(idleInput, 40));
    expect(callbacks.size).toBe(1);
    expect(recordMeasure).not.toHaveBeenCalled();
    drawFrame();
    expect(recordMeasure).toHaveBeenCalledExactlyOnceWith(
      'inputTraceFrame',
      expect.any(Number)
    );
    const fresh = render(trace(activeInput, 40));
    drawFrame();
    fresh.rerender(trace(idleInput, 40));
    drawFrame();
    expect(paths(existing.container)).toEqual(paths(fresh.container));
    existing.rerender(trace(activeInput, 40));
    existing.unmount();
    expect(callbacks.size).toBe(0);
    expect(observers.size).toBe(1); // Only the fresh instance remains.
  });

  it('preserves channel order, steering normalization, colors and ABS bar opacity', () => {
    const view = render(trace(activeInput, 2));
    drawFrame();
    const drawn = paths(view.container);
    expect(drawn.map(({ kind, color }) => [kind, color])).toEqual([
      ['stroke', '#666'],
      ['stroke', 'slate'],
      ['stroke', 'blue'],
      ['stroke', 'green'],
      ['fill', 'yellow'],
      ['stroke', 'red'],
      ['stroke', 'yellow'],
    ]);
    expect(drawn[1].path).toBe('M0,50L400,0');
    expect(drawn[5].path).toBe('M0,95.455L400,22.727');
    expect(drawn[4].alpha).toBe(0.3);
    expect(drawn[5].alpha).toBe(1);
    expect(drawn[6].width).toBe(3);
    expect(view.container.querySelector('svg')).toBeNull();
    expect(recordMeasure).toHaveBeenLastCalledWith(
      'inputTraceFrame',
      expect.any(Number)
    );
  });

  it('marks the throttle while traction control cuts, the way ABS marks the brake', () => {
    const cutting = { ...activeInput, tcActive: true };
    const view = render(trace(cutting, 2));
    drawFrame();
    // A second sample, so that the cut spans the whole history.
    view.rerender(trace({ ...cutting }, 2));
    drawFrame();
    const drawn = paths(view.container);
    // The fill under each curve, the curve, then its highlight: the
    // throttle's set first, the brake's on top.
    expect(drawn.map(({ kind, color }) => [kind, color])).toEqual([
      ['stroke', '#666'],
      ['stroke', 'slate'],
      ['stroke', 'blue'],
      ['fill', 'yellow'],
      ['stroke', 'green'],
      ['stroke', 'yellow'],
      ['fill', 'yellow'],
      ['stroke', 'red'],
      ['stroke', 'yellow'],
    ]);
    // The mark follows the throttle, not the brake.
    expect(drawn[5].path).toBe(drawn[4].path);
    expect(drawn[5].path).not.toBe(drawn[7].path);
    expect(drawn[3].alpha).toBe(0.3);
    expect(drawn[4].alpha).toBe(1);
    expect(drawn[5].width).toBe(3);
  });

  it('draws the traction control overlay wider and the brake after it at its own width', () => {
    const view = render(
      <InputTrace
        input={{ ...activeInput, tcActive: true }}
        settings={{ ...settings, absStyle: 'overlay' }}
      />
    );
    drawFrame();
    const drawn = paths(view.container);
    expect(
      drawn.map(({ kind, color, width }) => [kind, color, width]).slice(3)
    ).toEqual([
      ['stroke', 'green', 3],
      ['stroke', 'yellow', 5],
      ['stroke', 'red', 3],
      ['stroke', 'yellow', 5],
    ]);
  });

  it('draws no traction control mark when it is off, or when the throttle is', () => {
    const cutting = { ...activeInput, brakeAbsActive: false, tcActive: true };
    const off = render(
      <InputTrace
        input={cutting}
        settings={{ ...settings, includeAbs: false, includeTc: false }}
      />
    );
    const noThrottle = render(
      <InputTrace
        input={cutting}
        settings={{ ...settings, includeAbs: false, includeThrottle: false }}
      />
    );
    drawFrame();
    for (const view of [off, noThrottle]) {
      expect(
        paths(view.container).some(({ color }) => color === 'yellow')
      ).toBe(false);
    }
  });

  it('stops drawing the mark once the last cut has left the history', () => {
    const view = render(trace({ ...idleInput, tcActive: true }, 4));
    drawFrame();
    const marked = () =>
      paths(view.container).filter(({ color }) => color === 'yellow').length;
    // The fill and the highlight for traction control, and ABS's two.
    expect(marked()).toBe(4);
    for (let index = 1; index < 4; index++) {
      view.rerender(trace({ ...idleInput }, 4));
      drawFrame();
      expect(marked()).toBe(4);
    }
    view.rerender(trace({ ...idleInput }, 4));
    drawFrame();
    // Only ABS's, which are drawn whether or not it has worked.
    expect(marked()).toBe(2);
  });

  it.each(['bar', 'overlay'] as const)(
    'hides zero-width pedal strokes in ABS %s mode',
    (absStyle) => {
      const view = render(
        <InputTrace
          input={activeInput}
          settings={{ ...settings, strokeWidth: 0, absStyle }}
        />
      );
      drawFrame();
      const drawn = paths(view.container);
      expect(
        drawn.filter(({ kind }) => kind === 'stroke').map(({ color }) => color)
      ).toEqual(['#666', 'slate']);
      expect(drawn.filter(({ kind }) => kind === 'fill')).toHaveLength(
        absStyle === 'bar' ? 1 : 0
      );
    }
  );

  it('renders overlay ABS with its thicker line and clears disabled channels', () => {
    const view = render(
      <InputTrace
        input={activeInput}
        settings={{ ...settings, absStyle: 'overlay' }}
      />
    );
    drawFrame();
    expect(paths(view.container).some(({ kind }) => kind === 'fill')).toBe(
      false
    );
    expect(paths(view.container).at(-1)?.width).toBe(5);
    view.rerender(
      <InputTrace
        input={activeInput}
        settings={{
          includeBrake: false,
          includeClutch: false,
          includeThrottle: false,
          includeSteer: false,
        }}
      />
    );
    drawFrame();
    expect(paths(view.container)).toHaveLength(1); // Grid only; no old pixels.
  });

  it.each([
    [-100, 2],
    [0, 2],
    [1, 2],
    [40.9, 40],
    [Number.NaN, 400],
    [Number.NEGATIVE_INFINITY, 400],
    [Number.POSITIVE_INFINITY, 400],
  ])('normalizes capacity %s to %i samples', (capacity, expected) => {
    const view = render(trace(activeInput, capacity));
    const reference = render(trace(activeInput, expected));
    drawFrame();
    expect(paths(view.container)).toEqual(paths(reference.container));
    expect(JSON.stringify(paths(view.container))).not.toMatch(/NaN|Infinity/);
  });

  it.each([1000.9, 1001, 2 ** 32, Number.MAX_SAFE_INTEGER, Number.MAX_VALUE])(
    'caps capacity %s at 1000 and retains history when the capped size is unchanged',
    (capacity) => {
      const view = render(trace(activeInput, capacity));
      const reference = render(trace(activeInput, 1000));
      drawFrame();
      expect(paths(view.container)).toEqual(paths(reference.container));

      view.rerender(trace(idleInput, 1000));
      reference.rerender(trace(idleInput, 1000));
      drawFrame();
      expect(paths(view.container)).toEqual(paths(reference.container));
      expect(JSON.stringify(paths(view.container))).not.toMatch(/NaN|Infinity/);
    }
  );

  it('repaints on resize without advancing history or scheduling a sample', () => {
    const view = render(trace(activeInput, 40));
    drawFrame();
    const before = structuredClone(paths(view.container));
    const canvas = canvasFor(view.container);
    for (let index = 0; index < 50; index++)
      resize(canvas, 400 + index, 100 + index);
    expect(paths(view.container)).toEqual(before);
    expect(callbacks.size).toBe(0);
    resize(canvas, 0, 0);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    resize(canvas, 400, 100);
    expect(paths(view.container)).toEqual(before);
  });

  it('sizes the backing buffer for DPR and widget scale, preserving history on scale changes', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const view = render(
      <WidgetScale scale={125}>{trace(activeInput, 40)}</WidgetScale>
    );
    drawFrame();
    const canvas = canvasFor(view.container);
    const before = structuredClone(paths(view.container));
    expect(canvas.width).toBe(1000);
    expect(canvas.height).toBe(250);
    expect(contextFor(canvas).ctx.setTransform).toHaveBeenLastCalledWith(
      2.5,
      0,
      0,
      2.5,
      0,
      0
    );
    view.rerender(
      <WidgetScale scale={200}>{trace(activeInput, 40)}</WidgetScale>
    );
    // Input samples update immediately; painting remains frame-scheduled.
    expect(paths(view.container)).toEqual(before);
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(400);
    vi.stubGlobal('devicePixelRatio', 1);
    act(() => window.dispatchEvent(new Event('resize')));
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(200);
  });
});
