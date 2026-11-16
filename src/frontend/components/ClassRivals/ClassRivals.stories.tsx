import type { Meta, StoryObj } from '@storybook/react-vite';
import { strategyStory } from '@irdashies/storybook';
import { ClassRivals } from './ClassRivals';

/**
 * Class Rivals on the staged eight-hour race: the fourteen LMGT3s, ours
 * fourth. Every figure is what the real forecast makes of the staged cars;
 * none comes from a recording, because no recorded race has a pit stop.
 */
const meta: Meta<typeof ClassRivals> = {
  component: ClassRivals,
  title: 'widgets/ClassRivals',
};

export default meta;

type Story = StoryObj<typeof ClassRivals>;

const ALL_SESSIONS = {
  race: true,
  loneQualify: true,
  openQualify: true,
  practice: true,
  offlineTesting: true,
};

/**
 * The whole class, scrolling under the captions: one car owes a stop more
 * and ends behind us, one is in the pit lane now.
 */
export const EightHourRace: Story = { ...strategyStory('classrivals') };

/** Tall enough for all fourteen cars. */
export const WholeClass: Story = {
  ...strategyStory('classrivals', { size: { width: 760, height: 500 } }),
};

/** A team-mate at the wheel: the same table, about the same car. */
export const TeamMateDriving: Story = {
  ...strategyStory('classrivals', { stage: { teamMate: 'Andrei Petrov' } }),
};

/**
 * Three cars around us whose stops are assumed, not read or seen: their
 * forecast cells are fainter, and the net gap carries a ~.
 */
export const AssumedRivals: Story = {
  ...strategyStory('classrivals', { stage: { rivals: 'assumed' } }),
};

/** Three cars each side of us. */
export const ThreeEachSide: Story = {
  ...strategyStory('classrivals', {
    config: { carsAhead: 3, carsBehind: 3 },
    size: { width: 620, height: 280 },
  }),
};

/** Only the gaps and the pace: no stop columns, no legend. */
export const GapsAndPaceOnly: Story = {
  ...strategyStory('classrivals', {
    config: {
      showStops: false,
      showNextStop: false,
      showLegend: false,
      carsAhead: 3,
      carsBehind: 3,
    },
    size: { width: 400, height: 230 },
  }),
};

/** A race to 306 laps, with no clock. */
export const LapRace: Story = {
  ...strategyStory('classrivals', { stage: { lapRace: true } }),
};

/**
 * iRacing: no car's fuel is published, so every next stop is the end of the
 * longest stint the car has been seen to drive.
 */
export const IRacing: Story = {
  ...strategyStory('classrivals', { stage: { iracing: true } }),
};

/** On the grid: it says what it is waiting for. */
export const BeforeTheGreenFlag: Story = {
  ...strategyStory('classrivals', { stage: { session: 'grid' } }),
};

/** A practice session it is set to show in: it says why it is empty. */
export const NotARace: Story = {
  ...strategyStory('classrivals', {
    stage: { session: 'practice' },
    config: { sessionVisibility: ALL_SESSIONS },
  }),
};

/** In a panel of the Pit Wall, at the size the page's design gives it. */
export const InAPitWallPanel: Story = {
  ...strategyStory('classrivals', { panel: { width: 760, height: 300 } }),
};
