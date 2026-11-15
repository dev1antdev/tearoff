/**
 * A frame cell kept from one frame to the next for as long as its values
 * stand, and replaced when one of them moves.
 *
 * For the arrays that change a few times a session rather than a few times a
 * second: which cars are in the pits, how dented the body is, what each wheel
 * is standing on. The mapper runs at the poll rate, about 64 times a second,
 * and building such an array afresh each time hands the collector one per key
 * per frame for values that have not moved. Comparing them costs a loop over
 * numbers already in hand and allocates nothing.
 *
 * Replaced, never written to. A frame is handed on by reference, so a cell
 * changed in place would change under anything still holding the frame
 * before; the REST cells and the dial maxima are handed over the same way.
 */
export interface HeldCell<T> {
  cell: { value: T[] } | undefined;
}

export const createHeldCell = <T>(): HeldCell<T> => ({ cell: undefined });

/** A raw value published as it stands. */
export const asRead = (raw: number): number => raw;

/** A raw 1-or-0 flag as a boolean. */
export const asFlag = (raw: number): boolean => raw !== 0;

/**
 * The cell for the first `length` values of `source`: the one already held
 * when every value is what it was, a new one otherwise.
 *
 * `read` turns a raw value into the published one. It takes `context` as an
 * argument so that it can be a function of the module, not a closure built
 * on every frame.
 */
export function holdCell<T, C>(
  held: HeldCell<T>,
  source: ArrayLike<number>,
  length: number,
  read: (raw: number, index: number, context: C) => T,
  context: C
): { value: T[] } {
  const current = held.cell;
  if (current?.value.length === length) {
    let index = 0;
    while (
      index < length &&
      Object.is(current.value[index], read(source[index], index, context))
    ) {
      index += 1;
    }
    if (index === length) return current;
  }
  const value = new Array<T>(length);
  for (let index = 0; index < length; index += 1) {
    value[index] = read(source[index], index, context);
  }
  const next = { value };
  held.cell = next;
  return next;
}
