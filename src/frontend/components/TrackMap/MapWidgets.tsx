import { useTrackMapSource } from '@irdashies/domain/track';
import { FlatTrackMap } from './FlatTrackMap';
import { FlatTrackMapLmu } from './FlatTrackMapLmu';
import { TrackMap } from './TrackMap';
import { TrackMapLmu } from './TrackMapLmu';

interface MapWidgetProps {
  /** Docked in the Gantry rather than a window of its own. */
  embedded?: boolean;
}

/**
 * The two maps of the whole circuit as the overlay mounts them.
 *
 * This is where it is decided which sim's map is drawn, once for each, by
 * `useTrackMapSource`: a session that carries its own outline, or belongs to
 * the sim that would (Le Mans Ultimate), gets the map made of that outline
 * and of what that sim publishes; any other gets the map made of the drawing
 * shipped for its track id, which is the map iRacing has always had and is
 * left exactly as it was. Below this point nothing asks which sim is running:
 * the canvases are given a track, cars and stretches to colour.
 */
export const TrackMapWidget = ({ embedded }: MapWidgetProps) => {
  const source = useTrackMapSource();
  if (source.kind === 'drawing') return <TrackMap embedded={embedded} />;
  return (
    <TrackMapLmu
      embedded={embedded}
      drawing={source.kind === 'outline' ? source.drawing : null}
    />
  );
};

export const FlatTrackMapWidget = ({ embedded }: MapWidgetProps) => {
  const source = useTrackMapSource();
  return source.kind === 'drawing' ? (
    <FlatTrackMap embedded={embedded} />
  ) : (
    <FlatTrackMapLmu embedded={embedded} />
  );
};
