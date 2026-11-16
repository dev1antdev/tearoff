import type { Meta, StoryObj } from '@storybook/react-vite';
import { raceLogStory } from '@irdashies/storybook';
import { RaceLog } from './RaceLog';

/**
 * The Race Log on the staged eight-hour race, four and a half hours in.
 * Every event is invented: no recorded race has a pit stop, a driver
 * change, a full-course yellow or a penalty in it. The log is longer than
 * the channel carries, so the list ends in a button for the events before.
 */
const meta: Meta<typeof RaceLog> = {
  component: RaceLog,
  title: 'widgets/RaceLog',
};

export default meta;

type Story = StoryObj<typeof RaceLog>;

const ALL_SESSIONS = {
  race: true,
  loneQualify: true,
  openQualify: true,
  practice: true,
  offlineTesting: true,
};

const ONLY = {
  pits: false,
  drivers: false,
  fastestLaps: false,
  flags: false,
  status: false,
};

/**
 * Every car, every kind: the newest lines of an eight-hour race. Our own
 * car's are amber.
 */
export const EightHourRace: Story = { ...raceLogStory() };

/** The same list with room for a quarter of an hour of it. */
export const EightHourRaceTall: Story = {
  ...raceLogStory({ size: { width: 520, height: 640 } }),
};

/**
 * The end of the list: the channel carries the most recent 200 events, and
 * the ones before are a button away.
 */
export const EarlierEventsOffered: Story = {
  ...raceLogStory({ atTheEnd: true }),
};

/** The button pressed: the list now runs back to the green flag. */
export const ReadBackToTheStart: Story = {
  ...raceLogStory({ atTheEnd: true, press: ['Earlier events'] }),
};

/** Our class only. Flags and the forecast are still listed. */
export const OurClass: Story = {
  ...raceLogStory({
    config: { scope: 'class' },
    size: { width: 460, height: 420 },
  }),
};

/** Our car only: its stops, its drivers, its place. */
export const OurCar: Story = {
  ...raceLogStory({
    config: { scope: 'car' },
    size: { width: 460, height: 420 },
  }),
};

/** Pit stops alone, of every car. */
export const PitStopsOnly: Story = {
  ...raceLogStory({ config: { kinds: { ...ONLY, pits: true } } }),
};

/**
 * Driver changes alone: the stops at which the driver changed, and the one
 * change with no stop seen.
 */
export const DriverChangesOnly: Story = {
  ...raceLogStory({ config: { kinds: { ...ONLY, drivers: true } } }),
};

/** Each class's fastest lap, as it fell. */
export const FastestLapsOnly: Story = {
  ...raceLogStory({ config: { kinds: { ...ONLY, fastestLaps: true } } }),
};

/** The flags for the whole field, and the forecast. */
export const FlagsAndForecastOnly: Story = {
  ...raceLogStory({ config: { kinds: { ...ONLY, flags: true } } }),
};

/** Cars out and back, penalties, and our own place. */
export const StatusOnly: Story = {
  ...raceLogStory({ config: { kinds: { ...ONLY, status: true } } }),
};

/** Nothing switched on: it says so instead of standing empty. */
export const NothingSwitchedOn: Story = {
  ...raceLogStory({ config: { kinds: ONLY } }),
};

/** The session clock on each line in place of the clock in the sim. */
export const SessionClock: Story = {
  ...raceLogStory({ config: { time: 'session' } }),
};

/** Without the switches over the list, as it might sit on the overlay. */
export const WithoutSwitches: Story = {
  ...raceLogStory({ config: { showFilters: false } }),
};

/**
 * iRacing: black flags shown and cleared in place of named penalties, a
 * car that is gone in place of one listed as retired, no forecast, and
 * iRacing's class colours.
 */
export const IRacing: Story = {
  ...raceLogStory({
    stage: { iracing: true },
    size: { width: 460, height: 420 },
  }),
};

/** A sim that gives no clock: every line falls back to the session clock. */
export const NoClockInTheSim: Story = {
  ...raceLogStory({ stage: { noClock: true } }),
};

/** A race just begun: nothing has happened yet. */
export const EmptyLog: Story = {
  ...raceLogStory({ stage: { log: 'empty' } }),
};

/** No session is being recorded. */
export const NoSession: Story = {
  ...raceLogStory({
    stage: { log: 'none' },
    config: { sessionVisibility: ALL_SESSIONS },
  }),
};

/** In a panel of the Pit Wall, wide and low as the page's design has it. */
export const InAPitWallPanel: Story = {
  ...raceLogStory({ panel: { width: 520, height: 300 } }),
};

/** In a panel of the Pit Wall, narrow and tall as on a small screen. */
export const InANarrowPitWallPanel: Story = {
  ...raceLogStory({ panel: { width: 380, height: 420 } }),
};

/** An empty log in a panel. */
export const EmptyInAPitWallPanel: Story = {
  ...raceLogStory({
    stage: { log: 'empty' },
    panel: { width: 520, height: 300 },
  }),
};
