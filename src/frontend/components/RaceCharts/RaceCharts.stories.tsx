import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import {
  PointAt,
  RACE_HISTORY_STAGE_FOR_CHARTS,
  raceHistoryStory,
} from '@irdashies/storybook';
import { RaceCharts } from './RaceCharts';

/**
 * The Race Charts on the staged eight-hour race of
 * `.storybook/raceHistoryStage.ts`: twenty-two cars in three classes, five
 * and a quarter hours in, our #77 fifth in its class and seven laps into
 * its sixth stint. Three of its laps were lost to traffic, and the car
 * behind, #23, has been catching it since lap 136.
 *
 * Every lap is a staged record of the race history; none comes from a
 * recording, because no recorded race has a pit stop, a driver change or a
 * full-course yellow.
 */
const meta: Meta<typeof RaceCharts> = {
  component: RaceCharts,
  title: 'widgets/RaceCharts',
};

export default meta;

type Story = StoryObj<typeof RaceCharts>;

const stage = RACE_HISTORY_STAGE_FOR_CHARTS;

/**
 * Pace over the last forty laps: three drivers of ours, two stops, the
 * leader of the class, the car ahead and the car behind. The laps of the
 * stops, two under a yellow and two lost to traffic are marks at the top.
 */
export const Pace: Story = { ...raceHistoryStory('racecharts', { stage }) };

/**
 * The gap to the same three cars at the line. Every stop is a step, and
 * between its stops the car behind climbs towards our line.
 */
export const Gap: Story = {
  ...raceHistoryStory('racecharts', { stage, config: { tab: 'gap' } }),
};

/** What each lap of ours used of its virtual energy. */
export const Usage: Story = {
  ...raceHistoryStory('racecharts', { stage, config: { tab: 'usage' } }),
};

/** The last twenty laps: one stop, on a finer scale. */
export const LastTwentyLaps: Story = {
  ...raceHistoryStory('racecharts', { stage, config: { laps: 20 } }),
};

/** The last eighty laps: three stops and all three drivers. */
export const LastEightyLaps: Story = {
  ...raceHistoryStory('racecharts', { stage, config: { laps: 80 } }),
};

/**
 * The whole race: every stint, with the lap from the grid and the three
 * laps under the full-course yellow as marks at the top.
 */
export const WholeRace: Story = {
  ...raceHistoryStory('racecharts', { stage, config: { laps: 0 } }),
};

/** The gap over the whole race. */
export const GapOverTheWholeRace: Story = {
  ...raceHistoryStory('racecharts', {
    stage,
    config: { tab: 'gap', laps: 0 },
  }),
};

const pointing = (x: number, y: number): Decorator => {
  const Pointing: Decorator = (Story) => (
    <PointAt selector='[data-testid="race-charts-plot"]' x={x} y={y}>
      <Story />
    </PointAt>
  );
  return Pointing;
};

const pointed = (
  options: Parameters<typeof raceHistoryStory<'racecharts'>>[1],
  x: number,
  y: number
): Story => {
  const story = raceHistoryStory('racecharts', options);
  return { ...story, decorators: [...story.decorators, pointing(x, y)] };
};

/** Pointing at a lap of the pace chart: every car's time on it, and who drove. */
export const PointingAtALap: Story = pointed({ stage }, 0.72, 0.45);

/**
 * Pointing at the lap of a stop, which is off the scale: its real time,
 * and what the stop is seen to have done.
 */
export const PointingAtAStop: Story = pointed({ stage }, 0.845, 0.4);

/** Pointing at a lap of the gap chart. */
export const PointingAtAGap: Story = pointed(
  { stage, config: { tab: 'gap' } },
  0.5,
  0.6
);

/** Our car alone: other cars chosen by number, and none entered. */
export const OneCarOnly: Story = {
  ...raceHistoryStory('racecharts', {
    stage,
    config: { others: 'chosen', carNumbers: '' },
  }),
};

/** Three cars of our class chosen by number, wherever they are in it. */
export const ChosenCars: Story = {
  ...raceHistoryStory('racecharts', {
    stage,
    config: { others: 'chosen', carNumbers: '46, 91, 85' },
  }),
};

/** iRacing: no Usage chart, since nothing is published of what a car has left. */
export const IRacing: Story = {
  ...raceHistoryStory('racecharts', { stage: { ...stage, iracing: true } }),
};

/** Three laps into the race: the chart fills from the left. */
export const ThreeLapsIn: Story = {
  ...raceHistoryStory('racecharts', { stage: { ownLaps: 3 } }),
};

/** The first minute of the race: no lap to draw yet. */
export const BeforeAnyLap: Story = {
  ...raceHistoryStory('racecharts', { stage: { ownLaps: 0 } }),
};

/**
 * The race carried on after a restart, 60 laps in: laps 41 to 47 were
 * driven while the app was not running, and are a hatched band.
 */
export const AfterARestart: Story = {
  ...raceHistoryStory('racecharts', {
    stage: { ownLaps: 60, outage: { afterOwnLap: 40, untilOwnLap: 47 } },
  }),
};

/** The gap after the same restart: no gap for the laps that are not held. */
export const GapAfterARestart: Story = {
  ...raceHistoryStory('racecharts', {
    stage: { ownLaps: 60, outage: { afterOwnLap: 40, untilOwnLap: 47 } },
    config: { tab: 'gap' },
  }),
};

/**
 * A page that was given no bridge to the race history, which is no page of
 * the app any more: what the panel says should it ever be drawn on one.
 */
export const NoBridge: Story = {
  ...raceHistoryStory('racecharts', { stage, noBridge: true }),
};

/** In a panel of the Pit Wall about 760 by 300, as on the Race page. */
export const InAPitWallPanel: Story = {
  ...raceHistoryStory('racecharts', {
    stage,
    panel: { width: 760, height: 300 },
  }),
};

/** In a panel about 560 by 320. */
export const InANarrowPitWallPanel: Story = {
  ...raceHistoryStory('racecharts', {
    stage,
    panel: { width: 560, height: 320 },
  }),
};

/** The gap chart in the narrow panel. */
export const GapInANarrowPitWallPanel: Story = {
  ...raceHistoryStory('racecharts', {
    stage,
    config: { tab: 'gap' },
    panel: { width: 560, height: 320 },
  }),
};

/** The usage chart in the narrow panel. */
export const UsageInANarrowPitWallPanel: Story = {
  ...raceHistoryStory('racecharts', {
    stage,
    config: { tab: 'usage' },
    panel: { width: 560, height: 320 },
  }),
};

/**
 * In the panel the Race page has for it in a window of 1600 by 900: 887 by
 * 264. A panel this short gives its legend one line, with the other cars
 * named by number, and what the scale counts is in the bar.
 */
export const InTheRacePanelAt1600: Story = {
  ...raceHistoryStory('racecharts', {
    stage,
    panel: { width: 887, height: 264 },
  }),
};

/**
 * In the Race page's panel at 1280 by 800: 588 by 214. The legend is at its
 * barest to stay on one line, and a stop's band has room for "stop" alone.
 */
export const InTheRacePanelAt1280: Story = {
  ...raceHistoryStory('racecharts', {
    stage,
    panel: { width: 588, height: 214 },
  }),
};

/** The gap chart in that panel, with what its scale counts in the bar. */
export const GapInTheRacePanelAt1280: Story = {
  ...raceHistoryStory('racecharts', {
    stage,
    config: { tab: 'gap' },
    panel: { width: 588, height: 214 },
  }),
};

/** The whole race in that panel. */
export const WholeRaceInTheRacePanelAt1280: Story = {
  ...raceHistoryStory('racecharts', {
    stage,
    config: { laps: 0 },
    panel: { width: 588, height: 214 },
  }),
};

/**
 * Under 400 wide, as the page's panel on a phone is: the buttons of the bar
 * leave the caption no room, and it goes under them. The legend is held to
 * two lines.
 */
export const Under400Wide: Story = {
  ...raceHistoryStory('racecharts', {
    stage,
    config: { tab: 'gap' },
    size: { width: 364, height: 420 },
  }),
};

/** The pace chart at that width: the legend at its barest, on two lines. */
export const PaceUnder400Wide: Story = {
  ...raceHistoryStory('racecharts', {
    stage,
    size: { width: 364, height: 420 },
  }),
};

/**
 * Laps that were not recorded, in the Race page's short panel: the bar says
 * how many beside what the scale counts.
 */
export const AfterARestartInTheRacePanelAt1280: Story = {
  ...raceHistoryStory('racecharts', {
    stage: { ownLaps: 60, outage: { afterOwnLap: 40, untilOwnLap: 47 } },
    panel: { width: 588, height: 214 },
  }),
};
