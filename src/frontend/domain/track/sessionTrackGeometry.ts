import { useMemo } from 'react';
import { useSessionStore, useTrackLength } from '@irdashies/context';
import type { LmuTrackMap } from '@irdashies/types';
import {
  buildTrackGeometry,
  type TrackGeometry,
  type TrackPathData,
} from './trackGeometry';
import { getTrackPathData } from './trackPaths';
import { useTrackDrawing } from './useTrackDrawing';

/**
 * The centreline of a Le Mans Ultimate map, in the shape the geometry builder
 * takes.
 *
 * An LMU map holds samples at even lap distance: sample `i` of `count` sits
 * `i / count` of the way round, so the stored line stops one sample short of
 * where it began. Repeating the first point closes it. Without that the last
 * stretch of every lap would be squeezed into the points before it and a car
 * crossing the line would jump the gap.
 */
export const lmuTrackPathData = (
  map: LmuTrackMap | null | undefined
): TrackPathData | null => {
  const points = map?.active?.trackPathPoints;
  if (!points || points.length < 3) return null;
  return {
    trackPathPoints: [...points, points[0]],
    totalLength: points.length,
    startFinishLength: 0,
    // Samples are stored in the order they are driven.
    direction: 'anticlockwise',
  };
};

/**
 * Smoothing for an LMU map, in metres.
 *
 * The map is a few hundred straight segments, each 7 m long on a short
 * circuit and 27 m at Le Mans. Zoomed in, the joints show as corners the road
 * does not have, so the window has to span a couple of segments rather than
 * the fixed width that suits a densely traced drawing.
 */
const lmuSmoothing = (trackLength: number, samples: number) =>
  Math.max(16, (trackLength / samples) * 2.5);

/**
 * A cheap fingerprint of an LMU map.
 *
 * The session is republished whenever a position or lap time moves, and every
 * publish carries a fresh copy of the same map. Selecting the map itself would
 * rebuild the geometry each time; selecting this string does it only when the
 * map really is a different one.
 */
const lmuMapSignature = (map: LmuTrackMap | undefined): string => {
  const points = map?.active?.trackPathPoints;
  if (!points || points.length === 0) return '';
  const first = points[0];
  const middle = points[Math.floor(points.length / 2)];
  const last = points[points.length - 1];
  return [
    points.length,
    first.x,
    first.y,
    middle.x,
    middle.y,
    last.x,
    last.y,
  ].join(',');
};

export interface SessionTrackGeometry {
  geometry: TrackGeometry | null;
  /** Where the line came from, or null when the track has no usable map. */
  source: 'lmu' | 'drawing' | null;
}

/**
 * The current track's centreline, from whichever source the running sim has.
 *
 * Le Mans Ultimate sends its map with the session: bundled for most circuits,
 * otherwise recorded from the first full lap driven. iRacing tracks come from
 * the drawings shipped with the app, looked up by track id.
 *
 * `enabled` false skips loading a drawing, for a widget that is hidden.
 */
export const useSessionTrackGeometry = (
  enabled = true
): SessionTrackGeometry => {
  const lmuSignature = useSessionStore((state) =>
    lmuMapSignature(state.session?.LmuTrackMap)
  );
  const trackId = useSessionStore(
    (state) => state.session?.WeekendInfo?.TrackID
  );
  const trackLength = useTrackLength();
  const hasLmuMap = lmuSignature !== '';
  const drawing = useTrackDrawing(enabled && !hasLmuMap ? trackId : undefined);

  return useMemo(() => {
    if (!(trackLength > 0)) return { geometry: null, source: null };
    if (hasLmuMap) {
      const map = useSessionStore.getState().session?.LmuTrackMap;
      const path = lmuTrackPathData(map);
      const geometry = path
        ? buildTrackGeometry(path, trackLength, {
            smoothing: lmuSmoothing(trackLength, path.totalLength),
          })
        : null;
      return { geometry, source: geometry ? 'lmu' : null };
    }
    const path = getTrackPathData(trackId, drawing);
    const geometry = path ? buildTrackGeometry(path, trackLength) : null;
    return { geometry, source: geometry ? 'drawing' : null };
    // The signature stands in for the map: see lmuMapSignature.
    // eslint-disable-next-line @eslint-react/exhaustive-deps
  }, [lmuSignature, hasLmuMap, trackId, trackLength, drawing]);
};
