import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  TelemetryDecorator,
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
