import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ChannelBridge,
  ChannelName,
  ChannelPayloads,
  GForceSnapshot,
} from '@irdashies/types';
import {
  FrictionCircleCanvas,
  type FrictionCircleCanvasProps,
} from './FrictionCircleCanvas';

/**
 * Whether the overlay is hidden, as a store: the component is memoised, so
 * only a hook that subscribes can tell it, as the real one does.
 */
const overlay = vi.hoisted(() => {
  let hidden = false;
  const listeners = new Set<() => void>();
  return {
    isHidden: () => hidden,
    set: (next: boolean) => {
      hidden = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

vi.mock('@irdashies/context', async () => {
  const { useSyncExternalStore } = await import('react');
  const store = await vi.importActual<
    typeof import('../../context/ChannelStore/ChannelSnapshotStore')
  >('../../context/ChannelStore/ChannelSnapshotStore');
  return {
    getChannelSnapshotStore: store.getChannelSnapshotStore,
    usePaintingPaused: () =>
      useSyncExternalStore(overlay.subscribe, overlay.isHidden),
  };
});

/** A box of 184 px: a circle of 86 px once the dot has its room. */
const BOX = 184;
const CENTRE = BOX / 2;
const RADIUS = 86;

const WHITE = '#ffffff';
const AMBER = '#fcd34d';
const SLATE = '#64748b';
const SUSTAINED = '#94a3b8';

interface Stroke {
  color: string;
  alpha: number;
  width: number;
  dashed: boolean;
  /** Line points and arcs, in the order they were added. */
  points: [number, number][];
  arcs: [number, number, number][];
}

interface Frame {
  strokes: Stroke[];
  /** The dot: where it was filled, and in what colour. */
  dot: { x: number; y: number; color: string } | null;
}

/** Records what each frame draws: every clear starts a new one. */
const recordContext = () => {
  const frames: Frame[] = [];
  let points: [number, number][] = [];
  let arcs: [number, number, number][] = [];
  let dashed = false;
  const current = (): Frame => {
    const frame = frames.at(-1);
    if (!frame) throw new Error('Drawn before the canvas was cleared');
    return frame;
  };
  const context = {
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    lineJoin: '',
    lineCap: '',
    setTransform: () => undefined,
    setLineDash: (dash: number[]) => {
      dashed = dash.length > 0;
    },
    clearRect: () => frames.push({ strokes: [], dot: null }),
    beginPath: () => {
      points = [];
      arcs = [];
    },
    moveTo: (x: number, y: number) => points.push([x, y]),
    lineTo: (x: number, y: number) => points.push([x, y]),
    arc: (x: number, y: number, radius: number) => arcs.push([x, y, radius]),
    stroke: () =>
      current().strokes.push({
        color: context.strokeStyle,
        alpha: context.globalAlpha,
        width: context.lineWidth,
        dashed,
        points,
        arcs,
      }),
    fill: () => {
      const [x, y] = arcs[0];
      current().dot = { x, y, color: context.fillStyle };
    },
  };
  return { context, frames };
};

const snapshot = (extra: Partial<GForceSnapshot> = {}): GForceSnapshot => ({
  available: true,
  latG: 0,
  longG: 0,
  maxLatG: 0,
  maxLongG: 0,
  sustainedLatG: 0,
  sessionNum: 0,
  version: 1,
  ...extra,
});

const defaults: FrictionCircleCanvasProps = {
  scaleG: 3.5,
  orientation: 'force',
  showTrace: true,
  traceSeconds: 4,
  showRings: true,
  showSustainedRing: true,
};

describe('FrictionCircleCanvas', () => {
  let callbacks: Map<number, FrameRequestCallback>;
  let recorded: ReturnType<typeof recordContext>;
  let publish: ((payload: GForceSnapshot) => void) | undefined;
  let subscribedRateHz: number | undefined;
  let unsubscribed: number;
  let now: number;

  /** Runs the pending animation frame, `ms` after the one before. */
  const frame = (ms = 40) => {
    now += ms;
    const pending = [...callbacks.values()];
    callbacks.clear();
    act(() => pending.forEach((callback) => callback(now)));
  };
  const send = (extra: Partial<GForceSnapshot> = {}, ms = 33) => {
    now += ms;
    act(() => publish?.(snapshot(extra)));
  };
  const lastFrame = (): Frame => {
    const last = recorded.frames.at(-1);
    if (!last) throw new Error('Nothing has been drawn');
    return last;
  };
  /** The trail: the white strokes two pixels wide. */
  const trailOf = (drawn: Frame) =>
    drawn.strokes.filter(
      (stroke) => stroke.color === WHITE && stroke.width === 2
    );
  const mount = (props: Partial<FrictionCircleCanvasProps> = {}) =>
    render(<FrictionCircleCanvas {...defaults} {...props} />);

  beforeEach(() => {
    callbacks = new Map();
    recorded = recordContext();
    publish = undefined;
    subscribedRateHz = undefined;
    unsubscribed = 0;
    now = 1000;
    overlay.set(false);
    let frameId = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {
          /* The size comes from clientWidth and clientHeight. */
        }
        disconnect() {
          /* No native observer to release. */
        }
      }
    );
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(BOX);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(BOX);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => recorded.context as unknown as CanvasRenderingContext2D
    );
    const bridge: ChannelBridge = {
      subscribe: <K extends ChannelName>(
        channel: K,
        callback: (payload: ChannelPayloads[K]) => void,
        requestedRateHz?: number
      ) => {
        if (channel !== 'g-force.snapshot') return () => undefined;
        publish = callback as (payload: GForceSnapshot) => void;
        subscribedRateHz = requestedRateHz;
        return () => {
          unsubscribed += 1;
          publish = undefined;
        };
      },
    };
    window.channelBridge = bridge;
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, 'channelBridge');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('asks the channel for thirty readings a second', () => {
    mount();

    expect(subscribedRateHz).toBe(30);
  });

  it('draws the rings and a resting dot before any reading', () => {
    mount();
    frame();
    const drawn = lastFrame();

    // Rings at 1, 2 and 3 g with the cross, then the rim.
    const [rings, rim] = drawn.strokes;
    expect(rings.arcs.map(([, , radius]) => radius)).toEqual([
      (1 / 3.5) * RADIUS,
      (2 / 3.5) * RADIUS,
      (3 / 3.5) * RADIUS,
    ]);
    expect(rim.arcs).toEqual([[CENTRE, CENTRE, RADIUS]]);
    expect(drawn.dot).toEqual({ x: CENTRE, y: CENTRE, color: SLATE });
    expect(trailOf(drawn)).toEqual([]);
    // Nothing is fading, so nothing more is asked for.
    expect(callbacks.size).toBe(0);
  });

  it('puts the dot where the reading is', () => {
    mount();
    frame();
    // A left-hander under braking: right and up.
    send({ latG: 1.75, longG: -0.7 });
    frame();

    const dot = lastFrame().dot;
    expect(dot?.x).toBeCloseTo(CENTRE + RADIUS / 2, 6);
    expect(dot?.y).toBeCloseTo(CENTRE - RADIUS / 5, 6);
    expect(dot?.color).toBe(WHITE);
  });

  it('turns the dot amber on the rim for a reading past the scale', () => {
    mount({ scaleG: 2 });
    frame();
    send({ latG: 3, longG: 0 });
    frame();

    const dot = lastFrame().dot;
    expect(dot?.x).toBeCloseTo(CENTRE + RADIUS, 6);
    expect(dot?.y).toBeCloseTo(CENTRE, 6);
    expect(dot?.color).toBe(AMBER);
  });

  it('goes the other way in the acceleration orientation', () => {
    mount({ orientation: 'acceleration' });
    frame();
    send({ latG: 1.75, longG: -0.7 });
    frame();

    const dot = lastFrame().dot;
    expect(dot?.x).toBeCloseTo(CENTRE - RADIUS / 2, 6);
    expect(dot?.y).toBeCloseTo(CENTRE + RADIUS / 5, 6);
  });

  it('draws one frame for a burst of readings', () => {
    mount();
    frame();
    const before = recorded.frames.length;

    send({ latG: 0.5 });
    send({ latG: 0.6 });
    send({ latG: 0.7 });
    expect(callbacks.size).toBe(1);
    frame();

    expect(recorded.frames.length).toBe(before + 1);
    // All three are on the trail, and the dot is at the last.
    const points = trailOf(lastFrame()).flatMap((stroke) => stroke.points);
    expect(points.at(0)?.[0]).toBeCloseTo(CENTRE + (0.5 / 3.5) * RADIUS, 6);
    expect(points.at(-1)?.[0]).toBeCloseTo(CENTRE + (0.7 / 3.5) * RADIUS, 6);
    expect(lastFrame().dot?.x).toBeCloseTo(CENTRE + (0.7 / 3.5) * RADIUS, 6);
  });

  it('fades the trail from the dot back, and never above 60 %', () => {
    mount();
    frame();
    for (let step = 0; step <= 60; step += 1) send({ latG: step / 30 });
    frame();

    const trail = trailOf(lastFrame());
    expect(trail.length).toBeGreaterThan(3);
    const alphas = trail.map((stroke) => stroke.alpha);
    expect([...alphas].sort((a, b) => a - b)).toEqual(alphas);
    expect(Math.max(...alphas)).toBeLessThanOrEqual(0.6);
    expect(Math.min(...alphas)).toBeGreaterThan(0);
    // One line from end to end: each stroke starts where the last ended.
    for (let index = 1; index < trail.length; index += 1) {
      expect(trail[index].points[0]).toEqual(trail[index - 1].points.at(-1));
    }
  });

  it('lets the trail of a car that has stopped fade out, then stops drawing', () => {
    mount();
    frame();
    send({ latG: 1 });
    send({ latG: 2 });
    frame();
    expect(trailOf(lastFrame()).length).toBeGreaterThan(0);
    // Still fading: another frame is waiting though no reading came.
    expect(callbacks.size).toBe(1);

    // The same reading over and over adds nothing to the trail.
    for (let second = 0; second < 5; second += 1) {
      send({ latG: 2 }, 1000);
      frame();
    }

    expect(trailOf(lastFrame())).toEqual([]);
    expect(lastFrame().dot?.color).toBe(WHITE);
    expect(callbacks.size).toBe(0);
  });

  it('draws no more than thirty frames a second', () => {
    mount();
    frame();
    send({ latG: 1 });
    send({ latG: 2 });
    frame();
    const before = recorded.frames.length;

    // A 144 Hz display: 7 ms between refreshes.
    for (let refresh = 0; refresh < 10; refresh += 1) frame(7);

    expect(recorded.frames.length - before).toBeLessThanOrEqual(3);
    expect(recorded.frames.length - before).toBeGreaterThanOrEqual(2);
  });

  it('draws the sustained grip as a dashed neutral ring', () => {
    mount();
    frame();
    send({ latG: 1, sustainedLatG: 2.31 });
    frame();

    const ring = lastFrame().strokes.find(
      (stroke) => stroke.color === SUSTAINED
    );
    expect(ring).toMatchObject({ dashed: true, width: 2 });
    expect(ring?.arcs[0][2]).toBeCloseTo((2.31 / 3.5) * RADIUS, 6);
  });

  it('leaves the sustained ring out when it is zero, past the scale or off', () => {
    const sustained = () =>
      lastFrame().strokes.filter((stroke) => stroke.color === SUSTAINED);
    const view = mount();
    frame();

    send({ latG: 1, sustainedLatG: 0 });
    frame();
    expect(sustained()).toEqual([]);

    send({ latG: 1.1, sustainedLatG: 3.6 });
    frame();
    expect(sustained()).toEqual([]);

    send({ latG: 1.2, sustainedLatG: 2 });
    frame();
    expect(sustained()).toHaveLength(1);

    view.rerender(
      <FrictionCircleCanvas {...defaults} showSustainedRing={false} />
    );
    frame();
    expect(sustained()).toEqual([]);
  });

  it('leaves the rings and the trail out when they are switched off', () => {
    mount({ showRings: false, showTrace: false });
    frame();
    send({ latG: 1 });
    send({ latG: 2 });
    frame();
    const drawn = lastFrame();

    // The rim only, and the outline of the dot.
    expect(drawn.strokes).toHaveLength(2);
    expect(drawn.strokes[0].arcs).toEqual([[CENTRE, CENTRE, RADIUS]]);
    expect(trailOf(drawn)).toEqual([]);
    // No trail to fade, so no frame waits.
    expect(callbacks.size).toBe(0);
  });

  it('empties the trail when the driver gets out', () => {
    mount();
    frame();
    send({ latG: 1 });
    send({ latG: 2 });
    send({ available: false });
    frame();

    expect(trailOf(lastFrame())).toEqual([]);
    expect(lastFrame().dot).toEqual({ x: CENTRE, y: CENTRE, color: SLATE });

    // Back in: the trail starts from here, not from before.
    send({ latG: 0.5 });
    send({ latG: 0.6 });
    frame();
    const points = trailOf(lastFrame()).flatMap((stroke) => stroke.points);
    expect(points).toHaveLength(2);
  });

  it('empties the trail when the session changes', () => {
    mount();
    frame();
    send({ latG: 1 });
    send({ latG: 2 });
    send({ latG: 2.1, sessionNum: 1 });
    frame();

    expect(trailOf(lastFrame())).toEqual([]);
  });

  describe('while nothing drawn can be seen', () => {
    it('draws nothing, and keeps filling the trail', () => {
      mount();
      frame();
      send({ latG: 0.5 });
      frame();

      // A trail that is fading has a frame waiting; hiding drops it.
      send({ latG: 0.6 });
      frame();
      expect(callbacks.size).toBe(1);
      const before = recorded.frames.length;
      act(() => overlay.set(true));
      expect(callbacks.size).toBe(0);

      send({ latG: 1 });
      send({ latG: 1.5 });
      send({ latG: 2 });
      expect(callbacks.size).toBe(0);
      expect(recorded.frames.length).toBe(before);

      // Back on screen: one frame, with everything that arrived meanwhile.
      act(() => overlay.set(false));
      expect(callbacks.size).toBe(1);
      frame();

      expect(recorded.frames.length).toBe(before + 1);
      const points = trailOf(lastFrame()).flatMap((stroke) => stroke.points);
      expect(points.at(0)?.[0]).toBeCloseTo(CENTRE + (0.5 / 3.5) * RADIUS, 6);
      expect(points.at(-1)?.[0]).toBeCloseTo(CENTRE + (2 / 3.5) * RADIUS, 6);
      expect(lastFrame().dot?.x).toBeCloseTo(CENTRE + (2 / 3.5) * RADIUS, 6);
    });

    it('does not draw when a setting changes', () => {
      overlay.set(true);
      const view = mount();
      expect(callbacks.size).toBe(0);

      view.rerender(<FrictionCircleCanvas {...defaults} scaleG={5} />);

      expect(callbacks.size).toBe(0);
      expect(recorded.frames).toEqual([]);
    });
  });

  it('lets go of the channel and the pending frame when it unmounts', () => {
    const view = mount();
    frame();
    send({ latG: 1 });
    expect(callbacks.size).toBe(1);

    view.unmount();

    expect(unsubscribed).toBe(1);
    expect(callbacks.size).toBe(0);
  });
});
