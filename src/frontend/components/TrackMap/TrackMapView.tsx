import type { Sector, TrackMapWidgetSettings } from '@irdashies/types';
import type { SectorColor } from '@irdashies/context';
import type { LapSpan, TrackDrawing } from '@irdashies/domain/track';
import {
  TrackCanvas,
  type DriverIdentity,
  type TrackDriver,
  type TurnLabels,
} from './TrackCanvas';

const debug = import.meta.env.DEV || import.meta.env.MODE === 'storybook';

/** Redraw rate for a map docked in the Gantry, which shares the GPU with the overlays. */
const EMBEDDED_MAX_FPS = 30;

export interface TrackMapViewProps {
  settings: TrackMapWidgetSettings['config'] | undefined;
  embedded: boolean;
  trackId: number;
  /** The drawing, where the caller holds it; else the one for `trackId`. */
  trackDrawing?: TrackDrawing | null;
  drivers: TrackDriver[];
  identities: DriverIdentity[];
  highlightColor: number | undefined;
  /**
   * Where the sectors start, or undefined where that is not known. Drawn,
   * with their colours, only while Sector Colors is switched on.
   */
  sectors: Sector[] | undefined;
  sectorColors: SectorColor[];
  currentSectorIdx: number;
  /** Stretches of the lap under a yellow flag, whatever the setting above. */
  yellowSpans?: readonly LapSpan[];
  turnLabels: TurnLabels;
  playerIconDataUrl: string | null;
  driverLivePositions: Record<number, number>;
}

/**
 * The Track Map's settings as the canvas takes them. One mapping for every
 * sim: what differs between them is where the track, the sectors and the
 * flags come from, which the caller has settled before it gets here.
 */
export const TrackMapView = ({
  settings,
  embedded,
  trackId,
  trackDrawing,
  drivers,
  identities,
  highlightColor,
  sectors,
  sectorColors,
  currentSectorIdx,
  yellowSpans,
  turnLabels,
  playerIconDataUrl,
  driverLivePositions,
}: TrackMapViewProps) => {
  // Sector Colors switched on, at a circuit whose sector starts are known.
  const drawnSectors = settings?.sectorColoring?.enabled ? sectors : undefined;

  return (
    <div className="w-full h-full">
      <TrackCanvas
        trackId={trackId}
        trackDrawing={trackDrawing}
        drivers={drivers}
        driverIdentities={identities}
        turnLabels={turnLabels}
        showCarNumbers={settings?.showCarNumbers ?? true}
        displayMode={settings?.displayMode ?? 'carNumber'}
        invertTrackColors={settings?.invertTrackColors ?? false}
        driverCircleSize={settings?.driverCircleSize ?? 40}
        playerCircleSize={settings?.playerCircleSize ?? 40}
        trackmapFontSize={settings?.trackmapFontSize ?? 100}
        trackLineWidth={settings?.trackLineWidth ?? 20}
        trackOutlineWidth={settings?.trackOutlineWidth ?? 40}
        highlightColor={
          settings?.useHighlightColor ? highlightColor : undefined
        }
        invertLeaderColor={settings?.invertLeaderColor ?? false}
        isMinimalTrack={settings?.styling?.isMinimalTrack ?? false}
        isMinimalCar={settings?.styling?.isMinimalCar ?? true}
        sectors={drawnSectors}
        sectorColors={drawnSectors ? sectorColors : undefined}
        currentSectorIdx={drawnSectors ? currentSectorIdx : undefined}
        yellowSpans={yellowSpans}
        playerIconDataUrl={playerIconDataUrl}
        driverLivePositions={driverLivePositions}
        debug={debug}
        maxFps={embedded ? EMBEDDED_MAX_FPS : undefined}
      />
    </div>
  );
};
