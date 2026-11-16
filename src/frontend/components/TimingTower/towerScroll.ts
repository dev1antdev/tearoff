/**
 * Where the tower's list is scrolled to so that our own car's row can be
 * read. Pure arithmetic and one function that applies it to the list.
 */

export interface RowInView {
  /** The row's top and height, in the list's own coordinates. */
  rowTop: number;
  rowHeight: number;
  /** The header row, which stays at the top of the list over the rows. */
  headerHeight: number;
  /** The height of the list that shows. */
  viewHeight: number;
  /** Where the list is scrolled to now. */
  scrollTop: number;
}

/**
 * The scroll position at which a row can be read, or null to leave the
 * list where it is.
 *
 * A row in view is left alone: the list is not moved under somebody who is
 * reading it. A row that fits on the first screen is shown with the list
 * from its top, where the leaders are. Any other is put in the middle of
 * what shows under the header row.
 */
export const scrollTopForRow = ({
  rowTop,
  rowHeight,
  headerHeight,
  viewHeight,
  scrollTop,
}: RowInView): number | null => {
  const rowBottom = rowTop + rowHeight;
  if (
    rowTop >= scrollTop + headerHeight &&
    rowBottom <= scrollTop + viewHeight
  ) {
    return null;
  }
  if (rowBottom <= viewHeight) return 0;
  return Math.max(0, rowTop - (viewHeight + headerHeight - rowHeight) / 2);
};

/**
 * Scrolls the list so that our own car's row can be read, and to its top
 * when it has no such row.
 *
 * Set on the list's own scroll position, not asked of the browser, whose
 * scrollIntoView moves every scrolling box up to the window to do it.
 */
export const showOwnRow = (box: HTMLElement): void => {
  const row = box.querySelector<HTMLElement>('tr[data-own="true"]');
  if (!row) {
    if (box.scrollTop !== 0) box.scrollTop = 0;
    return;
  }
  const next = scrollTopForRow({
    // A row's offset is from the table, which starts where the list does.
    rowTop: row.offsetTop,
    rowHeight: row.offsetHeight,
    headerHeight: box.querySelector<HTMLElement>('thead')?.offsetHeight ?? 0,
    viewHeight: box.clientHeight,
    scrollTop: box.scrollTop,
  });
  if (next !== null) box.scrollTop = next;
};
