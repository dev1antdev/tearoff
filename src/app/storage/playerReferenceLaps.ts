import type { ReferenceLap } from '@irdashies/types';
import { app } from 'electron';
import fsp from 'node:fs/promises';
import path from 'node:path';
import logger from '../logger';
import { createDebouncedAtomicWriter } from './debouncedAtomicWriter';
import { reportStorageResult, storageErrorCode } from './storageStatus';

/**
 * The player's own best lap per track and car, kept across sessions.
 *
 * Separate from referenceLaps.json on purpose. That file holds the best lap
 * of a class in a series, whoever drove it -- an AI's lap as readily as the
 * player's -- and is never written under Le Mans Ultimate, which has no
 * series id. A delta against "my best lap here in this car" needs the
 * player's lap and nothing else, in both sims.
 */

const filePath = path.join(app.getPath('userData'), 'playerReferenceLaps.json');

/**
 * At most this many track and car combinations, dropping the one saved
 * longest ago. A lap is two arrays of a point every ten metres, about 25 KB
 * as text at Le Mans, so the file stays in the low megabytes at the cap.
 */
const MAX_PLAYER_REFERENCE_LAPS = 200;
const VERSION = 1;
/** Longer than any circuit at ten metres a point; a sanity bound on input. */
const MAX_POINTS = 5000;

/** A lap as it sits in the file: just what cannot be recomputed. */
interface StoredLap {
  /** Seconds. */
  lapTime: number;
  /** ISO time the lap was kept, for whoever opens the file. */
  savedAt: string;
  /** Lap fraction between points. */
  interval: number;
  /** Lap fraction each point was sampled at. */
  pointPos: number[];
  /** Seconds into the lap at each point. */
  times: number[];
}

const cache = new Map<string, StoredLap>();
let loaded = false;

const keyOf = (simulator: string, trackId: number, carKey: string): string =>
  `${simulator}|${trackId}|${carKey}`;

const round = (value: number, decimals: number): number => {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
};

const isFiniteArray = (value: unknown, length: number): value is number[] =>
  Array.isArray(value) &&
  value.length === length &&
  value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));

/** The file is untrusted input: anything that is not a whole lap is dropped. */
const parseStoredLap = (value: unknown): StoredLap | null => {
  if (!value || typeof value !== 'object') return null;
  const { lapTime, savedAt, interval, pointPos, times } = value as Record<
    string,
    unknown
  >;
  if (typeof lapTime !== 'number' || !(lapTime > 0)) return null;
  if (typeof interval !== 'number' || !(interval > 0)) return null;
  if (!Array.isArray(pointPos)) return null;
  const count = pointPos.length;
  if (count < 2 || count > MAX_POINTS) return null;
  if (!isFiniteArray(pointPos, count) || !isFiniteArray(times, count)) {
    return null;
  }
  return {
    lapTime,
    savedAt: typeof savedAt === 'string' ? savedAt : '',
    interval,
    pointPos,
    times,
  };
};

const createWriter = () =>
  createDebouncedAtomicWriter({
    filePath,
    serialize: () =>
      JSON.stringify({ version: VERSION, laps: Object.fromEntries(cache) }),
    onSuccess: () => {
      reportStorageResult('playerReferenceLaps');
      logger.info(
        `[Main] Player reference laps written to disk (${cache.size} entries)`
      );
    },
    onError: (error) => {
      logger.error(
        'Failed to write player reference laps:',
        storageErrorCode(error)
      );
      reportStorageResult('playerReferenceLaps', error);
    },
  });
let writer = createWriter();

/**
 * Reads the file into memory. Called once at startup and awaited by nothing:
 * a lookup before it lands finds no lap, and a lap saved before it lands is
 * kept in preference to the one on disk.
 */
export const loadPlayerReferenceLaps = async (): Promise<void> => {
  if (loaded) return;
  loaded = true;
  let text: string;
  try {
    text = await fsp.readFile(filePath, 'utf8');
  } catch (error) {
    // No file yet is the normal first run, not a fault.
    if (storageErrorCode(error) !== 'ENOENT') {
      logger.warn(
        'Failed to read playerReferenceLaps.json:',
        storageErrorCode(error)
      );
    }
    return;
  }
  try {
    const parsed = JSON.parse(text) as { version?: unknown; laps?: unknown };
    if (parsed?.version !== VERSION || !parsed.laps) return;
    if (typeof parsed.laps !== 'object') return;
    const fromDisk = new Map<string, StoredLap>();
    for (const [key, value] of Object.entries(parsed.laps)) {
      const lap = parseStoredLap(value);
      if (lap) fromDisk.set(key, lap);
    }
    // Disk entries go first so anything saved this run stays the newest.
    const savedThisRun = [...cache];
    cache.clear();
    for (const [key, lap] of fromDisk) cache.set(key, lap);
    for (const [key, lap] of savedThisRun) {
      cache.delete(key);
      cache.set(key, lap);
    }
  } catch {
    logger.warn('playerReferenceLaps.json is not valid JSON; ignoring it');
  }
};

/**
 * The player's best lap for a track and car, or null.
 *
 * Tangents come back zeroed: they are derived from the points, and deriving
 * them is the recorder's job, not the file's.
 */
export const getPlayerReferenceLap = (
  simulator: string,
  trackId: number,
  carKey: string
): ReferenceLap | null => {
  const stored = cache.get(keyOf(simulator, trackId, carKey));
  if (!stored) return null;
  const pointsCount = stored.pointPos.length;
  return {
    pointPos: Float32Array.from(stored.pointPos),
    times: Float32Array.from(stored.times),
    tangents: new Float32Array(pointsCount),
    interval: stored.interval,
    pointsCount,
    startTime: 0,
    finishTime: stored.lapTime,
    lastTrackedPct: 0,
    isCleanLap: true,
  };
};

/**
 * Keeps a lap as the player's best for a track and car. The caller decides
 * that it is the best; this only stores it.
 */
export const savePlayerReferenceLap = (
  simulator: string,
  trackId: number,
  carKey: string,
  lap: ReferenceLap
): void => {
  const lapTime = lap.finishTime - lap.startTime;
  if (!(lapTime > 0) || lap.pointsCount < 2 || lap.pointsCount > MAX_POINTS) {
    return;
  }
  const key = keyOf(simulator, trackId, carKey);
  cache.delete(key);
  cache.set(key, {
    lapTime: round(lapTime, 4),
    savedAt: new Date().toISOString(),
    interval: lap.interval,
    // Rounded to what the timing resolves, which also keeps a float32 from
    // being written out as sixteen digits.
    pointPos: Array.from(lap.pointPos, (value) => round(value, 6)),
    times: Array.from(lap.times, (value) => round(value, 4)),
  });
  while (cache.size > MAX_PLAYER_REFERENCE_LAPS) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  writer.schedule();
};

/** Awaited by the shutdown coordinator so the last lap is not lost. */
export const flushPlayerReferenceLapsOnShutdown = () => writer.flush();

/** Testing helper: forget everything so each spec starts clean. */
export const __resetForTests = (): void => {
  writer.cancel();
  cache.clear();
  loaded = false;
  writer = createWriter();
};
