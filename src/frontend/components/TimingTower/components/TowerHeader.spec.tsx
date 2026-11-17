import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TowerTab } from '../towerRows';
import { TowerHeader } from './TowerHeader';

/** The staged race's classes, and the tab for all of them. */
const TABS: TowerTab[] = [
  { id: '1', label: 'Hypercar', color: 0xff0000 },
  { id: '2', label: 'LMP2', color: 0x0000ff },
  { id: '3', label: 'LMGT3', color: 0x00ff00 },
  { id: 'all', label: 'All' },
];

/*
 * jsdom lays nothing out, so a layout is staged here, as plain as will do:
 * a letter is six pixels wide; a button is its words and eighteen of
 * padding and border, with fourteen more for a class's dot; four pixels
 * stand between two buttons, six between a switch's label and its buttons
 * and sixteen between the parts of the bar. A row is twenty-six pixels tall
 * with six between rows. A part never breaks, but the class tabs wrap among
 * themselves where the bar may.
 *
 * At these sizes the staged bar is 860 wide whole, 740 with "Avg" and "vs",
 * 632 with the choices shortened too and 572 at its barest.
 */
const LETTER = 6;
const BUTTON = 18;
const DOT = 14;
const BUTTON_GAP = 4;
const LABEL_GAP = 6;
const PART_GAP = 16;
const ROW = 26;
const ROW_GAP = 6;

const scene = { width: 0 };

const buttonWidth = (button: Element): number =>
  BUTTON +
  (button.querySelector('span.rounded-full') ? DOT : 0) +
  (button.textContent ?? '').length * LETTER;

/** The buttons of a group on one row. */
const buttonsWidth = (buttons: Element[]): number =>
  buttons.reduce(
    (width, button, index) =>
      width + buttonWidth(button) + (index > 0 ? BUTTON_GAP : 0),
    0
  );

/** A part of the bar: its width on one row, or null for the spacer. */
const partWidth = (part: Element): number | null => {
  const buttons = Array.from(part.querySelectorAll('button'));
  if (part.getAttribute('role') === 'group') return buttonsWidth(buttons);
  if (buttons.length > 0) {
    const label = part.querySelector(':scope > span')?.textContent ?? '';
    return label.length * LETTER + LABEL_GAP + buttonsWidth(buttons);
  }
  const text = part.textContent ?? '';
  return text ? text.length * LETTER : null;
};

/** The rows the bar comes to, each as the width of what is on it. */
const rowsOf = (bar: HTMLElement): number[] => {
  const wraps = bar.classList.contains('flex-wrap');
  const rows: number[] = [];
  const place = (width: number, gap: number) => {
    const last = rows.length - 1;
    if (last >= 0 && (!wraps || rows[last] + gap + width <= scene.width)) {
      rows[last] += gap + width;
    } else {
      rows.push(width);
    }
  };
  for (const part of bar.children) {
    const width = partWidth(part);
    if (width === null) continue;
    if (wraps && part.getAttribute('role') === 'group' && width > scene.width) {
      // The class tabs, wider than the bar: they wrap among themselves,
      // and what follows starts under them.
      const tabRows: number[] = [];
      for (const button of part.children) {
        const own = buttonWidth(button);
        const last = tabRows.length - 1;
        if (last >= 0 && tabRows[last] + BUTTON_GAP + own <= scene.width) {
          tabRows[last] += BUTTON_GAP + own;
        } else {
          tabRows.push(own);
        }
      }
      rows.push(...tabRows.slice(0, -1), scene.width);
      continue;
    }
    place(width, PART_GAP);
  }
  return rows;
};

const contentHeight = (bar: HTMLElement): number => {
  const rows = rowsOf(bar).length;
  return rows * ROW + Math.max(0, rows - 1) * ROW_GAP;
};

const isBar = (element: HTMLElement) =>
  element.parentElement?.dataset.testid === 'tower-header';

class FakeResizeObserver {
  observe() {
    return undefined;
  }
  disconnect() {
    return undefined;
  }
}

interface Shown {
  tabs?: readonly TowerTab[];
  averages?: boolean;
  pace?: boolean;
  cars?: number;
}

const onAveragesOver = vi.fn();
const onPaceAgainst = vi.fn();

const show = (
  width: number,
  { tabs = TABS, averages = true, pace = true, cars = 14 }: Shown = {}
) => {
  // One bar on the page at a time: a test may show it at two widths.
  cleanup();
  scene.width = width;
  render(
    <TowerHeader
      tabs={tabs}
      activeTab="3"
      onTabChange={() => undefined}
      averagesOver={averages ? 'clean' : undefined}
      onAveragesOverChange={onAveragesOver}
      paceAgainst={pace ? 'stint' : undefined}
      onPaceAgainstChange={onPaceAgainst}
      cars={cars}
    />
  );
  const header = screen.getByTestId('tower-header');
  const bar = header.firstElementChild as HTMLElement;
  return {
    look: `${header.dataset.words} on ${header.dataset.rows}`,
    rows: rowsOf(bar).length,
    words: Array.from(bar.querySelectorAll('span, button'))
      .filter((element) => !element.classList.contains('rounded-full'))
      .map((element) => element.textContent)
      // Less the class tabs, which are written the same at every width.
      .slice(tabs.length),
  };
};

describe('TowerHeader', () => {
  beforeEach(() => {
    onAveragesOver.mockReset();
    onPaceAgainst.mockReset();
    const define = (name: string, get: (this: HTMLElement) => number) =>
      Object.defineProperty(HTMLElement.prototype, name, {
        configurable: true,
        get,
      });
    define('clientWidth', () => scene.width);
    define('scrollWidth', function () {
      return isBar(this) ? Math.max(scene.width, ...rowsOf(this)) : scene.width;
    });
    define('scrollHeight', function () {
      return isBar(this) ? contentHeight(this) : ROW;
    });
    define('clientHeight', function () {
      if (!isBar(this)) return ROW;
      // A bar held to two rows is no taller than they are.
      return this.className.includes('max-h-')
        ? Math.min(contentHeight(this), 2 * ROW + ROW_GAP)
        : contentHeight(this);
    });
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  });

  afterEach(() => {
    for (const name of [
      'clientWidth',
      'clientHeight',
      'scrollWidth',
      'scrollHeight',
    ]) {
      Reflect.deleteProperty(HTMLElement.prototype, name);
    }
    vi.unstubAllGlobals();
  });

  it('writes its switches whole where the bar holds them on one row', () => {
    const header = show(900);
    expect(header.look).toBe('full on 1');
    expect(header.words).toEqual([
      'Averages over',
      'Clean laps',
      'All laps',
      'Pace against',
      'Previous stint',
      'Previous driver',
      '14 cars',
    ]);
  });

  it('shortens what a switch chooses before it takes a second row', () => {
    const header = show(800);
    expect(header.look).toBe('short on 1');
    expect(header.words).toEqual([
      'Avg',
      'Clean laps',
      'All laps',
      'vs',
      'Previous stint',
      'Previous driver',
      '14 cars',
    ]);
  });

  it('then shortens the choices, and is one row at 700 wide', () => {
    const header = show(700);
    expect(header.look).toBe('shorter on 1');
    expect(header.rows).toBe(1);
    expect(header.words).toEqual([
      'Avg',
      'Clean',
      'All',
      'vs',
      'Prev stint',
      'Prev driver',
      '14 cars',
    ]);
  });

  it('takes a second row where no one row holds it, whole again', () => {
    const header = show(600);
    expect(header.look).toBe('full on 2');
    expect(header.rows).toBe(2);
    expect(header.words[0]).toBe('Averages over');
  });

  it('writes less to stay on two rows', () => {
    expect(show(450)).toMatchObject({ look: 'short on 2', rows: 2 });
    expect(show(400)).toMatchObject({ look: 'shorter on 2', rows: 2 });
  });

  it('is at its barest on two rows on a phone', () => {
    const header = show(340);
    expect(header).toMatchObject({ look: 'shortest on 2', rows: 2 });
    expect(header.words).toEqual([
      'Avg',
      'Clean',
      'All',
      'vs',
      'Stint',
      'Driver',
      '14 cars',
    ]);
  });

  it('takes the rows it needs where two cannot hold it, and leaves no switch out', () => {
    const header = show(200);
    expect(header.look).toBe('shortest on 0');
    expect(header.rows).toBeGreaterThan(2);
    expect(screen.getByRole('group', { name: 'Averages over' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Pace against' })).toBeTruthy();
    expect(screen.getByTestId('tower-count')).toHaveTextContent('14 cars');
  });

  it('has more room for words in a session of one class', () => {
    // No tabs: the two switches and the count come to 598.
    expect(show(620, { tabs: [] }).look).toBe('full on 1');
    expect(show(590, { tabs: [] }).look).toBe('short on 1');
  });

  it('names a shortened switch and its choices in full to a reader', () => {
    show(340);
    const averages = screen.getByRole('group', { name: 'Averages over' });
    const pace = screen.getByRole('group', { name: 'Pace against' });
    expect(averages).toBeInTheDocument();
    // The short words before each group are for the eye only.
    for (const group of [averages, pace]) {
      const label = group.previousElementSibling;
      expect(label).toHaveAttribute('aria-hidden', 'true');
      expect(label).toHaveAttribute('title', group.getAttribute('aria-label'));
    }
    const stint = screen.getByRole('button', { name: 'Previous stint' });
    expect(stint).toHaveTextContent(/^Stint$/);
    expect(stint).toHaveAttribute('title', 'Pace against: Previous stint');
    expect(stint).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('button', { name: 'Clean laps' })
    ).toHaveTextContent(/^Clean$/);
  });

  it('chooses the same whatever its buttons are called', () => {
    show(340);
    fireEvent.click(screen.getByRole('button', { name: 'Previous driver' }));
    expect(onPaceAgainst).toHaveBeenCalledWith('driver');
    fireEvent.click(screen.getByRole('button', { name: 'All laps' }));
    expect(onAveragesOver).toHaveBeenCalledWith('all');
  });

  it('has no title on words that are written whole', () => {
    show(900);
    const stint = screen.getByRole('button', { name: 'Previous stint' });
    expect(stint).not.toHaveAttribute('title');
    expect(stint).not.toHaveAttribute('aria-label');
    expect(
      screen.getByRole('group', { name: 'Pace against' }).previousElementSibling
    ).not.toHaveAttribute('aria-hidden');
  });

  it('is whole where nothing is laid out', () => {
    for (const name of ['scrollWidth', 'scrollHeight']) {
      Reflect.deleteProperty(HTMLElement.prototype, name);
    }
    expect(show(0).look).toBe('full on 1');
  });
});
