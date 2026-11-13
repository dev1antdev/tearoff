import { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  TelemetryDecoratorWithConfig,
} from '@irdashies/storybook';
import type { LapDeltaReference, LapDeltaSnapshot } from '@irdashies/types';
import { LapDelta } from './LapDelta';

const none: LapDeltaReference = { lapTime: null, delta: null, trend: null };

const snapshot = (
  sessionBest: LapDeltaReference,
  allTime: LapDeltaReference = none
): LapDeltaSnapshot => ({ sessionBest, allTime, sessionNum: 0, version: 1 });

const story = (
  delta: LapDeltaSnapshot,
  config: Record<string, unknown> = {},
  size = { width: 220, height: 130 }
) => ({
  decorators: [
    TelemetryDecoratorWithConfig('/test-data/1747384033336', {
      // The stories have no driving state to show the widget for.
      lapdelta: { showOnlyWhenOnTrack: false, ...config },
    }),
    ChannelSnapshotDecorator({ 'lap-delta.snapshot': delta }),
    // The widget fills its overlay window, so the story supplies one of the
    // default size rather than letting it span the page.
    (Story: React.ComponentType) => (
      <div style={size}>
        <Story />
      </div>
    ),
  ],
});

const meta: Meta<typeof LapDelta> = {
  component: LapDelta,
  title: 'widgets/LapDelta',
};

export default meta;

type Story = StoryObj<typeof LapDelta>;

/** A third of a second up on the session best, and still pulling away. */
export const Gaining: Story = {
  ...story(snapshot({ lapTime: 98.556, delta: -0.342, trend: -0.11 })),
};

/** Up on the lap, but giving some of it back through this corner. */
export const UpButLosing: Story = {
  ...story(snapshot({ lapTime: 98.556, delta: -0.342, trend: 0.18 })),
};

/** A mistake: over a second down and the bar full. */
export const Losing: Story = {
  ...story(snapshot({ lapTime: 98.556, delta: 1.204, trend: 0.42 })),
};

/** Matching the reference: level, and nothing on the bar. */
export const Level: Story = {
  ...story(snapshot({ lapTime: 98.556, delta: 0.002, trend: 0.001 })),
};

/** No clean lap in this session yet: dashes, not a borrowed reference. */
export const NoReferenceYet: Story = {
  ...story(snapshot(none, { lapTime: 97.91, delta: 0.6, trend: 0.02 })),
};

/**
 * A reference exists but this lap was not seen from its start, as on the
 * out-lap: its time is shown, the delta is not.
 */
export const LapNotTimed: Story = {
  ...story(snapshot({ lapTime: 98.556, delta: null, trend: null })),
};

/** Against the best lap kept for this track and car across sessions. */
export const AllTimeBest: Story = {
  ...story(
    snapshot(
      { lapTime: 98.556, delta: -0.342, trend: -0.11 },
      { lapTime: 97.91, delta: 0.304, trend: -0.11 }
    ),
    { reference: 'allTime' }
  ),
};

export const ThreeDecimals: Story = {
  ...story(snapshot({ lapTime: 98.556, delta: -0.342, trend: -0.11 }), {
    decimals: 3,
  }),
};

/** Just the figure and the bar, in a smaller window. */
export const DeltaAndTrendOnly: Story = {
  ...story(
    snapshot({ lapTime: 98.556, delta: -0.342, trend: -0.11 }),
    { showPredictedLap: false, showReferenceLap: false },
    { width: 180, height: 76 }
  ),
};

/** A long lap and a large delta, to check nothing is pushed out of place. */
export const LongLap: Story = {
  ...story(snapshot({ lapTime: 508.214, delta: -12.5, trend: -0.3 })),
};
