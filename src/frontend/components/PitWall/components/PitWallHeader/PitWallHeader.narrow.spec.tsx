import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PitWallLayoutChoice } from '@irdashies/types';
import type { PitWallHeaderData } from '../../hooks/usePitWallHeader';
import { PIT_WALL_HEADER_SQUEEZE, PitWallHeader } from './PitWallHeader';

/** The staged race's header: at the wheel, under green. */
const racing: PitWallHeaderData = {
  simulator: 'Le Mans Ultimate',
  inSession: true,
  session: 'Race · Silverstone Grand Prix Circuit - WEC',
  timeLeft: '2:41:24',
  timeOfDay: '19:18',
  flag: { label: 'GREEN', tone: 'green' },
  car: {
    number: '77',
    classColor: '#00ff6a',
    place: { position: 'P5', field: 'of 14 in LMGT3', overall: 'P13 overall' },
    driver: 'Mikhail Ivanov',
    team: 'Tearoff Endurance',
  },
  watching: false,
};

/** A team-mate's stint under a full-course yellow: the most it has to say. */
const teamMateUnderYellow: PitWallHeaderData = {
  ...racing,
  flag: { label: 'FULL COURSE YELLOW', tone: 'yellow' },
  watching: true,
};

/*
 * jsdom lays nothing out, so the strip's layout is staged from what the
 * real page measured (the probe of the page stories, stage 12b): each item
 * is as wide as it is there, and so is the room between two items for each
 * of the strip's gaps. As on the page, the session's name takes no part: it
 * is cut by the page's own layout before anything else is, down to the
 * clock under it, which is the width the session is given here.
 *
 * From 1280 wide (1100 on the layout for a tablet) the strip is one line,
 * and what is between the wordmark and the controls is a box that either
 * holds its items or overflows; under that it wraps and overflows nothing.
 */
const WIDTHS = {
  padding: 32,
  wordmark: 89,
  wordmarkWithTitle: 177,
  simulator: 179,
  dot: 8,
  clock: 189,
  flag: { GREEN: 77, 'FULL COURSE YELLOW': 186 } as Record<string, number>,
  car: 179,
  driver: 90,
  watching: 120,
  eye: 38,
  layoutSwitch: 293,
  controlsGap: 20,
  button: 40,
  tallButton: 44,
  buttonGap: 6,
};
const GAPS: Record<string, number> = {
  'gap-x-7': 28,
  'gap-x-5': 20,
  'gap-x-4': 16,
  'gap-x-3': 12,
};

const scene = { width: 0, tall: false };

const strip = () => screen.getByRole('banner');
const parts = () => {
  const [wordmark, middle, controls] = Array.from(strip().children);
  return { wordmark, middle: middle as HTMLElement, controls };
};

const gapOf = (element: Element): number =>
  GAPS[
    Object.keys(GAPS).find((name) => element.classList.contains(name)) ?? ''
  ];

const isOneLine = () => scene.width >= (scene.tall ? 1100 : 1280);

/** Read out only: it takes no room. */
const hidden = (element: Element | null | undefined): boolean =>
  !element || element.classList.contains('sr-only');

const itemWidth = (item: Element): number => {
  switch ((item as HTMLElement).dataset.item) {
    case 'session':
      return WIDTHS.clock;
    case 'flag':
      return WIDTHS.flag[item.textContent ?? ''];
    case 'car':
      return WIDTHS.car;
    case 'driver':
      // An item that may be cut short is no wider than it is let be.
      return item.classList.contains('shrink-0') ? WIDTHS.driver : 0;
    case 'watching':
      return hidden(item.querySelector('span')) ? WIDTHS.eye : WIDTHS.watching;
    case 'simulator':
      // Its dot, with or without its words.
      return hidden(item.querySelector('span:last-child'))
        ? WIDTHS.dot
        : WIDTHS.simulator;
    default:
      return 0;
  }
};

const middleContent = (middle: Element): number => {
  const items = Array.from(middle.children);
  return (
    items.reduce((width, item) => width + itemWidth(item), 0) +
    Math.max(0, items.length - 1) * gapOf(middle)
  );
};

const middleRoom = (): number => {
  const { wordmark, controls } = parts();
  const buttons = controls.querySelectorAll(':scope > div > button').length;
  const size = scene.tall ? WIDTHS.tallButton : WIDTHS.button;
  const switchShown = !controls.querySelector('nav')?.hasAttribute('hidden');
  return (
    scene.width -
    WIDTHS.padding -
    (hidden(wordmark.querySelector('h1'))
      ? WIDTHS.wordmark
      : WIDTHS.wordmarkWithTitle) -
    (switchShown ? WIDTHS.layoutSwitch + WIDTHS.controlsGap : 0) -
    (buttons * size + Math.max(0, buttons - 1) * WIDTHS.buttonGap) -
    2 * gapOf(strip())
  );
};

class FakeResizeObserver {
  observe() {
    return undefined;
  }
  disconnect() {
    return undefined;
  }
}

interface Shown {
  layout?: PitWallLayoutChoice;
  data?: PitWallHeaderData;
  editable?: boolean;
  phone?: boolean;
  reconnecting?: boolean;
}

const show = (
  width: number,
  {
    layout = 'race',
    data = racing,
    editable = false,
    phone = false,
    reconnecting = false,
  }: Shown = {}
) => {
  // One strip on the page at a time: a test may show it at two widths.
  cleanup();
  scene.width = width;
  scene.tall = layout === 'compact';
  render(
    <PitWallHeader
      data={data}
      layout={layout}
      onLayoutChange={phone ? undefined : () => undefined}
      onEditLayout={editable ? () => undefined : undefined}
      fullscreen={false}
      onToggleFullscreen={() => undefined}
      onOpenSettings={() => undefined}
      phone={phone}
      reconnecting={reconnecting}
    />
  );
  return Number(strip().dataset.squeeze);
};

/** What the strip writes for the eye, item by item. */
const written = () => {
  const { wordmark, middle } = parts();
  const item = (name: string) =>
    middle.querySelector<HTMLElement>(`[data-item="${name}"]`);
  return {
    title: !hidden(wordmark.querySelector('h1')),
    simulator: !hidden(
      middle.firstElementChild?.querySelector('span:last-child')
    ),
    // "You are watching": its words, an eye for them, or no such item.
    watching: !item('watching')
      ? 'none'
      : hidden(item('watching')?.querySelector('span'))
        ? 'eye'
        : 'words',
    atTheWheel: !hidden(item('driver')?.firstElementChild),
    driverMayBeCut: !item('driver')?.classList.contains('shrink-0'),
    gap: gapOf(strip()),
  };
};

const WHOLE = {
  title: true,
  simulator: true,
  watching: 'none',
  atTheWheel: true,
  driverMayBeCut: false,
  gap: 28,
};

describe('PitWallHeader, short of room', () => {
  beforeEach(() => {
    const define = (name: string, get: (this: HTMLElement) => number) =>
      Object.defineProperty(HTMLElement.prototype, name, {
        configurable: true,
        get,
      });
    const isMiddle = (element: HTMLElement) =>
      element.parentElement?.tagName === 'HEADER' &&
      element === element.parentElement.children[1];
    define('clientWidth', function () {
      if (!isMiddle(this)) return scene.width;
      return isOneLine() ? middleRoom() : 0;
    });
    define('scrollWidth', function () {
      if (!isMiddle(this)) return scene.width;
      return isOneLine() ? Math.max(middleRoom(), middleContent(this)) : 0;
    });
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  });

  afterEach(() => {
    for (const name of ['clientWidth', 'scrollWidth']) {
      Reflect.deleteProperty(HTMLElement.prototype, name);
    }
    vi.unstubAllGlobals();
  });

  describe('the name of the session', () => {
    it('is what gives way first: it may be cut anywhere and is held to one line', () => {
      show(1920);
      const label = within(strip()).getByText(racing.session);
      // Cut, it ends in an ellipsis, and is whole for whoever points at it.
      expect(label).toHaveClass('line-clamp-1', 'break-all');
      expect(label).toHaveAttribute('title', racing.session);
      // The session is the one item of the strip that is let shrink, and
      // the clock under the name is never broken: that is how far it goes.
      const session = label.parentElement as HTMLElement;
      expect(session.className).toMatch(/shrink-\[1000\]/);
      expect(session).not.toHaveClass('min-w-0');
      expect(session.lastElementChild).toHaveClass('whitespace-nowrap');
      expect(session.lastElementChild).toHaveTextContent(
        '2:41:24 left · 19:18 in game'
      );
      for (const name of ['flag', 'car', 'driver']) {
        expect(strip().querySelector(`[data-item="${name}"]`)).toHaveClass(
          'shrink-0'
        );
      }
    });

    it('is cut to the width of the clock on the layout for a tablet, as before', () => {
      show(1180, { layout: 'compact' });
      const label = within(strip()).getByText(racing.session);
      expect(label).toHaveClass('truncate', 'w-0', 'min-w-full');
      expect(label).toHaveAttribute('title', racing.session);
    });
  });

  describe('on Race', () => {
    it('is whole on a monitor', () => {
      expect(show(1920)).toBe(0);
      expect(written()).toEqual(WHOLE);
      expect(show(1600)).toBe(0);
    });

    it('closes its gaps at 1460, and nothing more', () => {
      expect(show(1460)).toBe(PIT_WALL_HEADER_SQUEEZE.gaps);
      expect(written()).toEqual({ ...WHOLE, gap: 20 });
    });

    it('keeps to its line at 1280 with the dot for the simulator', () => {
      expect(show(1280)).toBe(PIT_WALL_HEADER_SQUEEZE.simulator);
      expect(
        within(screen.getByRole('navigation', { name: 'Layout' })).getAllByRole(
          'button'
        )[0]
      ).toHaveClass('px-3.5');
      expect(written()).toEqual({ ...WHOLE, gap: 20, simulator: false });
      // Still said, and still there for whoever points at the dot.
      const simulator = parts().middle.firstElementChild as HTMLElement;
      expect(simulator).toHaveTextContent('Le Mans Ultimate connected');
      expect(simulator).toHaveAttribute('title', 'Le Mans Ultimate connected');
    });

    it('still says the simulator is as last heard while reconnecting, with the dot alone', () => {
      expect(show(1280, { reconnecting: true })).toBe(
        PIT_WALL_HEADER_SQUEEZE.simulator
      );
      const simulator = strip().querySelector('[data-item="simulator"]');
      // Dimmed, and its words for a reader and for whoever points at it.
      expect(simulator).toHaveClass('text-slate-500');
      expect(simulator).toHaveAttribute(
        'title',
        'Le Mans Ultimate, as last heard'
      );
      expect(simulator?.lastElementChild).toHaveClass('sr-only');
      expect(simulator?.lastElementChild).toHaveTextContent(
        'Le Mans Ultimate, as last heard'
      );
    });

    it('is one line from 1280, with what it is about in a box of its own', () => {
      show(1280);
      expect(strip()).toHaveClass('flex-nowrap');
      expect(strip()).not.toHaveClass('flex-wrap');
      expect(parts().middle).toHaveClass('flex', 'flex-1', 'overflow-hidden');
    });

    it('wraps under 1280, whole, as it always did', () => {
      // Its own width, which on a page drawn at 125 % is a fifth less
      // than the window's.
      expect(show(1279)).toBe(0);
      expect(written()).toEqual(WHOLE);
      expect(strip()).toHaveClass('flex-wrap');
      expect(strip()).not.toHaveClass('flex-nowrap');
      // No box around what it is about: its items wrap among the strip's.
      expect(parts().middle).toHaveClass('contents');
      expect(parts().middle).not.toHaveClass('flex');
    });
  });

  describe('while a team-mate drives', () => {
    const data = { ...racing, watching: true };

    it('is whole at 1920 and closes its gaps at 1600', () => {
      expect(show(1920, { layout: 'watching', data })).toBe(0);
      expect(written()).toEqual({ ...WHOLE, watching: 'words' });
      expect(show(1600, { layout: 'watching', data })).toBe(
        PIT_WALL_HEADER_SQUEEZE.gaps
      );
    });

    it('gives up "Pit Wall" and the words of "You are watching" at 1280', () => {
      expect(show(1280, { layout: 'watching', data })).toBe(
        PIT_WALL_HEADER_SQUEEZE.watching
      );
      expect(written()).toEqual({
        ...WHOLE,
        gap: 20,
        simulator: false,
        title: false,
        watching: 'eye',
      });
      const pill = strip().querySelector('[data-item="watching"]');
      expect(pill).toHaveTextContent('You are watching');
      expect(pill).toHaveAttribute('title', 'You are watching');
      expect(pill?.querySelector('svg')).not.toBeNull();
      // The page's name is still its heading.
      expect(
        screen.getByRole('heading', { name: 'Pit Wall' })
      ).toBeInTheDocument();
    });
  });

  describe('at its fullest: Custom, a team-mate at the wheel, a full-course yellow', () => {
    const fullest = {
      layout: 'custom',
      data: teamMateUnderYellow,
      editable: true,
    } as const;

    it('still has a line to itself at 1600, with its gaps closed', () => {
      expect(show(1600, fullest)).toBe(PIT_WALL_HEADER_SQUEEZE.simulator);
    });

    it('gives up everything it can at 1280, the end of the driver’s name last', () => {
      expect(show(1280, fullest)).toBe(PIT_WALL_HEADER_SQUEEZE.driver);
      expect(written()).toEqual({
        title: false,
        simulator: false,
        watching: 'eye',
        atTheWheel: false,
        driverMayBeCut: true,
        gap: 12,
      });
      // What must stay, stays: the clock, the flag, our car and its place.
      expect(strip()).toHaveTextContent('2:41:24');
      expect(strip().querySelector('[data-item="flag"]')).toHaveTextContent(
        'FULL COURSE YELLOW'
      );
      const car = strip().querySelector('[data-item="car"]');
      expect(car).toHaveTextContent('#77P5 of 14 in LMGT3P13 overall');
      expect(car).toHaveClass('shrink-0');
      // The name is cut with an ellipsis, is still said in full, and is
      // whole for whoever points at it.
      const driver = strip().querySelector('[data-item="driver"]');
      expect(driver).toHaveTextContent('At the wheelMikhail Ivanov');
      expect(driver?.lastElementChild).toHaveClass('truncate');
      expect(driver?.lastElementChild).toHaveAttribute(
        'title',
        'Mikhail Ivanov'
      );
      // The layout switch gave up some of its own room before that.
      for (const button of within(
        screen.getByRole('navigation', { name: 'Layout' })
      ).getAllByRole('button')) {
        expect(button).toHaveClass('px-2.5');
      }
      // The controls are outside what can be cut.
      expect(parts().middle).toHaveClass('overflow-hidden');
      expect(parts().controls).toHaveClass('shrink-0');
      expect(parts().middle).not.toContainElement(
        screen.getByRole('button', { name: 'Edit layout' })
      );
    });
  });

  describe('on the layout for a tablet', () => {
    it('keeps to its line at 1180 by closing its gaps', () => {
      expect(show(1180, { layout: 'compact' })).toBe(
        PIT_WALL_HEADER_SQUEEZE.gaps
      );
      expect(written()).toMatchObject({ gap: 16, atTheWheel: true });
      expect(strip()).toHaveClass('flex-nowrap');
    });

    it('wraps under 1100', () => {
      expect(show(1099, { layout: 'compact' })).toBe(0);
      expect(written().gap).toBe(20);
      expect(strip()).toHaveClass('flex-wrap');
    });
  });

  describe('on a phone', () => {
    it('is two rows: the clock and the flag, then our car, its place and who drives it', () => {
      expect(show(390, { layout: 'compact', phone: true })).toBe(0);
      const { wordmark, middle, controls } = parts();
      const items = Array.from(middle.children);
      const names = items.map(
        (item) => (item as HTMLElement).dataset.item ?? 'row break'
      );
      expect(names).toEqual([
        'simulator',
        'session',
        'flag',
        'row break',
        'car',
        'driver',
      ]);
      // The break takes a whole line of the strip to itself.
      expect(items[3]).toHaveClass('basis-full');
      // No box of its own: its items are the strip's, and wrap as such.
      expect(middle).toHaveClass('contents');
      expect(strip()).toHaveClass('flex-wrap');
      expect(strip()).not.toHaveClass('flex-nowrap');
      expect(controls).toHaveClass('ml-auto');
      expect(wordmark.querySelector('img')).not.toBeNull();
    });

    it('leaves the words for a reader and keeps the figures for the eye', () => {
      show(390, { layout: 'compact', phone: true });
      const session = strip().querySelector('[data-item="session"]');
      const driver = strip().querySelector('[data-item="driver"]');
      // Gone from sight, each still read out.
      expect(within(strip()).getByText(racing.session)).toHaveClass('sr-only');
      expect(within(strip()).getByText('At the wheel')).toHaveClass('sr-only');
      expect(
        within(strip()).getByText('Le Mans Ultimate connected')
      ).toHaveClass('sr-only');
      expect(parts().wordmark.querySelector('span')).toHaveClass('sr-only');
      expect(parts().wordmark).toHaveTextContent('Tearoff');
      // On show: the clock, the flag, our car, its place, the driver.
      expect(session?.lastElementChild).not.toHaveClass('sr-only');
      expect(session?.lastElementChild).toHaveTextContent('2:41:24');
      expect(strip().querySelector('[data-item="flag"]')).toHaveTextContent(
        'GREEN'
      );
      expect(strip().querySelector('[data-item="car"]')).toHaveTextContent(
        '#77P5 of 14 in LMGT3P13 overall'
      );
      expect(driver?.lastElementChild).toHaveTextContent('Mikhail Ivanov');
      expect(driver?.lastElementChild).not.toHaveClass('sr-only');
    });

    it('lets the words beside the clock and the driver’s name give way, never the figures', () => {
      show(390, {
        layout: 'compact',
        phone: true,
        data: teamMateUnderYellow,
      });
      const session = strip().querySelector('[data-item="session"]');
      const clock = session?.lastElementChild as HTMLElement;
      // "left · 19:18 in game" goes before the flag is pushed off the
      // row, and goes whole: on a row of one line that may wrap, behind an
      // item with nothing in it, words that do not fit are on a second
      // line, out of sight.
      expect(session).toHaveClass('min-w-0', 'flex-1');
      const words = clock.querySelector('span') as HTMLElement;
      expect(words).toHaveClass('flex-wrap', 'overflow-hidden', 'h-4');
      expect(words.firstElementChild).toHaveAttribute('aria-hidden', 'true');
      expect(words.lastElementChild).toHaveTextContent(
        /^left · 19:18 in game$/
      );
      // The figures are no part of that row.
      expect(clock.firstChild?.textContent).toBe('2:41:24');
      for (const name of ['flag', 'car']) {
        expect(strip().querySelector(`[data-item="${name}"]`)).toHaveClass(
          'shrink-0'
        );
      }
      const driver = strip().querySelector('[data-item="driver"]');
      expect(driver).toHaveClass('min-w-0', 'flex-1');
      // An eye for "You are watching".
      const pill = strip().querySelector('[data-item="watching"]');
      expect(pill?.querySelector('svg')).not.toBeNull();
      expect(pill?.querySelector('span')).toHaveClass('sr-only');
    });
  });

  it('is whole where nothing is laid out', () => {
    for (const name of ['clientWidth', 'scrollWidth']) {
      Reflect.deleteProperty(HTMLElement.prototype, name);
    }
    expect(show(1280, { data: teamMateUnderYellow })).toBe(0);
    expect(written()).toEqual({ ...WHOLE, watching: 'words' });
  });
});
