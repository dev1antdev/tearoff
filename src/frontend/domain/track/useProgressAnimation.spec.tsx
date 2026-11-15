import { act, cleanup, render } from '@testing-library/react';
import { StrictMode, useLayoutEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProgressInterpolator,
  progressToFlatX,
  progressToTrackPoint,
  useProgressAnimation,
} from './useProgressAnimation';

describe('ProgressInterpolator', () => {
  it('interpolates normal movement', () => {
    const interpolator = new ProgressInterpolator(40);
    interpolator.setTargets([{ progress: 0.1 }], 0);
    interpolator.setTargets([{ progress: 0.3 }], 0);

    expect(interpolator.advance(20)).toBe(true);
    expect(interpolator.getValues()[0]).toBeCloseTo(0.2);
  });

  it('uses the shortest wrapped path across start/finish', () => {
    const interpolator = new ProgressInterpolator(40);
    interpolator.setTargets([{ progress: 0.99 }], 0);
    interpolator.setTargets([{ progress: 0.01 }], 0);

    interpolator.advance(20);
    expect(interpolator.getValues()[0]).toBeCloseTo(0);
    interpolator.advance(40);
    expect(interpolator.getValues()[0]).toBeCloseTo(0.01);
  });

  it('settles after one position interval', () => {
    const interpolator = new ProgressInterpolator(40);
    interpolator.setTargets([{ progress: 0.2 }], 0);
    interpolator.setTargets([{ progress: 0.4 }], 0);

    expect(interpolator.advance(39)).toBe(true);
    expect(interpolator.advance(40)).toBe(false);
    expect(interpolator.getValues()[0]).toBeCloseTo(0.4);
  });

  it('adapts interpolation to the observed snapshot cadence', () => {
    const interpolator = new ProgressInterpolator();
    interpolator.setTargets([{ progress: 0.1 }], 0);
    interpolator.setTargets([{ progress: 0.3 }], 50);

    expect(interpolator.advance(75)).toBe(true);
    expect(interpolator.getValues()[0]).toBeCloseTo(0.2);
    expect(interpolator.advance(100)).toBe(false);
  });

  it('reuses its output collection throughout the frame path', () => {
    const interpolator = new ProgressInterpolator(40);
    interpolator.setTargets([{ progress: 0.1 }, { progress: 0.2 }], 0);
    const output = interpolator.getValues();

    for (let now = 0; now <= 40; now++) {
      interpolator.advance(now);
      expect(interpolator.getValues()).toBe(output);
    }
  });

  it('preserves existing drivers by CarIdx when the roster changes', () => {
    const interpolator = new ProgressInterpolator(40);
    interpolator.setTargets(
      [
        { progress: 0.1, driver: { CarIdx: 7 } },
        { progress: 0.5, driver: { CarIdx: 3 } },
      ],
      0
    );
    interpolator.setTargets(
      [
        { progress: 0.7, driver: { CarIdx: 3 } },
        { progress: 0.9, driver: { CarIdx: 9 } },
      ],
      0
    );

    expect(interpolator.getValues()[0]).toBeCloseTo(0.5);
    expect(interpolator.getValues()[1]).toBeCloseTo(0.9);
    expect(interpolator.getCount()).toBe(2);
  });
});

describe('map projection', () => {
  it('projects interpolated progress onto the curved map in place', () => {
    const output = { x: 0, y: 0 };
    progressToTrackPoint(
      0.5,
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      100,
      0,
      'anticlockwise',
      output
    );

    expect(output).toEqual({ x: 50, y: 0 });
  });

  it('projects interpolated progress onto the flat map', () => {
    expect(progressToFlatX(0.5, 40, 200)).toBe(140);
  });
});

describe('useProgressAnimation', () => {
  let callbacks: Map<number, FrameRequestCallback>;
  let nextFrameId: number;
  let now: number;

  const frame = (time: number) => {
    now = time;
    const pending = [...callbacks.values()];
    callbacks.clear();
    act(() => pending.forEach((callback) => callback(time)));
  };
  const commitAt = (time: number) => {
    now = time;
  };
  const drivers = (progress: number) => [{ progress, driver: { CarIdx: 7 } }];

  beforeEach(() => {
    callbacks = new Map();
    nextFrameId = 0;
    now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.set(++nextFrameId, callback);
      return nextFrameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  });

  afterEach(() => {
    cleanup();
    delete window.rendererPerfBridge;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('coalesces multiple position commits into one frame using the latest data', () => {
    const draw = vi.fn();
    const Harness = ({ source }: { source: ReturnType<typeof drivers> }) => {
      useProgressAnimation(source, draw);
      return null;
    };
    const view = render(<Harness source={drivers(0.1)} />);
    draw.mockClear();
    commitAt(5);
    view.rerender(<Harness source={drivers(0.2)} />);
    commitAt(10);
    view.rerender(<Harness source={drivers(0.3)} />);
    expect(draw).not.toHaveBeenCalled();
    expect(callbacks.size).toBe(1);
    frame(20);
    expect(draw).toHaveBeenCalledTimes(1);
    expect(draw.mock.calls[0][0][0]).toBeGreaterThan(0.1);
    expect(draw.mock.calls[0][0][0]).toBeLessThan(0.3);
    frame(40);
    expect(draw.mock.calls.at(-1)?.[0][0]).toBeCloseTo(0.3);
    expect(callbacks.size).toBe(0);
  });

  it('keeps interpolating each uncapped frame and stops when settled without React renders', () => {
    let renders = 0;
    const values: number[] = [];
    const Harness = ({ source }: { source: ReturnType<typeof drivers> }) => {
      renders++;
      useProgressAnimation(source, (progress) => values.push(progress[0]));
      return null;
    };
    const view = render(<Harness source={drivers(0.1)} />);
    view.rerender(<Harness source={drivers(0.3)} />);
    frame(10);
    frame(20);
    frame(40);
    expect(values).toEqual([0.1, 0.15, 0.2, 0.3]);
    expect(callbacks.size).toBe(0);
    expect(renders).toBe(2);
  });

  it('does not restart the cap on every position commit', () => {
    const draw = vi.fn();
    const Harness = ({ source }: { source: ReturnType<typeof drivers> }) => {
      useProgressAnimation(source, draw, 30);
      return null;
    };
    const view = render(<Harness source={drivers(0.1)} />);
    draw.mockClear();
    commitAt(5);
    view.rerender(<Harness source={drivers(0.3)} />);
    frame(16);
    commitAt(25);
    view.rerender(<Harness source={drivers(0.4)} />);
    frame(32);
    expect(draw).not.toHaveBeenCalled();
    frame(34);
    expect(draw).toHaveBeenCalledTimes(1);
    expect(callbacks.size).toBe(1);
  });

  describe('a frame cap on a moving field', () => {
    const draw = vi.fn();
    const Harness = ({
      source,
      cap,
    }: {
      source: ReturnType<typeof drivers>;
      cap: number;
    }) => {
      useProgressAnimation(source, draw, cap);
      return null;
    };
    /**
     * A second of driving: a snapshot every 40 ms keeps the cars moving, and
     * the display refreshes `hz` times, each `jitter(index)` ms off the beat.
     * Returns the draws made, the one at mount not counted.
     */
    const drawsInOneSecond = (
      cap: number,
      hz: number,
      jitter: (index: number) => number = () => 0
    ) => {
      const view = render(<Harness source={drivers(0)} cap={cap} />);
      view.rerender(<Harness source={drivers(0.0005)} cap={cap} />);
      draw.mockClear();
      let snapshots = 0;
      for (let index = 1; index <= hz; index++) {
        const time = (index * 1000) / hz + jitter(index);
        while ((snapshots + 1) * 40 <= time) {
          snapshots++;
          commitAt(snapshots * 40);
          view.rerender(
            <Harness source={drivers(0.0005 + snapshots * 0.001)} cap={cap} />
          );
        }
        frame(time);
      }
      view.unmount();
      return draw.mock.calls.length;
    };

    it.each([60, 120, 144, 240])(
      'draws about 60 times a second at a cap of 60 on a %i Hz display',
      (hz) => {
        const draws = drawsInOneSecond(60, hz);
        expect(draws).toBeGreaterThanOrEqual(59);
        expect(draws).toBeLessThanOrEqual(60);
      }
    );

    it.each([59.94, 60])(
      'draws on every refresh of a %s Hz display at a cap of 60, however the timestamps wobble',
      (hz) => {
        // Refresh times are never exactly an interval apart. Measured from
        // the last draw, half of them fall a hair short of the cap and the
        // map drops to every other frame.
        const draws = drawsInOneSecond(60, hz, (index) =>
          index % 2 ? 0.2 : -0.2
        );
        expect(draws).toBeGreaterThanOrEqual(58);
        expect(draws).toBeLessThanOrEqual(60);
      }
    );

    it.each([60, 144])(
      'draws about 30 times a second at a cap of 30 on a %i Hz display',
      (hz) => {
        const draws = drawsInOneSecond(30, hz, (index) =>
          index % 2 ? 0.2 : -0.2
        );
        expect(draws).toBeGreaterThanOrEqual(29);
        expect(draws).toBeLessThanOrEqual(30);
      }
    );

    it('draws every frame of a display slower than the cap', () => {
      expect(drawsInOneSecond(60, 30)).toBe(30);
    });

    it('skips the slots a stall went past, with no burst to catch up', () => {
      const view = render(<Harness source={drivers(0)} cap={60} />);
      commitAt(40);
      view.rerender(<Harness source={drivers(0.1)} cap={60} />);
      draw.mockClear();
      // Half a second with no frame at all, then the display catches up.
      frame(540);
      expect(draw).toHaveBeenCalledTimes(1);
      commitAt(541);
      view.rerender(<Harness source={drivers(0.2)} cap={60} />);
      frame(540 + 1000 / 240);
      frame(540 + 2000 / 240);
      expect(draw).toHaveBeenCalledTimes(1);
      frame(540 + 4000 / 240);
      expect(draw).toHaveBeenCalledTimes(2);
    });
  });

  it('uses the latest committed appearance in an already pending frame', () => {
    const oldDraw = vi.fn();
    const latestDraw = vi.fn();
    const Harness = ({
      source,
      draw,
    }: {
      source: ReturnType<typeof drivers>;
      draw: typeof oldDraw;
    }) => {
      useProgressAnimation(source, draw);
      return null;
    };
    const view = render(<Harness source={drivers(0.1)} draw={oldDraw} />);
    view.rerender(<Harness source={drivers(0.3)} draw={oldDraw} />);
    oldDraw.mockClear();
    view.rerender(<Harness source={drivers(0.4)} draw={latestDraw} />);
    expect(latestDraw).not.toHaveBeenCalled();
    frame(20);
    expect(oldDraw).not.toHaveBeenCalled();
    expect(latestDraw).toHaveBeenCalledTimes(1);
  });

  it('repaints appearance-only commits immediately while idle or animating', () => {
    const draw = vi.fn();
    const source = drivers(0.1);
    const Harness = ({
      source,
      appearance,
    }: {
      source: ReturnType<typeof drivers>;
      appearance: string;
    }) => {
      useProgressAnimation(source, (values) => draw(appearance, values[0]));
      return null;
    };
    const view = render(<Harness source={source} appearance="old" />);
    view.rerender(<Harness source={source} appearance="new" />);
    expect(draw.mock.calls.at(-1)).toEqual(['new', 0.1]);
    expect(callbacks.size).toBe(0);
    const moving = drivers(0.3);
    view.rerender(<Harness source={moving} appearance="new" />);
    frame(10);
    commitAt(20);
    view.rerender(<Harness source={moving} appearance="latest" />);
    expect(draw.mock.calls.at(-1)?.[0]).toBe('latest');
    expect(draw.mock.calls.at(-1)?.[1]).toBeCloseTo(0.2);
    frame(40);
    expect(draw.mock.calls.at(-1)).toEqual(['latest', 0.3]);
    expect(callbacks.size).toBe(0);
  });

  it('restores a canvas cleared by an earlier layout effect even with a new snapshot and a cap', () => {
    let canvas = '';
    const Harness = ({
      source,
      revision,
    }: {
      source: ReturnType<typeof drivers>;
      revision: number;
    }) => {
      const invalidated = useRef(false);
      useLayoutEffect(() => {
        canvas = '';
        invalidated.current = true;
      }, [revision]);
      useProgressAnimation(
        source,
        () => {
          canvas = `cars:${revision}`;
        },
        30,
        invalidated
      );
      return null;
    };
    const view = render(<Harness source={drivers(0.1)} revision={0} />);
    expect(canvas).toBe('cars:0');
    commitAt(5);
    view.rerender(<Harness source={drivers(0.3)} revision={1} />);
    expect(canvas).toBe('cars:1');
    frame(16);
    expect(canvas).toBe('cars:1');
  });

  it('paints a nonmoving roster update once, then stays idle', () => {
    const draw = vi.fn();
    const Harness = ({ source }: { source: ReturnType<typeof drivers> }) => {
      useProgressAnimation(source, draw);
      return null;
    };
    const view = render(<Harness source={drivers(0.1)} />);
    view.rerender(<Harness source={[]} />);
    frame(16);
    expect(draw.mock.calls.at(-1)?.[1]).toBe(0);
    expect(callbacks.size).toBe(0);
    view.rerender(<Harness source={drivers(0.9)} />);
    frame(32);
    expect(draw.mock.calls.at(-1)?.[0][0]).toBeCloseTo(0.9);
    expect(callbacks.size).toBe(0);
  });

  describe('paused, as while the overlay is hidden', () => {
    const draw = vi.fn();
    const Harness = ({
      source,
      paused,
      appearance = 'plain',
    }: {
      source: ReturnType<typeof drivers>;
      paused: boolean;
      appearance?: string;
    }) => {
      useProgressAnimation(
        source,
        (values, count) => draw(appearance, values[0], count),
        undefined,
        undefined,
        paused
      );
      return null;
    };

    beforeEach(() => draw.mockClear());

    it('draws nothing and asks for no frame, whatever arrives', () => {
      const view = render(<Harness source={drivers(0.1)} paused={false} />);
      commitAt(5);
      view.rerender(<Harness source={drivers(0.3)} paused={false} />);
      expect(callbacks.size).toBe(1);
      draw.mockClear();

      // The pending frame goes with the pause.
      view.rerender(<Harness source={drivers(0.3)} paused />);
      expect(callbacks.size).toBe(0);

      // New positions, the same positions restyled, and time passing.
      commitAt(45);
      view.rerender(<Harness source={drivers(0.5)} paused />);
      view.rerender(
        <Harness source={drivers(0.5)} paused appearance="restyled" />
      );
      frame(60);
      frame(200);

      expect(draw).not.toHaveBeenCalled();
      expect(callbacks.size).toBe(0);
    });

    it('paints once when the pause ends, where the cars are by then', () => {
      const view = render(<Harness source={drivers(0.1)} paused={false} />);
      view.rerender(<Harness source={drivers(0.1)} paused />);
      commitAt(40);
      view.rerender(<Harness source={drivers(0.3)} paused />);
      commitAt(80);
      const latest = drivers(0.5);
      view.rerender(<Harness source={latest} paused appearance="restyled" />);
      draw.mockClear();

      commitAt(400);
      view.rerender(
        <Harness source={latest} paused={false} appearance="restyled" />
      );

      // In the commit itself, not a frame later, and not eased in from where
      // the cars were when the overlay went away.
      expect(draw).toHaveBeenCalledTimes(1);
      expect(draw.mock.calls[0][0]).toBe('restyled');
      expect(draw.mock.calls[0][1]).toBeCloseTo(0.5);
      expect(callbacks.size).toBe(0);
    });

    it('paints and animates on when positions arrive with the end of the pause', () => {
      const view = render(<Harness source={drivers(0.1)} paused />);
      expect(draw).not.toHaveBeenCalled();

      commitAt(40);
      view.rerender(<Harness source={drivers(0.3)} paused={false} />);
      expect(draw).toHaveBeenCalledTimes(1);
      expect(callbacks.size).toBe(1);
      frame(80);
      expect(draw.mock.calls.at(-1)?.[1]).toBeCloseTo(0.3);
      expect(callbacks.size).toBe(0);
    });

    it('restores a canvas that was cleared while paused', () => {
      let canvas = 'cars';
      const Canvas = ({
        paused,
        revision,
      }: {
        paused: boolean;
        revision: number;
      }) => {
        const invalidated = useRef(false);
        useLayoutEffect(() => {
          canvas = '';
          invalidated.current = true;
        }, [revision]);
        useProgressAnimation(
          source,
          () => {
            canvas = `cars:${revision}`;
          },
          30,
          invalidated,
          paused
        );
        return null;
      };
      const source = drivers(0.1);
      const view = render(<Canvas paused={false} revision={0} />);
      view.rerender(<Canvas paused revision={1} />);
      expect(canvas).toBe('');
      view.rerender(<Canvas paused={false} revision={1} />);
      expect(canvas).toBe('cars:1');
    });
  });

  it('records draw work and cancels pending work on unmount including StrictMode', () => {
    const recordMeasure = vi.fn();
    window.rendererPerfBridge = { recordMeasure };
    const draw = vi.fn();
    const Harness = ({
      source,
      cap,
    }: {
      source: ReturnType<typeof drivers>;
      cap?: number;
    }) => {
      useProgressAnimation(source, draw, cap);
      return null;
    };
    const view = render(
      <StrictMode>
        <Harness source={drivers(0.1)} />
      </StrictMode>
    );
    view.rerender(
      <StrictMode>
        <Harness source={drivers(0.3)} />
      </StrictMode>
    );
    expect(callbacks.size).toBe(1);
    frame(16);
    expect(recordMeasure).toHaveBeenCalledWith(
      'trackMapAnimationFrame',
      expect.any(Number)
    );
    view.rerender(
      <StrictMode>
        <Harness source={drivers(0.4)} cap={30} />
      </StrictMode>
    );
    expect(callbacks.size).toBe(1);
    view.unmount();
    expect(callbacks.size).toBe(0);
    draw.mockClear();
    frame(100);
    expect(draw).not.toHaveBeenCalled();
  });
});
