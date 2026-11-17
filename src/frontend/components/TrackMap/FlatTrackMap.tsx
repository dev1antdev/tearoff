import { useDriverProgress } from './hooks/useDriverProgress';
import { useFlatTrackMapSettings } from './hooks/useFlatTrackMapSettings';
import { useHighlightColor } from './hooks/useHighlightColor';
import { useTrackId } from './hooks/useTrackId';
import { FlatTrackMapView } from './FlatTrackMapView';
import { useTrackDrawing } from '@irdashies/domain/track';
import {
  useSessionVisibility,
  useTrackStateSnapshot,
} from '@irdashies/context';
import { useDriverLivePositions } from '@irdashies/domain';

const debug = import.meta.env.DEV || import.meta.env.MODE === 'storybook';

/**
 * The Flat Track Map for a track with a drawing shipped for its id: an
 * iRacing track. `FlatTrackMapWidget` decides when this is the one mounted.
 */
export const FlatTrackMap = ({ embedded = false }: { embedded?: boolean }) => {
  const trackId = useTrackId();
  const { drivers: driversTrackData } = useDriverProgress();
  const settings = useFlatTrackMapSettings();
  const highlightColor = useHighlightColor();
  const trackState = useTrackStateSnapshot();
  const isOnTrack = trackState?.isOnTrack;
  // Cars in the pit lane are greyed and lettered P, as the Track Map draws
  // them from the same snapshot.
  const carIdxIsOnPitRoad = trackState?.carIdxOnPitRoad;
  const driverLivePositions = useDriverLivePositions({
    enabled: (settings?.displayMode ?? 'carNumber') === 'livePosition',
  });

  const sessionVisible = useSessionVisibility(settings?.sessionVisibility);
  const trackDrawing = useTrackDrawing(
    sessionVisible && (!settings?.showOnlyWhenOnTrack || isOnTrack)
      ? trackId
      : undefined
  );

  if (!sessionVisible) return <></>;

  // Hide if showOnlyWhenOnTrack is enabled and player is not on track
  if (settings?.showOnlyWhenOnTrack && !isOnTrack) {
    return <></>;
  }

  if (!trackId || !trackDrawing) {
    return debug ? (
      <div className="w-full h-full flex items-center justify-center text-white">
        <p>No track data available</p>
      </div>
    ) : (
      <></>
    );
  }

  return (
    <FlatTrackMapView
      settings={settings}
      embedded={embedded}
      trackDrawing={trackDrawing}
      drivers={driversTrackData}
      highlightColor={highlightColor}
      driverLivePositions={driverLivePositions}
      carIdxIsOnPitRoad={carIdxIsOnPitRoad}
    />
  );
};
