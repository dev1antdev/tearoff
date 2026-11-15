import { describe, expect, it } from 'vitest';
import { asFlag, asRead, createHeldCell, holdCell } from './heldCell';

describe('holdCell', () => {
  it('builds a cell from the values it is given', () => {
    const held = createHeldCell<number>();

    const cell = holdCell(held, new Uint8Array([0, 5, 0, 4]), 4, asRead, null);

    expect(cell.value).toEqual([0, 5, 0, 4]);
  });

  it('hands back the same cell while no value has moved', () => {
    // The point of it: a frame allocates nothing for an array that stands.
    const held = createHeldCell<number>();
    const first = holdCell(held, new Uint8Array([0, 5, 0, 4]), 4, asRead, null);
    // A different array each frame, as the addon returns one, holding the
    // same values.
    const second = holdCell(
      held,
      new Uint8Array([0, 5, 0, 4]),
      4,
      asRead,
      null
    );

    expect(second).toBe(first);
  });

  it('replaces the cell when a value moves, and leaves the old one alone', () => {
    // A frame is handed on by reference: whoever still holds the frame
    // before must not see it change.
    const held = createHeldCell<number>();
    const first = holdCell(held, new Uint8Array([0, 5, 0, 4]), 4, asRead, null);
    const second = holdCell(
      held,
      new Uint8Array([0, 0, 0, 4]),
      4,
      asRead,
      null
    );

    expect(second).not.toBe(first);
    expect(second.value).toEqual([0, 0, 0, 4]);
    expect(first.value).toEqual([0, 5, 0, 4]);
    // And the new one is now the one held.
    expect(holdCell(held, new Uint8Array([0, 0, 0, 4]), 4, asRead, null)).toBe(
      second
    );
  });

  it('replaces the cell when the number of values changes', () => {
    // A car joins and the per-car arrays grow by a slot.
    const held = createHeldCell<number>();
    const two = holdCell(held, new Uint8Array([1, 2]), 2, asRead, null);
    const three = holdCell(held, new Uint8Array([1, 2, 0]), 3, asRead, null);

    expect(three).not.toBe(two);
    expect(three.value).toEqual([1, 2, 0]);
  });

  it('reads only as many values as it is asked for', () => {
    const held = createHeldCell<number>();

    expect(
      holdCell(held, new Float64Array([1, 2, 3, 4]), 3, asRead, null).value
    ).toEqual([1, 2, 3]);
  });

  it('compares what is published, not what was read', () => {
    // A flag is published as a boolean, so a 1 becoming a 2 changes nothing.
    const held = createHeldCell<boolean>();
    const first = holdCell(held, new Uint8Array([0, 1]), 2, asFlag, null);
    const second = holdCell(held, new Uint8Array([0, 2]), 2, asFlag, null);

    expect(first.value).toEqual([false, true]);
    expect(second).toBe(first);
  });

  it('gives the reader the slot and the context it was called with', () => {
    const held = createHeldCell<string>();
    const cell = holdCell(
      held,
      new Uint8Array([7, 8]),
      2,
      (raw, index, prefix: string) => `${prefix}${index}=${raw}`,
      'car'
    );

    expect(cell.value).toEqual(['car0=7', 'car1=8']);
  });

  it('keeps each held cell to itself', () => {
    const one = createHeldCell<number>();
    const other = createHeldCell<number>();
    const first = holdCell(one, new Uint8Array([1]), 1, asRead, null);
    const second = holdCell(other, new Uint8Array([1]), 1, asRead, null);

    expect(second).not.toBe(first);
  });
});
