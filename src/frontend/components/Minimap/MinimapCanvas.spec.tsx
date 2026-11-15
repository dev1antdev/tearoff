import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OverlayHiddenContext } from '@irdashies/context';
import { buildTrackGeometry } from '@irdashies/domain/track';
import {
  MinimapCanvas,
  type MinimapCanvasProps,
  type MinimapCar,
} from './MinimapCanvas';

vi.mock('@irdashies/domain/widgetPresentation/WidgetScale', () => ({
  useWidgetScale: () => 1,
}));

/** A 4 km lap drawn as a circle: 2000 samples, one every 2 m. */
const LAP_M = 4000;
const circle = Array.from({ length: 721 }, (_, index) => {
  const angle = (index / 720) * Math.PI * 2;
  return { x: 960 + 400 * Math.cos(angle), y: 540 + 400 * Math.sin(angle) };
});
const geometry = buildTrackGeometry(
  {
    trackPathPoints: circle,
    totalLength: 720,
    startFinishLength: 0,
    direction: 'anticlockwise',
  },
  LAP_M
);
if (!geometry) throw new Error('No geometry for the test lap');

const car = (
  carIdx: number,
  progress: number,
  isFocus = false
): MinimapCar => ({
  progress,
  driver: { CarIdx: carIdx },
  fill: isFocus ? '#ffffff' : '#38bdf8',
  textColor: '#0f172a',
  label: String(carIdx),
  isFocus,
  inPits: false,
});

/** Our car at `progress` with a rival 40 m up the road. */
const field = (progress: number): MinimapCar[] => [
  car(0, progress, true),
  car(1, progress + 40 / LAP_M),
];

const props: Omit<MinimapCanvasProps, 'cars'> = {
  geometry,
  range: 200,
  orientation: 'fixed',
  markerSize: 22,
  trackWidth: 24,
  showStartFinish: true,
  dimCarsInPits: true,
  backgroundOpacity: 60,
  focusColor: '#fbbf24',
  emptyMessage: 'No map for this track',
};

type Op = [name: string, ...args: unknown[]];
/** What the Path2D stand-in remembers: how many points it was given. */
interface TrackPath {
  points: number;
}

describe('MinimapCanvas', () => {
  let logs: WeakMap<HTMLCanvasElement, Op[]>;
  let callbacks: Map<number, FrameRequestCallback>;
  let now: number;
  /** Every track path built, in order. */
  let paths: TrackPath[];

  const ops = (canvas: HTMLCanvasElement | null): Op[] =>
    canvas ? (logs.get(canvas) ?? []) : [];
  const named = (canvas: HTMLCanvasElement | null, name: string) =>
    ops(canvas).filter(([op]) => op === name);
  /** The paths handed to stroke(): the track, not the start/finish line. */
  const trackStrokes = (canvas: HTMLCanvasElement | null) =>
    named(canvas, 'stroke')
      .filter(([, path]) => path !== undefined)
      .map(([, path]) => path as TrackPath);
  /** Marker centres drawn, rounded: the disc and its ring are at the middle. */
  const markers = (canvas: HTMLCanvasElement | null) =>
    named(canvas, 'arc')
      .filter(([, , , radius]) => (radius as number) < 20)
      .map(([, x, y]) => [
        Math.round((x as number) * 100) / 100,
        Math.round((y as number) * 100) / 100,
      ]);
  const frame = (time: number) => {
    now = time;
    const pending = [...callbacks.values()];
    callbacks.clear();
    act(() => pending.forEach((callback) => callback(time)));
  };

  const Harness = ({
    cars,
    hidden = false,
    ...overrides
  }: Partial<MinimapCanvasProps> & {
    cars: MinimapCar[];
    hidden?: boolean;
  }) => (
    <OverlayHiddenContext.Provider value={hidden}>
      <MinimapCanvas {...props} {...overrides} cars={cars} />
    </OverlayHiddenContext.Provider>
  );

  beforeEach(() => {
    logs = new WeakMap();
    callbacks = new Map();
    now = 0;
    let frameId = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
    paths = [];
    vi.stubGlobal(
      'Path2D',
      class implements TrackPath {
        points = 0;
        constructor() {
          paths.push(this);
        }
        moveTo() {
          this.points += 1;
        }
        lineTo() {
          this.points += 1;
        }
        closePath() {
          return undefined;
        }
      }
    );
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {
          /* The canvas is measured once, at mount. */
        }
        disconnect() {
          /* Nothing to release. */
        }
      }
    );
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      function (this: HTMLCanvasElement) {
        let log = logs.get(this);
        if (!log) {
          log = [];
          logs.set(this, log);
        }
        const canvasLog = log;
        return new Proxy(
          {},
          {
            get:
              (_target, name) =>
              (...args: unknown[]) => {
                canvasLog.push([String(name), ...args]);
              },
            set: () => true,
          }
        ) as unknown as CanvasRenderingContext2D;
      }
    );
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /**
   * Drive for `seconds` from `from`, at `metresPerSecond`: a snapshot every
   * 40 ms, and a refresh of the display `hz` times a second.
   */
  const drive = (
    view: ReturnType<typeof render>,
    from: number,
    metresPerSecond: number,
    hz: number,
    seconds = 1
  ) => {
    const start = now;
    let snapshots = 0;
    for (let index = 1; index <= hz * seconds; index++) {
      const time = (index * 1000) / hz;
      while ((snapshots + 1) * 40 <= time) {
        snapshots++;
        now = start + snapshots * 40;
        view.rerender(
          <Harness
            cars={field(from + (metresPerSecond * snapshots * 0.04) / LAP_M)}
          />
        );
      }
      frame(start + time);
    }
  };

  describe('the track', () => {
    it('is stroked from the stretch round the car, not from the whole lap', () => {
      const view = render(<Harness cars={field(0.1)} />);
      const canvas = view.container.querySelector('canvas');

      // The edge and the surface, from one path.
      const strokes = trackStrokes(canvas);
      expect(strokes).toHaveLength(2);
      expect(strokes[1]).toBe(strokes[0]);
      // 200 m either way and a margin, of a lap that is 2000 points round.
      expect(geometry.count).toBe(2000);
      // 275 of them as this is written.
      expect(strokes[0].points).toBeGreaterThan(200);
      expect(strokes[0].points).toBeLessThan(400);
    });

    it('is not built again from frame to frame, only stroked', () => {
      const view = render(<Harness cars={field(0.1)} />);
      const canvas = view.container.querySelector('canvas');
      expect(paths).toHaveLength(1);
      view.rerender(<Harness cars={field(0.1 + 1 / LAP_M)} />);
      ops(canvas).length = 0;

      // 40 m in a second: well inside the stretch that was built.
      drive(view, 0.1, 40, 60);

      const frames = named(canvas, 'clearRect').length;
      expect(frames).toBeGreaterThanOrEqual(59);
      expect(paths).toHaveLength(1);
      const strokes = trackStrokes(canvas);
      expect(strokes).toHaveLength(frames * 2);
      expect(new Set(strokes).size).toBe(1);
    });

    it('is built again as the car drives out of each stretch, and for a new range', () => {
      const view = render(<Harness cars={field(0.1)} />);
      const canvas = view.container.querySelector('canvas');

      // 70 m/s for five seconds: 350 m, several stretches on.
      drive(view, 0.1, 70, 60, 5);
      const built = paths.length;
      expect(built).toBeGreaterThan(2);
      // A handful in three hundred frames, each about as long as the first.
      expect(built).toBeLessThan(12);
      for (const path of paths) expect(path.points).toBeLessThan(400);
      expect(trackStrokes(canvas).at(-1)).toBe(paths.at(-1));

      view.rerender(<Harness cars={field(0.1 + 350 / LAP_M)} range={400} />);
      frame(now + 20);
      expect(paths).toHaveLength(built + 1);
      expect(paths.at(-1)?.points).toBeGreaterThan(400);
    });
  });

  describe('the frame rate', () => {
    it.each([60, 144, 240])('is about 60 a second on a %i Hz display', (hz) => {
      const view = render(<Harness cars={field(0.1)} />);
      const canvas = view.container.querySelector('canvas');
      view.rerender(<Harness cars={field(0.1 + 1 / LAP_M)} />);
      ops(canvas).length = 0;

      drive(view, 0.1, 40, hz);

      const frames = named(canvas, 'clearRect').length;
      expect(frames).toBeGreaterThanOrEqual(59);
      expect(frames).toBeLessThanOrEqual(60);
    });
  });

  describe('while the overlay is hidden', () => {
    it('makes no draw call, whatever arrives, and paints once when shown again', () => {
      const view = render(<Harness cars={field(0.1)} />);
      const canvas = view.container.querySelector('canvas');
      expect(named(canvas, 'clearRect').length).toBeGreaterThan(0);
      now = 10;
      view.rerender(<Harness cars={field(0.11)} />);
      expect(callbacks.size).toBe(1);
      ops(canvas).length = 0;

      // The frame that was waiting goes with the overlay.
      view.rerender(<Harness cars={field(0.11)} hidden />);
      expect(callbacks.size).toBe(0);

      // The cars drive on and a setting changes, with nobody looking.
      now = 50;
      view.rerender(<Harness cars={field(0.2)} hidden />);
      now = 90;
      const latest = field(0.3);
      view.rerender(<Harness cars={latest} hidden trackWidth={30} />);
      frame(130);
      expect(ops(canvas)).toEqual([]);
      expect(callbacks.size).toBe(0);

      now = 400;
      view.rerender(<Harness cars={latest} trackWidth={30} />);
      expect(named(canvas, 'clearRect')).toHaveLength(1);
      expect(callbacks.size).toBe(0);

      // The same picture as a map that was never hidden draws from that data.
      const fresh = render(<Harness cars={latest} trackWidth={30} />);
      const freshCanvas = fresh.container.querySelector('canvas');
      expect(markers(canvas)).toEqual(markers(freshCanvas));
      expect(markers(canvas)).toHaveLength(2);
    });
  });
});
