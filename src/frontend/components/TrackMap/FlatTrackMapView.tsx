import type { FlatTrackMapWidgetSettings } from '@irdashies/types';
import type { LapSpan, TrackDrawing } from '@irdashies/domain/track';
import { FlatTrackMapCanvas } from './FlatTrackMapCanvas';
import type { TrackDriver } from './TrackCanvas';

/** Redraw rate for a map docked in the Gantry, which shares the GPU with the overlays. */
const EMBEDDED_MAX_FPS = 30;

export interface FlatTrackMapViewProps {
  settings: FlatTrackMapWidgetSettings['config'] | undefined;
  embedded: boolean;
  trackDrawing?: TrackDrawing;
  drivers: TrackDriver[];
  highlightColor: number | undefined;
  driverLivePositions: Record<number, number>;
  /** Which cars are on pit road, where the caller greys them. */
  carIdxIsOnPitRoad?: readonly boolean[];
  /** Stretches of the lap under a yellow flag. */
  yellowSpans?: readonly LapSpan[];
}

/**
 * The Flat Track Map's settings as the canvas takes them: one mapping for
 * every sim, as `TrackMapView` is for the Track Map.
 */
export const FlatTrackMapView = ({
  settings,
  embedded,
  trackDrawing,
  drivers,
  highlightColor,
  driverLivePositions,
  carIdxIsOnPitRoad,
  yellowSpans,
}: FlatTrackMapViewProps) => (
  <div className="w-full h-full">
    <FlatTrackMapCanvas
      trackDrawing={trackDrawing}
      drivers={drivers}
      highlightColor={settings?.useHighlightColor ? highlightColor : undefined}
      invertLeaderColor={settings?.invertLeaderColor ?? false}
      showCarNumbers={settings?.showCarNumbers ?? true}
      displayMode={settings?.displayMode ?? 'carNumber'}
      driverCircleSize={settings?.driverCircleSize ?? 40}
      playerCircleSize={settings?.playerCircleSize ?? 40}
      trackmapFontSize={settings?.trackmapFontSize ?? 100}
      trackLineWidth={settings?.trackLineWidth ?? 20}
      trackOutlineWidth={settings?.trackOutlineWidth ?? 40}
      invertTrackColors={settings?.invertTrackColors ?? false}
      driverLivePositions={driverLivePositions}
      carIdxIsOnPitRoad={carIdxIsOnPitRoad}
      yellowSpans={yellowSpans}
      maxFps={embedded ? EMBEDDED_MAX_FPS : undefined}
    />
  </div>
);
