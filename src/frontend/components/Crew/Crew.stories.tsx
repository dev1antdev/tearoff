import type { Meta, StoryObj } from '@storybook/react-vite';
import { raceHistoryStory } from '@irdashies/storybook';
import { Crew } from './Crew';

/**
 * Crew and Stints on the staged eight-hour race of
 * `.storybook/raceHistoryStage.ts`: twenty-two cars in three classes, five
 * and a quarter hours in, our #77 in its sixth stint with its third driver
 * change behind it. Every lap and stint is a staged record of the race
 * history; none comes from a recording, because no recorded race has a pit
 * stop or a driver change.
 */
const meta: Meta<typeof Crew> = {
  component: Crew,
  title: 'widgets/Crew',
};

export default meta;

type Story = StoryObj<typeof Crew>;

/** The limits of a league: four hours at most, an hour and a half at least. */
const LIMITS = { enabled: true, maxMinutes: 240, minMinutes: 90 };

/**
 * Our car: three drivers and six stints, the one under way against the
 * last stint another driver drove, and what each stop is seen to have done.
 */
export const EightHourRace: Story = { ...raceHistoryStory('crew') };

/**
 * With the drive-time limits on: a bar for each driver against the maximum
 * of four hours, a mark at the minimum of an hour and a half, and what the
 * third driver still owes.
 */
export const DriveTimeLimits: Story = {
  ...raceHistoryStory('crew', {
    config: { driveTime: LIMITS },
    size: { width: 660, height: 500 },
  }),
};

/** A maximum of two hours: the first driver is past it, in red. */
export const OverTheMaximum: Story = {
  ...raceHistoryStory('crew', {
    config: { driveTime: { enabled: true, maxMinutes: 120, minMinutes: 60 } },
    size: { width: 660, height: 500 },
  }),
};

/** The class leader chosen in the header: its drivers and its stints. */
export const RivalChosen: Story = {
  ...raceHistoryStory('crew', { car: '33' }),
};

/**
 * An LMP2 chosen, which runs on fuel: the column counts fuel a lap, and a
 * stop reads "fuel".
 */
export const FuelCarChosen: Story = {
  ...raceHistoryStory('crew', { car: '22' }),
};

/** The first minute of the race: one stint under way, with no lap yet. */
export const FirstStintNoLapYet: Story = {
  ...raceHistoryStory('crew', { stage: { ownLaps: 0 } }),
};

/**
 * The race carried on after a restart: seven laps were driven while the
 * app was not running. The stint that was under way ends where the laps
 * stop, and the header says how many are not recorded.
 */
export const AfterARestart: Story = {
  ...raceHistoryStory('crew', {
    stage: { outage: { afterOwnLap: 40, untilOwnLap: 47 } },
  }),
};

/**
 * iRacing: no energy column, and of a stop only what iRacing lets be seen,
 * the standing time and the driver.
 */
export const IRacing: Story = {
  ...raceHistoryStory('crew', { stage: { iracing: true } }),
};

/** Only the drivers, with their limits: the stint list switched off. */
export const DriversOnly: Story = {
  ...raceHistoryStory('crew', {
    config: { driveTime: LIMITS, showStints: false },
    size: { width: 460, height: 240 },
  }),
};

/**
 * A page that was given no bridge to the race history, which is no page of
 * the app any more: what the panel says should it ever be drawn on one.
 */
export const NoBridge: Story = {
  ...raceHistoryStory('crew', { noBridge: true }),
};

/** In a panel of the Pit Wall about 600 by 420. */
export const InAPitWallPanel: Story = {
  ...raceHistoryStory('crew', {
    config: { driveTime: LIMITS },
    panel: { width: 600, height: 420 },
  }),
};

/** In a panel about 760 by 520, as on the Watching page. */
export const InAWidePitWallPanel: Story = {
  ...raceHistoryStory('crew', {
    config: { driveTime: LIMITS },
    panel: { width: 760, height: 520 },
  }),
};
