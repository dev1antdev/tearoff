/**
 * The flag that applies to the player, resolved once for every consumer.
 *
 * Built by FlagStateProcessor at 10 Hz from the sim's own flag fields and the
 * cars around the player. The types and the ranking live here, under types,
 * because the processor ranks the conditions and the renderer re-ranks them
 * when a widget has one kind switched off, and the two must agree.
 */

/** What the panel names. */
export type FlagKind =
  | 'none'
  | 'green'
  | 'yellow'
  | 'fullCourseYellow'
  | 'blue'
  | 'white'
  | 'chequered'
  | 'red'
  | 'penalty'
  | 'meatball'
  | 'debris'
  | 'disqualified'
  | 'start';

/** Which case of the kind, for the explanation line. */
export type FlagDetail =
  | 'noSession'
  | 'trackClear'
  | 'greenStart'
  | 'greenRestart'
  | 'yellowAhead'
  | 'yellowBehind'
  | 'yellowInSector'
  | 'yellowElsewhere'
  | 'fcy'
  | 'fcyPending'
  | 'fcyPitsClosed'
  | 'fcyPitLeadLap'
  | 'fcyPitsOpen'
  | 'fcyLastLap'
  | 'fcyResume'
  | 'blueLapping'
  | 'blueFasterClass'
  | 'blueTraffic'
  | 'lastLap'
  | 'finishLap'
  | 'finished'
  | 'sessionOver'
  | 'sessionStopped'
  | 'driveThrough'
  | 'stopGo'
  | 'timePenalty'
  | 'penaltyUnknown'
  | 'blackFlag'
  | 'slowDown'
  | 'repairRequired'
  | 'debris'
  | 'disqualified'
  | 'beforeSession'
  | 'recon'
  | 'grid'
  | 'formationLap'
  | 'lights'
  | 'ready'
  | 'set';

/** The nearest car the blue is for, and how many more are queued behind it. */
export interface FlagBlueCar {
  /**
   * Slot of the nearest listed car; number, driver, team and class are looked
   * up from the session by it.
   */
  carIdx: number;
  /** Metres behind the player along the track, whole; 0 while alongside. */
  distanceM: number;
  /**
   * distanceM over the faster of the two speeds, seconds, one decimal; null
   * below 1 m/s and where no speed is known.
   */
  gapS: number | null;
  /**
   * That car's speed less the player's, m/s, one decimal; positive is
   * catching. Null where no speed is known.
   */
  closingMs: number | null;
  /** Whole laps that car is ahead of the player in the race; 0 outside one. */
  lapsAhead: number;
  /** Its class is faster than the player's. */
  fasterClass: boolean;
  /**
   * False when no car met the lapping rule and this is only the nearest car
   * behind.
   */
  confirmed: boolean;
  /**
   * Further cars that meet the lapping rule and are inside the listing window
   * behind this one; 0 when it is alone.
   */
  othersCount: number;
}

export interface FlagStateSnapshot {
  kind: FlagKind;
  detail: FlagDetail;
  /**
   * Every condition that holds, as FLAG_ACTIVE_* bits, for a consumer with
   * its own ranking.
   */
  active: number;
  /** SessionTime, seconds, when kind or detail last changed. */
  since: number;
  /**
   * Local yellow per sector in driving order (S1, S2, S3); empty where the
   * sim flags no sectors.
   */
  yellowSectors: readonly boolean[];
  /** The player's sector, 0-based, or null. */
  playerSector: number | null;
  /**
   * Signed metres along the track to the nearest stopped or crawling car
   * while a local yellow is out; positive is ahead; null when there is none.
   */
  incidentDistM: number | null;
  incidentCarIdx: number | null;
  blue: FlagBlueCar | null;
  /**
   * The player's outstanding penalties; kind is an LMU_PENALTY_CODE (0 when
   * not known); seconds for a stop-go or a time penalty. Null where the sim
   * counts none, which under iRacing is always: its black flag has no count.
   */
  penalty: { count: number; kind: number; seconds: number | null } | null;
  /**
   * Red lights lit and in the sequence; null outside the countdown or when
   * the sim gives none.
   */
  startLights: { lit: number; total: number } | null;
  pitLaneClosed: boolean;
  sessionNum: number | null;
  version: number;
}

/**
 * The conditions of `FlagStateSnapshot.active`.
 *
 * The first thirteen are one per row of the priority table, the local yellow
 * taking two: one for a yellow anywhere on the circuit, one more when it is
 * the player's. The rest say which case of a kind holds, so that a consumer
 * that ranks for itself can still name the detail of a kind the processor did
 * not rank first.
 */
export const FLAG_ACTIVE_DISQUALIFIED = 1 << 0;
export const FLAG_ACTIVE_RED = 1 << 1;
export const FLAG_ACTIVE_CHEQUERED = 1 << 2;
export const FLAG_ACTIVE_START = 1 << 3;
export const FLAG_ACTIVE_FULL_COURSE_YELLOW = 1 << 4;
/** A local yellow is out somewhere on the circuit. */
export const FLAG_ACTIVE_YELLOW = 1 << 5;
/** That yellow is the player's: an incident in range, or their own sector. */
export const FLAG_ACTIVE_YELLOW_NEAR = 1 << 6;
export const FLAG_ACTIVE_DEBRIS = 1 << 7;
export const FLAG_ACTIVE_BLUE = 1 << 8;
export const FLAG_ACTIVE_PENALTY = 1 << 9;
export const FLAG_ACTIVE_MEATBALL = 1 << 10;
/** The last lap of the race. */
export const FLAG_ACTIVE_WHITE = 1 << 11;
/** The session is running and nothing stops the player racing. */
export const FLAG_ACTIVE_GREEN = 1 << 12;
/** Inside the announcement after the lights went out. */
export const FLAG_ACTIVE_GREEN_START = 1 << 13;
/** Inside the announcement after a yellow of either kind ended. */
export const FLAG_ACTIVE_GREEN_RESTART = 1 << 14;
/**
 * The blue is traffic to mind rather than a car to let by: outside a race, or
 * with the player in the pit lane.
 */
export const FLAG_ACTIVE_BLUE_TRAFFIC = 1 << 15;
/** iRacing's furled black flag: a warning, not a penalty to serve. */
export const FLAG_ACTIVE_WARNING = 1 << 16;
/**
 * The sub-phase of a full-course yellow, three bits wide, in rFactor 2's
 * numbering: 0 not stated, 1 pending, 2 pits closed, 3 pit lead lap, 4 pits
 * open, 5 last lap, 6 resume.
 */
export const FLAG_ACTIVE_FCY_PHASE_SHIFT = 17;
export const FLAG_ACTIVE_FCY_PHASE_MASK = 0b111 << FLAG_ACTIVE_FCY_PHASE_SHIFT;

/**
 * The priority table: the kind is the first of these whose condition holds.
 *
 * The states that end the player's running come first; then the start, which
 * excludes everything below it in time; then the flags that demand slowing
 * down, the full-course one before the local one. A yellow that is near
 * outranks the blue and a yellow somewhere else on the circuit does not. A
 * penalty lasts for laps, so it yields to the momentary flags. Green is what
 * is left.
 */
const FLAG_PRIORITY: readonly (readonly [FlagKind, number])[] = [
  ['disqualified', FLAG_ACTIVE_DISQUALIFIED],
  ['red', FLAG_ACTIVE_RED],
  ['chequered', FLAG_ACTIVE_CHEQUERED],
  ['start', FLAG_ACTIVE_START],
  ['fullCourseYellow', FLAG_ACTIVE_FULL_COURSE_YELLOW],
  ['yellow', FLAG_ACTIVE_YELLOW_NEAR],
  ['debris', FLAG_ACTIVE_DEBRIS],
  ['blue', FLAG_ACTIVE_BLUE],
  ['penalty', FLAG_ACTIVE_PENALTY],
  ['meatball', FLAG_ACTIVE_MEATBALL],
  ['white', FLAG_ACTIVE_WHITE],
  ['yellow', FLAG_ACTIVE_YELLOW],
  ['green', FLAG_ACTIVE_GREEN],
];

/**
 * The kind that ranks first among the conditions in `active`.
 *
 * `isHidden` leaves a kind out of the ranking, which is how a widget with a
 * kind switched off falls through to whatever ranks next.
 */
export const rankFlagKind = (
  active: number,
  isHidden?: (kind: FlagKind) => boolean
): FlagKind => {
  for (const [kind, bit] of FLAG_PRIORITY) {
    if ((active & bit) !== 0 && !isHidden?.(kind)) return kind;
  }
  return 'none';
};

const FCY_DETAILS: readonly FlagDetail[] = [
  'fcy',
  'fcyPending',
  'fcyPitsClosed',
  'fcyPitLeadLap',
  'fcyPitsOpen',
  'fcyLastLap',
  'fcyResume',
];

/** LMU_PENALTY_CODE to the detail that names it; 0 is a penalty not named. */
const PENALTY_DETAILS: readonly FlagDetail[] = [
  'penaltyUnknown',
  'driveThrough',
  'stopGo',
  'timePenalty',
];

/** What `flagDetailFor` reads besides the conditions. */
export type FlagDetailFacts = Pick<
  FlagStateSnapshot,
  'active' | 'incidentDistM' | 'blue' | 'penalty'
>;

/**
 * The detail of a kind, from the conditions and the facts published with
 * them.
 *
 * Covers every kind but two. The start and the chequered flag have details
 * only the processor can tell apart (which phase of the start, whether the
 * player has finished), and neither can be ranked into by switching another
 * kind off, since nothing that can be switched off ranks above them: for
 * those the caller keeps the detail the processor published, passed as
 * `published`.
 */
export const flagDetailFor = (
  kind: FlagKind,
  facts: FlagDetailFacts,
  published: FlagDetail = 'noSession'
): FlagDetail => {
  const { active } = facts;
  switch (kind) {
    case 'disqualified':
      return 'disqualified';
    case 'red':
      return 'sessionStopped';
    case 'fullCourseYellow':
      return (
        FCY_DETAILS[
          (active & FLAG_ACTIVE_FCY_PHASE_MASK) >> FLAG_ACTIVE_FCY_PHASE_SHIFT
        ] ?? 'fcy'
      );
    case 'yellow':
      if ((active & FLAG_ACTIVE_YELLOW_NEAR) === 0) return 'yellowElsewhere';
      if (facts.incidentDistM === null) return 'yellowInSector';
      return facts.incidentDistM >= 0 ? 'yellowAhead' : 'yellowBehind';
    case 'debris':
      return 'debris';
    case 'blue':
      if ((active & FLAG_ACTIVE_BLUE_TRAFFIC) !== 0) return 'blueTraffic';
      if (facts.blue && facts.blue.lapsAhead < 1 && facts.blue.fasterClass) {
        return 'blueFasterClass';
      }
      return 'blueLapping';
    case 'penalty':
      if (facts.penalty === null) {
        return (active & FLAG_ACTIVE_WARNING) !== 0 ? 'slowDown' : 'blackFlag';
      }
      return PENALTY_DETAILS[facts.penalty.kind] ?? 'penaltyUnknown';
    case 'meatball':
      return 'repairRequired';
    case 'white':
      return 'lastLap';
    case 'green':
      if ((active & FLAG_ACTIVE_GREEN_START) !== 0) return 'greenStart';
      if ((active & FLAG_ACTIVE_GREEN_RESTART) !== 0) return 'greenRestart';
      return 'trackClear';
    case 'none':
      return 'noSession';
    case 'start':
    case 'chequered':
      return published;
  }
};

/**
 * The two yellow ranges and the sector switch the processor ranks with. They
 * are widget settings, so they reach the processor from the `flagpanel`
 * config of the current dashboard.
 */
export interface FlagProcessorTuning {
  /** How far ahead a stopped car makes the yellow the player's, metres. */
  yellowRangeAheadM: number;
  /** The same behind. */
  yellowRangeBehindM: number;
  /**
   * Treat a yellow in the player's own sector as theirs. Off until the order
   * of LMU's sector flags is confirmed on a recording.
   */
  yellowInOwnSector: boolean;
}

export const DEFAULT_FLAG_TUNING: FlagProcessorTuning = {
  yellowRangeAheadM: 500,
  yellowRangeBehindM: 50,
  yellowInOwnSector: false,
};

export const EMPTY_FLAG_STATE: FlagStateSnapshot = {
  kind: 'none',
  detail: 'noSession',
  active: 0,
  since: 0,
  yellowSectors: [],
  playerSector: null,
  incidentDistM: null,
  incidentCarIdx: null,
  blue: null,
  penalty: null,
  startLights: null,
  pitLaneClosed: false,
  sessionNum: null,
  version: 0,
};
