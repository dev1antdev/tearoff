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
import { Elevation } from './Elevation';

/** The widget fills its overlay window, so the story supplies one. */
const sized =
  (width: number, height: number): Decorator =>
  (Story) => (
    <div style={{ width, height }}>
      <Story />
    </div>
  );

interface Scene {
  profile?: TrackProfileSnapshot;
  /** How far round the lap the car is, 0..1. */
  lapDistPct?: number;
  trackState?: Partial<TrackStateSnapshot>;
  config?: Record<string, unknown>;
  width?: number;
  height?: number;
}

const scene = ({
  profile = trackProfileStorySnapshot,
  lapDistPct = 0.42,
  trackState = {},
  config = {},
  width = 400,
  height = 70,
}: Scene = {}) => ({
  decorators: [
    TelemetryDecoratorWithConfig('/test-data/1747384033336', {
      elevation: config,
    }),
    ChannelSnapshotDecorator({
      'track-profile.snapshot': profile,
      'track-state.snapshot': {
        ...trackStateStorySnapshot,
        lapDistPct,
        ...trackState,
      },
    }),
    sized(width, height),
  ],
});

const meta: Meta<typeof Elevation> = {
  component: Elevation,
  title: 'widgets/Elevation',
};

export default meta;

type Story = StoryObj<typeof Elevation>;

/**
 * Laguna Seca, recorded from one lap: the car on the climb up the back of
 * the hill, the lap behind it tinted, the two sector starts dashed, the
 * height where the car is and the range of the lap.
 */
export const Recorded: Story = {
  ...scene(),
};

/** At the top of the Corkscrew, the highest point of the lap. */
export const AtTheCorkscrew: Story = {
  ...scene({ lapDistPct: 0.664 }),
};

/** Just over the line: nothing of the lap driven yet. */
export const StartOfTheLap: Story = {
  ...scene({ lapDistPct: 0.012 }),
};

/**
 * Measured from the start/finish line and so signed: in the flat run after
 * the hairpin the car is below the line.
 */
export const MeasuredFromTheLine: Story = {
  ...scene({ lapDistPct: 0.18, config: { zero: 'line' } }),
};

/** Feet, for a driver who reads them. */
export const Feet: Story = {
  ...scene({ config: { unit: 'ft' } }),
};

/** The profile alone: no tint, no sector lines, no figures. */
export const ProfileOnly: Story = {
  ...scene({
    config: {
      showProgress: false,
      showSectors: false,
      showReading: false,
      showRange: false,
    },
  }),
};

/**
 * No profile for this track yet, and the lap that will record it under way:
 * 35 % of it driven.
 */
export const Recording: Story = {
  ...scene({
    profile: { ...emptyTrackProfileStorySnapshot, recordingProgress: 0.35 },
    lapDistPct: 0.35,
  }),
};

/** No profile and no lap being recorded: out of the pits, before the line. */
export const NoProfile: Story = {
  ...scene({ profile: emptyTrackProfileStorySnapshot, lapDistPct: 0.9 }),
};

/**
 * A profile taken from a TinyPedal track map, drawn the same, while the lap
 * that will replace it with the car's own is being driven.
 */
export const FromTinyPedalWhileRecording: Story = {
  ...scene({
    profile: {
      ...trackProfileStorySnapshot,
      elevationSource: 'tinypedal',
      recordingProgress: 0.6,
    },
    lapDistPct: 0.6,
  }),
};

/**
 * Le Mans Ultimate before the car has been seen crossing into each sector:
 * the session carries even thirds as a placeholder, which are not places on
 * the track, so no sector start is drawn. The profile is.
 */
export const SectorStartsNotLearnedYet: Story = {
  ...scene({
    profile: {
      ...trackProfileStorySnapshot,
      sectorStartPct: [0, 1 / 3, 2 / 3],
      sectorSource: 'nominal',
    },
  }),
};

/**
 * Watching another car: the mark is that car's, three quarters round, and
 * not the user's own, which is at the hairpin.
 */
export const WatchingAnotherCar: Story = {
  ...scene({
    lapDistPct: 0.08,
    trackState: {
      isOnTrack: false,
      outOfCar: true,
      watching: true,
      focusCarIdx: 7,
      carIdxLapDistPct: [0.08, 0, 0, 0, 0, 0, 0, 0.752],
    },
  }),
};

/** Taller and wider, as a driver might set it along the top of the screen. */
export const Large: Story = {
  ...scene({ width: 640, height: 120, lapDistPct: 0.55 }),
};

/** Narrow: the same lap through fewer points. */
export const Narrow: Story = {
  ...scene({ width: 220, height: 56, lapDistPct: 0.3 }),
};
