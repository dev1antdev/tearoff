import type { PlayerStintSource } from './ReferenceLapProcessor';

/**
 * The player's stint as the ledger running now has it.
 *
 * The ledger is made by the app once a simulator is known, and replaced when
 * another takes over; the processors are made by the telemetry bridge, which
 * knows nothing of it. This is where the one finds the other: the app names
 * the ledger here, and a bridge hands `livePlayerStintSource` to its
 * processors, which then follow whichever ledger is running.
 *
 * With no ledger there is no stint, and the best lap of a stint is never
 * dropped for a new one.
 */
let current: PlayerStintSource | undefined;

/** Names the ledger whose stints count; undefined while there is none. */
export const setLivePlayerStintSource = (
  source: PlayerStintSource | undefined
): void => {
  current = source;
};

export const livePlayerStintSource: PlayerStintSource = {
  stintId: () => current?.stintId() ?? '',
  stintOrdinal: () => current?.stintOrdinal() ?? 0,
};
