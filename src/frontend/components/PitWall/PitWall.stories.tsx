import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  TelemetryDecorator,
  pitWallStage,
  sessionBarStorySnapshot,
  standingsStorySnapshot,
  timedRaceTimingSnapshot,
  trackStateStorySnapshot,
} from '@irdashies/storybook';
import { EMPTY_FLAG_STATE } from '@irdashies/types';
import { PitWallContent } from '../../windows/PitWallWindow';
import { PitWall } from './PitWall';

/**
 * The Pit Wall as its window shows it: the page with its panels filled by
 * the host. The stories fill the browser, so the viewport is the window.
 */
const meta: Meta<typeof PitWall> = {
  component: PitWall,
  title: 'widgets/PitWall',
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div className="h-screen w-screen">
      <PitWallContent />
    </div>
  ),
};
export default meta;
type Story = StoryObj<typeof PitWall>;

/**
 * The Race layout under Le Mans Ultimate, three and a half hours from the
 * flag on the made-up endurance grid: all ten panels, the Track Map drawn
 * from the map of Le Mans that ships with the app.
 */
export const Race: Story = { ...pitWallStage({ layout: 'race' }) };

/**
 * The Watching layout during a team-mate's stint: the header names who is at
 * the wheel and says the user is watching.
 */
export const Watching: Story = {
  ...pitWallStage({ layout: 'watching', teamMate: 'Nadia Volkova' }),
};

/** The Compact layout, made for a tablet-sized window of 1180 by 820. */
export const Compact: Story = { ...pitWallStage({ layout: 'compact' }) };

/**
 * The Race layout on an iRacing session with no simulator named, so nothing
 * is left out: the Track Map is iRacing's drawing, and Wear and the forecast
 * have nothing to read, which is why iRacing leaves those two panels out.
 */
export const RaceEveryPanel: Story = {
  decorators: [
    TelemetryDecorator(),
    ChannelSnapshotDecorator({
      'standings.snapshot': standingsStorySnapshot,
      'track-state.snapshot': trackStateStorySnapshot,
      'session-bar.snapshot': sessionBarStorySnapshot,
      'session-timing.snapshot': timedRaceTimingSnapshot,
      'flag-state.snapshot': {
        ...EMPTY_FLAG_STATE,
        kind: 'yellow',
        detail: 'yellowElsewhere',
        version: 1,
      },
    }),
  ],
};

/** The page at 125 %: the header and every panel grow together. */
export const Scaled: Story = {
  ...pitWallStage({ layout: 'compact', scale: 125 }),
};

/** No simulator is running: the header keeps its controls, the page waits. */
export const NoSimulator: Story = { ...pitWallStage({ running: false }) };

/** A simulator is running and is in no session yet. */
export const NoSession: Story = { ...pitWallStage({ inSession: false }) };

/**
 * A profile that has lost two of its widgets: their panels say so and offer
 * the widget's settings page, where saving a setting puts it back.
 */
export const MissingWidgets: Story = {
  ...pitWallStage({ layout: 'compact', without: ['fuel', 'weather'] }),
};

/**
 * The page alone, as the widget registry hands it out: without a host the
 * panels only name what they hold.
 */
export const WithoutHost: Story = {
  ...pitWallStage({ layout: 'race' }),
  render: () => (
    <div className="h-screen w-screen">
      <PitWall />
    </div>
  ),
};
