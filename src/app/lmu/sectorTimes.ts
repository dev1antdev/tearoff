/**
 * One car's sector times and sector index, from scoring's per-car arrays.
 *
 * Beside the mapper rather than in it because two callers read them: the
 * mapper, for the car the player is in, and ownEntryKeys.ts, for the user's
 * own entry while a team-mate drives it.
 */

const validTime = (value: number | undefined): number | null =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : null;

/**
 * The three sector times of a lap from LMU's two running totals: the first
 * sector, the first and second together, and, where a lap time is given,
 * what is left of it for the third. A figure the sim has not set is null.
 */
export function mapLmuSectorTimes(
  sector1: number | undefined,
  sector1And2: number | undefined,
  lapTime?: number
): (number | null)[] {
  const first = validTime(sector1);
  const cumulativeSecond = validTime(sector1And2);
  const second =
    first !== null && cumulativeSecond !== null && cumulativeSecond > first
      ? cumulativeSecond - first
      : null;
  const fullLap = validTime(lapTime);
  const third =
    cumulativeSecond !== null && fullLap !== null && fullLap > cumulativeSecond
      ? fullLap - cumulativeSecond
      : null;
  return [first, second, third];
}

/**
 * The sector a car is in, counted in driving order from 0. The sim's own
 * figure is rotated: 1 is the first sector, 2 the second and 0 the third.
 */
export function lmuSectorIdx(rawSector: number | undefined): number {
  if (rawSector === 1) return 0;
  if (rawSector === 2) return 1;
  return 2;
}
