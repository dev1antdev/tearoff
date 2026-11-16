import {
  LEDGER_LAP_CAUTION,
  LEDGER_LAP_FROM_START,
  LEDGER_LAP_IN_LAP,
  LEDGER_LAP_OUT_LAP,
  LEDGER_LAP_VOIDED,
  LEDGER_LAP_YELLOW,
  type RaceLap,
} from '@irdashies/types';
import { isCleanLap } from '@irdashies/shared';
import {
  isDrivenStint,
  lapsAroundStop,
  lapsByStint,
  stopSeen,
  type CarRaceRecord,
} from './carRecord';
import { stopText } from './crew';

/**
 * Car Laps, worked out from one car's records: a row a lap, newest first,
 * with what the lap used, a note on what happened on it, and one quiet row
 * for every run of laps that were not recorded.
 *
 * A note says only what the lap's own flags and the car's stints show. Why
 * a lap was slow, whether it was traffic or cold tyres, is not recorded and
 * is not guessed at.
 */

/** How a lap's time is drawn. */
export type LapTone =
  /** The best lap of the car's class in the session. */
  | 'classBest'
  /** The best clean lap of its stint. */
  | 'stintBest'
  | 'plain'
  /** Not a clean lap: in the pits, under a full-course yellow, untimed. */
  | 'quiet';

export interface CarLapRow {
  kind: 'lap';
  lap: number;
  /** Seconds; null while the sim's time has not come, or never did. */
  lapTime: number | null;
  tone: LapTone;
  /** S1, S2 and S3, seconds; null for each the sim did not give. */
  sectors: readonly (number | null)[];
  /** Which of them are the best of the lap's stint. */
  sectorBest: readonly boolean[];
  /** Share of a full budget the lap used, 0..1; null where not known. */
  energyUsed: number | null;
  /** The car ended the lap with more than it began it with. */
  refilled: boolean;
  note: string;
}

/** A run of laps the car completed while nothing was recording. */
export interface MissingLapsRow {
  kind: 'missing';
  from: number;
  to: number;
}

export type CarLapsRow = CarLapRow | MissingLapsRow;

export interface CarLapsView {
  /** Newest first. */
  rows: CarLapsRow[];
  /** A lap has a sector time: the sim times them for this car. */
  hasSectors: boolean;
  /** A lap has what the car had left: the sim publishes it for this car. */
  hasEnergy: boolean;
  /** Which budget that is; null where there is none. */
  energyIsVirtual: boolean | null;
}

/**
 * Clean laps a stint needs before one of them is called its best. The only
 * clean lap of a stint is its best and says nothing by being so.
 */
export const STINT_BEST_MIN_CLEAN_LAPS = 2;

/** Two lap times are the same lap time: the sims print to the thousandth. */
const SAME_TIME_S = 0.0005;

const NO_SECTOR_BEST: readonly boolean[] = [false, false, false];

/** Between two notes on one lap. Not a comma: a stop lists what it did. */
const NOTE_SEPARATOR = ' · ';

const has = (flags: number, bit: number): boolean => (flags & bit) !== 0;

interface StintBests {
  /** The lap number of the stint's best clean lap; null with too few. */
  lap: number | null;
  /** The best time of each sector over those laps. */
  sectors: (number | null)[];
}

const bestsOf = (ownLaps: readonly RaceLap[]): StintBests => {
  const clean = ownLaps.filter(
    (lap) => lap.lapTime !== null && isCleanLap(lap.flags)
  );
  const bests: StintBests = { lap: null, sectors: [null, null, null] };
  if (clean.length < STINT_BEST_MIN_CLEAN_LAPS) return bests;
  let bestTime = Number.POSITIVE_INFINITY;
  for (const lap of clean) {
    if (lap.lapTime !== null && lap.lapTime < bestTime) {
      bestTime = lap.lapTime;
      bests.lap = lap.lap;
    }
    lap.sectors.forEach((time, sector) => {
      if (time === null || sector >= bests.sectors.length) return;
      const best = bests.sectors[sector];
      if (best === null || time < best) bests.sectors[sector] = time;
    });
  }
  return bests;
};

/** What a lap used, from what the car had left at this line and the last. */
const energyOf = (
  lap: RaceLap,
  before: RaceLap | undefined
): { used: number | null; refilled: boolean } => {
  if (
    !before ||
    before.lap !== lap.lap - 1 ||
    before.energy === null ||
    lap.energy === null ||
    before.energyIsVirtual !== lap.energyIsVirtual
  ) {
    return { used: null, refilled: false };
  }
  const used = before.energy - lap.energy;
  return used < 0 ? { used: null, refilled: true } : { used, refilled: false };
};

/** A missing lap as a held one would be listed, for the merge below. */
const numberOf = (entry: RaceLap | number): number =>
  typeof entry === 'number' ? entry : entry.lap;

/**
 * The rows of one car's laps, newest first.
 *
 * @param classBestS The best lap of the car's class in the session, as the
 *   sim has it; null where it is not known. A lap of this car with that
 *   time is that lap.
 */
export const carLapsView = (
  record: CarRaceRecord,
  classBestS: number | null
): CarLapsView => {
  const { laps, stints } = record;
  const allLaps = lapsByStint(stints, laps);

  // What is known of each lap from the stint it was driven in.
  const stintBest = new Set<number>();
  const sectorBests = new Map<number, (number | null)[]>();
  /** The lap the car stood still on, and what the stop is seen to have done. */
  const stopNotes = new Map<number, string>();
  /** The first lap of a stint another driver began with no stop seen. */
  const driverChanges = new Set<number>();
  stints.forEach((stint, at) => {
    if (!isDrivenStint(stint)) return;
    const ownLaps = allLaps[at];
    const bests = bestsOf(ownLaps);
    if (bests.lap !== null) stintBest.add(bests.lap);
    for (const lap of ownLaps) sectorBests.set(lap.lap, bests.sectors);
    if (stint.openedBy === 'driver' && stint.firstLap !== null) {
      driverChanges.add(stint.firstLap);
    }
    if (stint.lastLap === null) return;
    const stop = stopSeen(
      stint,
      stints[at + 1],
      ...lapsAroundStop(stint, ownLaps, allLaps[at + 1] ?? [])
    );
    // The car stood still on the lap after the last one of the stint the
    // stop ended, whichever side of the line its box is on.
    if (stop) {
      stopNotes.set(
        stint.lastLap + 1,
        stop.inPits ? 'in the pits' : `stop ${stopText(stop, 'driver change')}`
      );
    }
  });

  // Held laps and missing numbers, as one list in the order driven.
  const merged: (RaceLap | number)[] = [...laps, ...record.missingLaps].sort(
    (a, b) => numberOf(a) - numberOf(b)
  );

  const rows: CarLapsRow[] = [];
  let before: RaceLap | undefined;
  let hasSectors = false;
  let energyIsVirtual: boolean | null = null;
  for (const entry of merged) {
    if (typeof entry === 'number') {
      const last = rows[rows.length - 1];
      if (last?.kind === 'missing' && last.to === entry - 1) last.to = entry;
      else rows.push({ kind: 'missing', from: entry, to: entry });
      continue;
    }
    const lap = entry;
    if (lap.sectors.some((time) => time !== null)) hasSectors = true;
    if (lap.energy !== null) energyIsVirtual ??= lap.energyIsVirtual;

    const stop = stopNotes.get(lap.lap);
    const inLap = has(lap.flags, LEDGER_LAP_IN_LAP);
    const outLap = has(lap.flags, LEDGER_LAP_OUT_LAP);
    const isClassBest =
      classBestS !== null &&
      lap.lapTime !== null &&
      Math.abs(lap.lapTime - classBestS) < SAME_TIME_S;
    const isStintBest = stintBest.has(lap.lap);
    const untimed = lap.lapTime === null && has(lap.flags, LEDGER_LAP_VOIDED);

    const notes = [
      isClassBest
        ? 'best of the class'
        : isStintBest
          ? 'best of the stint'
          : null,
      // The stop says where the car was; a lap without one that touched
      // the pit lane at both ends drove through it.
      stop ??
        (inLap && outLap
          ? 'through the pit lane'
          : inLap
            ? 'in lap'
            : outLap
              ? 'out lap'
              : null),
      driverChanges.has(lap.lap) ? 'driver change, no stop seen' : null,
      has(lap.flags, LEDGER_LAP_FROM_START) ? 'from the grid' : null,
      has(lap.flags, LEDGER_LAP_CAUTION)
        ? 'full-course yellow'
        : has(lap.flags, LEDGER_LAP_YELLOW)
          ? 'yellow'
          : null,
      untimed ? 'no time from the sim' : null,
    ].filter((note): note is string => note !== null);

    const bests = sectorBests.get(lap.lap);
    const clean = lap.lapTime !== null && isCleanLap(lap.flags);
    const energy = energyOf(lap, before);
    rows.push({
      kind: 'lap',
      lap: lap.lap,
      lapTime: lap.lapTime,
      tone: isClassBest
        ? 'classBest'
        : isStintBest
          ? 'stintBest'
          : clean
            ? 'plain'
            : 'quiet',
      sectors: lap.sectors,
      sectorBest:
        bests && clean
          ? lap.sectors.map(
              (time, sector) => time !== null && time === bests[sector]
            )
          : NO_SECTOR_BEST,
      energyUsed: energy.used,
      refilled: energy.refilled,
      note: notes.join(NOTE_SEPARATOR),
    });
    before = lap;
  }

  return {
    rows: rows.reverse(),
    hasSectors,
    hasEnergy: energyIsVirtual !== null,
    energyIsVirtual,
  };
};

/** "lap 41 was not recorded", "laps 41 to 47 were not recorded". */
export const missingLapsText = ({ from, to }: MissingLapsRow): string =>
  from === to
    ? `lap ${from} was not recorded`
    : `laps ${from} to ${to} were not recorded`;
