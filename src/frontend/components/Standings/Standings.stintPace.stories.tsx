import type { ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  createMockBridgeWithConfig,
  sessionBarStorySnapshot,
  timingTowerRace,
} from '@irdashies/storybook';
import { DashboardProvider, useSessionStore } from '@irdashies/context';
import {
  getWidgetDefaultConfig,
  type DashboardBridge,
  type StandingsConfig,
} from '@irdashies/types';
import { Standings } from './Standings';

/**
 * The "vs stint" column of the overlay Standings, on the staged eight-hour
 * race of `.storybook/timingTowerStage.ts`: three and a half hours in, our
 * #77 fourth in LMGT3. The stints and their pace are written out there.
 *
 * Worth finding: #50 and #28, a few laps after a stop, and #23, at its box,
 * read `--`, having fewer than three clean laps in the stint; #33 and #77
 * are quicker than their stint before and slower than their driver before.
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
  stintPace: { enabled: true },
  // So the time columns can be told apart.
  stylingOptions: { columnHeaders: { enabled: true } },
};

const story = (
  config: Partial<StandingsConfig>,
  { compactMode = 'off' }: { compactMode?: 'off' | 'compact' } = {}
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
        useSessionStore.setState({ session: timingTowerRace.session });
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
        ...timingTowerRace.snapshots,
        'session-bar.snapshot': sessionBarStorySnapshot,
      }),
    ],
  };
};

const meta: Meta<typeof Standings> = {
  component: Standings,
  title: 'widgets/Standings/Stint pace',
};

export default meta;

type Story = StoryObj<typeof Standings>;

/** Against the stint before, the default. */
export const AgainstPreviousStint: Story = {
  ...story({ paceAgainst: 'stint' }),
};

/**
 * Against the most recent stint somebody else drove. A car whose only
 * earlier stints were its present driver's has nothing to show.
 */
export const AgainstPreviousDriver: Story = {
  ...story({ paceAgainst: 'driver' }),
};

/**
 * As the widget looks with its column headers off, which is how a new
 * dashboard has it: the signed figure after the times.
 */
export const WithoutColumnHeaders: Story = {
  ...story({
    paceAgainst: 'stint',
    stylingOptions: { columnHeaders: { enabled: false } },
  }),
};

/** Compact mode, where the column tightens with the rest of the row. */
export const Compact: Story = {
  ...story({ paceAgainst: 'stint' }, { compactMode: 'compact' }),
};

/**
 * The column switched off, as on a new dashboard: nothing of it is drawn,
 * and the race history is not read.
 */
export const ColumnOff: Story = {
  ...story({ stintPace: { enabled: false } }),
};
