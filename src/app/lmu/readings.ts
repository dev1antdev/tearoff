/**
 * Whether a field of a shared-memory read holds something the sim wrote.
 *
 * The addon leaves a field out altogether when the player has no car, and an
 * addon built before a field was exported never has it; neither is a zero,
 * and neither may be published as one.
 */

/** A number, as opposed to a field that is not there. */
export const isReading = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Three of them: a position or a vector, x y z. */
export const isVec3 = (
  value: ArrayLike<number> | undefined
): value is ArrayLike<number> =>
  value !== undefined &&
  value.length >= 3 &&
  Number.isFinite(value[0]) &&
  Number.isFinite(value[1]) &&
  Number.isFinite(value[2]);
