import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type {
  WeatherForecastConfig,
  WeatherForecastNode,
  WeatherForecastSnapshot,
} from '@irdashies/types';
import { WeatherForecast } from './WeatherForecast';

const mocks = vi.hoisted(() => ({
  snapshot: undefined as unknown,
  config: {} as Record<string, unknown>,
  isDriving: true,
  isWatching: false,
  sessionVisible: true,
  displayUnits: 1 as number | undefined,
}));

vi.mock('@irdashies/context', () => ({
  useDashboard: () => ({
    currentDashboard: {
      widgets: [{ id: 'weatherforecast', config: mocks.config }],
    },
  }),
  sessionBarSelectors: { displayUnits: () => 1 },
  useSessionBarSelector: () => mocks.displayUnits,
  useWeatherForecastSnapshot: () => mocks.snapshot,
  useDrivingState: () => ({
    isDriving: mocks.isDriving,
    isWatching: mocks.isWatching,
  }),
  useSessionVisibility: () => mocks.sessionVisible,
}));

const node = (
  index: number,
  extra: Partial<WeatherForecastNode> = {}
): WeatherForecastNode => ({
  index,
  skyType: 1,
  airTempC: 18 - index,
  rainChance: 0,
  humidity: 0.6,
  windSpeedMs: 17,
  windDirectionRad: (7 * Math.PI) / 4,
  startsInMinutes: index * 3 - 3,
  startsAtTimeOfDay: 54_600 + index * 180,
  ...extra,
});

/** The recorded race at its first frame. */
const recorded = (
  extra: Partial<WeatherForecastSnapshot> = {}
): WeatherForecastSnapshot => ({
  available: true,
  now: {
    skyType: 0,
    airTempC: 17.2,
    rain: 0,
    airTempTrend: 0,
    rainTrend: 0,
  },
  nodes: [
    node(1, { airTempC: 17, startsInMinutes: 0, startsAtTimeOfDay: 54_780 }),
    node(2, { airTempC: 16, startsInMinutes: 3, startsAtTimeOfDay: 54_960 }),
    node(3, { airTempC: 16, startsInMinutes: 6, startsAtTimeOfDay: 55_140 }),
    node(4, {
      skyType: 2,
      airTempC: 16,
      startsInMinutes: 9,
      startsAtTimeOfDay: 55_320,
    }),
  ],
  lapLimited: false,
  sessionNum: 10,
  version: 1,
  ...extra,
});

const configure = (config: Partial<WeatherForecastConfig>) => {
  mocks.config = config as Record<string, unknown>;
};

/** The heading of each column, left to right. */
const headings = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('.grid > div')]
    .map((column) => column.firstElementChild?.textContent ?? '')
    .filter((text) => text !== '');

describe('WeatherForecast', () => {
  beforeEach(() => {
    mocks.snapshot = recorded();
    mocks.config = {};
    mocks.isDriving = true;
    mocks.isWatching = false;
    mocks.sessionVisible = true;
    mocks.displayUnits = 1;
  });

  it('draws now and the four coming points, each time marked as an estimate', () => {
    const { container } = render(<WeatherForecast />);

    expect(headings(container)).toEqual(['Now', '<1m', '~3m', '~6m', '~9m']);
    expect(screen.getAllByText('17°')).toHaveLength(2);
    expect(screen.getAllByText('16°')).toHaveLength(3);
    expect(screen.getByLabelText('Clear')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Light clouds')).toHaveLength(3);
    expect(screen.getByLabelText('Partially cloudy')).toBeInTheDocument();
  });

  it('writes the clock time a point starts at when asked, also as an estimate', () => {
    configure({ timeLabel: 'clock' });
    const { container } = render(<WeatherForecast />);

    expect(headings(container)).toEqual([
      'Now',
      '~15:13',
      '~15:16',
      '~15:19',
      '~15:22',
    ]);
  });

  it('writes a dash for the time in a race that ends on laps', () => {
    mocks.snapshot = recorded({
      lapLimited: true,
      nodes: [
        node(3, { startsInMinutes: null, startsAtTimeOfDay: null }),
        node(4, { startsInMinutes: null, startsAtTimeOfDay: null }),
      ],
    });
    const { container } = render(<WeatherForecast />);

    expect(headings(container)).toEqual(['Now', '--', '--']);
  });

  it('draws only "Now" before the forecast arrives', () => {
    mocks.snapshot = recorded({ available: false, nodes: [] });
    const { container } = render(<WeatherForecast />);

    expect(headings(container)).toEqual(['Now']);
  });

  it('keeps its shape with no snapshot at all', () => {
    mocks.snapshot = undefined;
    const { container } = render(<WeatherForecast />);

    expect(headings(container)).toEqual(['Now']);
    // No reading is a dash, not a zero.
    expect(screen.getByText('--')).toBeInTheDocument();
    expect(screen.getByLabelText('Unknown')).toBeInTheDocument();
  });

  it('holds the row at full width with dashes when empty columns are kept', () => {
    mocks.snapshot = recorded({
      nodes: [node(3, { startsInMinutes: 3 }), node(4, { startsInMinutes: 6 })],
    });
    configure({ hideEmptyColumns: false });
    const { container } = render(<WeatherForecast />);

    expect(headings(container)).toEqual(['Now', '~3m', '~6m', '--', '--']);
  });

  it('shows as many columns as asked for, soonest first', () => {
    configure({ nodes: 2 });
    const { container } = render(<WeatherForecast />);

    expect(headings(container)).toEqual(['Now', '<1m', '~3m']);
  });

  it('runs right to left, with "Now" last', () => {
    mocks.snapshot = recorded({
      nodes: [node(3, { startsInMinutes: 3 }), node(4, { startsInMinutes: 6 })],
    });
    configure({ reverse: true });
    const { container } = render(<WeatherForecast />);

    expect(headings(container)).toEqual(['~6m', '~3m', 'Now']);
    // Two empty cells lead, so the columns sit against the right edge.
    expect(
      container.querySelectorAll('.grid > [aria-hidden="true"]')
    ).toHaveLength(2);
  });

  it('leaves "Now" out when asked, and says so when nothing is left', () => {
    configure({ showNow: false });
    const { container, rerender } = render(<WeatherForecast />);
    expect(headings(container)).toEqual(['<1m', '~3m', '~6m', '~9m']);

    mocks.snapshot = recorded({ nodes: [] });
    rerender(<WeatherForecast />);
    expect(screen.getByText('No further forecast')).toBeInTheDocument();

    mocks.snapshot = recorded({ available: false, nodes: [] });
    rerender(<WeatherForecast />);
    expect(screen.getByText('No forecast')).toBeInTheDocument();
  });

  it('rings a wet point and not a dry one', () => {
    mocks.snapshot = recorded({
      nodes: [node(1), node(2, { skyType: 6, rainChance: 0.7 })],
    });
    const { container } = render(<WeatherForecast />);
    const columns = [...container.querySelectorAll('.grid > div')];

    expect(columns[1].className).not.toContain('ring-sky-400/60');
    expect(columns[2].className).toContain('ring-sky-400/60');
  });

  it('shows the trend arrows in "Now" only while a reading is on the move', () => {
    mocks.snapshot = recorded({
      now: {
        skyType: 5,
        airTempC: 17.2,
        rain: 0.05,
        airTempTrend: -1,
        rainTrend: 1,
      },
    });
    const { rerender } = render(<WeatherForecast />);

    expect(screen.getByLabelText('Temperature falling')).toBeInTheDocument();
    // More rain is the caution.
    expect(
      screen.getByLabelText('Rain rising').getAttribute('class')
    ).toContain('text-amber-300');

    configure({ trend: { enabled: false } });
    rerender(<WeatherForecast />);
    expect(screen.queryByLabelText('Temperature falling')).toBeNull();
    expect(screen.queryByLabelText('Rain rising')).toBeNull();
  });

  it('writes Fahrenheit when asked, and follows the sim on auto', () => {
    configure({ units: 'Imperial' });
    const { rerender } = render(<WeatherForecast />);
    expect(screen.getAllByText('63°')).toHaveLength(2);

    configure({ units: 'auto' });
    mocks.displayUnits = 0;
    rerender(<WeatherForecast />);
    expect(screen.getAllByText('63°')).toHaveLength(2);

    mocks.displayUnits = 1;
    rerender(<WeatherForecast />);
    expect(screen.getAllByText('17°')).toHaveLength(2);
  });

  it('adds the rain figure, humidity and wind when switched on', () => {
    mocks.snapshot = recorded({
      nodes: [node(1, { rainChance: 0.35, humidity: 0.6, windSpeedMs: 17 })],
    });
    configure({
      rainChance: { enabled: true, showValue: true },
      humidity: { enabled: true },
      wind: { enabled: true },
    });
    render(<WeatherForecast />);

    expect(screen.getByText('35%')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
    // 17 m/s, which the sim words as 61.2 km/h.
    expect(screen.getByText('61')).toBeInTheDocument();
  });

  it('drops the temperature and the rain bar when switched off', () => {
    configure({
      temperature: { enabled: false },
      rainChance: { enabled: false, showValue: false },
    });
    render(<WeatherForecast />);

    expect(screen.queryByText('17°')).toBeNull();
    expect(screen.queryByLabelText('Chance of rain')).toBeNull();
    expect(screen.queryByLabelText('Rain')).toBeNull();
  });

  it('is centred by its own margins, so that a box too short for it shows it from the top', () => {
    const { container, rerender } = render(<WeatherForecast />);
    // jsdom lays nothing out: what is checked is that nothing centres the
    // columns but margins, which give way where there is no room to share
    // out. The pictures of the page show the rest.
    const box = container.firstElementChild;
    expect(box).toHaveClass('flex', 'flex-col', 'h-full');
    expect(box?.className).not.toMatch(/justify-|items-center|place-/);
    // Nor has the box any padding above or below: that room is the
    // margins', so that columns as tall as the box are not pushed out of it.
    expect(box).toHaveClass('px-2');
    expect(box?.className).not.toMatch(/(^| )p[ytb]?-/);
    expect(screen.getByTestId('weather-forecast-columns')).toHaveClass(
      'my-auto'
    );

    configure({ showNow: false });
    mocks.snapshot = recorded({ available: false, nodes: [] });
    rerender(<WeatherForecast />);
    expect(screen.getByText('No forecast')).toHaveClass('my-auto');
  });

  describe('visibility', () => {
    it('is shown out of the car by default: a forecast is read in the garage', () => {
      mocks.isDriving = false;
      const { container } = render(<WeatherForecast />);

      expect(headings(container)).toHaveLength(5);
    });

    it('is hidden in a session it is switched off for', () => {
      mocks.sessionVisible = false;
      const { container } = render(<WeatherForecast />);

      expect(container.innerHTML).toBe('');
    });

    describe('set to show only when on track', () => {
      beforeEach(() => {
        configure({ showOnlyWhenOnTrack: true });
      });

      it('is shown at the wheel', () => {
        const { container } = render(<WeatherForecast />);
        expect(headings(container)).toHaveLength(5);
      });

      it('is shown while watching a car, as through a team-mate’s stint', () => {
        // The forecast is the session's, and as true from the monitor.
        mocks.isDriving = false;
        mocks.isWatching = true;
        const { container } = render(<WeatherForecast />);

        expect(headings(container)).toHaveLength(5);
      });

      it('is hidden while neither: in the garage, or in the menus', () => {
        mocks.isDriving = false;
        const { container } = render(<WeatherForecast />);

        expect(container.innerHTML).toBe('');
      });
    });
  });
});
