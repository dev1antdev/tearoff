import type { Meta, StoryObj } from '@storybook/react-vite';
import { strategyStory } from '@irdashies/storybook';
import { StintTimeline } from './StintTimeline';

/**
 * The Stint Timeline on the staged eight-hour race, four and a half hours
 * in. The stints driven are staged records of the race history; the stints
 * to come are what the real forecast makes of the staged cars. None of it
 * comes from a recording, because no recorded race has a pit stop.
 */
const meta: Meta<typeof StintTimeline> = {
  component: StintTimeline,
  title: 'widgets/StintTimeline',
};

export default meta;

type Story = StoryObj<typeof StintTimeline>;

const ALL_SESSIONS = {
  race: true,
  loneQualify: true,
  openQualify: true,
  practice: true,
  offlineTesting: true,
};

/**
 * Our car with the class cars ahead and behind: five stints driven by two
 * drivers, three stops to come; the car ahead owes a stop more.
 */
export const EightHourRace: Story = { ...strategyStory('stinttimeline') };

/** A team-mate in the stint under way: its bar is in the team-mate's colour. */
export const TeamMateDriving: Story = {
  ...strategyStory('stinttimeline', {
    stage: { teamMate: 'Andrei Petrov' },
  }),
};

/** Four rivals: the two nearest each side, one of which changed driver. */
export const FourRivals: Story = {
  ...strategyStory('stinttimeline', {
    config: { rivals: 4 },
    size: { width: 700, height: 230 },
  }),
};

/** Our car alone, without names or a legend. */
export const OwnCarOnly: Story = {
  ...strategyStory('stinttimeline', {
    config: { rivals: 0, showDrivers: false, showLegend: false },
    size: { width: 700, height: 70 },
  }),
};

/**
 * The cars around us have their stops assumed from the class: their stints
 * to come are laid out from a stint as long as the class has shown.
 */
export const AssumedRivals: Story = {
  ...strategyStory('stinttimeline', { stage: { rivals: 'assumed' } }),
};

/** A race to 306 laps: the scale is laps. */
export const LapRace: Story = {
  ...strategyStory('stinttimeline', { stage: { lapRace: true } }),
};

/** iRacing: the same bars, with the stints to come from stints seen. */
export const IRacing: Story = {
  ...strategyStory('stinttimeline', { stage: { iracing: true } }),
};

/** On the grid: it says what it is waiting for. */
export const BeforeTheGreenFlag: Story = {
  ...strategyStory('stinttimeline', { stage: { session: 'grid' } }),
};

/** A practice session it is set to show in: it says why it is empty. */
export const NotARace: Story = {
  ...strategyStory('stinttimeline', {
    stage: { session: 'practice' },
    config: { sessionVisibility: ALL_SESSIONS },
  }),
};

/** In a panel of the Pit Wall, at the size the page's design gives it. */
export const InAPitWallPanel: Story = {
  ...strategyStory('stinttimeline', { panel: { width: 900, height: 220 } }),
};
