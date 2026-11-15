import fsp from 'node:fs/promises';
import path from 'node:path';
import { normalizeTrackName } from './trackMap';

/**
 * The elevation a TinyPedal track map carries, for a track the user has
 * mapped there and not driven here yet.
 *
 * TinyPedal keeps one SVG per track with two polylines: `id="map"`, the
 * outline, which the minimap already reads, and `id="dist"`, pairs of
 * metres into the lap and the car's height at that point. This reads the
 * second. The height is the same world Y the app records itself, so an
 * imported profile and a recorded one are on one scale.
 *
 * Read without blocking: the folders are looked for on every drive letter,
 * and a drive that is slow to answer must not hold up anything else.
 */

/** Fewer pairs than this is not a lap. */
const MIN_PAIRS = 20;
/** A track map is a few hundred kilobytes. Anything far larger is not one. */
const MAX_FILE_BYTES = 8_000_000;

/**
 * The distance and height pairs of a TinyPedal track map, in lap order, or
 * null when the file has no `dist` polyline worth the name.
 */
export const parseTinyPedalElevation = (
  svg: string
): [number, number][] | null => {
  const points = svg.match(
    /<polyline\b[^>]*\bid=["']dist["'][^>]*\bpoints=["']([^"']+)["']/i
  )?.[1];
  if (!points) return null;
  const pairs = points
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(',').map(Number))
    .filter(
      (pair): pair is [number, number] =>
        pair.length === 2 && pair.every(Number.isFinite)
    );
  return pairs.length >= MIN_PAIRS ? pairs : null;
};

/**
 * Looks through TinyPedal's track map folders for a map of this track and
 * returns its elevation pairs, or null when there is none.
 */
export async function findTinyPedalElevation(
  trackName: string,
  directories: readonly string[]
): Promise<[number, number][] | null> {
  const wanted = normalizeTrackName(trackName);
  if (!wanted) return null;
  for (const directory of directories) {
    let fileNames: string[];
    try {
      fileNames = await fsp.readdir(directory);
    } catch {
      continue;
    }
    const fileName = fileNames.find(
      (name) =>
        path.extname(name).toLowerCase() === '.svg' &&
        normalizeTrackName(path.basename(name, path.extname(name))) === wanted
    );
    if (!fileName) continue;
    try {
      const filePath = path.join(directory, fileName);
      if ((await fsp.stat(filePath)).size > MAX_FILE_BYTES) continue;
      const pairs = parseTinyPedalElevation(
        await fsp.readFile(filePath, 'utf8')
      );
      if (pairs) return pairs;
    } catch {
      continue;
    }
  }
  return null;
}
