import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackDrawing } from '@irdashies/domain/track';
import type { TrackMapWidgetSettings } from '@irdashies/types';
import { NO_OUTLINE_MESSAGE, TrackMapLmu } from './TrackMapLmu';

vi.mock('./hooks/useTrackId');
vi.mock('./hooks/useDriverProgress');
vi.mock('./hooks/useTrackMapSettings');
vi.mock('./hooks/useHighlightColor');
vi.mock('./hooks/useLearnedMapSectors');
vi.mock('./hooks/useGhostSectorColors', () => ({
  useGhostSectorColors: vi.fn(() => null),
}));
vi.mock('./hooks/usePlayerIconImage', () => ({
  usePlayerIconImage: vi.fn(() => null),
}));
vi.mock('@irdashies/domain/standings/useDriverLivePositions', () => ({
  useDriverLivePositions: vi.fn(() => ({})),
}));
vi.mock('@irdashies/context', () => ({
  useDrivingState: vi.fn(),
  useSessionVisibility: vi.fn(),
  useSectorColors: vi.fn(() => ['purple', 'default', 'red']),
  useSectorTimingStore: vi.fn(() => 1),
}));
const canvasProps = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('./TrackCanvas', () => ({
  TrackCanvas: (props: Record<string, unknown>) => {
    canvasProps.push(props);
    return <div>Track Canvas</div>;
  },
}));

import { useDrivingState, useSessionVisibility } from '@irdashies/context';
import { useDriverProgress } from './hooks/useDriverProgress';
import { useHighlightColor } from './hooks/useHighlightColor';
import { useLearnedMapSectors } from './hooks/useLearnedMapSectors';
import { useTrackId } from './hooks/useTrackId';
import { useTrackMapSettings } from './hooks/useTrackMapSettings';

const TRACK_ID = 1_694_510_461;

const drawing: TrackDrawing = {
  active: {
    inside: 'M0,0 L100,0 L100,100 L0,100 Z',
    outside: 'M0,0 L100,0 L100,100 L0,100 Z',
    trackPathPoints: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 0 },
    ],
    totalLength: 4,
  },
  startFinish: {
    line: 'M0,-30 L0,30',
    point: { x: 0, y: 0, length: 0 },
    direction: 'anticlockwise',
  },
};

const SECTORS = [
  { SectorNum: 0, SectorStartPct: 0 },
  { SectorNum: 1, SectorStartPct: 0.39 },
  { SectorNum: 2, SectorStartPct: 0.792 },
];
const YELLOW_IN_SECOND = [{ from: 0.39, to: 0.792 }];

const settings = (
  overrides: Partial<TrackMapWidgetSettings['config']> = {}
): TrackMapWidgetSettings['config'] =>
  ({
    showOnlyWhenOnTrack: false,
    sectorColoring: { enabled: false },
    ...overrides,
  }) as TrackMapWidgetSettings['config'];

const driving = (
  state: Partial<ReturnType<typeof useDrivingState>> = {}
): ReturnType<typeof useDrivingState> => ({
  isDriving: true,
  isWatching: false,
  isWatchingOwnCar: false,
  isWatchingOtherCar: false,
  ...state,
});

const lastCanvas = () => canvasProps.at(-1) ?? {};

describe('TrackMapLmu', () => {
  beforeEach(() => {
    canvasProps.length = 0;
    vi.mocked(useTrackId).mockReturnValue(TRACK_ID);
    vi.mocked(useDriverProgress).mockReturnValue({
      drivers: [],
      identities: [],
    });
    vi.mocked(useTrackMapSettings).mockReturnValue(settings());
    vi.mocked(useHighlightColor).mockReturnValue(undefined);
    vi.mocked(useSessionVisibility).mockReturnValue(true);
    vi.mocked(useDrivingState).mockReturnValue(driving());
    vi.mocked(useLearnedMapSectors).mockReturnValue({
      sectors: SECTORS,
      yellowSpans: [],
    });
  });
  afterEach(() => cleanup());

  it('draws from the outline it is handed, not from a drawing for the track id', () => {
    render(<TrackMapLmu drawing={drawing} />);

    expect(screen.getByText('Track Canvas')).toBeTruthy();
    expect(lastCanvas().trackDrawing).toBe(drawing);
    expect(lastCanvas().trackId).toBe(TRACK_ID);
  });

  it('says so, in one sentence, for a circuit with no outline yet', () => {
    render(<TrackMapLmu drawing={null} />);

    expect(screen.getByText(NO_OUTLINE_MESSAGE)).toBeTruthy();
    expect(screen.queryByText('Track Canvas')).toBeNull();
  });

  it('shows nothing while no session names a track', () => {
    vi.mocked(useTrackId).mockReturnValue(undefined);
    const { container } = render(<TrackMapLmu drawing={null} />);

    // Not the sentence about the map: there is no circuit to say it of.
    expect(container.firstChild).toBeNull();
  });

  describe('sectors', () => {
    it('are left off the road while Sector Colors is switched off', () => {
      render(<TrackMapLmu drawing={drawing} />);

      expect(lastCanvas().sectors).toBeUndefined();
      expect(lastCanvas().sectorColors).toBeUndefined();
      expect(lastCanvas().currentSectorIdx).toBeUndefined();
    });

    it('are drawn where the profile learned them, with the colours of the sim-timed sectors', () => {
      vi.mocked(useTrackMapSettings).mockReturnValue(
        settings({ sectorColoring: { enabled: true } })
      );
      render(<TrackMapLmu drawing={drawing} />);

      expect(lastCanvas().sectors).toBe(SECTORS);
      expect(lastCanvas().sectorColors).toEqual(['purple', 'default', 'red']);
      expect(lastCanvas().currentSectorIdx).toBe(1);
    });

    it('are not drawn at all until they have been learned, whatever the setting', () => {
      vi.mocked(useTrackMapSettings).mockReturnValue(
        settings({ sectorColoring: { enabled: true } })
      );
      vi.mocked(useLearnedMapSectors).mockReturnValue({
        sectors: undefined,
        yellowSpans: [],
      });
      render(<TrackMapLmu drawing={drawing} />);

      // No ticks at even thirds, and no colour over a stretch that is not
      // the sector it was set in.
      expect(lastCanvas().sectors).toBeUndefined();
      expect(lastCanvas().sectorColors).toBeUndefined();
      expect(lastCanvas().currentSectorIdx).toBeUndefined();
    });
  });

  describe('a sector under yellow', () => {
    it('is painted whether or not Sector Colors is switched on', () => {
      vi.mocked(useLearnedMapSectors).mockReturnValue({
        sectors: SECTORS,
        yellowSpans: YELLOW_IN_SECOND,
      });
      render(<TrackMapLmu drawing={drawing} />);

      expect(lastCanvas().yellowSpans).toBe(YELLOW_IN_SECOND);
      expect(lastCanvas().sectors).toBeUndefined();
    });

    it('keeps its identity across position updates, so the track is not redrawn', () => {
      vi.mocked(useLearnedMapSectors).mockReturnValue({
        sectors: SECTORS,
        yellowSpans: YELLOW_IN_SECOND,
      });
      vi.mocked(useTrackMapSettings).mockReturnValue(
        settings({ sectorColoring: { enabled: true } })
      );
      const view = render(<TrackMapLmu drawing={drawing} />);
      vi.mocked(useDriverProgress).mockReturnValue({
        drivers: [],
        identities: [],
      });
      view.rerender(<TrackMapLmu drawing={drawing} />);

      expect(canvasProps).toHaveLength(2);
      expect(canvasProps[1].yellowSpans).toBe(canvasProps[0].yellowSpans);
      expect(canvasProps[1].sectors).toBe(canvasProps[0].sectors);
      expect(canvasProps[1].turnLabels).toBe(canvasProps[0].turnLabels);
    });
  });

  describe('show only when on track', () => {
    beforeEach(() => {
      vi.mocked(useTrackMapSettings).mockReturnValue(
        settings({ showOnlyWhenOnTrack: true })
      );
    });

    it('hides the map out of the car', () => {
      vi.mocked(useDrivingState).mockReturnValue(driving({ isDriving: false }));
      const { container } = render(<TrackMapLmu drawing={drawing} />);

      expect(container.firstChild).toBeNull();
      // And nothing is asked of the channels for a map nobody sees.
      expect(useLearnedMapSectors).toHaveBeenLastCalledWith(false);
    });

    it('keeps it up through a team-mate’s stint, or with the camera on a car', () => {
      vi.mocked(useDrivingState).mockReturnValue(
        driving({ isDriving: false, isWatching: true })
      );
      render(<TrackMapLmu drawing={drawing} />);

      expect(screen.getByText('Track Canvas')).toBeTruthy();
      expect(useLearnedMapSectors).toHaveBeenLastCalledWith(true);
    });

    it('hides the sentence about a missing map too', () => {
      vi.mocked(useDrivingState).mockReturnValue(driving({ isDriving: false }));
      const { container } = render(<TrackMapLmu drawing={null} />);

      expect(container.firstChild).toBeNull();
    });
  });

  it('hides in a session type the widget is switched off for', () => {
    vi.mocked(useSessionVisibility).mockReturnValue(false);
    const { container } = render(<TrackMapLmu drawing={drawing} />);

    expect(container.firstChild).toBeNull();
  });

  it('caps redraws only when docked in the Gantry', () => {
    render(<TrackMapLmu drawing={drawing} />);
    render(<TrackMapLmu drawing={drawing} embedded />);

    expect(canvasProps[0].maxFps).toBeUndefined();
    expect(canvasProps[1].maxFps).toBe(30);
  });
});
