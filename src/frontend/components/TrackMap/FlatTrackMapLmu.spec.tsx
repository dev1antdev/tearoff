import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlatTrackMapWidgetSettings } from '@irdashies/types';
import { FlatTrackMapLmu } from './FlatTrackMapLmu';

vi.mock('./hooks/useTrackId');
vi.mock('./hooks/useDriverProgress');
vi.mock('./hooks/useFlatTrackMapSettings');
vi.mock('./hooks/useHighlightColor');
vi.mock('./hooks/useLearnedMapSectors');
vi.mock('@irdashies/domain/standings/useDriverLivePositions', () => ({
  useDriverLivePositions: vi.fn(() => ({})),
}));
vi.mock('@irdashies/context', () => ({
  trackStateSelectors: { carIdxOnPitRoad: 'carIdxOnPitRoad' },
  useDrivingState: vi.fn(),
  useSessionVisibility: vi.fn(),
  useTrackStateSelector: vi.fn(),
}));
const canvasProps = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('./FlatTrackMapCanvas', () => ({
  FlatTrackMapCanvas: (props: Record<string, unknown>) => {
    canvasProps.push(props);
    return <div>Flat Track Canvas</div>;
  },
}));

import {
  useDrivingState,
  useSessionVisibility,
  useTrackStateSelector,
} from '@irdashies/context';
import { useDriverLivePositions } from '@irdashies/domain';
import { useDriverProgress } from './hooks/useDriverProgress';
import { useFlatTrackMapSettings } from './hooks/useFlatTrackMapSettings';
import { useHighlightColor } from './hooks/useHighlightColor';
import { useLearnedMapSectors } from './hooks/useLearnedMapSectors';
import { useTrackId } from './hooks/useTrackId';

const PIT_ROAD = [false, true, false];
const YELLOW_IN_SECOND = [{ from: 0.39, to: 0.792 }];

const settings = (
  overrides: Partial<NonNullable<FlatTrackMapWidgetSettings['config']>> = {}
) =>
  ({
    showOnlyWhenOnTrack: false,
    displayMode: 'carNumber',
    ...overrides,
  }) as FlatTrackMapWidgetSettings['config'];

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

describe('FlatTrackMapLmu', () => {
  beforeEach(() => {
    canvasProps.length = 0;
    vi.mocked(useTrackId).mockReturnValue(1_694_510_461);
    vi.mocked(useDriverProgress).mockReturnValue({
      drivers: [],
      identities: [],
    });
    vi.mocked(useFlatTrackMapSettings).mockReturnValue(settings());
    vi.mocked(useHighlightColor).mockReturnValue(undefined);
    vi.mocked(useSessionVisibility).mockReturnValue(true);
    vi.mocked(useDrivingState).mockReturnValue(driving());
    vi.mocked(useTrackStateSelector).mockReturnValue(PIT_ROAD);
    vi.mocked(useLearnedMapSectors).mockReturnValue({
      sectors: undefined,
      yellowSpans: [],
    });
  });
  afterEach(() => cleanup());

  it('lays the lap out without asking for a map of the circuit', () => {
    render(<FlatTrackMapLmu />);

    // A straight line needs no outline: a circuit with none is drawn too.
    expect(screen.getByText('Flat Track Canvas')).toBeTruthy();
    expect(lastCanvas().trackDrawing).toBeUndefined();
  });

  it('greys the cars in the pit lane, which the sim names', () => {
    render(<FlatTrackMapLmu />);

    expect(lastCanvas().carIdxIsOnPitRoad).toBe(PIT_ROAD);
  });

  it('paints the sector under yellow once its place is known', () => {
    vi.mocked(useLearnedMapSectors).mockReturnValue({
      sectors: [],
      yellowSpans: YELLOW_IN_SECOND,
    });
    render(<FlatTrackMapLmu />);

    expect(lastCanvas().yellowSpans).toBe(YELLOW_IN_SECOND);
  });

  it('shows nothing while no session names a track', () => {
    vi.mocked(useTrackId).mockReturnValue(undefined);
    const { container } = render(<FlatTrackMapLmu />);

    expect(container.firstChild).toBeNull();
  });

  describe('show only when on track', () => {
    beforeEach(() => {
      vi.mocked(useFlatTrackMapSettings).mockReturnValue(
        settings({ showOnlyWhenOnTrack: true, displayMode: 'livePosition' })
      );
    });

    it('hides the map out of the car, and asks nothing of the channels', () => {
      vi.mocked(useDrivingState).mockReturnValue(driving({ isDriving: false }));
      const { container } = render(<FlatTrackMapLmu />);

      expect(container.firstChild).toBeNull();
      expect(useLearnedMapSectors).toHaveBeenLastCalledWith(false);
      expect(useDriverLivePositions).toHaveBeenLastCalledWith({
        enabled: false,
      });
      expect(vi.mocked(useTrackStateSelector).mock.lastCall?.[1]).toMatchObject(
        { enabled: false }
      );
    });

    it('keeps it up through a team-mate’s stint, or with the camera on a car', () => {
      vi.mocked(useDrivingState).mockReturnValue(
        driving({ isDriving: false, isWatching: true })
      );
      render(<FlatTrackMapLmu />);

      expect(screen.getByText('Flat Track Canvas')).toBeTruthy();
      expect(useDriverLivePositions).toHaveBeenLastCalledWith({
        enabled: true,
      });
    });
  });

  it('hides in a session type the widget is switched off for', () => {
    vi.mocked(useSessionVisibility).mockReturnValue(false);
    const { container } = render(<FlatTrackMapLmu />);

    expect(container.firstChild).toBeNull();
  });

  it('caps redraws only when docked in the Gantry', () => {
    render(<FlatTrackMapLmu />);
    render(<FlatTrackMapLmu embedded />);

    expect(canvasProps[0].maxFps).toBeUndefined();
    expect(canvasProps[1].maxFps).toBe(30);
  });
});
