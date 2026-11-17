/**
 * The columns a settings page lists, in the order an order names them.
 *
 * `known` is every column the page can show. A column the order does not
 * name comes after those it does, in the page's own order: that is how a
 * column added in a later version appears in an order saved before it. An
 * id the order names that the page does not know is left out, as one that
 * was retired is, and a column named twice is listed once.
 */
export const columnOrder = (
  known: readonly string[],
  order: readonly string[] | undefined
): string[] => {
  const valid = new Set(known);
  const listed = new Set<string>();
  for (const id of order ?? []) {
    if (valid.has(id)) listed.add(id);
  }
  return [...listed, ...known.filter((id) => !listed.has(id))];
};
