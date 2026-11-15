import { asFlag, asRead, createHeldCell, holdCell } from './heldCell';
import { isVec3 } from './readings';
import { TYRE_WHEEL_COUNT } from './tyreState';

/**
 * What has happened to the player's car: where it was last hit, how dented
 * the body is, and what has come off or gone flat.
 *
 * The sim's own statements, from the player's block of its telemetry, beside
 * the two damage figures its REST API gives (LmuSuspensionDamage and
 * LmuAeroDamage). The one recording has five impacts at the nose and one
 * dent level raised by the hardest of them; nothing on it is detached, flat
 * or overheating, so those four are as the rFactor 2 header describes them
 * and have not been seen set.
 *
 * All of it moves a handful of times a race, so the arrays are held between
 * frames and replaced on a change.
 */

/** The fields of a shared-memory read the damage channels are built from. */
export interface LmuDamageSource {
  dentSeverity?: ArrayLike<number>;
  detached?: boolean | number;
  overheating?: boolean | number;
  lastImpactPos?: ArrayLike<number>;
  tyreFlat?: ArrayLike<number>;
  wheelDetached?: ArrayLike<number>;
}

/** The components of a position: x, y, z. */
const AXIS_COUNT = 3;

const heldDentSeverity = createHeldCell<number>();
const heldLastImpactPos = createHeldCell<number>();
const heldTyreFlat = createHeldCell<boolean>();
const heldWheelDetached = createHeldCell<boolean>();

/**
 * Writes the damage channels onto a telemetry frame.
 *
 * - LmuDentSeverity: the dent level of each of the eight parts of the body,
 *   0 none, 1 some, 2 more. The order is the sim's; a hit on the nose raises
 *   the first.
 * - LmuBodyDetached: whether a part other than a wheel has come off.
 * - LmuOverheating: whether the sim is showing its overheating warning.
 * - LmuLastImpactPos: where the last impact landed, [x, y, z] in the sim's
 *   car axes: +x to the car's left, +y up, +z to the rear, so the nose is
 *   negative z. Metres by the rFactor 2 header, which the recording fits.
 *   Zeros until the first impact; LmuLastImpactTime says when it was, and a
 *   new impact is a change of that.
 * - LmuTyreFlat, LmuWheelDetached: per wheel, LF RF LR RR.
 *
 * With no player car the sim writes none of this and nothing is published.
 */
export function writeLmuDamage(
  frame: Record<string, { value: unknown[] }>,
  raw: LmuDamageSource
): void {
  if (raw.dentSeverity && raw.dentSeverity.length > 0) {
    frame.LmuDentSeverity = holdCell(
      heldDentSeverity,
      raw.dentSeverity,
      raw.dentSeverity.length,
      asRead,
      undefined
    );
  }
  if (raw.detached !== undefined) {
    frame.LmuBodyDetached = { value: [Boolean(raw.detached)] };
  }
  if (raw.overheating !== undefined) {
    frame.LmuOverheating = { value: [Boolean(raw.overheating)] };
  }
  if (isVec3(raw.lastImpactPos)) {
    frame.LmuLastImpactPos = holdCell(
      heldLastImpactPos,
      raw.lastImpactPos,
      AXIS_COUNT,
      asRead,
      undefined
    );
  }
  if (raw.tyreFlat && raw.tyreFlat.length >= TYRE_WHEEL_COUNT) {
    frame.LmuTyreFlat = holdCell(
      heldTyreFlat,
      raw.tyreFlat,
      TYRE_WHEEL_COUNT,
      asFlag,
      undefined
    );
  }
  if (raw.wheelDetached && raw.wheelDetached.length >= TYRE_WHEEL_COUNT) {
    frame.LmuWheelDetached = holdCell(
      heldWheelDetached,
      raw.wheelDetached,
      TYRE_WHEEL_COUNT,
      asFlag,
      undefined
    );
  }
}
