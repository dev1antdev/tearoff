import type { Meta, StoryObj } from '@storybook/react-vite';
import { strategyStory } from '@irdashies/storybook';
import { OurCar } from './OurCar';

/**
 * Our Car on the staged eight-hour race: twenty-two cars in three classes,
 * four and a half hours in, our LMGT3 fourth of fourteen. Every figure is
 * what the real forecast makes of the staged cars; none comes from a
 * recording, because no recorded race has a pit stop.
 */
const meta: Meta<typeof OurCar> = {
  component: OurCar,
  title: 'widgets/OurCar',
};

export default meta;

type Story = StoryObj<typeof OurCar>;

/** A second team driver, for the stints the user watches. */
const TEAM_MATE = 'Andrei Petrov';
/** Every session, for the stories of a session that is not a race. */
const ALL_SESSIONS = {
  race: true,
  loneQualify: true,
  openQualify: true,
  practice: true,
  offlineTesting: true,
};

/**
 * At the wheel: 52 % of the energy for sixteen laps, the window the three
 * stops owed leave, a forecast place gained on a rival that owes a stop
 * more, and the two cars the planned stop puts us between.
 */
export const EightHourRace: Story = { ...strategyStory('ourcar') };

/**
 * A team-mate at the wheel: the gaps to the class cars either side, the
 * last lap and the mean of five lead the panel. The energy is still sent;
 * the tyres and the damage are not, and the foot of the panel says so.
 */
export const TeamMateDriving: Story = {
  ...strategyStory('ourcar', {
    stage: { teamMate: TEAM_MATE },
    size: { width: 380, height: 560 },
  }),
};

/**
 * A team-mate driving a car on fuel: the sim sends nothing of its tank, so
 * there is no stint to state and no place to forecast.
 */
export const TeamMateDrivingAFuelCar: Story = {
  ...strategyStory('ourcar', {
    stage: { teamMate: TEAM_MATE, fuelCar: true },
    size: { width: 380, height: 560 },
  }),
};

/**
 * The stops of the cars around us are assumed, not read or seen: the
 * forecast place is quieter and carries a ~.
 */
export const AssumedRivals: Story = {
  ...strategyStory('ourcar', { stage: { rivals: 'assumed' } }),
};

/** A race to 306 laps, with no clock. */
export const LapRace: Story = {
  ...strategyStory('ourcar', { stage: { lapRace: true } }),
};

/** The car carries damage, with a repair set for the next stop. */
export const Damaged: Story = {
  ...strategyStory('ourcar', { stage: { damaged: true } }),
};

/** The gaps and the pace always, and gallons for a car on fuel. */
export const PaceAlwaysInGallons: Story = {
  ...strategyStory('ourcar', {
    stage: { fuelCar: true },
    config: { showPace: 'always', fuelUnits: 'gal' },
    size: { width: 380, height: 520 },
  }),
};

/** Only the stint and the strategy: no tyres, no damage, no rejoin. */
export const StrategyOnly: Story = {
  ...strategyStory('ourcar', {
    config: { showTyres: false, showDamage: false, showRejoin: false },
    size: { width: 380, height: 250 },
  }),
};

/**
 * iRacing: fuel in litres, the rivals' stops from the stints they have been
 * seen to drive, and no tread or damage to show.
 */
export const IRacing: Story = {
  ...strategyStory('ourcar', { stage: { iracing: true } }),
};

/** On the grid: it says what it is waiting for. */
export const BeforeTheGreenFlag: Story = {
  ...strategyStory('ourcar', { stage: { session: 'grid' } }),
};

/** A practice session it is set to show in: it says why it is empty. */
export const NotARace: Story = {
  ...strategyStory('ourcar', {
    stage: { session: 'practice' },
    config: { sessionVisibility: ALL_SESSIONS },
  }),
};

/** In a panel of the Pit Wall, at the size the page's design gives it. */
export const InAPitWallPanel: Story = {
  ...strategyStory('ourcar', { panel: { width: 380, height: 560 } }),
};

/** The panel on the grid: its notice at the size it reads at on the overlay. */
export const NoticeInAPitWallPanel: Story = {
  ...strategyStory('ourcar', {
    stage: { session: 'grid' },
    panel: { width: 380, height: 200 },
  }),
};

/** The same panel through a team-mate's stint, where it scrolls. */
export const InAPitWallPanelWatching: Story = {
  ...strategyStory('ourcar', {
    stage: { teamMate: TEAM_MATE },
    panel: { width: 380, height: 560 },
  }),
};

/** The wide panel of the Watching layout: four tiles across. */
export const InAWidePitWallPanel: Story = {
  ...strategyStory('ourcar', {
    stage: { teamMate: TEAM_MATE },
    panel: { width: 640, height: 420 },
  }),
};
