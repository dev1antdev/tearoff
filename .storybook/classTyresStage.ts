// Nothing here is imported through a path alias at run time, so a spec can
// load this file and check what a story is told with.
import {
  TREAD_ESTIMATE,
  TREAD_MEASURED,
  TREAD_NONE,
  TYRE_SET_AT_LEAST,
  TYRE_SET_LIKELY,
  TYRE_SET_SEEN,
  TYRE_SET_UNKNOWN,
  type ClassTyresSnapshot,
} from '../src/types';

/**
 * What the LMGT3s of the staged eight-hour races are on, for the stories
 * of the tables that show it: the Timing Tower and Class Rivals.
 *
 * Written out by hand, and invented like the rest of those races: no
 * recording has a pit stop, so there is nothing to run the tracker on. The
 * figures are the ones `ClassTyresTracker` would publish for such a field,
 * chosen so that every state a cell can be in is on screen at once:
 *
 * - a set seen to go on (#33, #60, #92, #61), with its estimate;
 * - one told from the length of a stop (#46), and two that ran through a
 *   stop on the same set (#54, #27);
 * - at least so many laps (#85), a car in its box (#23) and one of which
 *   nothing is known since it went to its garage (#88);
 * - no estimate, for the compounds our own car has not run: hards (#91,
 *   #31) and a mixed set with softs at the rear (#10);
 * - our own #77, with the tread the sim reads.
 */

const SOFT = 0;
const MEDIUM = 1;
const HARD = 2;
const WHEELS = 4;

/** What a lap costs our own car on mediums: all it has run in this race. */
const OWN_MEDIUM_COST_PCT = 0.8;
/** Laps of the stint before, for a car that kept its tyres at its stop. */
const STINT_BEFORE_LAPS = 31;

type Sure = 'seen' | 'likely' | 'atLeast';

interface StagedTyres {
  /** One compound, or one a wheel: LF, RF, LR, RR. */
  wheels: number | [number, number, number, number];
  sure: Sure;
  /** The set went on a stop before the last one. */
  sinceTheStopBefore?: boolean;
}

/** By car number. A car that is not here is of another class. */
const STAGED_TYRES: Readonly<Record<string, StagedTyres>> = {
  '33': { wheels: MEDIUM, sure: 'seen' },
  '46': { wheels: MEDIUM, sure: 'likely' },
  '91': { wheels: HARD, sure: 'seen' },
  '77': { wheels: MEDIUM, sure: 'seen' },
  '54': { wheels: MEDIUM, sure: 'likely', sinceTheStopBefore: true },
  '23': { wheels: MEDIUM, sure: 'atLeast' },
  '85': { wheels: MEDIUM, sure: 'atLeast' },
  '31': { wheels: HARD, sure: 'likely' },
  '60': { wheels: MEDIUM, sure: 'seen' },
  '27': { wheels: MEDIUM, sure: 'likely', sinceTheStopBefore: true },
  '92': { wheels: MEDIUM, sure: 'seen' },
  '10': { wheels: [MEDIUM, MEDIUM, SOFT, SOFT], sure: 'atLeast' },
  '61': { wheels: MEDIUM, sure: 'seen' },
  '88': { wheels: MEDIUM, sure: 'atLeast' },
};

const SURE_CODE: Record<Sure, number> = {
  seen: TYRE_SET_SEEN,
  likely: TYRE_SET_LIKELY,
  atLeast: TYRE_SET_AT_LEAST,
};

/** One car of a staged race, as the stage that asks holds it. */
export interface ClassTyresStoryCar {
  number: string;
  /** Laps it has completed since its last stop. */
  sinceStop: number;
}

export interface ClassTyresStoryOptions {
  /** Our own car, by number. */
  own: string;
  /**
   * The tread the sim reads on our own car, percent. Left out where it
   * reads none: a team-mate at the wheel, whose car is then reckoned like
   * any other.
   */
  ownTreadPct?: number;
  /**
   * iRacing: one compound a car, no tread to make a figure from, and no
   * rates to hold the length of a stop against, so a set is seen from the
   * start or at least as old as the laps since the last stop.
   */
  iracing?: boolean;
  /**
   * Before the start: every car on the set it left the grid on, with no
   * lap of ours to make an estimate from.
   */
  beforeStart?: boolean;
}

/**
 * `class-tyres.snapshot` for a staged race: its cars in slot order, the
 * LMGT3s among them with the tyres written out above.
 */
export const classTyresStorySnapshot = (
  cars: readonly ClassTyresStoryCar[],
  {
    own,
    ownTreadPct,
    iracing = false,
    beforeStart = false,
  }: ClassTyresStoryOptions
): ClassTyresSnapshot => {
  const snapshot = {
    ownCarIdx: cars.findIndex((car) => car.number === own),
    compounds: [] as number[],
    setLaps: [] as number[],
    sure: [] as number[],
    treadPct: [] as number[],
    treadSource: [] as number[],
    sessionNum: 0,
    version: 1,
  };
  for (const car of cars) {
    const staged = STAGED_TYRES[car.number];
    if (!staged) {
      snapshot.compounds.push(-1, -1, -1, -1);
      snapshot.setLaps.push(-1);
      snapshot.sure.push(TYRE_SET_UNKNOWN);
      snapshot.treadPct.push(-1);
      snapshot.treadSource.push(TREAD_NONE);
      continue;
    }
    const first =
      typeof staged.wheels === 'number' ? staged.wheels : staged.wheels[0];
    // iRacing has one compound a car.
    const wheels =
      iracing || typeof staged.wheels === 'number'
        ? Array.from({ length: WHEELS }, () => first)
        : staged.wheels;
    const sure: Sure = beforeStart
      ? 'seen'
      : iracing && staged.sure === 'likely'
        ? 'atLeast'
        : staged.sure;
    const laps = beforeStart
      ? 0
      : car.sinceStop +
        (staged.sinceTheStopBefore && sure === 'likely'
          ? STINT_BEFORE_LAPS
          : 0);
    const isOwn = car.number === own;
    const onMediums = wheels.every((wheel) => wheel === MEDIUM);

    let treadPct = -1;
    let treadSource = TREAD_NONE;
    if (isOwn && ownTreadPct !== undefined && !iracing) {
      treadPct = Math.round(beforeStart ? 100 : ownTreadPct);
      treadSource = TREAD_MEASURED;
    } else if (!iracing && !beforeStart && onMediums) {
      treadPct = Math.max(0, Math.round(100 - OWN_MEDIUM_COST_PCT * laps));
      treadSource = TREAD_ESTIMATE;
    }
    snapshot.compounds.push(...wheels);
    snapshot.setLaps.push(laps);
    snapshot.sure.push(SURE_CODE[sure]);
    snapshot.treadPct.push(treadPct);
    snapshot.treadSource.push(treadSource);
  }
  return snapshot;
};
