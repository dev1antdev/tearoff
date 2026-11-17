import type { Meta, StoryObj } from '@storybook/react-vite';
import { raceHistoryStory } from '@irdashies/storybook';
import { CarLaps } from './CarLaps';

/**
 * Car Laps on the staged eight-hour race of
 * `.storybook/raceHistoryStage.ts`: twenty-two cars in three classes, five
 * and a quarter hours in, our #77 seven laps into its sixth stint. Every
 * lap is a staged record of the race history; none comes from a recording,
 * because no recorded race has a pit stop or a driver change.
 */
const meta: Meta<typeof CarLaps> = {
  component: CarLaps,
  title: 'widgets/CarLaps',
};

export default meta;

type Story = StoryObj<typeof CarLaps>;

/**
 * Our car: the stint under way with its best lap green, the out-lap, and
 * the lap of the stop with what it is seen to have done.
 */
export const EightHourRace: Story = { ...raceHistoryStory('carlaps') };

/**
 * The class leader chosen in the header. Its best lap is the best of the
 * class, in purple.
 */
export const RivalChosen: Story = {
  ...raceHistoryStory('carlaps', { car: '33' }),
};

/** An LMP2 chosen, which runs on fuel: the column counts fuel. */
export const FuelCarChosen: Story = {
  ...raceHistoryStory('carlaps', { car: '22' }),
};

/** Three laps into the race: the lap from the grid, and two clean ones. */
export const ThreeLapsIn: Story = {
  ...raceHistoryStory('carlaps', { stage: { ownLaps: 3 } }),
};

/** The first minute of the race: no lap to list yet. */
export const NoLapYet: Story = {
  ...raceHistoryStory('carlaps', { stage: { ownLaps: 0 } }),
};

/**
 * The race carried on after a restart, 49 laps in: laps 41 to 47 were
 * driven while the app was not running, and are one quiet line.
 */
export const AfterARestart: Story = {
  ...raceHistoryStory('carlaps', {
    stage: { ownLaps: 49, outage: { afterOwnLap: 40, untilOwnLap: 47 } },
  }),
};

/** iRacing: no sector columns and no energy column. */
export const IRacing: Story = {
  ...raceHistoryStory('carlaps', { stage: { iracing: true } }),
};

/** The time and the note alone: the sectors and the energy switched off. */
export const TimesOnly: Story = {
  ...raceHistoryStory('carlaps', {
    config: { showSectors: false, showEnergy: false },
    size: { width: 360, height: 420 },
  }),
};

/**
 * A page that was given no bridge to the race history, which is no page of
 * the app any more: what the panel says should it ever be drawn on one.
 */
export const NoBridge: Story = {
  ...raceHistoryStory('carlaps', { noBridge: true }),
};

/** In a panel of the Pit Wall about 600 by 420. */
export const InAPitWallPanel: Story = {
  ...raceHistoryStory('carlaps', { panel: { width: 600, height: 420 } }),
};

/** In a panel about 760 by 520, as on the Watching page. */
export const InAWidePitWallPanel: Story = {
  ...raceHistoryStory('carlaps', { panel: { width: 760, height: 520 } }),
};
