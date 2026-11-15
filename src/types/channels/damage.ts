/**
 * What has happened to the player's car, for the damage widget.
 *
 * Le Mans Ultimate only: iRacing publishes no body, suspension or aero state.
 * Built by DamageProcessor from the player's block of shared memory (dents,
 * what has come off, the last impact) and from the sim's REST API (aero and
 * suspension damage, the repair the pit menu is set to and what it costs).
 *
 * One recording stands behind it, with five knocks to the nose and one dent.
 * What that confirms and what still rests on TinyPedal's reading of the sim
 * is said field by field below.
 */

/** 0 none, 1 light, 2 heavy, 3 detached. */
export type DamageLevel = 0 | 1 | 2 | 3;

/** How many zones the body is drawn in. */
export const DAMAGE_BODY_ZONES = 8;

export interface DamageWheel {
  /** The wheel has come off. Never seen set on a recording. */
  detached: boolean;
  /**
   * Flat or at no pressure, and still on the car. Never seen on a recording
   * either: whether the sim sets its flat flag at all is not known, which is
   * why a pressure at or below 1 kPa counts as well.
   */
  punctured: boolean;
  /**
   * 0 healthy .. 1 destroyed; null until the sim's REST API has answered.
   * The scale is TinyPedal's reading: the recorded car reads 0 throughout,
   * its five impacts included.
   */
  suspensionDamage: number | null;
}

export interface DamageSnapshot {
  /** False when the player has no car (monitor, spectating). */
  available: boolean;
  /**
   * Eight zones clockwise from the nose: front, front right, right, rear
   * right, rear, rear left, left, front left.
   *
   * Only the front is confirmed: the recorded dent followed a hit on the
   * nose. The other seven positions, and level 2, are TinyPedal's reading.
   * Level 3 is only ever the rear, for bodywork the sim reports detached,
   * which by the same reading is the rear wing.
   */
  body: readonly DamageLevel[];
  /** LF, RF, LR, RR. */
  wheels: readonly DamageWheel[];
  /** 0..1, 1 = undamaged: 1 minus the eight levels over 16. */
  bodyIntegrity: number;
  /** 0..1; null until REST has answered. */
  aeroIntegrity: number | null;
  /**
   * 0..1 from the worst wheel; null until REST has answered and no wheel is
   * detached.
   */
  suspensionIntegrity: number | null;
  /** Lowest tread fraction of the four tyres, 0..1; null without a reading. */
  tyreIntegrity: number | null;
  /** The sim's overheating warning. Never seen set on a recording. */
  overheating: boolean;
  /**
   * Direction of the last impact, radians clockwise from the nose; null when
   * none in the last 15 s. An impact too light to be a contact, a kerb or the
   * floor touching the road, is left out unless damage came with it.
   */
  impactBearingRad: number | null;
  /** Seconds the next stop spends on repairs; null when the sim does not say. */
  repairSeconds: number | null;
  /** The pit menu's repair choice as the sim words it; null when none. */
  repairChoice: string | null;
  sessionNum: number | null;
  version: number;
}
