import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  TelemetryDecoratorWithConfig,
  emptyTrackProfileStorySnapshot,
  trackProfileStorySnapshot,
  trackStateStorySnapshot,
} from '@irdashies/storybook';
import type {
  TrackProfileSnapshot,
  TrackStateSnapshot,
} from '@irdashies/types';
import { TrackNotes } from './TrackNotes';

/** The widget fills its overlay window, so the story supplies one. */
const sized =
  (width: number, height: number): Decorator =>
  (Story) => (
    <div style={{ width, height }}>
      <Story />
    </div>
  );

const TRACK_LENGTH_M = trackProfileStorySnapshot.trackLengthM;

interface Scene {
  profile?: TrackProfileSnapshot;
  /** Metres into the lap. */
  at?: number;
  trackState?: Partial<TrackStateSnapshot>;
  config?: Record<string, unknown>;
  width?: number;
  height?: number;
}

const scene = ({
  profile = trackProfileStorySnapshot,
  at = 2200,
  trackState = {},
  config = {},
  width = 350,
  height = 80,
}: Scene = {}) => ({
  decorators: [
    TelemetryDecoratorWithConfig('/test-data/1747384033336', {
      tracknotes: config,
    }),
    ChannelSnapshotDecorator({
      'track-profile.snapshot': profile,
      'track-state.snapshot': {
        ...trackStateStorySnapshot,
        lapDistPct: at / TRACK_LENGTH_M,
        speed: 52,
        ...trackState,
      },
    }),
    sized(width, height),
  ],
});

const meta: Meta<typeof TrackNotes> = {
  component: TrackNotes,
  title: 'widgets/TrackNotes',
};

export default meta;

type Story = StoryObj<typeof TrackNotes>;

/**
 * On the run up to the Corkscrew: the pace note for what is coming over the
 * track note for where the car is.
 */
export const NoteShowing: Story = {
  ...scene(),
};

/** With the comment of the pace note and the distance to the next one. */
export const CommentAndNextDistance: Story = {
  ...scene({
    config: { showComment: true, showNextDistance: true },
    height: 104,
  }),
};

/** Track notes only: the one line takes the large style. */
export const TrackNoteOnly: Story = {
  ...scene({ at: 2420, config: { showPaceNotes: false }, height: 56 }),
};

/** Pace notes only, in capitals. */
export const PaceNoteOnlyInCapitals: Story = {
  ...scene({
    config: { showTrackNotes: false, uppercase: true },
    height: 56,
  }),
};

/** On pit road: the note written for the pits, in amber. */
export const OnPitRoad: Story = {
  ...scene({ at: 80, trackState: { onPitRoad: true } }),
};

/** On pit road on a track with no pit note. */
export const PitLaneWithoutANote: Story = {
  ...scene({
    at: 80,
    trackState: { onPitRoad: true },
    profile: {
      ...trackProfileStorySnapshot,
      notes: trackProfileStorySnapshot.notes.filter((note) => !note.pit),
    },
  }),
};

/** A note too long for the box is cut short with an ellipsis. */
export const LongNote: Story = {
  ...scene({
    profile: {
      ...trackProfileStorySnapshot,
      notes: [
        {
          id: 'long',
          distanceM: 2000,
          kind: 'pace',
          text: 'Brake at the bridge, down two gears, and turn in before the apex comes into view',
          comment: '',
          pit: false,
        },
        {
          id: 'here',
          distanceM: 2100,
          kind: 'track',
          text: 'Rahal Straight, the climb to the top of the hill',
          comment: '',
          pit: false,
        },
      ],
    },
  }),
};

/**
 * A track with no notes, with the widget set not to hide: it says so, and
 * keeps its place in the layout.
 */
export const NoNote: Story = {
  ...scene({
    profile: emptyTrackProfileStorySnapshot,
    config: { hideWhenNoNotes: false },
  }),
};

/**
 * Watching another car: the notes are for where that car is, at Rainey
 * Curve, and not for the user's own, which is at the hairpin.
 */
export const WatchingAnotherCar: Story = {
  ...scene({
    at: 300,
    trackState: {
      isOnTrack: false,
      outOfCar: true,
      watching: true,
      focusCarIdx: 7,
      carIdxLapDistPct: [0.08, 0, 0, 0, 0, 0, 0, 0.77],
      carIdxOnPitRoad: [],
    },
  }),
};
