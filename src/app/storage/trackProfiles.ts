import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type {
  TrackElevationSource,
  TrackNote,
  TrackNoteKind,
  TrackProfile,
  TrackProfileDemand,
  TrackProfileKey,
  TrackProfileLap,
  TrackProfileSummary,
  TrackSectorSource,
} from '@irdashies/types';
import {
  TRACK_NOTE_COMMENT_LENGTH,
  TRACK_NOTE_LIMIT,
  TRACK_NOTE_TEXT_LENGTH,
  TRACK_PROFILE_MAX_POINTS,
  TRACK_PROFILE_SPACING_M,
  TRACK_PROFILE_VERSION,
} from '@irdashies/types';
import logger from '../logger';
import { createDebouncedAtomicWriter } from './debouncedAtomicWriter';
import { parseTrackNotesFile, serializeTrackNotesFile } from './trackNotesFile';

/**
 * Track profiles on disk: one JSON file per simulator and track under
 * `userData/track-profiles/`, so a new note rewrites a few kilobytes and not
 * every circuit the user has driven.
 *
 * Nothing here waits for the disk on the caller's time. `get` and `load`
 * answer from memory and start the read the first time a track is asked
 * for; `revision` moves when it lands. Every change is applied in memory
 * and the file follows through a debounced, atomic write.
 *
 * Caps: 500 notes a track, 5,000 buckets a profile (50 km), and 1,000
 * files, past which the ones changed longest ago go, a file with a note in
 * it never. A file a newer build wrote is neither read nor written over.
 */

const DIRECTORY = 'track-profiles';
/** A profile's file name: the simulator, then the track id. */
const PROFILE_FILE = /^([a-z][a-z0-9]{0,31})_(-?\d+)\.json$/;
/** The most profile files kept. */
export const TRACK_PROFILE_FILE_LIMIT = 1000;
/**
 * The largest file read as a profile. The longest track with its line and
 * five hundred notes of the longest text comes to a tenth of this.
 */
const MAX_FILE_BYTES = 4_000_000;
/** How far a lap's height may be from where it began, by its source. */
const RECORDED_CLOSURE_M = 1;
const INTEGRATED_CLOSURE_M = 5;
/** Laps averaged into a profile that is added up rather than read. */
const INTEGRATED_LAPS = 3;
const MAX_SECTORS = 16;
const MAX_NAME_LENGTH = 200;
const MAX_ID_LENGTH = 64;
/** Centimetres: finer than the height or the line of a road is known. */
const STORED_DECIMALS = 100;

const ELEVATION_SOURCES: readonly TrackElevationSource[] = [
  'recorded',
  'integrated',
  'tinypedal',
];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const errorCode = (error: unknown): string =>
  (error as NodeJS.ErrnoException)?.code ?? 'UNKNOWN';

const pointsCountOf = (trackLengthM: number): number =>
  Math.ceil(trackLengthM / TRACK_PROFILE_SPACING_M);

/**
 * The file a track's profile is kept in, or null for a simulator or a track
 * id that could not have come from a session. Built from nothing else, so
 * no path can be made to leave the folder.
 */
export const trackProfileFileName = (
  simulator: unknown,
  trackId: unknown
): string | null =>
  typeof simulator === 'string' &&
  /^[a-z][a-z0-9]{0,31}$/.test(simulator) &&
  Number.isSafeInteger(trackId)
    ? `${simulator}_${trackId}.json`
    : null;

const isKey = (key: TrackProfileKey): boolean =>
  trackProfileFileName(key?.simulator, key?.trackId) !== null &&
  typeof key.trackName === 'string' &&
  isFiniteNumber(key.trackLengthM) &&
  key.trackLengthM > 0 &&
  key.pointsCount === pointsCountOf(key.trackLengthM) &&
  key.pointsCount <= TRACK_PROFILE_MAX_POINTS;

/**
 * A value as it is kept. The 0 added turns a negative zero into the zero it
 * is read back as, so a profile in memory equals the one on disk.
 */
const stored = (value: number): number =>
  Math.round(value * STORED_DECIMALS) / STORED_DECIMALS + 0;

/** A whole array of finite numbers of the length asked for, or null. */
const numbersOf = (value: unknown, length: number): number[] | null => {
  if (!Array.isArray(value) || value.length !== length) return null;
  return value.every(isFiniteNumber) ? (value as number[]) : null;
};

/** Sector starts that begin at 0 and rise to under a lap, or null. */
const sectorStartsOf = (value: unknown): number[] | null => {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_SECTORS) {
    return null;
  }
  if (!value.every(isFiniteNumber) || value[0] !== 0) return null;
  for (let index = 1; index < value.length; index += 1) {
    if (!(value[index] > value[index - 1]) || !(value[index] < 1)) return null;
  }
  return value as number[];
};

const noteOf = (value: unknown, trackLengthM: number): TrackNote | null => {
  if (!isObject(value)) return null;
  const { id, distanceM, kind, text, comment, pit } = value;
  if (typeof id !== 'string' || id === '' || id.length > MAX_ID_LENGTH) {
    return null;
  }
  if (!isFiniteNumber(distanceM) || distanceM < 0) return null;
  if (!(distanceM < trackLengthM)) return null;
  if (kind !== 'track' && kind !== 'pace') return null;
  if (typeof text !== 'string') return null;
  return {
    id,
    distanceM,
    kind,
    text: text.slice(0, TRACK_NOTE_TEXT_LENGTH),
    comment:
      typeof comment === 'string'
        ? comment.slice(0, TRACK_NOTE_COMMENT_LENGTH)
        : '',
    pit: pit === true,
  };
};

/**
 * The well-formed notes of a list, each id once, sorted by distance. What
 * is malformed, or lies off the lap, is left out; text too long is cut.
 */
export const cleanTrackNotes = (
  value: unknown,
  trackLengthM: number
): TrackNote[] => {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const notes: TrackNote[] = [];
  for (const entry of value) {
    const note = noteOf(entry, trackLengthM);
    if (!note || ids.has(note.id)) continue;
    ids.add(note.id);
    notes.push(note);
  }
  return notes.sort((a, b) => a.distanceM - b.distanceM);
};

const emptyProfile = (key: TrackProfileKey, now: number): TrackProfile => ({
  version: TRACK_PROFILE_VERSION,
  simulator: key.simulator,
  trackId: key.trackId,
  trackName: key.trackName.slice(0, MAX_NAME_LENGTH),
  trackLengthM: key.trackLengthM,
  pointsCount: key.pointsCount,
  elevationM: null,
  elevationSource: null,
  elevationLaps: 0,
  xM: null,
  zM: null,
  sectorStartPct: [],
  sectorSource: 'nominal',
  notes: [],
  updatedAt: now,
});

/**
 * What a stored file holds, field by field: null for one that is not a
 * profile of this track at all, 'newer' for one a later build wrote. A part
 * that is malformed is dropped and the rest kept, so a damaged elevation
 * does not cost the driver their notes.
 */
export const parseTrackProfile = (
  value: unknown,
  simulator: string,
  trackId: number
): TrackProfile | 'newer' | null => {
  if (!isObject(value) || typeof value.version !== 'number') return null;
  if (value.version > TRACK_PROFILE_VERSION) return 'newer';
  if (value.version !== TRACK_PROFILE_VERSION) return null;
  if (value.simulator !== simulator || value.trackId !== trackId) return null;
  const { trackLengthM, pointsCount } = value;
  if (!isFiniteNumber(trackLengthM) || !(trackLengthM > 0)) return null;
  if (
    pointsCount !== pointsCountOf(trackLengthM) ||
    pointsCount > TRACK_PROFILE_MAX_POINTS
  ) {
    return null;
  }

  const elevationSource = ELEVATION_SOURCES.find(
    (source) => source === value.elevationSource
  );
  const elevationM = elevationSource
    ? numbersOf(value.elevationM, pointsCount)
    : null;
  const xM = elevationM ? numbersOf(value.xM, pointsCount) : null;
  const zM = xM ? numbersOf(value.zM, pointsCount) : null;
  const sectorSource: TrackSectorSource =
    value.sectorSource === 'session' || value.sectorSource === 'learned'
      ? value.sectorSource
      : 'nominal';
  const sectorStartPct =
    sectorSource === 'nominal' ? null : sectorStartsOf(value.sectorStartPct);

  return {
    version: TRACK_PROFILE_VERSION,
    simulator,
    trackId,
    trackName:
      typeof value.trackName === 'string'
        ? value.trackName.slice(0, MAX_NAME_LENGTH)
        : '',
    trackLengthM,
    pointsCount,
    elevationM,
    elevationSource: elevationM ? (elevationSource ?? null) : null,
    elevationLaps:
      elevationM &&
      Number.isInteger(value.elevationLaps) &&
      (value.elevationLaps as number) >= 0
        ? (value.elevationLaps as number)
        : 0,
    xM: zM ? xM : null,
    zM,
    sectorStartPct: sectorStartPct ?? [],
    sectorSource: sectorStartPct ? sectorSource : 'nominal',
    notes: cleanTrackNotes(value.notes, trackLengthM).slice(
      0,
      TRACK_NOTE_LIMIT
    ),
    updatedAt: isFiniteNumber(value.updatedAt) ? value.updatedAt : 0,
  };
};

/** The stored profile when it is of the layout the key names, else null. */
const sameLayout = (
  existing: TrackProfile | null,
  key: TrackProfileKey
): TrackProfile | null =>
  existing &&
  existing.pointsCount === key.pointsCount &&
  existing.trackLengthM === key.trackLengthM
    ? existing
    : null;

/**
 * What a clean lap of a track would still be good for, given what is stored
 * and how the lap's heights will have been come by.
 */
export const profileDemand = (
  existing: TrackProfile | null,
  key: TrackProfileKey,
  source: TrackProfileLap['source']
): TrackProfileDemand => {
  const base = sameLayout(existing, key);
  if (source === 'recorded') {
    if (base?.elevationSource !== 'recorded') return 'first';
    return base.sectorSource === 'learned' ? 'none' : 'more';
  }
  if (base?.elevationSource !== 'integrated') return 'first';
  return base.elevationLaps < INTEGRATED_LAPS ? 'more' : 'none';
};

const sameNumbers = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * The profile a clean lap leaves behind, or null when the lap changes
 * nothing.
 *
 * A lap whose height does not come back to where it began is refused: 1 m
 * for a height that was read, 5 m for one that was added up. A read
 * elevation is taken once, from the first lap that closes, and later laps
 * leave it alone until it is cleared; an added-up one is the mean of the
 * first three. Either replaces an imported one. The driver's notes are
 * carried over whatever else changes.
 */
export const mergeProfileLap = (
  existing: TrackProfile | null,
  key: TrackProfileKey,
  lap: TrackProfileLap,
  now: number
): TrackProfile | null => {
  if (!isKey(key) || lap.elevationM.length !== key.pointsCount) return null;
  const limit =
    lap.source === 'recorded' ? RECORDED_CLOSURE_M : INTEGRATED_CLOSURE_M;
  if (!(lap.closureM >= 0) || lap.closureM > limit) return null;
  for (const values of [lap.elevationM, lap.xM, lap.zM]) {
    if (!values) continue;
    if (values.length !== key.pointsCount) return null;
    if (!values.every((value) => Number.isFinite(value))) return null;
  }

  const base = sameLayout(existing, key);
  const next: TrackProfile = base
    ? { ...base, trackName: key.trackName.slice(0, MAX_NAME_LENGTH) }
    : {
        ...emptyProfile(key, now),
        notes: cleanTrackNotes(existing?.notes, key.trackLengthM),
      };
  let changed = false;

  if (lap.source === 'recorded') {
    if (next.elevationSource !== 'recorded') {
      next.elevationM = Array.from(lap.elevationM, stored);
      next.elevationSource = 'recorded';
      next.elevationLaps = 1;
      next.xM = lap.xM && lap.zM ? Array.from(lap.xM, stored) : null;
      next.zM = lap.xM && lap.zM ? Array.from(lap.zM, stored) : null;
      changed = true;
    }
  } else if (next.elevationSource !== 'integrated' || !next.elevationM) {
    next.elevationM = Array.from(lap.elevationM, stored);
    next.elevationSource = 'integrated';
    next.elevationLaps = 1;
    next.xM = null;
    next.zM = null;
    changed = true;
  } else if (next.elevationLaps < INTEGRATED_LAPS) {
    const laps = next.elevationLaps;
    next.elevationM = next.elevationM.map((height, bucket) =>
      stored((height * laps + lap.elevationM[bucket]) / (laps + 1))
    );
    next.elevationLaps = laps + 1;
    changed = true;
  }

  const sectors = lap.sectorSource ? sectorStartsOf(lap.sectorStartPct) : null;
  if (
    sectors &&
    lap.sectorSource &&
    // Starts the car was seen crossing are kept like the elevation they
    // came with; the session's own follow the session.
    (lap.sectorSource === 'learned'
      ? next.sectorSource !== 'learned'
      : next.sectorSource !== 'session' ||
        !sameNumbers(next.sectorStartPct, sectors))
  ) {
    next.sectorStartPct = [...sectors];
    next.sectorSource = lap.sectorSource;
    changed = true;
  }

  if (!changed) return null;
  next.updatedAt = now;
  return next;
};

/**
 * Heights given as pairs of metres into the lap and metres up, in lap
 * order, brought to one height per bucket by straight lines between them.
 * Before the first pair and after the last, the nearest stands. Null for
 * fewer than two usable pairs.
 */
export const resampleElevation = (
  pairs: readonly (readonly [number, number])[],
  key: TrackProfileKey
): number[] | null => {
  const points = pairs
    .filter(
      (pair) =>
        Array.isArray(pair) &&
        isFiniteNumber(pair[0]) &&
        isFiniteNumber(pair[1])
    )
    .map(([distance, height]) => ({ distance, height }))
    .sort((a, b) => a.distance - b.distance);
  if (points.length < 2 || !isKey(key)) return null;
  const out = new Array<number>(key.pointsCount);
  let upper = 0;
  for (let bucket = 0; bucket < key.pointsCount; bucket += 1) {
    const distance = (bucket * key.trackLengthM) / key.pointsCount;
    while (upper < points.length && points[upper].distance < distance) {
      upper += 1;
    }
    const high = points[Math.min(upper, points.length - 1)];
    const low = points[Math.max(upper - 1, 0)];
    const span = high.distance - low.distance;
    const share =
      span > 0 ? Math.min(Math.max((distance - low.distance) / span, 0), 1) : 0;
    out[bucket] = stored(low.height + (high.height - low.height) * share);
  }
  return out;
};

export interface TrackProfileStore {
  /**
   * The profile kept for a track, from memory. Null when there is none, and
   * on the first call for a track, before its file has been read: the
   * revision moves when it has.
   */
  get(simulator: string, trackId: number): TrackProfile | null;
  /**
   * The same, for a running session: only a profile sampled at the
   * session's own number of buckets, as a lap curve of the library is only
   * used at its own.
   */
  load(
    simulator: string,
    trackId: number,
    pointsCount: number
  ): TrackProfile | null;
  /** Moves whenever `get` or `load` may answer differently. */
  revision(): number;
  /** The profile kept for a track, once its file has been read. */
  whenLoaded(simulator: string, trackId: number): Promise<TrackProfile | null>;
  /** What a clean lap of the track would still be good for. */
  demand(
    key: TrackProfileKey,
    source: TrackProfileLap['source']
  ): TrackProfileDemand;
  /** Takes a clean lap. Resolves true when it changed the profile. */
  recordLap(key: TrackProfileKey, lap: TrackProfileLap): Promise<boolean>;
  /**
   * Fills in an elevation from pairs of distance and height, for a track
   * that has none. Resolves true when it did.
   */
  importElevation(
    key: TrackProfileKey,
    pairs: readonly (readonly [number, number])[]
  ): Promise<boolean>;
  /** Forgets the elevation, the line and the learned sector starts. */
  clearElevation(simulator: string, trackId: number): Promise<boolean>;
  /**
   * Replaces a track's notes. Resolves with the notes as kept, or null
   * when they were refused: more than 500, or not a list.
   */
  saveNotes(key: TrackProfileKey, notes: unknown): Promise<TrackNote[] | null>;
  /**
   * Adds the notes of a notes file to a track's own. The file says which
   * kind they are; `kind` stands where it does not. Resolves with every
   * note of the track afterwards, or null when the file is not a notes
   * file or would take the track past 500.
   */
  importNotes(
    key: TrackProfileKey,
    kind: TrackNoteKind,
    fileText: unknown
  ): Promise<TrackNote[] | null>;
  /** A track's notes of one kind as a notes file. */
  exportNotes(
    simulator: string,
    trackId: number,
    kind: TrackNoteKind
  ): Promise<string>;
  /** Every track with a file, newest change first. */
  list(): Promise<TrackProfileSummary[]>;
  /** Fires after any change to a profile. */
  onChanged(callback: () => void): () => void;
  /** Writes every pending change now. */
  flush(): Promise<void>;
}

export interface TrackProfileStoreOptions {
  /** Wall-clock time in Unix milliseconds. */
  now?: () => number;
  /** A new note's id. */
  newId?: () => string;
  /** The most profile files kept. */
  maxFiles?: number;
}

interface Entry {
  simulator: string;
  trackId: number;
  fileName: string;
  filePath: string;
  profile: TrackProfile | null;
  /** The file has been read, or found missing. */
  loaded: boolean;
  /** A newer build wrote the file: nothing is read from it or written. */
  frozen: boolean;
  /** There was a file when it was read, or one has been written since. */
  onDisk: boolean;
  loading?: Promise<boolean>;
  writer?: ReturnType<typeof createDebouncedAtomicWriter>;
}

const summaryOf = (profile: TrackProfile): TrackProfileSummary => ({
  simulator: profile.simulator,
  trackId: profile.trackId,
  trackName: profile.trackName,
  trackLengthM: profile.trackLengthM,
  elevationSource: profile.elevationSource,
  notes: profile.notes.length,
  updatedAt: profile.updatedAt,
});

export function createTrackProfileStore(
  storageDir: string,
  {
    now = Date.now,
    newId = randomUUID,
    maxFiles = TRACK_PROFILE_FILE_LIMIT,
  }: TrackProfileStoreOptions = {}
): TrackProfileStore {
  const directory = path.join(storageDir, DIRECTORY);
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  /** Changes still waiting for a read or for the folder. */
  const inFlight = new Set<Promise<unknown>>();
  let revision = 0;
  let directoryReady: Promise<void> | undefined;
  let pruning: Promise<void> | undefined;

  const ensureDirectory = (): Promise<void> =>
    (directoryReady ??= fsp
      .mkdir(directory, { recursive: true })
      .then(() => undefined)
      .catch((error: unknown) => {
        directoryReady = undefined;
        throw error;
      }));

  const entryFor = (simulator: string, trackId: number): Entry | null => {
    const fileName = trackProfileFileName(simulator, trackId);
    if (!fileName) return null;
    let entry = entries.get(fileName);
    if (!entry) {
      entry = {
        simulator,
        trackId,
        fileName,
        filePath: path.join(directory, fileName),
        profile: null,
        loaded: false,
        frozen: false,
        onDisk: false,
      };
      entries.set(fileName, entry);
    }
    return entry;
  };

  /** What a profile file holds, read from disk past the cache. */
  const readFile = async (
    filePath: string,
    fileName: string,
    simulator: string,
    trackId: number
  ): Promise<TrackProfile | 'newer' | 'missing' | 'invalid'> => {
    let text: string;
    try {
      if ((await fsp.stat(filePath)).size > MAX_FILE_BYTES) {
        logger.warn('[TrackProfiles] Invalid file', fileName);
        return 'invalid';
      }
      text = await fsp.readFile(filePath, 'utf8');
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return 'missing';
      throw error;
    }
    let parsed: TrackProfile | 'newer' | null;
    try {
      parsed = parseTrackProfile(JSON.parse(text), simulator, trackId);
    } catch {
      parsed = null;
    }
    if (parsed === null) {
      logger.warn('[TrackProfiles] Invalid file', fileName);
      return 'invalid';
    }
    return parsed;
  };

  /** Whether the entry's file has been read, reading it if not. */
  const read = (entry: Entry): Promise<boolean> => {
    if (entry.loaded) return Promise.resolve(true);
    return (entry.loading ??= (async () => {
      try {
        const found = await readFile(
          entry.filePath,
          entry.fileName,
          entry.simulator,
          entry.trackId
        );
        if (found === 'newer') {
          entry.frozen = true;
          entry.onDisk = true;
          logger.warn(
            '[TrackProfiles] Written by a newer version, left as it is',
            entry.fileName
          );
        } else if (found === 'invalid') {
          // A file that cannot be read as a profile is written over by the
          // next change: there is nothing in it to keep.
          entry.onDisk = true;
        } else if (found !== 'missing') {
          entry.onDisk = true;
          entry.profile = found;
          revision += 1;
        }
        entry.loaded = true;
        return true;
      } catch (error) {
        // Often a scanner holding the file for a moment. It may hold a
        // profile, so nothing is written until a read has worked.
        logger.warn(
          '[TrackProfiles] Failed to read',
          entry.fileName,
          errorCode(error)
        );
        return false;
      } finally {
        entry.loading = undefined;
      }
    })());
  };

  const prune = (): Promise<void> =>
    (pruning ??= (async () => {
      try {
        const names = (await fsp.readdir(directory)).filter((name) =>
          name.endsWith('.json')
        );
        let excess = names.length - maxFiles;
        if (excess <= 0) return;
        const candidates: { name: string; updatedAt: number }[] = [];
        for (const name of names) {
          const match = PROFILE_FILE.exec(name);
          // A track asked for in this run is in use, or about to be
          // written: never one to drop.
          if (!match || entries.has(name)) continue;
          const profile = await readFile(
            path.join(directory, name),
            name,
            match[1],
            Number(match[2])
          ).catch(() => 'newer' as const);
          if (typeof profile === 'string') continue;
          if (profile.notes.length > 0) continue;
          candidates.push({ name, updatedAt: profile.updatedAt });
        }
        candidates.sort((a, b) => a.updatedAt - b.updatedAt);
        for (const { name } of candidates) {
          if (excess <= 0) break;
          await fsp.unlink(path.join(directory, name));
          excess -= 1;
        }
      } catch (error) {
        logger.warn('[TrackProfiles] Failed to prune', errorCode(error));
      } finally {
        pruning = undefined;
      }
    })());

  const writerFor = (entry: Entry) =>
    (entry.writer ??= createDebouncedAtomicWriter({
      filePath: entry.filePath,
      serialize: () => JSON.stringify(entry.profile),
      onSuccess: () => {
        if (entry.onDisk) return;
        // One more file than before: the only time the count can pass
        // the cap.
        entry.onDisk = true;
        void prune();
      },
      onError: (error) =>
        logger.warn(
          '[TrackProfiles] Failed to write',
          entry.fileName,
          errorCode(error)
        ),
    }));

  /**
   * Applies a change to a track's profile once its file has been read.
   * `change` returns the new profile, or undefined to leave it as it is.
   */
  const apply = (
    simulator: string,
    trackId: number,
    change: (current: TrackProfile | null) => TrackProfile | undefined
  ): Promise<boolean> => {
    const entry = entryFor(simulator, trackId);
    if (!entry) return Promise.resolve(false);
    const work = (async () => {
      if (!(await read(entry)) || entry.frozen) return false;
      const next = change(entry.profile);
      if (next === undefined) return false;
      entry.profile = next;
      revision += 1;
      for (const listener of listeners) listener();
      try {
        await ensureDirectory();
        writerFor(entry).schedule();
      } catch (error) {
        logger.warn(
          '[TrackProfiles] Failed to create the folder',
          errorCode(error)
        );
      }
      return true;
    })();
    inFlight.add(work);
    void work.finally(() => inFlight.delete(work));
    return work;
  };

  const get = (simulator: string, trackId: number): TrackProfile | null => {
    const entry = entryFor(simulator, trackId);
    if (!entry) return null;
    if (!entry.loaded) void read(entry);
    return entry.profile;
  };

  return {
    get,

    load(simulator, trackId, pointsCount) {
      const profile = get(simulator, trackId);
      return profile?.pointsCount === pointsCount ? profile : null;
    },

    revision: () => revision,

    async whenLoaded(simulator, trackId) {
      const entry = entryFor(simulator, trackId);
      if (!entry) return null;
      await read(entry);
      return entry.profile;
    },

    demand(key, source) {
      const entry = entryFor(key.simulator, key.trackId);
      if (!entry || entry.frozen) return 'none';
      if (!entry.loaded) {
        void read(entry);
        // Not known yet whether the track has a profile: worth sampling,
        // and not to be announced as its first.
        return 'more';
      }
      return profileDemand(entry.profile, key, source);
    },

    recordLap: (key, lap) =>
      apply(
        key.simulator,
        key.trackId,
        (current) => mergeProfileLap(current, key, lap, now()) ?? undefined
      ),

    importElevation: (key, pairs) =>
      apply(key.simulator, key.trackId, (current) => {
        const base = sameLayout(current, key);
        if (base?.elevationM) return undefined;
        const elevationM = resampleElevation(pairs, key);
        if (!elevationM) return undefined;
        return {
          ...(base ?? {
            ...emptyProfile(key, now()),
            notes: cleanTrackNotes(current?.notes, key.trackLengthM),
          }),
          elevationM,
          elevationSource: 'tinypedal',
          elevationLaps: 0,
          xM: null,
          zM: null,
          updatedAt: now(),
        };
      }),

    clearElevation: (simulator, trackId) =>
      apply(simulator, trackId, (current) => {
        if (!current) return undefined;
        const learned = current.sectorSource === 'learned';
        if (!current.elevationM && !learned) return undefined;
        return {
          ...current,
          elevationM: null,
          elevationSource: null,
          elevationLaps: 0,
          xM: null,
          zM: null,
          sectorStartPct: learned ? [] : current.sectorStartPct,
          sectorSource: learned ? 'nominal' : current.sectorSource,
          updatedAt: now(),
        };
      }),

    async saveNotes(key, notes) {
      if (!isKey(key) || !Array.isArray(notes)) return null;
      if (notes.length > TRACK_NOTE_LIMIT) return null;
      const kept = cleanTrackNotes(notes, key.trackLengthM);
      const saved = await apply(key.simulator, key.trackId, (current) => ({
        ...(current ?? emptyProfile(key, now())),
        notes: kept,
        updatedAt: now(),
      }));
      return saved ? kept : null;
    },

    async importNotes(key, kind, fileText) {
      if (!isKey(key) || (kind !== 'track' && kind !== 'pace')) return null;
      const file = parseTrackNotesFile(fileText);
      if (!file) return null;
      let result: TrackNote[] | null = null;
      await apply(key.simulator, key.trackId, (current) => {
        const existing = current?.notes ?? [];
        const added = cleanTrackNotes(
          file.rows.map((row) => ({
            ...row,
            id: newId(),
            kind: file.kind ?? kind,
          })),
          key.trackLengthM
        );
        if (existing.length + added.length > TRACK_NOTE_LIMIT) {
          return undefined;
        }
        result = [...existing, ...added].sort(
          (a, b) => a.distanceM - b.distanceM
        );
        return {
          ...(current ?? emptyProfile(key, now())),
          notes: result,
          updatedAt: now(),
        };
      });
      return result;
    },

    async exportNotes(simulator, trackId, kind) {
      const entry = entryFor(simulator, trackId);
      if (entry) await read(entry);
      return serializeTrackNotesFile(
        kind,
        (entry?.profile?.notes ?? []).filter((note) => note.kind === kind)
      );
    },

    async list() {
      let names: string[];
      try {
        names = await fsp.readdir(directory);
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') {
          logger.warn('[TrackProfiles] Failed to list', errorCode(error));
        }
        names = [];
      }
      const summaries = new Map<string, TrackProfileSummary>();
      for (const name of names) {
        const match = PROFILE_FILE.exec(name);
        // Read past the cache: a list of every track ever driven is not a
        // reason to hold every one of them in memory.
        if (!match || entries.has(name)) continue;
        const profile = await readFile(
          path.join(directory, name),
          name,
          match[1],
          Number(match[2])
        ).catch(() => 'newer' as const);
        if (typeof profile !== 'string') {
          summaries.set(name, summaryOf(profile));
        }
      }
      // The tracks asked for in this run, as they stand in memory: a change
      // may not have reached the disk yet.
      for (const [name, entry] of entries) {
        if (!entry.loaded) await read(entry);
        if (entry.profile) summaries.set(name, summaryOf(entry.profile));
      }
      return [...summaries.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    },

    onChanged(callback) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },

    async flush() {
      await Promise.allSettled([...inFlight]);
      // Each writer knows whether it has anything left to write.
      for (const entry of entries.values()) await entry.writer?.flush();
      await pruning;
    },
  };
}

let defaultStore: TrackProfileStore | undefined;

/** The installation's store, in `userData`. */
export function getTrackProfileStore(): TrackProfileStore {
  if (!defaultStore) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron');
    defaultStore = createTrackProfileStore(app.getPath('userData'));
  }
  return defaultStore;
}

export const flushTrackProfilesOnShutdown = (): Promise<void> =>
  defaultStore?.flush() ?? Promise.resolve();
