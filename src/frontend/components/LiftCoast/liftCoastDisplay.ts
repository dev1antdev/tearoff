import type { DriverControlsSnapshot, LiftCoastConfig } from '@irdashies/types';

/** What takes the whole strip, in the order they are tested. */
export type LiftCoastOverride = 'lock' | 'abs' | 'slip' | 'tc';

/** What the strip is showing, reduced to what changes a light. */
export interface LiftCoastLights {
  /** Lights lit, counted from the start of the strip. */
  lit: number;
  /** The signal is past the point where the lit lights change colour. */
  critical: boolean;
  /** A system that has the whole strip, or null for the progressive stage. */
  override: LiftCoastOverride | null;
}

/** The colour of one light. */
export type LiftCoastTone = 'off' | 'low' | 'critical' | LiftCoastOverride;

/**
 * One class per colour, each meaning on this strip what it means elsewhere:
 * red for a locked wheel, the yellow the input bar turns the brake while ABS
 * works, orange for wheelspin, the blue of the traction control chip in Car
 * Systems. The progressive stage is violet and, past the critical share,
 * pink. Nothing here is a timing figure, so violet does not read as a
 * personal best.
 */
export const LIFT_COAST_TONE_CLASS: Record<LiftCoastTone, string> = {
  // An unlit light takes the palette's dark neutral, as the rev lights do. No
  // rim: a ring is a shadow, and these change every frame.
  off: 'bg-slate-800',
  low: 'bg-violet-500',
  critical: 'bg-fuchsia-400',
  lock: 'bg-red-500',
  abs: 'bg-yellow-500',
  slip: 'bg-orange-500',
  tc: 'bg-blue-500',
};

export const LIFT_COAST_DARK: LiftCoastLights = {
  lit: 0,
  critical: false,
  override: null,
};

/** Fewest and most lights a strip may have, whatever was saved. */
export const MIN_LIGHTS = 3;
export const MAX_LIGHTS = 20;

/** Pedal travel below which a lock or wheelspin is not the driver's doing. */
const PEDAL_DEADZONE = 0.02;

/**
 * Keeps a share that is a whole number of lights from rounding up to one
 * more: 0.2 of 15 lights is 3.0000000000000004 as the machine multiplies it.
 * Far below the smallest step the sim's byte can take.
 */
const WHOLE_LIGHT_TOLERANCE = 1e-9;

export const clampLightCount = (count: number | undefined): number =>
  typeof count === 'number' && Number.isFinite(count)
    ? Math.min(MAX_LIGHTS, Math.max(MIN_LIGHTS, Math.round(count)))
    : 10;

type LiftCoastRules = Pick<
  LiftCoastConfig,
  | 'ledCount'
  | 'criticalFraction'
  | 'showLiftAndCoast'
  | 'showTc'
  | 'showAbs'
  | 'showWheelLock'
  | 'showWheelSlip'
  | 'lockThreshold'
  | 'slipThreshold'
>;

/**
 * Reduces a driver-controls snapshot to the state of the strip.
 *
 * The first rule that holds has the whole strip: a locked wheel, ABS
 * working, a spinning wheel, traction control cutting. Otherwise the strip
 * fills with the sim's lift-and-coast signal, one light for any signal at
 * all and the last only when it is full, and changes colour once the signal
 * is above the critical share.
 *
 * The lock and wheelspin rules read the slip ratio, which no processor
 * writes yet, so they hold only once one does.
 *
 * Returns the object it returned last time when nothing changed, so a strip
 * re-renders when a light changes and not sixty times a second.
 */
export const createLiftCoastSelector = (rules: LiftCoastRules) => {
  const count = clampLightCount(rules.ledCount);
  let previous: LiftCoastLights = LIFT_COAST_DARK;

  const hold = (
    lit: number,
    critical: boolean,
    override: LiftCoastOverride | null
  ): LiftCoastLights => {
    if (
      previous.lit !== lit ||
      previous.critical !== critical ||
      previous.override !== override
    ) {
      previous = { lit, critical, override };
    }
    return previous;
  };

  return (snapshot: DriverControlsSnapshot): LiftCoastLights => {
    const abs = snapshot.brakeAbsActive === true;
    const tc = snapshot.tcActive === true;

    if (
      rules.showWheelLock &&
      !abs &&
      snapshot.slipRatioMin !== undefined &&
      snapshot.slipRatioMin <= -rules.lockThreshold &&
      (snapshot.brakeRaw ?? 0) > PEDAL_DEADZONE
    ) {
      return hold(count, false, 'lock');
    }
    if (rules.showAbs && abs) return hold(count, false, 'abs');
    if (
      rules.showWheelSlip &&
      !tc &&
      snapshot.slipRatioMax !== undefined &&
      snapshot.slipRatioMax >= rules.slipThreshold &&
      (snapshot.throttleRaw ?? 0) > PEDAL_DEADZONE
    ) {
      return hold(count, false, 'slip');
    }
    if (rules.showTc && tc) return hold(count, false, 'tc');

    const progress = rules.showLiftAndCoast ? (snapshot.liftAndCoast ?? 0) : 0;
    if (!(progress > 0)) return hold(0, false, null);

    const lit = Math.min(
      count,
      Math.ceil(progress * count - WHOLE_LIGHT_TOLERANCE)
    );
    return hold(lit, progress > rules.criticalFraction, null);
  };
};

/** The colour of light `index` of a strip in the given state. */
export const lightTone = (
  lights: LiftCoastLights,
  index: number
): LiftCoastTone => {
  if (lights.override !== null) return lights.override;
  if (index >= lights.lit) return 'off';
  return lights.critical ? 'critical' : 'low';
};
