import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  TelemetryDecorator,
  emptyTrackProfileStorySnapshot,
} from '@irdashies/storybook';
import { getWidgetDefaultConfig } from '@irdashies/types';
import type { SessionBarSnapshot } from '@irdashies/types';
import { SessionBar } from './SessionBar';

const snapshot = (clock: Partial<SessionBarSnapshot>): SessionBarSnapshot => ({
  sessionName: 'Race',
  airTemp: 17,
  trackTemp: 41,
  trackWetness: 1,
  displayUnits: 1,
  brakeBiasIsClio: false,
  incidents: 0,
  // 15:12:19, the first frame of the recorded Le Mans Ultimate race.
  sessionTimeOfDay: 54_739.8,
  timeScale: 1,
  playerCarIdx: 0,
  playerClassified: true,
  playerOverallPosition: 1,
  playerClassPosition: 1,
  playerClassSize: 1,
  competitorCarIds: [],
  competitorPositions: [],
  lastLapTopSpeed: null,
  sessionBestTopSpeed: null,
  sessionNum: 0,
  version: 1,
  ...clock,
});

const withClock = (clock: Partial<SessionBarSnapshot>) => [
  TelemetryDecorator(),
  ChannelSnapshotDecorator({ 'session-bar.snapshot': snapshot(clock) }),
];

const footer = getWidgetDefaultConfig('standings').footerBar;

const bar = (
  options: Partial<(typeof footer)['sessionClockTime']> = {}
): typeof footer => ({
  ...footer,
  sessionClockTime: { enabled: true, ...options },
  displayOrder: ['sessionName', 'sessionClockTime', 'airTemperature'],
  sessionName: { enabled: true },
});

const meta = {
  component: SessionBar,
  title: 'widgets/Standings/components/SessionBar/Clock',
} satisfies Meta<typeof SessionBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** As before: the system's clock format, and nothing beside it in real time. */
export const RealTime: Story = {
  decorators: withClock({}),
  args: { settings: bar(), position: 'footer' },
};

/** A day running twice as fast as the session clock, on the 24-hour clock. */
export const Scaled: Story = {
  decorators: withClock({ timeScale: 2 }),
  args: { settings: bar({ format: '24h' }), position: 'footer' },
};

/** The fastest day there is, on the 12-hour clock. */
export const ScaledTwelveHour: Story = {
  decorators: withClock({ timeScale: 60, sessionTimeOfDay: 78_300 }),
  args: { settings: bar({ format: '12h' }), position: 'footer' },
};

/** Real time, with the scale always shown: "x1", muted. */
export const AlwaysShown: Story = {
  decorators: withClock({}),
  args: {
    settings: bar({ format: '24h', timeScale: 'always' }),
    position: 'footer',
  },
};

/** A time of day that stands still. */
export const StaticTimeOfDay: Story = {
  decorators: withClock({ timeScale: 0, sessionTimeOfDay: 43_200 }),
  args: { settings: bar({ format: '24h' }), position: 'footer' },
};

/** A scaled day with the scale switched off. */
export const ScaleHidden: Story = {
  decorators: withClock({ timeScale: 30 }),
  args: {
    settings: bar({ format: '24h', timeScale: 'never' }),
    position: 'footer',
  },
};

/** The first five seconds: the scale has not been measured yet. */
export const NotYetMeasured: Story = {
  decorators: withClock({ timeScale: undefined }),
  args: {
    settings: bar({ format: '24h', timeScale: 'always' }),
    position: 'footer',
  },
};

/** In the Information Bar. */
export const Standalone: Story = {
  decorators: withClock({ timeScale: 2 }),
  args: { settings: bar({ format: '24h' }), standalone: true },
};

/** Sunrise 06:12 and sunset 20:31, as a driver might enter them. */
const SUN_TIMES = { sunriseMinutes: 372, sunsetMinutes: 1231 };

/** The clock with the track's profile beside it, which holds the times. */
const withSun = (
  clock: Partial<SessionBarSnapshot>,
  sun: Partial<typeof SUN_TIMES> = SUN_TIMES
) => [
  TelemetryDecorator(),
  ChannelSnapshotDecorator({
    'session-bar.snapshot': snapshot(clock),
    'track-profile.snapshot': { ...emptyTrackProfileStorySnapshot, ...sun },
  }),
];

const countdown = bar({ format: '24h', sunPhase: true });

/** The afternoon of the recorded race: sunset is next, 5:18:41 away. */
export const TowardsSunset: Story = {
  decorators: withSun({}),
  args: { settings: countdown, position: 'footer' },
};

/** Half past four in the morning: sunrise is next, in blue. */
export const TowardsSunrise: Story = {
  decorators: withSun({ sessionTimeOfDay: 16_200 }),
  args: { settings: countdown, position: 'footer' },
};

/** Nine in the morning: midday, half-way from sunrise to sunset, is next. */
export const TowardsMidday: Story = {
  decorators: withSun({ sessionTimeOfDay: 32_400 }),
  args: { settings: countdown, position: 'footer' },
};

/** Ten at night: midnight, half-way from sunset to sunrise, is next. */
export const TowardsMidnight: Story = {
  decorators: withSun({ sessionTimeOfDay: 79_200 }),
  args: { settings: countdown, position: 'footer' },
};

/**
 * A day running twice as fast, counted in real time: 2:39:20, half of the
 * in-game time left to sunset.
 */
export const ScaledCountdown: Story = {
  decorators: withSun({ timeScale: 2 }),
  args: { settings: countdown, position: 'footer' },
};

/** The same day counted in in-game time: the whole 5:18:41. */
export const InGameTime: Story = {
  decorators: withSun({ timeScale: 2 }),
  args: {
    settings: bar({ format: '24h', sunPhase: true, sunPhaseInGameTime: true }),
    position: 'footer',
  },
};

/** No times entered for the track: the countdown is on and nothing is drawn. */
export const NoTimesStored: Story = {
  decorators: withSun({}, {}),
  args: { settings: countdown, position: 'footer' },
};

/** Only a sunrise entered: still nothing to count down to. */
export const OnlySunriseStored: Story = {
  decorators: withSun({}, { sunriseMinutes: 372 }),
  args: { settings: countdown, position: 'footer' },
};

/** The countdown in the Information Bar. */
export const StandaloneCountdown: Story = {
  decorators: withSun({ timeScale: 2 }),
  args: { settings: countdown, standalone: true },
};
