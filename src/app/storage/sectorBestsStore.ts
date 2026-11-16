import type { SectorBests } from '../../shared/sectorBests';
import { getTrackCarStore, type TrackCarStoreHandle } from './trackCarStore';

/**
 * The player's all-time sector bests, in the store of small values kept per
 * simulator, track and car (`sectorBests`, at most 2,000 keys, the ones set
 * longest ago dropped first).
 *
 * What the sector timer is handed: it may not wait for the disk, so `load`
 * answers from memory, and says so when the file has not been read yet
 * rather than passing an empty store off as "nothing kept".
 */
export interface SectorBestsStorage {
  /**
   * What is kept under a key, as stored. Undefined until the file has been
   * read, null when nothing is kept.
   */
  load(key: string): unknown;
  save(key: string, bests: SectorBests): void;
  /** Moves whenever `load` may answer differently. */
  revision(): number;
}

export const createSectorBestsStore = (
  store: TrackCarStoreHandle
): SectorBestsStorage => {
  let answered = false;
  let asking = false;
  /**
   * Asks the store whether its file has been read. Asked again from `load`
   * for as long as it has not: a read that failed is tried again by the
   * store at the next value set, and the answer then is found here.
   */
  const ask = (): void => {
    if (answered || asking) return;
    asking = true;
    void store.ready().then((ok) => {
      asking = false;
      answered = ok;
    });
  };
  ask();

  return {
    load(key) {
      if (!answered) {
        ask();
        return undefined;
      }
      return store.get<unknown>('sectorBests', key) ?? null;
    },
    save(key, bests) {
      store.set('sectorBests', key, bests);
    },
    // One more than the store's own once the file is in, so that a reader
    // who asked before then asks again.
    revision: () => store.revision() + (answered ? 1 : 0),
  };
};

let sectorBests: SectorBestsStorage | undefined;

/** The installation's sector bests. */
export const getSectorBestsStore = (): SectorBestsStorage => {
  sectorBests ??= createSectorBestsStore(getTrackCarStore());
  return sectorBests;
};
