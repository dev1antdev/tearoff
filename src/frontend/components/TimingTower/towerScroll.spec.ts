import { describe, expect, it } from 'vitest';
import { scrollTopForRow, showOwnRow } from './towerScroll';

/** A list 300 high under a header row of 26, with rows of 34. */
const HEADER = 26;
const ROW = 34;
const VIEW = 300;
const rowTop = (index: number) => HEADER + index * ROW;
const at = (index: number, scrollTop = 0) =>
  scrollTopForRow({
    rowTop: rowTop(index),
    rowHeight: ROW,
    headerHeight: HEADER,
    viewHeight: VIEW,
    scrollTop,
  });

describe('scrollTopForRow', () => {
  it('leaves the list alone while the row is in view', () => {
    expect(at(0)).toBeNull();
    expect(at(3)).toBeNull();
    // The last row that fits whole: 26 + 8 * 34 = 298.
    expect(at(7)).toBeNull();
    // And likewise in a list that has been scrolled.
    expect(at(12, 300)).toBeNull();
  });

  it('puts a row further down in the middle of what shows under the header', () => {
    // Row 20 starts at 706. The rows show between 26 and 300 of the view,
    // the middle of which is 163: 706 + 17 - 163.
    expect(at(20)).toBe(560);
    const top = at(20) as number;
    expect(rowTop(20) - top).toBeGreaterThan(HEADER);
    expect(rowTop(20) + ROW - top).toBeLessThan(VIEW);
  });

  it('counts a row cut off by the bottom edge as out of view', () => {
    // Row 8 runs from 298 to 332 in a view of 300.
    expect(at(8)).not.toBeNull();
  });

  it('counts a row under the header row as out of view', () => {
    // Scrolled by 40, row 1 (60..94) starts under the header (40..66).
    expect(at(1, 40)).toBe(0);
  });

  it('goes back to the top for a row of the first screen', () => {
    expect(at(2, 400)).toBe(0);
    expect(at(0, 120)).toBe(0);
  });

  it('never scrolls above the top', () => {
    expect(
      scrollTopForRow({
        rowTop: 10,
        rowHeight: 34,
        headerHeight: 26,
        viewHeight: 30,
        scrollTop: 500,
      })
    ).toBe(0);
  });
});

describe('showOwnRow', () => {
  /** A list as jsdom cannot lay one out: the sizes are written in. */
  const list = (ownIndex: number | null, scrollTop: number) => {
    const box = document.createElement('div');
    box.innerHTML = `<table><thead><tr><th>P</th></tr></thead><tbody>${Array.from(
      { length: 22 },
      (_, index) =>
        `<tr${index === ownIndex ? ' data-own="true"' : ''}><td>${index}</td></tr>`
    ).join('')}</tbody></table>`;
    Object.defineProperty(box, 'clientHeight', { value: VIEW });
    Object.defineProperty(box.querySelector('thead'), 'offsetHeight', {
      value: HEADER,
    });
    box.querySelectorAll('tbody tr').forEach((row, index) => {
      Object.defineProperty(row, 'offsetTop', { value: rowTop(index) });
      Object.defineProperty(row, 'offsetHeight', { value: ROW });
    });
    box.scrollTop = scrollTop;
    return box;
  };

  it('scrolls to our row where it is not in view', () => {
    const box = list(20, 0);

    showOwnRow(box);

    expect(box.scrollTop).toBe(560);
  });

  it('leaves the list where it is while our row is in view', () => {
    const box = list(12, 300);

    showOwnRow(box);

    expect(box.scrollTop).toBe(300);
  });

  it('goes to the top of a list our car is not in', () => {
    const box = list(null, 400);

    showOwnRow(box);

    expect(box.scrollTop).toBe(0);
  });
});
