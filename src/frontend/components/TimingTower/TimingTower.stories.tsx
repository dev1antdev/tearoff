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
  timingTowerRaceIRacingTyres,
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
 *
 * And in the Tyres column of our own class, LMGT3, every state the laps on
 * a set and the tread have (written out in `.storybook/classTyresStage.ts`):
 * #33, seen to go on, with its estimate; #46, told from the length of a
 * stop, with a ?; #54 and #27, through a stop on the same set; #85, at
 * least so many, with a + and a <; #23 in its box and #88 in its garage,
 * at least none; #91 and #31 on hards and #10 with softs at the rear, which
 * our own car has not run, with no estimate; #77, ours, with the tread the
 * sim reads.
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
 * The Tyres column carries the laps on each set and the tread left.
 */
export const OwnClass: Story = { ...story() };

/**
 * The Tyres column with little else beside it, so that its states can be
 * read: bare laps for a set seen to go on, ? for one told from the length
 * of a stop, + for at least so many; ~ before an estimate of the tread, <
 * where the laps are only a floor, -- for a compound our own car has not
 * run, and no mark on our own car's real figure.
 */
export const TyresOfOurClass: Story = {
  ...story(
    {
      gap: { enabled: false },
      interval: { enabled: false },
      lastTime: { enabled: false },
      bestTime: { enabled: false },
      avgLast5: { enabled: false },
      avgLast10: { enabled: false },
      stintPace: { enabled: false },
      sectors: { enabled: false },
    },
    { width: 560, height: 560 }
  ),
};

/**
 * The laps and the tread switched off: the compound alone, as the column
 * was before it carried them. No race is recorded for it then.
 */
export const TyresCompoundOnly: Story = {
  ...story({ tyres: { enabled: true, set: false, changeSeconds: 0 } }),
};

/**
 * The laps on a set where the sim reads no tread to make a figure from, as
 * under iRacing: the column is narrower, and a set is either the one from
 * the start or at least as old as the laps since the last stop.
 */
export const TyresWithoutTread: Story = {
  ...story({}, { stage: timingTowerRaceIRacingTyres }),
};

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
 * to the car one place ahead, whatever its class. Only the cars of our own
 * class carry the laps on their tyres; the others show their compound.
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
 * A panel 900 wide: every column still fits, and the Tyres column has room
 * for the laps on each set but not for the tread, which goes first.
 */
export const TyresWithoutRoomForTheTread: Story = {
  ...story({}, { width: 900 }),
};

/**
 * A panel 700 wide: Stops, Int, Best and Sect are left out so that the
 * rest fit without scrolling sideways. The Tyres column gave up its laps
 * and tread before any of them went, and shows the compound alone.
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
      tyres: { enabled: false, set: true, changeSeconds: 0 },
    },
    { width: 620 }
  ),
};
