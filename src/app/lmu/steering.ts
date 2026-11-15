const positive = (value: number | undefined): number | undefined =>
  value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : undefined;

/**
 * How far the steering wheel turns, lock to lock, in degrees: the number the
 * sim's steering fraction is scaled by to get an angle.
 *
 * LMU states three ranges and they need not agree. On the recorded Ferrari
 * 296 LMGT3 the driver's own wheel reads 0 (the sim does not know it), the
 * garage setup says 476 and the cockpit animation 719. The setup pairs its
 * 476 degrees with 17.2 at the road wheels, 13.8:1, which is a GT3 car's
 * ratio, and iRacing gives the same car 451; the animation's 719 would be
 * 20.9:1 and turned the drawn wheel half as far again as the real one.
 *
 * So, in order: the driver's own wheel when the sim knows it, else the
 * setup's steering lock, else the cockpit animation, which is all there is
 * before the REST API has answered. 0 when none of them reads.
 */
export const lmuSteeringRangeDeg = (
  physicalRange: number | undefined,
  setupLock: number | undefined,
  visualRange: number | undefined
): number =>
  positive(physicalRange) ?? positive(setupLock) ?? positive(visualRange) ?? 0;

/**
 * The mean angle of the two front road wheels in degrees, positive to the
 * left like SteeringWheelAngle, from the sim's per-wheel toe: radians,
 * positive pointing right, steering included on the fronts. The static toe
 * is equal and opposite on the two sides, so the mean is the steering alone.
 * Undefined when the sim has not written the wheels.
 */
export const lmuFrontWheelAngleDeg = (
  wheelToe: ArrayLike<number> | undefined
): number | undefined => {
  const left = wheelToe?.[0];
  const right = wheelToe?.[1];
  if (left === undefined || right === undefined) return undefined;
  if (!Number.isFinite(left) || !Number.isFinite(right)) return undefined;
  return (-(left + right) / 2) * (180 / Math.PI);
};
