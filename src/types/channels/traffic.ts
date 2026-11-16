/**
 * The cars around the player that are about to matter: who is closing from
 * behind and when it arrives, which slower car the player is catching, when
 * the leader comes to lap them, and who is coming while the player is in the
 * pit lane or slow on the track.
 *
 * Built by TrafficProcessor five times a second. Names, numbers and class
 * colours are looked up in the session by `carIdx`; the snapshot carries
 * none.
 */

/**
 * How a car behind stands to the player.
 *
 * The first three are traffic, by the rule the flag panel uses for a blue: a
 * car a lap or more ahead in the race, a car of a faster class, and outside a
 * race a car that is closing. The other three are not: a car of the player's
 * class on the same lap is racing them for position, a lapped car is one the
 * player has put a lap on, and `behind` is any other car that happens to be
 * there.
 */
export type TrafficRelation =
  'lapping' | 'fasterClass' | 'closing' | 'position' | 'lapped' | 'behind';

/** Whether a relation is traffic: a car to let by, not one to race. */
export const isTrafficRelation = (relation: TrafficRelation): boolean =>
  relation === 'lapping' ||
  relation === 'fasterClass' ||
  relation === 'closing';

/** One car of the three-column table: the two cars will meet, and when. */
export interface TrafficPick {
  carIdx: number;
  /** Time gap on track to the player now, seconds, one decimal; positive. */
  gapS: number;
  /**
   * Player laps until the two meet, two decimals; null when the gap is not
   * closing or they meet more than 50 laps off.
   */
  laps: number | null;
  /** They meet before the end of the lap under way. */
  thisLap: boolean;
}

/** A car in the mirror: behind the player inside the listing window. */
export interface TrafficCar {
  carIdx: number;
  relation: TrafficRelation;
  /** Metres behind the player along the track, whole metres; 0 alongside. */
  distanceM: number;
  /**
   * The interval, seconds, one decimal: how long ago the player was where
   * this car is now. Measured from the player's own running, so it is what a
   * timing line between the two would read. Where that running was not
   * clean (the pit lane, a spin) or is not on record yet, the metres over
   * the higher of the two speeds, as the flag panel gives it. Null with
   * neither.
   */
  gapS: number | null;
  /** `gapS` is the measured interval, not the figure from the speeds. */
  measured: boolean;
  /**
   * How fast the interval is shrinking, seconds per second, two decimals;
   * positive is catching. Null until it has been measured for a few seconds.
   */
  closingS: number | null;
  /**
   * Whole laps this car is ahead of the player in the race; negative for a
   * car the player has lapped; 0 outside a race.
   */
  lapsAhead: number;
}

/**
 * When and where the car that is catching the player arrives.
 *
 * An estimate, and published as one: `lowS` and `highS` are the earliest and
 * latest arrival the measured closing rate supports, never closer together
 * than a quarter of the figure either side. There is no forecast at all
 * until the interval has closed steadily for a few seconds.
 */
export interface TrafficForecast {
  carIdx: number;
  /** Seconds until it reaches the player, whole seconds. */
  etaS: number;
  lowS: number;
  highS: number;
  /** The range is narrow enough to be said as one figure. */
  steady: boolean;
  /** Player laps until then, two decimals; null without a lap time. */
  laps: number | null;
  /**
   * Lap fraction at which the two meet, three decimals, and the same for
   * both ends of the range. Null when the arrival is further off than the
   * closing was measured for (twenty seconds as a rule), or a lap or more
   * off: no place is named for either.
   */
  meetPct: number | null;
  meetLowPct: number | null;
  meetHighPct: number | null;
}

/** A car that will come by while the player is in the pits or slow. */
export interface TrafficArrival {
  carIdx: number;
  /**
   * Seconds until it reaches where the player is now, one decimal: the
   * metres between them over the highest of its speed, the player's and its
   * own lap average.
   */
  gapS: number;
  /** The speed that was taken at, m/s, one decimal. */
  speedMs: number;
}

export interface TrafficSnapshot {
  /** The car ahead the player reaches soonest. */
  slowerAhead: TrafficPick | null;
  /**
   * The race leader, from behind; null when the player leads or the leader
   * is not on track.
   */
  leader: TrafficPick | null;
  /** The car behind that reaches the player soonest. */
  fasterBehind: TrafficPick | null;
  /** Nearest on-track car behind, within 60 s. */
  nearestBehind: { carIdx: number; gapS: number } | null;
  /**
   * SessionTime at which the player was last slow or off the track while not
   * in the pits, seconds.
   */
  slowAt: number | null;
  /** SessionTime at which the player last left the pit lane, seconds. */
  exitedAt: number | null;
  /** The player's car is in the pit lane now. */
  inPitLane: boolean;
  /**
   * The mirror: cars behind inside the listing window (500 m and 8 s),
   * nearest first, at most four. Every car of traffic is listed; of the cars
   * that are not traffic only the nearest, and only when it is nearer than
   * all of the traffic.
   */
  behind: readonly TrafficCar[];
  /** Cars of traffic inside the listing window beyond those in `behind`. */
  moreBehind: number;
  forecast: TrafficForecast | null;
  /**
   * On-track cars behind the player, nearest first, within 60 s, at most
   * eight. Filled only while the player is in the pit lane or was there, or
   * slow, in the last 30 s; empty otherwise.
   */
  arriving: readonly TrafficArrival[];
  /**
   * The player's lap time that seconds were turned into laps with, seconds,
   * one decimal; null while no lap time and no full lap is on record.
   */
  lapS: number | null;
  sessionNum: number | null;
  version: number;
}

export const EMPTY_TRAFFIC: TrafficSnapshot = {
  slowerAhead: null,
  leader: null,
  fasterBehind: null,
  nearestBehind: null,
  slowAt: null,
  exitedAt: null,
  inPitLane: false,
  behind: [],
  moreBehind: 0,
  forecast: null,
  arriving: [],
  lapS: null,
  sessionNum: null,
  version: 0,
};
