import { useTrackId } from './hooks/useTrackId';
import { useDriverProgress } from './hooks/useDriverProgress';
import { useTrackMapSettings } from './hooks/useTrackMapSettings';
import { useHighlightColor } from './hooks/useHighlightColor';
import { useGhostSectorColors } from './hooks/useGhostSectorColors';
import { useTrackMapDisplay } from './hooks/useTrackMapDisplay';
import { useLearnedMapSectors } from './hooks/useLearnedMapSectors';
import { MapNotice } from './MapNotice';
import { TrackMapView } from './TrackMapView';
import type { TrackDrawing } from '@irdashies/domain/track';
import {
  useDrivingState,
  useSessionVisibility,
  useSectorColors,
  useSectorTimingStore,
} from '@irdashies/context';

/** Shown in place of the circuit while the session has no outline of it. */
export const NO_OUTLINE_MESSAGE =
  'No map of this track yet: it is drawn from your first full lap.';

/**
 * The Track Map under Le Mans Ultimate, drawn from the outline the session
 * carries. `TrackMapWidget` decides when this is the one mounted, and hands
 * it that outline.
 *
 * The cars, the class colours, the car marked as the user's and the cars
 * greyed in the pit lane are found as under iRacing: from the lap fraction,
 * the session's driver list and the pit-road flags, all of which Le Mans
 * Ultimate publishes. The marked car is the one the overlays are about: the
 * user's own entry, also while a team-mate drives it, or the car the camera
 * is on.
 *
 * Three things are found differently here:
 *
 * - The sectors. The sim says where none of them starts, so they are drawn
 *   only once the track profile has learned that from a clean lap.
 * - The sector under a yellow flag, which the sim names and iRacing does not.
 * - Whether the user is on track. "Show only when on track" keeps the map up
 *   while a car is being watched, as for the minimap: a team-mate's stint is
 *   when a map of the whole circuit is looked at most.
 */
export const TrackMapLmu = ({
  embedded = false,
  drawing,
}: {
  embedded?: boolean;
  drawing: TrackDrawing | null;
}) => {
  const trackId = useTrackId();
  const { drivers, identities } = useDriverProgress();
  const settings = useTrackMapSettings();
  const highlightColor = useHighlightColor();
  const { isDriving, isWatching } = useDrivingState();
  const sessionSectorColors = useSectorColors();
  const ghostColors = useGhostSectorColors();
  const currentSectorIdx = useSectorTimingStore((s) => s.currentSectorIdx);
  const display = useTrackMapDisplay(settings);
  const isSessionVisible = useSessionVisibility(settings?.sessionVisibility);
  const visible =
    isSessionVisible &&
    !(settings?.showOnlyWhenOnTrack && !(isDriving || isWatching));
  const { sectors, yellowSpans } = useLearnedMapSectors(visible);

  // No session names a track yet: nothing to say about its map either.
  if (!visible || trackId === undefined) return <></>;

  if (!drawing) return <MapNotice>{NO_OUTLINE_MESSAGE}</MapNotice>;

  return (
    <TrackMapView
      settings={settings}
      embedded={embedded}
      trackId={trackId}
      trackDrawing={drawing}
      drivers={drivers}
      identities={identities}
      highlightColor={highlightColor}
      sectors={sectors}
      sectorColors={ghostColors ?? sessionSectorColors}
      currentSectorIdx={currentSectorIdx}
      yellowSpans={yellowSpans}
      {...display}
    />
  );
};
