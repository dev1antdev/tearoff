import { useTrackId } from './hooks/useTrackId';
import { useDriverProgress } from './hooks/useDriverProgress';
import { useTrackMapSettings } from './hooks/useTrackMapSettings';
import { useHighlightColor } from './hooks/useHighlightColor';
import { useGhostSectorColors } from './hooks/useGhostSectorColors';
import { useTrackMapDisplay } from './hooks/useTrackMapDisplay';
import { TrackMapView } from './TrackMapView';
import {
  useSessionVisibility,
  useTrackStateSnapshot,
  useSessionStore,
  useSectorColors,
  useSectorTimingStore,
} from '@irdashies/context';

const NO_SECTORS: never[] = [];

/**
 * The Track Map drawn from the drawing shipped for the session's track id:
 * an iRacing track. `TrackMapWidget` decides when this is the one mounted.
 */
export const TrackMap = ({ embedded = false }: { embedded?: boolean }) => {
  const trackId = useTrackId();
  const { drivers: driversTrackData, identities } = useDriverProgress();
  const settings = useTrackMapSettings();
  const highlightColor = useHighlightColor();
  const isOnTrack = useTrackStateSnapshot()?.isOnTrack;
  const sessionSectorColors = useSectorColors();
  const ghostColors = useGhostSectorColors();
  const sectorColors = ghostColors ?? sessionSectorColors;
  const sectors =
    useSessionStore((s) => s.session?.SplitTimeInfo?.Sectors) ?? NO_SECTORS;
  const currentSectorIdx = useSectorTimingStore((s) => s.currentSectorIdx);
  const display = useTrackMapDisplay(settings);

  if (!useSessionVisibility(settings?.sessionVisibility)) return <></>;

  // Hide if showOnlyWhenOnTrack is enabled and player is not on track
  if (settings?.showOnlyWhenOnTrack && !isOnTrack) {
    return <></>;
  }

  if (!trackId) return <></>;

  return (
    <TrackMapView
      settings={settings}
      embedded={embedded}
      trackId={trackId}
      drivers={driversTrackData}
      identities={identities}
      highlightColor={highlightColor}
      sectors={sectors}
      sectorColors={sectorColors}
      currentSectorIdx={currentSectorIdx}
      {...display}
    />
  );
};
