import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ActiveSimulator } from '@irdashies/types';
import { Weather } from './Weather';

const mocks = vi.hoisted(() => ({
  simulator: null as ActiveSimulator | null,
  isOnTrack: true,
  isWatching: false,
  showOnlyWhenOnTrack: undefined as boolean | undefined,
}));

vi.mock('@irdashies/context', () => ({
  useDashboard: () => ({
    isDemoMode: false,
    currentDashboard:
      mocks.showOnlyWhenOnTrack === undefined
        ? undefined
        : {
            widgets: [
              {
                id: 'weather',
                config: { showOnlyWhenOnTrack: mocks.showOnlyWhenOnTrack },
              },
            ],
          },
  }),
  sessionBarSelectors: { displayUnits: () => 1 },
  trackStateSelectors: { isOnTrack: () => true },
  useSessionBarSelector: () => undefined,
  useTrackStateSelector: () => mocks.isOnTrack,
  useDrivingState: () => ({
    isDriving: mocks.isOnTrack,
    isWatching: mocks.isWatching,
  }),
  useSessionVisibility: () => true,
  useThrottledWeather: () => ({
    trackMoisture: 1,
    windYaw: 0,
    windDirection: 0,
    windVelocity: 0,
    humidity: undefined,
    precipitation: 0,
  }),
  useActiveSimulator: () => mocks.simulator,
}));

vi.mock('@irdashies/domain/weather/useTrackRubberedState', () => ({
  useTrackRubberedState: () => undefined,
}));

describe('Weather', () => {
  beforeEach(() => {
    mocks.simulator = null;
    mocks.isOnTrack = true;
    mocks.isWatching = false;
    mocks.showOnlyWhenOnTrack = undefined;
  });

  it('shows the wind cell under iRacing', () => {
    mocks.simulator = 'iracing';
    render(<Weather />);
    expect(screen.getByText('Wind')).toBeInTheDocument();
  });

  it('leaves the wind cell out under LMU, which simulates no wind', () => {
    mocks.simulator = 'lmu';
    render(<Weather />);
    expect(screen.queryByText('Wind')).not.toBeInTheDocument();
    // The rest of the widget is still there.
    expect(screen.getByText('Humidity')).toBeInTheDocument();
  });

  describe('set to show only when on track', () => {
    beforeEach(() => {
      mocks.simulator = 'lmu';
      mocks.showOnlyWhenOnTrack = true;
    });

    it('is shown at the wheel', () => {
      render(<Weather />);

      expect(screen.getByText('Humidity')).toBeInTheDocument();
    });

    it('is shown while watching a car, as through a team-mate’s stint', () => {
      // The weather is the session's, and the same from the monitor.
      mocks.isOnTrack = false;
      mocks.isWatching = true;
      render(<Weather />);

      expect(screen.getByText('Humidity')).toBeInTheDocument();
    });

    it('is hidden while neither: in the garage, or in the menus', () => {
      mocks.isOnTrack = false;
      const { container } = render(<Weather />);

      expect(container.innerHTML).toBe('');
    });

    it('is shown anywhere with the setting off', () => {
      mocks.isOnTrack = false;
      mocks.showOnlyWhenOnTrack = false;
      render(<Weather />);

      expect(screen.getByText('Humidity')).toBeInTheDocument();
    });
  });
});
