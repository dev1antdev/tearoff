import { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  TelemetryDecoratorWithConfig,
} from '@irdashies/storybook';
import type {
  WeatherForecastNode,
  WeatherForecastSnapshot,
} from '@irdashies/types';
import { WeatherForecast } from './WeatherForecast';

const node = (
  index: number,
  skyType: number,
  airTempC: number,
  rainChance: number,
  startsInMinutes: number | null,
  startsAtTimeOfDay: number | null,
  extra: Partial<WeatherForecastNode> = {}
): WeatherForecastNode => ({
  index,
  skyType,
  airTempC,
  rainChance,
  humidity: 0.5 + index * 0.04,
  windSpeedMs: 18 - index * 2,
  // North-west.
  windDirectionRad: (7 * Math.PI) / 4,
  startsInMinutes,
  startsAtTimeOfDay,
  ...extra,
});

const snapshot = (
  now: Partial<WeatherForecastSnapshot['now']>,
  nodes: WeatherForecastNode[],
  extra: Partial<WeatherForecastSnapshot> = {}
): WeatherForecastSnapshot => ({
  available: true,
  now: {
    skyType: 0,
    airTempC: 17.2,
    rain: 0,
    airTempTrend: 0,
    rainTrend: 0,
    ...now,
  },
  nodes,
  lapLimited: false,
  sessionNum: 10,
  version: 1,
  ...extra,
});

const story = (
  forecast: WeatherForecastSnapshot,
  config: Record<string, unknown> = {},
  size: { width: number; height: number } = { width: 300, height: 100 },
  // As a panel of the Pit Wall holds it: what does not fit scrolls.
  scrolls = false
) => ({
  decorators: [
    TelemetryDecoratorWithConfig('/test-data/1747384033336', {
      weatherforecast: config,
    }),
    ChannelSnapshotDecorator({ 'weather-forecast.snapshot': forecast }),
    // The widget fills its overlay window, so the story supplies one of the
    // default size rather than letting it span the page.
    (Story: React.ComponentType) => (
      <div style={size} className={scrolls ? 'overflow-auto' : undefined}>
        <Story />
      </div>
    ),
  ],
});

const meta: Meta<typeof WeatherForecast> = {
  component: WeatherForecast,
  title: 'widgets/WeatherForecast',
};

export default meta;

type Story = StoryObj<typeof WeatherForecast>;

/**
 * The recorded race, 140 s in: a clear sky that clouds over a little and
 * stays dry. The times carry a "~" because they are estimates.
 */
export const Dry: Story = {
  ...story(
    snapshot({ airTempTrend: -1 }, [
      node(1, 1, 17, 0, 0, 54_780),
      node(2, 1, 16, 0, 3, 54_960),
      node(3, 1, 16, 0, 6, 55_140),
      node(4, 2, 16, 0, 9, 55_320),
    ])
  ),
};

/**
 * An endurance race with rain on the way: the first wet column is ringed,
 * and it has started to spit.
 */
export const RainComing: Story = {
  ...story(
    snapshot({ skyType: 4, airTempC: 19.4, rain: 0.04, rainTrend: 1 }, [
      node(1, 4, 18, 0.35, 0, 62_100),
      node(2, 6, 17, 0.7, 72, 66_420),
      node(3, 9, 15, 0.95, 144, 70_740),
      node(4, 10, 14, 1, 216, 75_060),
    ])
  ),
};

/** Raining now and drying out: the rain is falling away, the air warming. */
export const DryingOut: Story = {
  ...story(
    snapshot(
      {
        skyType: 8,
        airTempC: 13.6,
        rain: 0.32,
        rainTrend: -1,
        airTempTrend: 1,
      },
      [
        node(1, 6, 14, 0.6, 9, 40_140),
        node(2, 4, 15, 0.3, 33, 41_580),
        node(3, 2, 17, 0.1, 57, 43_020),
        node(4, 0, 19, 0, 81, 44_460),
      ]
    )
  ),
};

/**
 * Before the sim has answered, or under a session with no forecast: the
 * weather as it is and nothing after it.
 */
export const NoForecast: Story = {
  ...story(snapshot({}, [], { available: false })),
};

/** The same, holding the row at its full width. */
export const NoForecastFullWidth: Story = {
  ...story(snapshot({}, [], { available: false }), {
    hideEmptyColumns: false,
  }),
};

/**
 * A race that ends on laps has no times: the points stay in order, with a
 * dash where the time would be.
 */
export const LapLimitedRace: Story = {
  ...story(
    snapshot(
      { skyType: 2, airTempC: 22.1 },
      [
        node(2, 3, 21, 0.1, null, null),
        node(3, 5, 19, 0.45, null, null),
        node(4, 7, 18, 0.8, null, null),
      ],
      { lapLimited: true }
    )
  ),
};

/** The in-game clock time each point starts at, in a race into the night. */
export const ClockTime: Story = {
  ...story(
    snapshot({ skyType: 1, airTempC: 21.3 }, [
      node(1, 2, 19, 0.05, 2, 82_800),
      node(2, 3, 16, 0.2, 14, 18_000),
      node(3, 4, 15, 0.4, 26, 39_600),
      node(4, 5, 18, 0.6, 38, 61_200),
    ]),
    { timeLabel: 'clock' }
  ),
};

/** Every row: the rain figure, humidity and the forecast's wind. */
export const AllRows: Story = {
  ...story(
    snapshot({ skyType: 4, airTempC: 19.4, rain: 0.04, rainTrend: 1 }, [
      node(1, 4, 18, 0.35, 0, 62_100),
      node(2, 6, 17, 0.7, 72, 66_420),
      node(3, 9, 15, 0.95, 144, 70_740),
      node(4, 10, 14, 1, 216, 75_060),
    ]),
    {
      rainChance: { enabled: true, showValue: true },
      humidity: { enabled: true },
      wind: { enabled: true },
    },
    { width: 320, height: 140 }
  ),
};

/**
 * In a box shorter than its columns, as a panel of the Pit Wall can be: it
 * starts at the top and the box scrolls down it. Centred there, it would be
 * cut at both ends, with its top out of reach.
 */
export const InABoxTooShortForIt: Story = {
  ...story(
    snapshot({ airTempTrend: -1 }, [
      node(1, 1, 17, 0, 0, 54_780),
      node(2, 1, 16, 0, 3, 54_960),
      node(3, 1, 16, 0, 6, 55_140),
      node(4, 2, 16, 0, 9, 55_320),
    ]),
    {},
    { width: 420, height: 62 },
    true
  ),
};

/** Late in the session: two points have begun and their columns are gone. */
export const LateInTheSession: Story = {
  ...story(
    snapshot({ skyType: 1, airTempC: 16.2 }, [
      node(3, 1, 16, 0, 3, 55_200),
      node(4, 2, 16, 0, 6, 55_440),
    ])
  ),
};

/** The same with empty columns kept, and right to left. */
export const RightToLeft: Story = {
  ...story(
    snapshot({ skyType: 1, airTempC: 16.2 }, [
      node(3, 1, 16, 0, 3, 55_200),
      node(4, 2, 16, 0, 6, 55_440),
    ]),
    { reverse: true, hideEmptyColumns: false }
  ),
};

/** Fahrenheit, two columns and no "Now". */
export const TwoColumnsImperial: Story = {
  ...story(
    snapshot({}, [
      node(1, 1, 17, 0, 12, 54_780),
      node(2, 5, 16, 0.4, 59, 55_020),
      node(3, 1, 16, 0, 84, 55_200),
    ]),
    { nodes: 2, showNow: false, units: 'Imperial' },
    { width: 160, height: 100 }
  ),
};

/** The sim publishes no sky at all: the unknown glyph. */
export const UnknownSky: Story = {
  ...story(
    snapshot({ skyType: -1, airTempC: null, rain: null }, [
      node(1, 11, 17, 0, 12, 54_780),
    ])
  ),
};
