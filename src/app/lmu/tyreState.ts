/**
 * The player's tyre and brake temperatures, from the per-wheel block of LMU's
 * telemetry.
 *
 * Units were measured from a recorded GT3 session rather than taken from the
 * rFactor 2 header LMU inherits its structs from, whose comments are wrong
 * about the brakes:
 *
 * - Surface, inner-layer, carcass and brake temperatures arrive in Kelvin. The
 *   header calls the brake Celsius, but the recorded brakes ran 434 to 950,
 *   which is a plausible 161 to 677 C and an impossible reading otherwise.
 * - The compound's optimal temperature arrives in Celsius already: a steady 92
 *   on the medium compound.
 *
 * The three temperature zones across a tyre are left, centre and right as the
 * car sees them. A driver thinks in inner and outer shoulders, and those swap
 * between the two sides of the car, so the zones are reordered here once
 * rather than by every consumer.
 */

/** Wheels per car, in the sim's order: LF, RF, LR, RR. */
export const TYRE_WHEEL_COUNT = 4;
/** Temperature zones across one tyre. */
export const TYRE_ZONE_COUNT = 3;

const KELVIN_OFFSET = 273.15;

/**
 * Kelvin to Celsius, or undefined for a reading that is not a temperature.
 *
 * Zero is the value an unwritten struct holds, not a tyre at absolute zero.
 */
const celsiusFromKelvin = (kelvin: number | undefined): number | undefined =>
  typeof kelvin === 'number' && Number.isFinite(kelvin) && kelvin > 0
    ? kelvin - KELVIN_OFFSET
    : undefined;

/**
 * One temperature per wheel, Kelvin to Celsius.
 *
 * Undefined unless every wheel reads, so a consumer never has to handle a car
 * with three tyres.
 */
export const lmuWheelTemperatures = (
  raw: ArrayLike<number> | undefined
): number[] | undefined => {
  if (!raw || raw.length < TYRE_WHEEL_COUNT) return undefined;
  const out = new Array<number>(TYRE_WHEEL_COUNT);
  for (let wheel = 0; wheel < TYRE_WHEEL_COUNT; wheel += 1) {
    const value = celsiusFromKelvin(raw[wheel]);
    if (value === undefined) return undefined;
    out[wheel] = value;
  }
  return out;
};

/**
 * Three zones per wheel, Kelvin to Celsius, reordered to outer shoulder,
 * middle, inner shoulder.
 *
 * The result holds `wheel * 3 + zone`. On the left wheels (LF, LR) the sim's
 * left zone is the outer shoulder; on the right wheels it is the inner one.
 */
export const lmuTyreZoneTemperatures = (
  raw: ArrayLike<number> | undefined
): number[] | undefined => {
  const expected = TYRE_WHEEL_COUNT * TYRE_ZONE_COUNT;
  if (!raw || raw.length < expected) return undefined;
  const out = new Array<number>(expected);
  for (let wheel = 0; wheel < TYRE_WHEEL_COUNT; wheel += 1) {
    const base = wheel * TYRE_ZONE_COUNT;
    const left = celsiusFromKelvin(raw[base]);
    const centre = celsiusFromKelvin(raw[base + 1]);
    const right = celsiusFromKelvin(raw[base + 2]);
    if (left === undefined || centre === undefined || right === undefined) {
      return undefined;
    }
    const isLeftWheel = wheel % 2 === 0;
    out[base] = isLeftWheel ? left : right;
    out[base + 1] = centre;
    out[base + 2] = isLeftWheel ? right : left;
  }
  return out;
};

/**
 * The compound's working temperature per wheel, Celsius as published.
 *
 * Undefined when the sim states none, which it does as 0.
 */
export const lmuTyreOptimalTemperatures = (
  raw: ArrayLike<number> | undefined
): number[] | undefined => {
  if (!raw || raw.length < TYRE_WHEEL_COUNT) return undefined;
  const out = new Array<number>(TYRE_WHEEL_COUNT);
  for (let wheel = 0; wheel < TYRE_WHEEL_COUNT; wheel += 1) {
    const value = raw[wheel];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return undefined;
    }
    out[wheel] = value;
  }
  return out;
};
