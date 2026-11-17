import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LegendEntry } from '../chartModel';
import { ChartLegend } from './ChartLegend';

/**
 * The legend of the pace chart of the staged race: three drivers of ours,
 * the three cars around us, a stop and a lap off the scale.
 */
const ENTRIES: LegendEntry[] = [
  { kind: 'driver', key: 'd0', colour: 0, number: '#77', name: 'M. Ivanov' },
  { kind: 'driver', key: 'd1', colour: 1, number: '#77', name: 'A. Petrov' },
  { kind: 'driver', key: 'd2', colour: 2, number: '#77', name: 'D. Sokolov' },
  {
    kind: 'car',
    key: 'c0',
    line: 0,
    number: '#33',
    name: 'E. Brandl',
    role: 'leader',
  },
  {
    kind: 'car',
    key: 'c1',
    line: 1,
    number: '#54',
    name: 'R. Castellano',
    role: 'ahead',
  },
  {
    kind: 'car',
    key: 'c2',
    line: 2,
    number: '#23',
    name: 'E. Vasquez',
    role: 'behind',
  },
  { kind: 'stop', key: 'stop', lead: 'our', text: 'pit stop' },
  { kind: 'mark', key: 'mark', lead: 'lap', text: 'off the scale' },
];

/*
 * jsdom lays nothing out, so a layout is staged here, as plain as will do:
 * every letter on show is six pixels wide, a key is as wide as its drawing,
 * six pixels stand between the parts of an entry, and a line is sixteen
 * pixels tall with two between lines. An entry never breaks, a list that
 * may wrap fills each line as far as it goes, and what is kept for a screen
 * reader takes no room.
 *
 * At these sizes the staged legend is 1060 wide whole, 850 with the other
 * cars as numbers and 620 at its barest.
 */
const LETTER = 6;
const PART_GAP = 6;
const LINE = 16;
const LINE_GAP = 2;

const scene = { width: 0 };

/** The words of an element that are on show. */
const shownText = (element: Element): string => {
  let text = '';
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? '';
    else if (
      node instanceof HTMLElement &&
      !node.classList.contains('sr-only')
    ) {
      text += shownText(node);
    }
  }
  return text;
};

const entryWidth = (entry: Element): number =>
  Array.from(entry.children).reduce((width, part, index) => {
    if (part.classList.contains('sr-only')) return width;
    const own =
      part.tagName.toLowerCase() === 'svg'
        ? Number(part.getAttribute('width'))
        : shownText(part).trim().length * LETTER;
    return width + own + (index > 0 ? PART_GAP : 0);
  }, 0);

/** The lines a list comes to, each as the width of what is on it. */
const linesOf = (list: HTMLElement): number[] => {
  const gap = list.classList.contains('gap-x-3.5') ? 14 : 12;
  const wraps = list.classList.contains('flex-wrap');
  const lines: number[] = [];
  for (const entry of list.children) {
    const width = entryWidth(entry);
    const last = lines.length - 1;
    if (last >= 0 && (!wraps || lines[last] + gap + width <= scene.width)) {
      lines[last] += gap + width;
    } else {
      lines.push(width);
    }
  }
  return lines;
};

const contentHeight = (list: HTMLElement): number => {
  const lines = linesOf(list).length;
  return lines * LINE + Math.max(0, lines - 1) * LINE_GAP;
};

class FakeResizeObserver {
  observe() {
    return undefined;
  }
  disconnect() {
    return undefined;
  }
}

const show = (width: number, roomy = false) => {
  // One legend on the page at a time: a test may show it at two widths.
  cleanup();
  scene.width = width;
  render(<ChartLegend entries={ENTRIES} roomy={roomy} />);
  const list = screen.getByTestId('race-charts-legend');
  return {
    look: `${list.dataset.detail} on ${list.dataset.lines}`,
    words: Array.from(list.children).map((entry) =>
      Array.from(entry.children)
        .filter((part) => !part.classList.contains('sr-only'))
        .map((part) => shownText(part).trim())
        .filter(Boolean)
        .join(' ')
    ),
    read: Array.from(list.children).map((entry) => entry.textContent),
  };
};

describe('ChartLegend', () => {
  beforeEach(() => {
    const define = (name: string, get: (this: HTMLElement) => number) =>
      Object.defineProperty(HTMLElement.prototype, name, {
        configurable: true,
        get,
      });
    define('clientWidth', () => scene.width);
    define('scrollWidth', function () {
      return Math.max(scene.width, ...linesOf(this));
    });
    define('scrollHeight', function () {
      return contentHeight(this);
    });
    define('clientHeight', function () {
      // A list that may wrap is held to two lines.
      return this.classList.contains('flex-wrap')
        ? Math.min(contentHeight(this), 2 * LINE + LINE_GAP)
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

  describe('in a short panel', () => {
    it('is whole on one line where that fits', () => {
      const legend = show(1100);
      expect(legend.look).toBe('full on 1');
      expect(legend.words).toEqual([
        '#77 M. Ivanov',
        '#77 A. Petrov',
        '#77 D. Sokolov',
        '#33 E. Brandl leader',
        '#54 R. Castellano ahead',
        '#23 E. Vasquez behind',
        'our pit stop',
        'lap off the scale',
      ]);
    });

    it('names the other cars by number before it takes a second line', () => {
      const legend = show(900);
      expect(legend.look).toBe('numbers on 1');
      expect(legend.words).toEqual([
        '#77 M. Ivanov',
        '#77 A. Petrov',
        '#77 D. Sokolov',
        '#33 leader',
        '#54 ahead',
        '#23 behind',
        'our pit stop',
        'lap off the scale',
      ]);
    });

    it('then drops why they are drawn, and writes our number once', () => {
      const legend = show(700);
      expect(legend.look).toBe('bare on 1');
      expect(legend.words).toEqual([
        '#77 M. Ivanov',
        'A. Petrov',
        'D. Sokolov',
        '#33',
        '#54',
        '#23',
        'pit stop',
        'off the scale',
      ]);
    });

    it('goes onto two lines only when no one line holds it, whole again', () => {
      const legend = show(600);
      expect(legend.look).toBe('full on 2');
      expect(legend.words[3]).toBe('#33 E. Brandl leader');
    });

    it('writes less on two lines where the whole of it needs three', () => {
      expect(show(400).look).toBe('bare on 2');
    });

    it('is cut at its second line where even the barest needs more', () => {
      const legend = show(250);
      expect(legend.look).toBe('bare on 2');
      const list = screen.getByTestId('race-charts-legend');
      expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
      expect(list).toHaveClass('overflow-hidden');
    });
  });

  describe('in a panel with height to spare', () => {
    it('is whole on one line where that fits', () => {
      expect(show(1100, true).look).toBe('full on 1');
    });

    it('takes its second line before it writes less', () => {
      const legend = show(900, true);
      expect(legend.look).toBe('full on 2');
      expect(legend.words[3]).toBe('#33 E. Brandl leader');
      expect(legend.words[6]).toBe('our pit stop');
    });

    it('writes less only to stay within two lines', () => {
      expect(show(500, true).look).toBe('numbers on 2');
    });

    it('is never on more than two lines', () => {
      expect(show(400, true).look).toBe('bare on 2');
      expect(show(250, true).look).toBe('bare on 2');
    });
  });

  it('keeps every word for a screen reader, however little is on show', () => {
    const whole = show(1100).read;
    const bare = show(250).read;
    expect(bare).toEqual(whole);
    expect(bare).toEqual([
      '#77 M. Ivanov',
      '#77 A. Petrov',
      '#77 D. Sokolov',
      '#33 E. Brandlleader',
      '#54 R. Castellanoahead',
      '#23 E. Vasquezbehind',
      'our pit stop',
      'lap off the scale',
    ]);
  });

  it('writes the number of a driver the record does not name', () => {
    scene.width = 300;
    render(
      <ChartLegend
        roomy={false}
        entries={[
          { kind: 'driver', key: 'd0', colour: 0, number: '#77', name: 'A' },
          { kind: 'driver', key: 'd1', colour: 1, number: '#77', name: '' },
          {
            kind: 'car',
            key: 'c0',
            line: 0,
            number: '#33',
            name: 'E. Brandl With A Long Name',
            role: 'leader',
          },
          { kind: 'mark', key: 'mark', lead: 'lap', text: 'off the scale' },
        ]}
      />
    );
    const list = screen.getByTestId('race-charts-legend');
    expect(list.dataset.detail).toBe('bare');
    // The second driver has nothing but the number to be told by.
    expect(shownText(list.children[1]).trim()).toBe('#77');
  });

  it('is whole where nothing is laid out', () => {
    for (const name of ['scrollWidth', 'scrollHeight']) {
      Reflect.deleteProperty(HTMLElement.prototype, name);
    }
    expect(show(0).look).toBe('full on 1');
  });
});
