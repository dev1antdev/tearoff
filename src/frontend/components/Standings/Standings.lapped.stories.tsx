import type { ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  createMockBridgeWithConfig,
  lmuEnduranceGrid,
  sessionBarStorySnapshot,
  trackStateStorySnapshot,
  type StoryGrid,
} from '@irdashies/storybook';
import { DashboardProvider, useSessionStore } from '@irdashies/context';
import {
  getWidgetDefaultConfig,
  type DashboardBridge,
  type StandingsConfig,
} from '@irdashies/types';
import { Standings } from './Standings';

/**
 * The Standings two hours into a staged three-class endurance race under Le
 * Mans Ultimate: cars a lap and more down in every class, one car stopped at
 * its box, one retired, and three last laps the sim did not time.
 *
 * Staged because the recorded race has none of these; see
 * `.storybook/lmuEnduranceGrid.ts` for the cars.
 */
const DEFAULTS = getWidgetDefaultConfig('standings');

/** The whole field, with the columns that have nothing to show left out. */
const BASE: Partial<StandingsConfig> = {
  driverStandings: { ...DEFAULTS.driverStandings, showAll: true },
  countryFlags: { enabled: false },
  carManufacturer: { enabled: false, hideIfSingleMake: false },
  lmuBadge: { enabled: false },
  badge: { ...DEFAULTS.badge, enabled: false },
  compound: { enabled: false },
  headerBar: { ...DEFAULTS.headerBar, enabled: false },
  footerBar: { ...DEFAULTS.footerBar, enabled: false },
};

const story = (grid: StoryGrid, config: Partial<StandingsConfig>) => {
  const bridge: DashboardBridge = {
    ...createMockBridgeWithConfig({ standings: { ...BASE, ...config } }),
    getActiveSimulator: async () => 'lmu',
  };
  return {
    loaders: [
      async () => {
        useSessionStore.setState({ session: grid.session });
      },
    ],
    decorators: [
      (Story: ComponentType) => (
        <DashboardProvider bridge={bridge}>
          <div style={{ width: 620 }}>
            <Story />
          </div>
        </DashboardProvider>
      ),
      ChannelSnapshotDecorator({
        'lap-times.snapshot': {
          lapTimes: [],
          lapTimeHistory: [],
          sessionNum: null,
          version: 0,
        },
        'standings.snapshot': grid.standings,
        'track-state.snapshot': trackStateStorySnapshot,
        'session-bar.snapshot': sessionBarStorySnapshot,
      }),
    ],
  };
};

const meta: Meta<typeof Standings> = {
  component: Standings,
  title: 'widgets/Standings/Lapped cars',
};

export default meta;

type Story = StoryObj<typeof Standings>;

/**
 * The default for a new dashboard, with Gap and Interval switched on: a car
 * more than a lap behind reads in laps, cars on the same lap in seconds.
 * The last Hypercar is three laps behind its leader and two behind the car
 * ahead; the car in front of it is a lap behind the leader but still on the
 * lap of the car ahead, so its interval stays a time.
 */
export const LapsWhenLapped: Story = {
  ...story(lmuEnduranceGrid, {
    gap: { enabled: true, reference: 'classLeader', decimalPlaces: 1 },
    interval: { enabled: true, decimalPlaces: 1, displayMode: 'laps' },
  }),
};

/** The same race with Interval Display set to Time, as it was before. */
export const TimeWhenLapped: Story = {
  ...story(lmuEnduranceGrid, {
    gap: { enabled: true, reference: 'classLeader', decimalPlaces: 1 },
    interval: { enabled: true, decimalPlaces: 1, displayMode: 'time' },
  }),
};

/**
 * Gaps measured from the player's LMGT3: every prototype is laps up the
 * road and reads in laps, negative for ahead; the player's own class is
 * still on its lap and reads in seconds.
 */
export const LappedClassAgainstPlayer: Story = {
  ...story(lmuEnduranceGrid, {
    gap: { enabled: true, reference: 'player', decimalPlaces: 1 },
    interval: { enabled: false, decimalPlaces: 1, displayMode: 'laps' },
  }),
};

/**
 * Three last laps the sim gave no time, dimmed behind a warning mark: one
 * slow, one quicker than its class's fastest lap, neither coloured as a
 * best. Beside them a session-fastest lap in purple and a personal best in
 * green.
 */
export const UncountedLastLaps: Story = {
  ...story(lmuEnduranceGrid, {}),
};

/** The same laps with "Mark Laps That Did Not Count" switched off. */
export const UncountedLastLapsUnmarked: Story = {
  ...story(lmuEnduranceGrid, {
    lastTime: { enabled: true, timeFormat: 'full', markInvalid: false },
  }),
};
