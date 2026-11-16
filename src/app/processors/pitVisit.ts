/**
 * What a visit to the pit lane counts as, in one place.
 *
 * A stint boundary, a pit timer and a car's stop count are three readings of
 * the same visit, and they must not disagree about it: a visit is a stop
 * once the car has stood for more than a second, and it makes its lap a pit
 * lap once it has lasted more than two.
 *
 * How standing is told depends on what is known of the car. The player's
 * own speed is read every frame, so its standstill has a hysteresis. For
 * any other car there is the sim's own pit state (Le Mans Ultimate) or the
 * stall surface (iRacing), which need none.
 */

/** A visit to the pit lane longer than this makes the lap a pit lap. */
export const PIT_LAP_SECONDS = 2;
/** Standing for longer than this makes the visit a stop. */
export const STOP_SECONDS = 1;

/** Below this the car is standing in the pit lane... */
export const STANDING_BELOW_MS = 0.5;
/** ...until it is above this again. */
export const MOVING_ABOVE_MS = 1;

/** A car crossing the pit entry line slower than this was put there. */
export const ENTRY_EDGE_MIN_SPEED_MS = 1;

/**
 * Time spent standing still, with a hysteresis: from below half a metre per
 * second until above one again, so a car creeping in its box is not counted
 * as stopping and starting.
 */
export class Standstill {
  /** Seconds at a standstill so far. */
  seconds = 0;
  private standing = false;
  private since = 0;

  /** Whether the car was standing on the last frame it was given. */
  get isStanding(): boolean {
    return this.standing;
  }

  reset(): void {
    this.seconds = 0;
    this.standing = false;
  }

  update(speed: number | null, time: number): void {
    if (speed === null) return;
    const pace = Math.abs(speed);
    if (this.standing) {
      const elapsed = time - this.since;
      if (elapsed > 0) this.seconds += elapsed;
      this.since = time;
      if (pace > MOVING_ABOVE_MS) this.standing = false;
    } else if (pace < STANDING_BELOW_MS) {
      this.standing = true;
      this.since = time;
    }
  }
}

/** Whether a car that was standing or moving is standing now. */
export const isStandingStill = (
  wasStanding: boolean,
  speed: number
): boolean => {
  const pace = Math.abs(speed);
  return wasStanding ? pace <= MOVING_ABOVE_MS : pace < STANDING_BELOW_MS;
};

/** Whether a finished visit was a stop, and whether it made a pit lap. */
export const isStopVisit = (standingSeconds: number): boolean =>
  standingSeconds > STOP_SECONDS;
export const isPitLapVisit = (laneSeconds: number): boolean =>
  laneSeconds > PIT_LAP_SECONDS;
