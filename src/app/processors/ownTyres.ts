import type { TyreWatch } from '../../shared/tyreSet';
import type { TreadCost } from './ledgerRates';

/**
 * What is known of the tyres on the user's own car, for whoever reckons
 * another car's from them. `PlayerLedgerRuntime` answers it: the tread is
 * the reading its wear forecast is made from, a change of tyre is the one
 * its stints record, and what a lap costs is taken from its laps.
 */
export interface OwnTyres {
  /**
   * Tread left per wheel, LF RF LR RR, 0..1, as the sim reads it now. Null
   * where it is not read live: with no car, and under iRacing, which
   * refreshes tread in the pits alone.
   */
  tread: readonly (number | null)[] | null;
  /** The tyres as the ledger's meter has watched them go on. */
  watch: TyreWatch;
  /**
   * What a lap costs the tread on each compound the car has run, by the
   * compound's name as the session's tyre list has it.
   */
  costs: ReadonlyMap<string, TreadCost>;
}

/** What the ledger running now knows; undefined while there is none. */
export type OwnTyresSource = () => OwnTyres | undefined;

let current: { ownTyres(): OwnTyres } | undefined;

/**
 * Names the ledger that watches our own car's tyres; undefined while there
 * is none. The app makes the ledger once a simulator is known and replaces
 * it when another takes over, as it does for `livePlayerStintSource`.
 */
export const setLiveOwnTyresSource = (
  source: { ownTyres(): OwnTyres } | undefined
): void => {
  current = source;
};

/** The tyres on our own car, as whichever ledger is running has them. */
export const liveOwnTyres: OwnTyresSource = () => current?.ownTyres();
