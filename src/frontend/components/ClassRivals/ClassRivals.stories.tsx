import type { Meta, StoryObj } from '@storybook/react-vite';
import { strategyStory } from '@irdashies/storybook';
import { ClassRivals } from './ClassRivals';

/**
 * Class Rivals on the staged eight-hour race: the fourteen LMGT3s, ours
 * fourth. Every figure is what the real forecast makes of the staged cars;
 * none comes from a recording, because no recorded race has a pit stop.
 *
 * The Tyres column is written out by hand (`.storybook/classTyresStage.ts`)
 * so that every state it has is in the class: #33, seen to go on; #46,
 * told from the length of a stop; #54 and #27, through a stop on the same
 * set; #85, at least so many; #23, in its box; #91 and #31 on hards and
 * #10 with softs at the rear, which our own car has not run; #77, ours,
 * with its real tread.
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
  ...strategyStory('classrivals', { size: { width: 800, height: 520 } }),
};

/**
 * The Tyres column with only the gap beside it, so that its states can be
 * read: bare laps for a set seen to go on, ? for one told from the length
 * of a stop, + for at least so many; ~ before an estimate of the tread, <
 * where the laps are only a floor, -- for a compound our own car has not
 * run, and no mark on our own car's real figure.
 */
export const TyresOnly: Story = {
  ...strategyStory('classrivals', {
    config: {
      showStops: false,
      showNextStop: false,
      showNetGap: false,
      showPace: false,
    },
    size: { width: 420, height: 520 },
  }),
};

/** The Tyres column switched off: the table as it was before it. */
export const WithoutTyres: Story = {
  ...strategyStory('classrivals', {
    config: { showTyres: false },
    size: { width: 680, height: 280 },
  }),
};

/**
 * A team-mate at the wheel: the same table, about the same car. Its tread
 * is not read then, so our own row carries an estimate like the rest.
 */
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
    size: { width: 680, height: 280 },
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
 * longest stint the car has been seen to drive. No tread is read either:
 * the Tyres column shows the laps on the set and nothing more, and a stop
 * cannot be held against a refill, so a set is at least as old as the laps
 * since it.
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

/**
 * In a panel of the Pit Wall, at a width that holds every column: with the
 * Tyres column that is 800, forty more than the page's design drew for the
 * table without it. A narrower panel scrolls the table sideways.
 */
export const InAPitWallPanel: Story = {
  ...strategyStory('classrivals', { panel: { width: 820, height: 310 } }),
};

/** The panel on the grid: its notice at the size it reads at on the overlay. */
export const NoticeInAPitWallPanel: Story = {
  ...strategyStory('classrivals', {
    stage: { session: 'grid' },
    panel: { width: 820, height: 160 },
  }),
};
