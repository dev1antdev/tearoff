import { getTrackCarStore, type TrackCarStoreHandle } from './trackCarStore';

/**
 * How far and how long the player has driven each car on each track, over
 * every session: the cruise block's odometer and time on track.
 *
 * Two numbers per simulator, track and car, in the `driveTotals` namespace
 * of the track-and-car store, which caps the entries and writes the file.
 * A total only grows, by the increments handed in here.
 *
 * The store reads its file once, some time after the app starts. Until it
 * has, nothing is known and nothing may be written: a value set before the
 * read would stand in place of the one on disk. So `load` answers null
 * until then, and an increment that arrives early waits and is added the
 * moment the read is done, before `load` first answers.
 */

/** Metres and seconds driven on one track in one car. */
export interface StoredDrivingTotals {
  metres: number;
  seconds: number;
}

export interface DrivingTotalsStore {
  /** The stored totals, or null while the file has not been read. */
  load(
    simulator: string,
    trackId: number,
    carKey: string
  ): StoredDrivingTotals | null;
  /** Adds to the stored totals. Nothing below zero and nothing unreal. */
  add(
    simulator: string,
    trackId: number,
    carKey: string,
    metres: number,
    seconds: number
  ): void;
}

const NAMESPACE = 'driveTotals';
/**
 * How many times the totals are asked for before a failed read of the file
 * is tried again: five seconds of the cruise channel's ten frames a second.
 */
const RETRY_AFTER_CALLS = 50;

/** As the store's namespace states it: `simulator|trackId|carKey`. */
export const drivingTotalsKey = (
  simulator: string,
  trackId: number,
  carKey: string
): string => `${simulator}|${trackId}|${carKey}`;

const amount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

/** What a stored entry holds, whatever shape it was left in. */
const totalsOf = (value: unknown): StoredDrivingTotals => {
  const entry =
    typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {};
  return { metres: amount(entry.metres), seconds: amount(entry.seconds) };
};

export const createDrivingTotalsStore = (
  store: Pick<TrackCarStoreHandle, 'get' | 'set' | 'ready'>
): DrivingTotalsStore => {
  /** The store's file has been read. */
  let known = false;
  let asking = false;
  /** Questions left to pass over before the store is asked again. */
  let waitCalls = 0;
  /** Increments that arrived before it was, by key. */
  const early = new Map<string, StoredDrivingTotals>();

  const write = (key: string, metres: number, seconds: number): void => {
    const current = totalsOf(store.get(NAMESPACE, key));
    store.set(NAMESPACE, key, {
      metres: current.metres + metres,
      seconds: current.seconds + seconds,
    });
  };

  /**
   * Asks the store whether its file is read, once at a time. A read that
   * failed is tried again, though not on every frame that asks: a file that
   * cannot be read now will not be readable a tenth of a second on.
   */
  const ask = (): void => {
    if (known || asking) return;
    if (waitCalls > 0) {
      waitCalls -= 1;
      return;
    }
    asking = true;
    void store
      .ready()
      .then((ready) => {
        if (!ready) {
          waitCalls = RETRY_AFTER_CALLS;
          return;
        }
        // In the same turn as `known`, so no `load` can answer between.
        for (const [key, totals] of early) {
          write(key, totals.metres, totals.seconds);
        }
        early.clear();
        known = true;
      })
      .catch(() => {
        waitCalls = RETRY_AFTER_CALLS;
      })
      .finally(() => {
        asking = false;
      });
  };
  ask();

  return {
    load(simulator, trackId, carKey) {
      if (!known) {
        // A read that failed is tried again by asking.
        ask();
        return null;
      }
      return totalsOf(
        store.get(NAMESPACE, drivingTotalsKey(simulator, trackId, carKey))
      );
    },

    add(simulator, trackId, carKey, metres, seconds) {
      const more = { metres: amount(metres), seconds: amount(seconds) };
      if (more.metres === 0 && more.seconds === 0) return;
      const key = drivingTotalsKey(simulator, trackId, carKey);
      if (known) {
        write(key, more.metres, more.seconds);
        return;
      }
      const waiting = early.get(key);
      early.set(key, {
        metres: (waiting?.metres ?? 0) + more.metres,
        seconds: (waiting?.seconds ?? 0) + more.seconds,
      });
      ask();
    },
  };
};

let drivingTotals: DrivingTotalsStore | undefined;

/** The installation's driving totals. */
export const getDrivingTotalsStore = (): DrivingTotalsStore => {
  drivingTotals ??= createDrivingTotalsStore(getTrackCarStore());
  return drivingTotals;
};
