import { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  TelemetryDecoratorWithConfig,
} from '@irdashies/storybook';
import {
  getWidgetDefaultConfig,
  type LapDeltaConfig,
  type LapDeltaFinal,
  type LapDeltaReference,
  type LapDeltaSnapshot,
} from '@irdashies/types';
import { LapDelta, LapDeltaView } from './LapDelta';

const none: LapDeltaReference = { lapTime: null, delta: null, trend: null };

const snapshot = (
  sessionBest: LapDeltaReference,
  allTime: LapDeltaReference = none,
  stintBest: LapDeltaReference = none,
  lastLap: LapDeltaReference = none
): LapDeltaSnapshot => ({
  sessionBest,
  allTime,
  stintBest,
  lastLap,
  lastLapFinal: null,
  stintId: 1,
  sessionNum: 0,
  version: 1,
});

/**
 * Three laps into a stint: a third of a second up on the session best, more
 * on the stint's best and on the lap before, and still down on the all-time
 * lap.
 */
const stint = snapshot(
  { lapTime: 98.556, delta: -0.342, trend: -0.11 },
  { lapTime: 97.91, delta: 0.304, trend: -0.11 },
  { lapTime: 98.802, delta: -0.588, trend: -0.11 },
  { lapTime: 99.137, delta: -0.923, trend: -0.11 }
);

/** The default box, and the taller one the strip of references wants. */
const BOX = { width: 220, height: 130 };
const BOX_WITH_STRIP = { width: 220, height: 150 };

const ALL_OTHERS = {
  sessionBest: true,
  allTime: true,
  stintBest: true,
  lastLap: true,
};

const story = (
  delta: LapDeltaSnapshot,
  config: Record<string, unknown> = {},
  size = BOX
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

/** Against the best clean lap of the stint under way. */
export const StintBest: Story = {
  ...story(stint, { reference: 'stintBest' }),
};

/** Against the lap before this one, clean or not. */
export const LastLap: Story = {
  ...story(stint, { reference: 'lastLap' }),
};

/**
 * The first lap after a stop: the session best stands, and the new stint
 * has no best yet. Dashes, and no other lap in its place.
 */
export const NoStintBestYet: Story = {
  ...story(
    snapshot(
      { lapTime: 98.556, delta: 0.412, trend: 0.03 },
      { lapTime: 97.91, delta: 1.058, trend: 0.03 },
      none,
      { lapTime: 99.137, delta: -0.169, trend: 0.03 }
    ),
    { reference: 'stintBest' }
  ),
};

/**
 * The other three references in a strip under the bar: A for all-time, T
 * for the stint best, L for the last lap. The box is 20 px taller for it.
 */
export const WithOtherReferences: Story = {
  ...story(stint, { secondary: ALL_OTHERS }, BOX_WITH_STRIP),
};

/** The strip with the stint best chosen: the session best takes its place. */
export const StintBestWithOtherReferences: Story = {
  ...story(
    stint,
    { reference: 'stintBest', secondary: ALL_OTHERS, decimals: 3 },
    BOX_WITH_STRIP
  ),
};

/** Two of the others, and a stint with no best yet: its cell stays. */
export const StripWithAMissingReference: Story = {
  ...story(
    snapshot(
      { lapTime: 98.556, delta: 0.412, trend: 0.03 },
      { lapTime: 97.91, delta: 1.058, trend: 0.03 },
      none,
      { lapTime: 99.137, delta: -0.169, trend: 0.03 }
    ),
    { secondary: { stintBest: true, lastLap: true } },
    BOX_WITH_STRIP
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

/** How the lap that has just ended compared with each reference. */
const justFinished: LapDeltaFinal = {
  lapTime: 98.214,
  completedAt: 1090,
  sessionBest: -0.342,
  allTime: 0.304,
  stintBest: -0.588,
  lastLap: -0.923,
};

const heldStory = (
  final: LapDeltaFinal,
  config: Partial<LapDeltaConfig>,
  size = BOX
): Story => ({
  // The hold lasts three seconds on the widget's own timer, so the stories
  // draw the view at that moment rather than race it.
  render: () => (
    <div style={size}>
      <LapDeltaView
        settings={{ ...getWidgetDefaultConfig('lapdelta'), ...config }}
        // The lap now begun is a few metres old, and level with the one
        // just finished, which is the new session best.
        readings={{
          sessionBest: { lapTime: 98.214, delta: 0.004, trend: null },
          allTime: { lapTime: 97.91, delta: 0.012, trend: null },
          stintBest: { lapTime: 98.214, delta: 0.004, trend: null },
          lastLap: { lapTime: 98.214, delta: 0.004, trend: null },
          lastLapFinal: final,
        }}
        held
      />
    </div>
  ),
});

/**
 * Just over the line: for three seconds the figure is how the lap that has
 * just ended finished against the reference, and the last row is its time.
 */
export const ResultHeldAfterTheLine: Story = heldStory(justFinished, {});

/** The same moment with the strip: the result against every reference. */
export const ResultHeldWithOtherReferences: Story = heldStory(
  justFinished,
  { secondary: ALL_OTHERS },
  BOX_WITH_STRIP
);

/**
 * The first timed lap of a stint ends: there was no stint best for it to
 * end against, so the figure is dashes while its time is shown.
 */
export const ResultHeldWithoutAReference: Story = heldStory(
  { ...justFinished, stintBest: null },
  { reference: 'stintBest', secondary: ALL_OTHERS },
  BOX_WITH_STRIP
);
