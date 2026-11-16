import { useMemo } from 'react';
import { useSessionStore, useTrackLength } from '@irdashies/context';
import { lmuMapSignature, lmuTrackPathData } from './lmuTrackOutline';
import { buildTrackGeometry, type TrackGeometry } from './trackGeometry';
import { getTrackPathData } from './trackPaths';
import { useTrackDrawing } from './useTrackDrawing';

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
