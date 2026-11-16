import { shallow } from 'zustand/shallow';
import { useDriverProgress } from './hooks/useDriverProgress';
import { useFlatTrackMapSettings } from './hooks/useFlatTrackMapSettings';
import { useHighlightColor } from './hooks/useHighlightColor';
import { useLearnedMapSectors } from './hooks/useLearnedMapSectors';
import { useTrackId } from './hooks/useTrackId';
import { FlatTrackMapView } from './FlatTrackMapView';
import {
  trackStateSelectors,
  useDrivingState,
  useSessionVisibility,
  useTrackStateSelector,
} from '@irdashies/context';
import { useDriverLivePositions } from '@irdashies/domain';

/**
 * The Flat Track Map under Le Mans Ultimate. `FlatTrackMapWidget` decides
 * when this is the one mounted.
 *
 * The lap is a straight line whatever the circuit, so nothing is drawn from
 * the session's outline and a circuit that has none yet is shown like any
 * other. Cars are placed by lap fraction and coloured by class as under
 * iRacing; the marked car is the one the overlays are about, which is the
 * user's own entry also while a team-mate drives it.
 *
 * Beyond that it shows what Le Mans Ultimate publishes and the iRacing
 * widget does not draw: cars in the pit lane greyed and lettered P, as on
 * the Track Map, and the sector under a yellow flag once the track profile
 * has learned where the sectors start. "Show only when on track" keeps it up
 * while a car is being watched.
 */
export const FlatTrackMapLmu = ({
  embedded = false,
}: {
  embedded?: boolean;
}) => {
  const trackId = useTrackId();
  const { drivers } = useDriverProgress();
  const settings = useFlatTrackMapSettings();
  const highlightColor = useHighlightColor();
  const { isDriving, isWatching } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings?.sessionVisibility);
  const visible =
    isSessionVisible &&
    !(settings?.showOnlyWhenOnTrack && !(isDriving || isWatching));
  const driverLivePositions = useDriverLivePositions({
    enabled:
      visible && (settings?.displayMode ?? 'carNumber') === 'livePosition',
  });
  const carIdxIsOnPitRoad = useTrackStateSelector(
    trackStateSelectors.carIdxOnPitRoad,
    { equality: shallow, enabled: visible }
  );
  const { yellowSpans } = useLearnedMapSectors(visible);

  // No session names a track yet: there is no lap to lay out.
  if (!visible || trackId === undefined) return <></>;

  return (
    <FlatTrackMapView
      settings={settings}
      embedded={embedded}
      drivers={drivers}
      highlightColor={highlightColor}
      driverLivePositions={driverLivePositions}
      carIdxIsOnPitRoad={carIdxIsOnPitRoad}
      yellowSpans={yellowSpans}
    />
  );
};
