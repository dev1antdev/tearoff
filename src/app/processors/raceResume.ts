import type { RaceEntry, RaceInfo, StoredRaceState } from '@irdashies/types';

/**
 * Whether a race found in the file is the one being driven now, so that it
 * is carried on after a restart instead of a new one being begun.
 *
 * Pure: it is handed what the file holds and what the sim says now.
 *
 * iRacing names a session outright, and the name settles it. Le Mans
 * Ultimate does not: the id Tearoff derives for it is shared by every race
 * at one track on one server, so there the race is told by what it is made
 * of. It is the same race when the simulator, the track and the kind of
 * session are the same, the cars in the slots are the same cars, no car has
 * completed fewer laps than were kept for it, and the session clock has not
 * gone back. A race is never made the same by its drivers: they change.
 *
 * Two races that pass all of that are still two races when the app was
 * away for far longer than the session clock moved on: the same grid at the
 * same track on another day.
 */

/** What the sim says of the race being driven. */
export interface LiveRaceState {
  info: RaceInfo;
  /** Laps each car has completed, by CarIdx; -1 for a slot with no car. */
  lapsCompleted: readonly number[];
  /** Session clock now, seconds. */
  sessionTime: number;
  /** Wall clock now, Unix milliseconds. */
  now: number;
}

export type RaceResumeVerdict =
  | { same: true }
  /** `reason` is for the log: what told the two apart. */
  | { same: false; reason: string };

/**
 * How far the session clock may be behind the one kept and still be the
 * same session's: the figure the recorder ends a race by.
 */
const CLOCK_TOLERANCE_SECONDS = 2;

/**
 * How much longer the app may have been away than the session clock moved
 * on. A paused race is picked up after a long break; one from another day
 * is not. The lap library rejoins a session of the player's by the same
 * figure.
 */
export const RACE_RESUME_MAX_AWAY_MS = 12 * 60 * 60 * 1000;

const different = (reason: string): RaceResumeVerdict => ({
  same: false,
  reason,
});

/** The car in a slot, whoever drives it and whatever the team is called. */
const entryKey = (entry: RaceEntry): string =>
  `${entry.carNumber}|${entry.car}`;

/**
 * Whether the cars in the slots are the same cars. Cars come and go in a
 * long race online, so a slot that is empty on one side says nothing; a
 * slot with another car in it does, and so do too few slots in common.
 */
const sameEntries = (
  stored: readonly RaceEntry[],
  live: readonly RaceEntry[]
): boolean => {
  const kept = new Map(stored.map((entry) => [entry.carIdx, entryKey(entry)]));
  let shared = 0;
  for (const entry of live) {
    const key = kept.get(entry.carIdx);
    if (key === undefined) continue;
    if (key !== entryKey(entry)) return false;
    shared += 1;
  }
  return shared > 0 && shared * 2 >= stored.length;
};

export const isSameRace = (
  stored: StoredRaceState,
  live: LiveRaceState
): RaceResumeVerdict => {
  const kept = stored.info;
  const current = live.info;
  if (kept.simulator !== current.simulator) {
    return different('another simulator');
  }
  if (
    kept.trackId !== current.trackId ||
    (kept.trackConfig ?? '') !== (current.trackConfig ?? '')
  ) {
    return different('another track');
  }
  if (
    (kept.sessionType ?? '') !== (current.sessionType ?? '') ||
    (kept.sessionNum !== null &&
      current.sessionNum !== null &&
      kept.sessionNum !== current.sessionNum)
  ) {
    return different('another kind of session');
  }
  if (kept.sessionKey !== current.sessionKey) {
    return different('another session by the sim’s own id');
  }
  // A session the sim names is that session, whoever is in it by now.
  const named = current.sessionKey !== '';
  if (!named && !sameEntries(kept.entries, current.entries)) {
    return different('another entry list');
  }
  for (const { carIdx, lap } of stored.lastLaps) {
    const completed = live.lapsCompleted[carIdx];
    if (completed !== undefined && completed >= 0 && completed < lap) {
      return different(
        `car ${carIdx} has completed ${completed} laps and ${lap} were kept`
      );
    }
  }
  if (live.sessionTime < kept.sessionTime - CLOCK_TOLERANCE_SECONDS) {
    return different('the session clock is behind the one kept');
  }
  if (!named) {
    const awayMs = live.now - kept.updatedAt;
    const clockMs = (live.sessionTime - kept.sessionTime) * 1000;
    if (awayMs - clockMs > RACE_RESUME_MAX_AWAY_MS) {
      return different('it was left too long ago');
    }
  }
  return { same: true };
};
