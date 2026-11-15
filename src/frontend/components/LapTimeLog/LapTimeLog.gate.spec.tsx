import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useDashboard,
  useDrivingState,
  useFocusCarIdx,
  useGeneralSettings,
  useSessionVisibility,
} from '@irdashies/context';
import { getWidgetDefaultConfig } from '@irdashies/types';
import { LapTimeLog } from './LapTimeLog';
import { useLapTimeLog } from './hooks/useLapTimeLog';

vi.mock('@irdashies/context', () => ({
  useDashboard: vi.fn(),
  useDrivingState: vi.fn(),
  useFocusCarIdx: vi.fn(),
  useGeneralSettings: vi.fn(),
  useSessionVisibility: vi.fn(),
}));

vi.mock('./hooks/useLapTimeLog', () => ({
  useLapTimeLog: vi.fn(),
}));

const defaults = getWidgetDefaultConfig('laptimelog');

/** Where the user is, as useDrivingState says it; nowhere unless told. */
const where = (
  state: Partial<ReturnType<typeof useDrivingState>> = {}
): ReturnType<typeof useDrivingState> => ({
  isDriving: false,
  isWatching: false,
  isWatchingOwnCar: false,
  isWatchingOtherCar: false,
  ...state,
});

/** The lap under way at 52.3 s, after a last lap of 1:44.530. */
const withSettings = (showOnlyWhenOnTrack: boolean) =>
  vi.mocked(useLapTimeLog).mockReturnValue({
    current: 52.3,
    lastlap: 104.53,
    bestlap: 104.054,
    alltimelap: 103.87,
    reference: 104.054,
    delta: 0.1,
    overall: 103.6,
    dirty: false,
    history: [],
    settings: { ...defaults, showOnlyWhenOnTrack },
  });

const currentLap = (container: HTMLElement) =>
  container.querySelector('#current-lap')?.textContent;

describe('LapTimeLog on and off the track', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useDashboard).mockReturnValue({
      isDemoMode: false,
    } as ReturnType<typeof useDashboard>);
    vi.mocked(useFocusCarIdx).mockReturnValue(0);
    vi.mocked(useGeneralSettings).mockReturnValue(undefined);
    vi.mocked(useSessionVisibility).mockReturnValue(true);
    withSettings(true);
  });

  it('times the lap while the user drives', () => {
    vi.mocked(useDrivingState).mockReturnValue(where({ isDriving: true }));

    expect(currentLap(render(<LapTimeLog />).container)).toBe('0:52.300');
  });

  it('is hidden out of the car, unless told to stay', () => {
    vi.mocked(useDrivingState).mockReturnValue(where());

    expect(render(<LapTimeLog />).container.firstChild).toBeNull();

    withSettings(false);
    const { container } = render(<LapTimeLog />);
    expect(container.firstChild).not.toBeNull();
    // No lap is being timed for anyone.
    expect(currentLap(container)).toBe('');
  });

  it('times a team-mate’s lap in the user’s own car', () => {
    vi.mocked(useDrivingState).mockReturnValue(
      where({ isWatching: true, isWatchingOwnCar: true })
    );

    const { container } = render(<LapTimeLog />);

    expect(currentLap(container)).toBe('0:52.300');
    expect(container.textContent).toContain('1:44.530');
  });

  it('stays hidden while the camera is on another car', () => {
    // The lap is still the team car's, which is not the car on screen.
    vi.mocked(useDrivingState).mockReturnValue(
      where({ isWatching: true, isWatchingOtherCar: true })
    );

    expect(render(<LapTimeLog />).container.firstChild).toBeNull();
  });

  it('times no lap over another car when told to stay on screen', () => {
    withSettings(false);
    vi.mocked(useDrivingState).mockReturnValue(
      where({ isWatching: true, isWatchingOtherCar: true })
    );

    expect(currentLap(render(<LapTimeLog />).container)).toBe('');
  });
});
