/**
 * The session clock, which under LMU is three clocks.
 *
 * The player's own telemetry block carries `mElapsedTime` at 100 Hz, and
 * that is the clock everything is timed on. It is only there while the
 * player has a car. At the monitor, in the garage menu, or while a team-mate
 * drives, the mapper used to fall back to scoring's `mCurrentET` -- the same
 * quantity, published at 5 Hz, and so always a little behind: on the
 * recorded race by a tenth of a second on average and up to two.
 *
 * So every time the player left the car the session clock stepped
 * backwards. A clock that goes backwards is how a restarted session is
 * recognised, and the processors took it for one: the lap-time history was
 * emptied, the standings started over, and the session timer worked out a
 * new green flag. That is each trip to the monitor in practice and each
 * driver change in a race.
 *
 * Two things close it. The other cars' telemetry blocks carry the same clock
 * at the same rate, a few milliseconds behind the player's, so the latest of
 * those stands in before scoring does. And whichever source is read, the
 * clock never runs backwards by a small amount: it holds where it was until
 * the new source catches up.
 */

export interface LmuSessionClockState {
  /** The last value handed out, or null before the first. */
  last: number | null;
  /** The game phase last seen in a race, or null outside one. */
  racePhase: number | null;
  /** When the race went green, on this clock, or null if that was not seen. */
  greenAt: number | null;
}

export const createLmuSessionClockState = (): LmuSessionClockState => ({
  last: null,
  racePhase: null,
  greenAt: null,
});

export const resetLmuSessionClockState = (
  state: LmuSessionClockState
): void => {
  state.last = null;
  state.racePhase = null;
  state.greenAt = null;
};

/** Just enough of a raw snapshot to read its clocks. */
export interface LmuSessionClockSource {
  /** The player's telemetry clock; absent with no player car. */
  elapsedTime?: number;
  /** Each car's telemetry clock, by slot. */
  vehElapsedTime?: ArrayLike<number>;
  /** Whether each slot had a telemetry block this frame. */
  vehTelemetryAvailable?: ArrayLike<number>;
  /** Scoring's clock, 5 Hz. */
  currentET: number;
}

/**
 * Further back than this is not one source trailing another: it is a new
 * session, whose clock starts again. The same figure the session identity
 * uses to tell the two apart.
 */
const REWIND_SECONDS = 2;

const usable = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** The best clock a snapshot carries, before anything is held. */
export const lmuClockReading = (source: LmuSessionClockSource): number => {
  if (usable(source.elapsedTime)) return source.elapsedTime;
  const clocks = source.vehElapsedTime;
  if (clocks) {
    let latest = -1;
    for (let carIdx = 0; carIdx < clocks.length; carIdx += 1) {
      const available = source.vehTelemetryAvailable?.[carIdx];
      if (available !== undefined && !available) continue;
      const clock = clocks[carIdx];
      if (usable(clock) && clock > latest) latest = clock;
    }
    // A slot with no telemetry reads 0, as does a grid with none at all.
    if (latest > 0) return latest;
  }
  return source.currentET;
};

/**
 * The session clock for one snapshot: the best reading it carries, never
 * less than the one before unless the session itself started again.
 */
export const lmuSessionClock = (
  state: LmuSessionClockState,
  source: LmuSessionClockSource
): number => {
  const reading = lmuClockReading(source);
  const last = state.last;
  if (last !== null && reading < last - REWIND_SECONDS) {
    // A new session: whatever was seen of the last one's start is not its.
    state.racePhase = null;
    state.greenAt = null;
  }
  const clock =
    last !== null && reading < last && last - reading <= REWIND_SECONDS
      ? last
      : reading;
  state.last = clock;
  return clock;
};

/** LMU's game phase from the green flag on: green, caution, and the end. */
const GREEN_PHASE = 5;

/**
 * When the race went green, on the session clock, or null where that was
 * not seen: outside a race, or in one joined after its start.
 *
 * Wanted because LMU gives a race's end as a time on the session clock, and
 * that clock starts on the grid, minutes before the race does. The length of
 * a race is its end less its green flag, not its end.
 */
export const lmuRaceGreenTime = (
  state: LmuSessionClockState,
  source: { isRace: boolean; gamePhase: number },
  clock: number
): number | null => {
  if (!source.isRace) {
    state.racePhase = null;
    state.greenAt = null;
    return null;
  }
  if (
    state.racePhase !== null &&
    state.racePhase < GREEN_PHASE &&
    source.gamePhase >= GREEN_PHASE
  ) {
    state.greenAt = clock;
  }
  state.racePhase = source.gamePhase;
  return state.greenAt;
};
