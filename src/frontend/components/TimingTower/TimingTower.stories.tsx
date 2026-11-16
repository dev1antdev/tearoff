import type { ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  createMockBridgeWithConfig,
  PressButtons,
  singleClassGrid,
  standingsStorySnapshot,
  TelemetryDecorator,
  timingTowerGrid,
  timingTowerRace,
  trackStateStorySnapshot,
  type TimingTowerStage,
} from '@irdashies/storybook';
import { DashboardProvider, useSessionStore } from '@irdashies/context';
import type {
  ActiveSimulator,
  DashboardBridge,
  TimingTowerConfig,
} from '@irdashies/types';
import { TimingTower } from './TimingTower';

/**
 * The timing tower on the staged eight-hour race of
 * `.storybook/timingTowerStage.ts`: twenty-two cars in three classes, three
 * and a half hours in, our #77 fourth in LMGT3. The places, gaps, averages
 * and sector bests come out of the app's own processors; the stops, stints
 * and their pace are written out. Nothing here is a recording.
 *
 * Worth finding in every story: #77, ours, in amber; #23 in the pit lane,
 * #94 on its out-lap and #88 in its garage; #50 and #28, a few laps after a
 * stop, with no pace against the stint before yet; #10, nearly out of
 * energy on a mixed set of tyres; #54, whose last lap did not count.
 */

interface StoryOptions {
  stage?: TimingTowerStage;
  simulator?: ActiveSimulator;
  width?: number;
  height?: number;
  /** Buttons of the tower's header to press once it is drawn. */
  press?: readonly string[];
}

const story = (
  config: Partial<TimingTowerConfig> = {},
  {
    stage = timingTowerRace,
    simulator = 'lmu',
    width = 940,
    height = 800,
    press = [],
  }: StoryOptions = {}
) => {
  const bridge: DashboardBridge = {
    ...createMockBridgeWithConfig({ timingtower: config }),
    getActiveSimulator: async () => simulator,
  };
  return {
    loaders: [
      async () => {
        useSessionStore.setState({ session: stage.session });
      },
    ],
    decorators: [
      (Story: ComponentType) => (
        <DashboardProvider bridge={bridge}>
          <div style={{ width, height }}>
            <PressButtons labels={press}>
              <Story />
            </PressButtons>
          </div>
        </DashboardProvider>
      ),
      ChannelSnapshotDecorator(stage.snapshots),
    ],
  };
};

const meta: Meta<typeof TimingTower> = {
  component: TimingTower,
  title: 'widgets/TimingTower',
};

export default meta;

type Story = StoryObj<typeof TimingTower>;

/**
 * As it opens: on the class of our own car, LMGT3, in class order, with
 * every column. Gaps are to the class leader and positions are in class.
 */
export const OwnClass: Story = { ...story() };

/** The Hypercar tab. #94 is on its out-lap, one lap after its stop. */
export const Hypercar: Story = { ...story({}, { press: ['Hypercar'] }) };

/**
 * The LMP2 tab. These cars run on fuel, which the energy column marks with
 * a pump; #28 stopped two laps ago.
 */
export const Lmp2: Story = { ...story({}, { press: ['LMP2'] }) };

/**
 * The whole field in overall order, each number on its class colour.
 * Positions are overall, gaps are to the leader of the race and intervals
 * to the car one place ahead, whatever its class.
 */
export const AllClasses: Story = { ...story({}, { press: ['All'] }) };

/**
 * "Averages over" switched to all laps in the header: the cars that
 * stopped in the last ten laps now carry their stops in Avg 5 and Avg 10.
 */
export const AveragesOverAllLaps: Story = {
  ...story({}, { press: ['All laps'] }),
};

/**
 * "Pace against" switched to the previous driver. For #77, #46 and #85, in
 * the second half of a double stint, the figure changes: it is now against
 * the team-mate who drove before, not against their own first half. #27
 * has had one driver all race and reads nothing.
 */
export const PaceAgainstPreviousDriver: Story = {
  ...story({}, { press: ['Previous driver'] }),
};

/**
 * Both switches as a saved setting has them: the tower opens on all laps
 * and the previous driver without anything being pressed.
 */
export const SwitchesFromSettings: Story = {
  ...story({ averagesOver: 'all', paceAgainst: 'driver' }),
};

/**
 * Before anybody has completed a lap: the field on its way to the line.
 * Every time and every pace reads --, the sector squares are grey.
 */
export const BeforeTheFirstLap: Story = {
  ...story({}, { stage: timingTowerGrid }),
};

/**
 * The shape it has under iRacing, on the recorded iRacing session the
 * other stories use: no sector marks and no energy, since iRacing publishes
 * neither for other cars, and no team line where every team is its driver.
 */
export const IRacing: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: 940, height: 800 }}>
        <Story />
      </div>
    ),
    TelemetryDecorator(),
    ChannelSnapshotDecorator({
      'standings.snapshot': standingsStorySnapshot,
      'track-state.snapshot': trackStateStorySnapshot,
    }),
  ],
};

/**
 * A session of one class: nothing to choose between, so no tabs. The
 * header keeps its two switches and the count.
 */
export const OneClass: Story = {
  loaders: [
    async () => {
      useSessionStore.setState({ session: singleClassGrid.session });
    },
  ],
  decorators: [
    (Story) => (
      <DashboardProvider bridge={createMockBridgeWithConfig({})}>
        <div style={{ width: 940, height: 800 }}>
          <Story />
        </div>
      </DashboardProvider>
    ),
    ChannelSnapshotDecorator({
      'standings.snapshot': singleClassGrid.standings,
      'track-state.snapshot': trackStateStorySnapshot,
    }),
  ],
};

/**
 * With the team line off a row is one line high: the whole LMGT3 class
 * without scrolling.
 */
export const WithoutTeams: Story = {
  ...story(
    {
      driver: {
        enabled: true,
        nameFormat: 'name-surname',
        team: false,
        status: true,
      },
    },
    { height: 460 }
  ),
};

/**
 * A panel 700 wide: Stops, Int and Best are left out so that the rest fit
 * without scrolling sideways.
 */
export const Narrow: Story = { ...story({}, { width: 700 }) };

/**
 * A panel 560 wide, as on the Compact page: the place, the number, the
 * driver, the gap, the last lap and the three pace columns are what stay.
 */
export const Compact: Story = { ...story({}, { width: 560 }) };

/**
 * A short panel on the tab of the whole field: the list scrolls under the
 * header row, and has moved to keep our car, twelfth overall, in view.
 */
export const Scrolling: Story = {
  ...story({}, { height: 300, press: ['All'] }),
};

/** Only the pace columns, for a tower that is about nothing else. */
export const PaceColumnsOnly: Story = {
  ...story(
    {
      interval: { enabled: false },
      bestTime: { enabled: false },
      sectors: { enabled: false },
      pitStops: { enabled: false },
      stintLaps: { enabled: false },
      energy: { enabled: false },
      tyres: { enabled: false },
    },
    { width: 620 }
  ),
};
