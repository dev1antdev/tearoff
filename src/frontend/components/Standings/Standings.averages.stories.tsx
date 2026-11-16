import type { ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  createMockBridgeWithConfig,
  lmuEnduranceGrid,
  lmuEnduranceLapTimes,
  lmuEnduranceLapTimesWithoutClean,
  sessionBarStorySnapshot,
  trackStateStorySnapshot,
} from '@irdashies/storybook';
import { DashboardProvider, useSessionStore } from '@irdashies/context';
import {
  getWidgetDefaultConfig,
  type DashboardBridge,
  type LapTimesSnapshot,
  type StandingsConfig,
} from '@irdashies/types';
import { Standings } from './Standings';

/**
 * The Avg 5 and Avg 10 columns, on the staged three-class endurance grid of
 * `.storybook/lmuEnduranceGrid.ts`, fourteen laps after the app began
 * watching it. The laps come out of the real LapTimesProcessor, so which of
 * them are clean is its answer.
 *
 * Four cars are worth finding in every story:
 *
 * - #22 (LMP2, first) stopped four laps ago. Its in-lap and out-lap are two
 *   of its last five laps and of none of its clean ones.
 * - #183 (LMP2, last) is at its box: its last lap is the one into the pits.
 * - #311 (Hypercar, last) has eleven laps, four of them through the pits:
 *   ten laps, but not ten clean ones.
 * - #61 (LMGT3, last) retired with four laps seen: not enough for either.
 *
 * #15 (Hypercar) and #54 (LMGT3) each have a slow last lap the sim did not
 * count. Those are in the averages either way: the lap was driven.
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
  avgLast5: { enabled: true, timeFormat: 'full' },
  avgLast10: { enabled: true, timeFormat: 'full' },
  // So the four time columns can be told apart.
  stylingOptions: { columnHeaders: { enabled: true } },
};

const story = (
  config: Partial<StandingsConfig>,
  {
    lapTimes = lmuEnduranceLapTimes,
    compactMode = 'off',
  }: { lapTimes?: LapTimesSnapshot; compactMode?: 'off' | 'compact' } = {}
) => {
  const bridge: DashboardBridge = {
    ...createMockBridgeWithConfig(
      { standings: { ...BASE, ...config } },
      { compactMode }
    ),
    getActiveSimulator: async () => 'lmu',
  };
  return {
    loaders: [
      async () => {
        useSessionStore.setState({ session: lmuEnduranceGrid.session });
      },
    ],
    decorators: [
      (Story: ComponentType) => (
        <DashboardProvider bridge={bridge}>
          <div style={{ width: 720 }}>
            <Story />
          </div>
        </DashboardProvider>
      ),
      ChannelSnapshotDecorator({
        'lap-times.snapshot': lapTimes,
        'standings.snapshot': lmuEnduranceGrid.standings,
        'track-state.snapshot': trackStateStorySnapshot,
        'session-bar.snapshot': sessionBarStorySnapshot,
      }),
    ],
  };
};

const meta: Meta<typeof Standings> = {
  component: Standings,
  title: 'widgets/Standings/Lap averages',
};

export default meta;

type Story = StoryObj<typeof Standings>;

/**
 * Averages over clean laps, the default. #22's stop does not show in its
 * figures: they are the laps either side of it. #311 has an Avg 5 and no
 * Avg 10, being short of ten clean laps, and #61 has neither.
 */
export const CleanLaps: Story = {
  ...story({ averagesOver: 'clean' }),
};

/**
 * The same moment with "Averages over" set to All laps. #22's two averages
 * are now seconds slower than the cars around it, #183's Avg 5 carries its
 * lap into the pits, and #311 has an Avg 10 after all, a slow one.
 */
export const AllLaps: Story = {
  ...story({ averagesOver: 'all' }),
};

/**
 * Clean laps, as the widget looks with its column headers off, which is how
 * a new dashboard has it: four time columns, Best, Last, Avg 5 and Avg 10.
 */
export const WithoutColumnHeaders: Story = {
  ...story({
    averagesOver: 'clean',
    stylingOptions: { columnHeaders: { enabled: false } },
  }),
};

/** Each column in a format of its own, as Last and Best can be. */
export const OwnTimeFormats: Story = {
  ...story({
    averagesOver: 'clean',
    avgLast5: { enabled: true, timeFormat: 'mixed' },
    avgLast10: { enabled: true, timeFormat: 'seconds-full' },
  }),
};

/**
 * Clean laps asked of a source that publishes no clean history: dashes in
 * every row, never the average of all laps under the clean heading.
 */
export const NoCleanHistory: Story = {
  ...story(
    { averagesOver: 'clean' },
    { lapTimes: lmuEnduranceLapTimesWithoutClean }
  ),
};

/** Compact mode, where the two columns tighten with the rest of the row. */
export const Compact: Story = {
  ...story({ averagesOver: 'clean' }, { compactMode: 'compact' }),
};
