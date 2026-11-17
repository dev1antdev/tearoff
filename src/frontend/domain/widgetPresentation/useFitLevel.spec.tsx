import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFitLevel, type FitLevelOptions } from './useFitLevel';

/**
 * jsdom lays nothing out, so a layout is staged here: the box is as wide and
 * as tall as `scene.room` says, and what it holds is as wide and as tall as
 * the level it was drawn at makes it.
 */
const scene = {
  room: { width: 0, height: 0 },
  /** What the content measures, by the level it is drawn at. */
  widths: [] as number[],
  heights: [] as number[],
  resized: [] as (() => void)[],
};

class FakeResizeObserver {
  private readonly changed: () => void;
  constructor(changed: () => void) {
    this.changed = changed;
  }
  observe() {
    scene.resized.push(this.changed);
  }
  disconnect() {
    scene.resized = scene.resized.filter((entry) => entry !== this.changed);
  }
}

/** The room changes, and the browser says so. */
const resize = (room: Partial<typeof scene.room>) => {
  scene.room = { ...scene.room, ...room };
  act(() => scene.resized.forEach((changed) => changed()));
};

const levelOf = (element: HTMLElement) => Number(element.dataset.level ?? 0);

const stageLayout = () => {
  const define = (name: string, get: (this: HTMLElement) => number) =>
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get,
    });
  define('clientWidth', () => scene.room.width);
  define('clientHeight', () => scene.room.height);
  define('scrollWidth', function () {
    return scene.widths[levelOf(this)] ?? 0;
  });
  define('scrollHeight', function () {
    return scene.heights[levelOf(this)] ?? 0;
  });
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
};

const unstageLayout = () => {
  for (const name of [
    'clientWidth',
    'clientHeight',
    'scrollWidth',
    'scrollHeight',
  ]) {
    Reflect.deleteProperty(HTMLElement.prototype, name);
  }
  vi.unstubAllGlobals();
};

/** A strip drawn at the level it is told fits. */
const Strip = (options: FitLevelOptions) => {
  const fit = useFitLevel(options);
  return (
    <div
      ref={fit.target}
      data-testid="strip"
      data-level={fit.level}
      data-width={fit.width}
    />
  );
};

/** A list in a box: the box is the room, the list is what must fit. */
const Boxed = (options: FitLevelOptions) => {
  const fit = useFitLevel(options);
  return (
    <div ref={fit.frame} data-testid="box">
      <div ref={fit.target} data-testid="strip" data-level={fit.level} />
    </div>
  );
};

const level = () => levelOf(screen.getByTestId('strip'));

describe('useFitLevel', () => {
  beforeEach(() => {
    scene.room = { width: 600, height: 40 };
    scene.widths = [900, 700, 500];
    scene.heights = [20, 20, 20];
    scene.resized = [];
    stageLayout();
  });

  afterEach(unstageLayout);

  it('draws the fullest level that fits', () => {
    render(<Strip levels={3} content="a" />);
    expect(level()).toBe(2);
  });

  it('draws the fullest of all where that fits', () => {
    scene.room.width = 1000;
    render(<Strip levels={3} content="a" />);
    expect(level()).toBe(0);
  });

  it('stops at the first level that fits, not the barest', () => {
    scene.room.width = 750;
    render(<Strip levels={3} content="a" />);
    expect(level()).toBe(1);
  });

  it('draws the last level where none fits', () => {
    scene.room.width = 100;
    render(<Strip levels={3} content="a" />);
    expect(level()).toBe(2);
  });

  it('lets a pixel of rounding pass', () => {
    scene.room.width = 899;
    render(<Strip levels={3} content="a" />);
    expect(level()).toBe(0);
    resize({ width: 898 });
    expect(level()).toBe(1);
  });

  it('counts what reaches past the bottom as well', () => {
    scene.room.width = 1000;
    scene.heights = [60, 20, 20];
    render(<Strip levels={3} content="a" />);
    expect(level()).toBe(1);
  });

  it('starts again from the fullest when there is more room', () => {
    render(<Strip levels={3} content="a" />);
    expect(level()).toBe(2);
    resize({ width: 950 });
    expect(level()).toBe(0);
  });

  it('goes down again when there is less', () => {
    scene.room.width = 950;
    render(<Strip levels={3} content="a" />);
    expect(level()).toBe(0);
    resize({ width: 720 });
    expect(level()).toBe(1);
  });

  it('starts again when the content changes', () => {
    const { rerender } = render(<Strip levels={3} content="long names" />);
    expect(level()).toBe(2);
    // Shorter names: the fullest way of drawing them fits now.
    scene.widths = [580, 400, 300];
    rerender(<Strip levels={3} content="short names" />);
    expect(level()).toBe(0);
  });

  it('keeps its level while neither the room nor the content changes', () => {
    const { rerender } = render(<Strip levels={3} content="a" />);
    expect(level()).toBe(2);
    // Drawn again with nothing new: what the page holds is not asked.
    scene.widths = [100, 100, 100];
    rerender(<Strip levels={3} content="a" />);
    expect(level()).toBe(2);
  });

  it('takes its room from the frame where one is given', () => {
    render(<Boxed levels={3} content="a" />);
    expect(level()).toBe(2);
    resize({ width: 1000 });
    expect(level()).toBe(0);
  });

  it('starts again for a change of height only where the room is a size', () => {
    const downOnly = (target: HTMLElement) =>
      target.scrollHeight > target.clientHeight + 1;
    scene.heights = [100, 20];
    const { unmount } = render(
      <Boxed levels={2} content="a" room="size" overflows={downOnly} />
    );
    // Too tall for the box, however wide it is.
    expect(level()).toBe(1);
    resize({ height: 120 });
    expect(level()).toBe(0);
    unmount();

    scene.room.height = 40;
    render(<Boxed levels={2} content="a" overflows={downOnly} />);
    expect(level()).toBe(1);
    // The height is not the room here: nothing is asked again.
    resize({ height: 120 });
    expect(level()).toBe(1);
  });

  it('asks only what it is told to of an overflow', () => {
    // Wider than the box at every level, and never too tall.
    const downOnly = (target: HTMLElement) =>
      target.scrollHeight > target.clientHeight + 1;
    render(<Strip levels={3} content="a" overflows={downOnly} />);
    expect(level()).toBe(0);
  });

  it('says how wide its room is, and keeps up with it', () => {
    render(<Strip levels={3} content="a" />);
    const strip = screen.getByTestId('strip');
    expect(strip.dataset.width).toBe('600');
    resize({ width: 1280 });
    expect(strip.dataset.width).toBe('1280');
  });

  it('is the fullest level where nothing is laid out', () => {
    unstageLayout();
    render(<Strip levels={3} content="a" />);
    expect(level()).toBe(0);
    // And no width has been measured.
    expect(screen.getByTestId('strip').dataset.width).toBe('0');
  });
});
