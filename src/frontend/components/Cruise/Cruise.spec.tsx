import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useActiveSimulator,
  useCruiseSnapshot,
  useDashboard,
  useDrivingState,
  useSessionBarSelector,
  useSessionVisibility,
} from '@irdashies/context';
import type { CruiseConfig, CruiseSnapshot } from '@irdashies/types';
import { Cruise } from './Cruise';

vi.mock('@irdashies/context', () => ({
  sessionBarSelectors: { displayUnits: () => 1 },
  useActiveSimulator: vi.fn(),
  useCruiseSnapshot: vi.fn(),
  useDashboard: vi.fn(),
  useDrivingState: vi.fn(),
  useSessionBarSelector: vi.fn(),
  useSessionVisibility: vi.fn(),
}));

const reading = (extra: Partial<CruiseSnapshot> = {}): CruiseSnapshot => ({
  available: true,
  headingDeg: 45,
  driftDeg: 3.2,
  elevationM: 38,
  lapDistanceM: 2345,
  sessionMetres: 9816.6,
  sessionSeconds: 240,
  totalMetres: 1_234_560,
  totalSeconds: 12 * 3600 + 34 * 60 + 56,
  sessionNum: 0,
  version: 1,
  ...extra,
});

interface Scene {
  /** As saved: a config from an older build may lack whole groups. */
  config?: Partial<CruiseConfig>;
  isDriving?: boolean;
  isWatching?: boolean;
  sessionVisible?: boolean;
  displayUnits?: number;
  simulator?: 'iracing' | 'lmu' | null;
}

const show = (
  snapshot: CruiseSnapshot | undefined,
  {
    config = {},
    isDriving = true,
    isWatching = false,
    sessionVisible = true,
    displayUnits = 1,
    simulator = 'lmu',
  }: Scene = {}
) => {
  vi.mocked(useDashboard).mockReturnValue({
    currentDashboard: { widgets: [{ id: 'cruise', config }] },
  } as unknown as ReturnType<typeof useDashboard>);
  vi.mocked(useCruiseSnapshot).mockReturnValue(snapshot);
  vi.mocked(useDrivingState).mockReturnValue({
    isDriving,
    isWatching,
    isWatchingOwnCar: false,
    isWatchingOtherCar: isWatching,
  });
  vi.mocked(useSessionVisibility).mockReturnValue(sessionVisible);
  vi.mocked(useSessionBarSelector).mockReturnValue(displayUnits as never);
  vi.mocked(useActiveSimulator).mockReturnValue(simulator);
  return render(<Cruise />);
};

/** The cells as they read, in the order they are drawn. */
const cells = (): string[] =>
  screen
    .getAllByTitle(/.+/)
    .map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim());

describe('Cruise', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prints the five readings, each with its unit', () => {
    show(reading());

    expect(cells()).toEqual([
      'Compass heading045°NE',
      'Elevation38m',
      'Distance driven1234.6km',
      'Time on track12h 34m',
      'Distance into the lap2345m',
    ]);
  });

  it('prints feet and miles where the driver reads them', () => {
    show(reading(), { displayUnits: 0 });

    expect(cells()).toEqual([
      'Compass heading045°NE',
      'Elevation125ft',
      'Distance driven767.1mi',
      'Time on track12h 34m',
      'Distance into the lap7694ft',
    ]);
  });

  it('keeps to the units it is set to, whatever the sim says', () => {
    show(reading(), { displayUnits: 1, config: { units: 'Imperial' } });
    expect(cells()[1]).toBe('Elevation125ft');
  });

  it('shows this session only when set to', () => {
    show(reading(), {
      config: {
        odometer: { enabled: true, scope: 'session' },
        timeOnTrack: { enabled: true, scope: 'session' },
      },
    });

    expect(cells()[2]).toBe('Distance driven9.8km');
    expect(cells()[3]).toBe('Time on track4m 00s');
  });

  it('shows a height below the datum as it is', () => {
    show(reading({ elevationM: -15 }));

    expect(cells()[1]).toBe('Elevation-15m');
  });

  it('draws the cells in the order saved, and only those switched on', () => {
    show(reading(), {
      config: {
        displayOrder: ['lapDistance', 'compass', 'nonsense', 'odometer'],
        compass: { enabled: false, dial: false },
      },
    });

    // The two the saved order leaves out follow it.
    expect(cells().map((cell) => cell.split(/\d|-/)[0])).toEqual([
      'Distance into the lap',
      'Distance driven',
      'Elevation',
      'Time on track',
    ]);
  });

  it('draws no elevation cell under iRacing, which states no height', () => {
    show(reading({ elevationM: null }), { simulator: 'iracing' });

    expect(screen.queryByTitle('Elevation')).toBeNull();
    expect(cells()).toHaveLength(4);
  });

  describe('without a reading', () => {
    it('shows a dash in every cell out of the car', () => {
      show(reading({ available: false }));

      expect(cells()).toEqual([
        'Compass heading--',
        'Elevation--',
        'Distance driven--',
        'Time on track--',
        'Distance into the lap--',
      ]);
    });

    it('shows dashes before the channel has answered', () => {
      show(undefined);

      expect(cells().every((cell) => cell.endsWith('--'))).toBe(true);
    });

    it('shows a dash for the totals until the stored record is in', () => {
      show(reading({ totalMetres: null, totalSeconds: null }));

      expect(cells()).toEqual([
        'Compass heading045°NE',
        'Elevation38m',
        'Distance driven--',
        'Time on track--',
        'Distance into the lap2345m',
      ]);
    });

    it('shows a dash for a reading the sim does not give', () => {
      show(reading({ headingDeg: null, elevationM: null, lapDistanceM: null }));

      expect(cells()[0]).toBe('Compass heading--');
      expect(cells()[1]).toBe('Elevation--');
      expect(cells()[4]).toBe('Distance into the lap--');
    });
  });

  describe('the dial', () => {
    it('is left out unless switched on', () => {
      show(reading());

      expect(screen.queryByTestId('compass-dial')).toBeNull();
    });

    it('turns the rose against the heading and the needle against the drift', () => {
      show(reading(), { config: { compass: { enabled: true, dial: true } } });

      expect(screen.getByTestId('compass-rose').style.rotate).toBe('-45deg');
      // Nose to the right of the path: the car is going to the left of it.
      expect(screen.getByTestId('compass-needle').style.rotate).toBe('-3.2deg');
      expect(screen.getByTestId('compass-dial')).toHaveTextContent('3°');
    });

    it('turns the needle red beyond ten degrees', () => {
      show(reading({ driftDeg: -12.4 }), {
        config: { compass: { enabled: true, dial: true } },
      });

      const needle = screen.getByTestId('compass-needle').firstElementChild;
      expect(needle?.className).toContain('bg-red-400');
      expect(screen.getByTestId('compass-dial')).toHaveTextContent('12°');
    });

    it('keeps the needle amber up to ten degrees', () => {
      show(reading({ driftDeg: 10 }), {
        config: { compass: { enabled: true, dial: true } },
      });

      const needle = screen.getByTestId('compass-needle').firstElementChild;
      expect(needle?.className).toContain('bg-amber-300');
    });

    it('takes the short way round through north', () => {
      const dial = { config: { compass: { enabled: true, dial: true } } };
      const { rerender } = show(reading({ headingDeg: 350 }), dial);
      expect(screen.getByTestId('compass-rose').style.rotate).toBe('-350deg');

      vi.mocked(useCruiseSnapshot).mockReturnValue(
        reading({ headingDeg: 10, version: 2 })
      );
      rerender(<Cruise />);

      // Twenty degrees on, not three hundred and forty back.
      expect(screen.getByTestId('compass-rose').style.rotate).toBe('-370deg');
    });

    it('rests without a needle out of the car', () => {
      show(reading({ available: false }), {
        config: { compass: { enabled: true, dial: true } },
      });

      expect(screen.getByTestId('compass-rose').style.rotate).toBe('0deg');
      expect(screen.queryByTestId('compass-needle')).toBeNull();
      expect(screen.getByTestId('compass-dial')).toHaveTextContent('--');
    });

    it('stands alone when every cell is switched off', () => {
      show(reading(), {
        config: {
          compass: { enabled: false, dial: true },
          elevation: { enabled: false },
          odometer: { enabled: false, scope: 'allTime' },
          timeOnTrack: { enabled: false, scope: 'allTime' },
          lapDistance: { enabled: false },
        },
      });

      expect(screen.getByTestId('compass-dial')).toBeInTheDocument();
      expect(screen.queryAllByTitle(/.+/)).toHaveLength(0);
    });
  });

  describe('visibility', () => {
    it('stays out of the car by default, with dashes', () => {
      const { container } = show(reading({ available: false }), {
        isDriving: false,
      });

      expect(container).not.toBeEmptyDOMElement();
    });

    it('hides out of the car when set to show only on track', () => {
      const { container } = show(reading(), {
        config: { showOnlyWhenOnTrack: true },
        isDriving: false,
      });

      expect(container).toBeEmptyDOMElement();
      expect(vi.mocked(useCruiseSnapshot)).toHaveBeenCalledWith(false);
    });

    it('hides while a car is being watched: the figures are of your own driving', () => {
      const { container } = show(reading(), {
        config: { showOnlyWhenOnTrack: true },
        isDriving: false,
        isWatching: true,
      });

      expect(container).toBeEmptyDOMElement();
    });

    it('hides in a session it is switched off for', () => {
      const { container } = show(reading(), { sessionVisible: false });

      expect(container).toBeEmptyDOMElement();
    });
  });
});
