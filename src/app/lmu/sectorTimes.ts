import { createHeldCell, type HeldCell } from './heldCell';

/**
 * A car's sector times and sector index, from scoring's per-car arrays.
 *
 * Beside the mapper rather than in it because three callers read them: the
 * mapper, for the car the player is in and for every car at once, and
 * ownEntryKeys.ts, for the user's own entry while a team-mate drives it.
 */

const validTime = (value: number | undefined): number | null =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : null;

/** Sectors in a lap, and the stride of the flat per-car sector arrays. */
export const SECTORS_PER_LAP = 3;

/**
 * One sector's time from LMU's two running totals: the first sector, the
 * first and second together, and, where a lap time is given, what is left
 * of it for the third. Null for a figure the sim has not set.
 *
 * @param sector 0, 1 or 2, in driving order.
 */
export function lmuSectorTime(
  sector: number,
  sector1: number | undefined,
  sector1And2: number | undefined,
  lapTime?: number
): number | null {
  const first = validTime(sector1);
  if (sector === 0) return first;
  const cumulativeSecond = validTime(sector1And2);
  if (sector === 1) {
    return first !== null &&
      cumulativeSecond !== null &&
      cumulativeSecond > first
      ? cumulativeSecond - first
      : null;
  }
  const fullLap = validTime(lapTime);
  return cumulativeSecond !== null &&
    fullLap !== null &&
    fullLap > cumulativeSecond
    ? fullLap - cumulativeSecond
    : null;
}

/** The three sector times of a lap, by the rule above. */
export function mapLmuSectorTimes(
  sector1: number | undefined,
  sector1And2: number | undefined,
  lapTime?: number
): (number | null)[] {
  return [
    lmuSectorTime(0, sector1, sector1And2, lapTime),
    lmuSectorTime(1, sector1, sector1And2, lapTime),
    lmuSectorTime(2, sector1, sector1And2, lapTime),
  ];
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

/** The fields of a shared-memory read the per-car sector keys are built from. */
export interface LmuCarSectorSource {
  vehCurSector1?: ArrayLike<number>;
  vehCurSector2?: ArrayLike<number>;
  vehLastSector1?: ArrayLike<number>;
  vehLastSector2?: ArrayLike<number>;
  vehLastLapTime?: ArrayLike<number>;
  vehBestSector1?: ArrayLike<number>;
  vehBestSector2?: ArrayLike<number>;
  vehBestLapTime?: ArrayLike<number>;
}

interface SectorCell {
  value: (number | null)[];
}

const heldCurrent = createHeldCell<number | null>();
const heldLast = createHeldCell<number | null>();
const heldBest = createHeldCell<number | null>();

/** The figure at one place of a flat per-car sector array. */
const flatSectorTime = (
  index: number,
  sector1s: ArrayLike<number>,
  sector1And2s: ArrayLike<number> | undefined,
  lapTimes: ArrayLike<number> | undefined
): number | null => {
  const carIdx = Math.trunc(index / SECTORS_PER_LAP);
  return lmuSectorTime(
    index % SECTORS_PER_LAP,
    sector1s[carIdx],
    sector1And2s?.[carIdx],
    lapTimes?.[carIdx]
  );
};

/**
 * Every car's three sector times as one flat cell: the one already held
 * while no figure has moved, a new one otherwise. A sector time changes a
 * few times a lap for each car and the mapper runs sixty-odd times a
 * second, so nearly every frame hands on the cell it had and allocates
 * nothing.
 */
const holdSectorTimes = (
  held: HeldCell<number | null>,
  sector1s: ArrayLike<number>,
  sector1And2s: ArrayLike<number> | undefined,
  lapTimes: ArrayLike<number> | undefined
): SectorCell => {
  const length = sector1s.length * SECTORS_PER_LAP;
  const current = held.cell;
  if (current?.value.length === length) {
    let index = 0;
    while (
      index < length &&
      current.value[index] ===
        flatSectorTime(index, sector1s, sector1And2s, lapTimes)
    ) {
      index += 1;
    }
    if (index === length) return current;
  }
  const value = new Array<number | null>(length);
  for (let index = 0; index < length; index += 1) {
    value[index] = flatSectorTime(index, sector1s, sector1And2s, lapTimes);
  }
  const next = { value };
  held.cell = next;
  return next;
};

/**
 * Writes the per-car sector keys onto a telemetry frame, three entries per
 * slot at `carIdx * 3 + sector`:
 *
 * - LmuCarIdxCurrentSectorTimes: the lap under way. Its third is always
 *   null, as the player's is: the lap is over when the third is.
 * - LmuCarIdxLastSectorTimes: the last lap, its third what the sim's time
 *   for that lap leaves; null where the sim gave the lap no time.
 * - LmuCarIdxBestSectorTimes: the sim's best first sector and best time to
 *   the end of the second, which need not be from one lap.
 *
 * A slot with no car in it keeps the zeros its arrays were created with,
 * and reads null three times. Each key is left out when the read does not
 * carry its source.
 */
export function writeLmuCarSectorTimes(
  frame: Record<string, { value: unknown[] }>,
  raw: LmuCarSectorSource
): void {
  if (raw.vehCurSector1) {
    frame.LmuCarIdxCurrentSectorTimes = holdSectorTimes(
      heldCurrent,
      raw.vehCurSector1,
      raw.vehCurSector2,
      undefined
    );
  }
  if (raw.vehLastSector1) {
    frame.LmuCarIdxLastSectorTimes = holdSectorTimes(
      heldLast,
      raw.vehLastSector1,
      raw.vehLastSector2,
      raw.vehLastLapTime
    );
  }
  if (raw.vehBestSector1) {
    frame.LmuCarIdxBestSectorTimes = holdSectorTimes(
      heldBest,
      raw.vehBestSector1,
      raw.vehBestSector2,
      raw.vehBestLapTime
    );
  }
}
