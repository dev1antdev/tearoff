import { isSectorTime } from '@irdashies/shared';
import { CAR_SECTORS_PER_LAP, type CarSectorsSnapshot } from '@irdashies/types';

/**
 * How the three sector marks of a car in a timing table are coloured, from
 * `car-sectors.snapshot`. Pure: the cell that draws them is
 * `SectorMarksCell`.
 *
 * A mark is about the car's most recent time for the sector: this lap's
 * once the sector is done, the lap before's until then. So the three are
 * never of one moment while a lap is under way, and after the line they are
 * the finished lap whole.
 */
export type SectorMarkTone =
  /** The quickest anybody of the class has done the sector this session. */
  | 'classBest'
  /** The car's own quickest, which somebody else of the class has beaten. */
  | 'ownBest'
  /** Slower than the car has done it before. */
  | 'slower'
  /** No time for the sector yet. */
  | 'none';

/** The marks of a car with no sector time at all. */
export const NO_SECTOR_MARKS: readonly SectorMarkTone[] = Object.freeze([
  'none',
  'none',
  'none',
]);

/**
 * Two times closer than this are the same time. The channel rounds to the
 * millisecond, so a time is its own best to the last figure; the margin is
 * for a best that reached here by another route.
 */
const MATCH_SECONDS = 0.0005;

const matches = (time: number, best: unknown): boolean =>
  isSectorTime(best) && time <= best + MATCH_SECONDS;

/**
 * The first that applies: no time; the class's best; the car's own best;
 * slower. A time with no best to hold it against is the car's own best,
 * being the only one there is.
 */
export const sectorMarkTone = (
  time: number | null | undefined,
  ownBest: number | null | undefined,
  classBest: number | null | undefined
): SectorMarkTone => {
  if (!isSectorTime(time)) return 'none';
  if (matches(time, classBest)) return 'classBest';
  if (!isSectorTime(ownBest) || matches(time, ownBest)) return 'ownBest';
  return 'slower';
};

/**
 * The three marks of one car, S1 to S3.
 *
 * `classId` is the session's class of the car, which names the class best
 * it is held against; a car whose class the channel does not list can still
 * be its own best or slower.
 */
export const carSectorMarks = (
  snapshot: CarSectorsSnapshot | undefined,
  carIdx: number,
  classId: number | undefined
): readonly SectorMarkTone[] => {
  if (!snapshot?.available || carIdx < 0) return NO_SECTOR_MARKS;
  const base = carIdx * CAR_SECTORS_PER_LAP;
  const classSlot =
    classId === undefined ? -1 : snapshot.classIds.indexOf(classId);
  const marks: SectorMarkTone[] = [];
  let any = false;
  for (let sector = 0; sector < CAR_SECTORS_PER_LAP; sector += 1) {
    const current = snapshot.current[base + sector];
    const tone = sectorMarkTone(
      isSectorTime(current) ? current : snapshot.last[base + sector],
      snapshot.best[base + sector],
      classSlot < 0
        ? null
        : snapshot.classBest[classSlot * CAR_SECTORS_PER_LAP + sector]
    );
    if (tone !== 'none') any = true;
    marks.push(tone);
  }
  return any ? marks : NO_SECTOR_MARKS;
};
