import {
  TREAD_ESTIMATE,
  TREAD_MEASURED,
  TYRE_SET_AT_LEAST,
  TYRE_SET_LIKELY,
  TYRE_SET_SEEN,
  type ClassTyresSnapshot,
} from '@irdashies/types';

/**
 * How the laps a car has run on its tyres and what is left of them are
 * written, stated once for the Timing Tower and Class Rivals, from what
 * `class-tyres.snapshot` gives.
 *
 * The laps come with how sure they are: bare where the set was seen to go
 * on, `?` where it is told from how long the car stood, `+` where the set
 * is at least that old. The tread carries a `~` where it is our own wear
 * applied to the car's laps, a `<` where those laps are only a floor, and
 * nothing where it is the sim's own reading.
 */

/** Marks laps counted from a stop judged by its length. */
export const TYRE_SET_LIKELY_MARK = '?';
/** Marks laps that are a floor: the set is at least that old. */
export const TYRE_SET_AT_LEAST_MARK = '+';
/** Marks a tread worked out from our own wear. */
export const TREAD_ESTIMATE_MARK = '~';
/** Marks a tread worked out from laps that are only a floor. */
export const TREAD_AT_MOST_MARK = '<';
/** What the tread reads while there is nothing to work it out from. */
export const NO_TREAD = '--';

/** How sure the laps on a set are, as a table marks them. */
export type TyreSetCertainty = 'seen' | 'likely' | 'atLeast';

export interface TyreSetDisplay {
  /** "17", "17?" or "17+"; '' where nothing is said of the car. */
  laps: string;
  /** "86%", "~86%" or "<86%"; `--` with no figure, '' beside no laps. */
  tread: string;
  /** Null where nothing is said of the car. */
  certainty: TyreSetCertainty | null;
  /** The figures in a sentence, for whoever points at them. */
  title: string;
}

const NOTHING: TyreSetDisplay = {
  laps: '',
  tread: '',
  certainty: null,
  title: '',
};

const CERTAINTY: Readonly<Record<number, TyreSetCertainty>> = {
  [TYRE_SET_SEEN]: 'seen',
  [TYRE_SET_LIKELY]: 'likely',
  [TYRE_SET_AT_LEAST]: 'atLeast',
};

const lapsWord = (laps: number): string => (laps === 1 ? 'lap' : 'laps');

/**
 * What a table writes of one car's tyres. Nothing for a car the snapshot
 * says nothing of: one of another class, or one nothing is held of.
 */
export const tyreSetDisplay = (
  snapshot: ClassTyresSnapshot | undefined,
  carIdx: number
): TyreSetDisplay => {
  const laps = snapshot?.setLaps[carIdx];
  const certainty = CERTAINTY[snapshot?.sure[carIdx] ?? -1];
  if (!snapshot || typeof laps !== 'number' || laps < 0 || !certainty) {
    return NOTHING;
  }
  const floor = certainty === 'atLeast';
  const percent = snapshot.treadPct[carIdx];
  const source = snapshot.treadSource[carIdx];

  let tread = NO_TREAD;
  let treadTitle = 'no tread figure yet';
  if (typeof percent === 'number' && percent >= 0) {
    if (source === TREAD_MEASURED) {
      tread = `${percent}%`;
      treadTitle = `${percent}% of the tread left, as the sim reads it`;
    } else if (source === TREAD_ESTIMATE) {
      tread = `${floor ? TREAD_AT_MOST_MARK : TREAD_ESTIMATE_MARK}${percent}%`;
      treadTitle = floor
        ? `no more than about ${percent}% of the tread left, at what a lap costs our own car`
        : `about ${percent}% of the tread left, at what a lap costs our own car`;
    }
  }

  const lapsTitle =
    certainty === 'seen'
      ? `${laps} ${lapsWord(laps)} on this set`
      : certainty === 'likely'
        ? `${laps} ${lapsWord(laps)} on this set, judging by how long it stood at its stops`
        : `At least ${laps} ${lapsWord(laps)} on this set: what it was given before that was not seen`;
  return {
    laps:
      certainty === 'seen'
        ? String(laps)
        : `${laps}${floor ? TYRE_SET_AT_LEAST_MARK : TYRE_SET_LIKELY_MARK}`,
    tread,
    certainty,
    title: `${lapsTitle}; ${treadTitle}.`,
  };
};

/**
 * Whether any car has a tread figure. Where none has, the sim reads no
 * tread a figure could be made from, which under iRacing is always, and a
 * table leaves the figure out rather than fill a column with `--`.
 */
export const hasTreadFigures = (
  snapshot: ClassTyresSnapshot | undefined
): boolean => snapshot?.treadPct.some((percent) => percent >= 0) ?? false;

const NO_COMPOUNDS: readonly number[] = Object.freeze([-1, -1, -1, -1]);

/**
 * The four compounds on each car, LF RF LR RR, by car: one list a car,
 * made once for a snapshot so that a row is handed the same one until the
 * snapshot moves.
 */
export const wheelCompoundsByCar = (
  snapshot: ClassTyresSnapshot | undefined
): readonly (readonly number[])[] => {
  const flat = snapshot?.compounds ?? [];
  const cars: (readonly number[])[] = [];
  for (let base = 0; base + 4 <= flat.length; base += 4) {
    const wheels = flat.slice(base, base + 4);
    cars.push(wheels.every((wheel) => wheel < 0) ? NO_COMPOUNDS : wheels);
  }
  return cars;
};
