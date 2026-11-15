import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  TelemetryDecoratorWithConfig,
  sessionBarStorySnapshot,
  trackStateStorySnapshot,
} from '@irdashies/storybook';
import type { CruiseSnapshot } from '@irdashies/types';
import { Cruise } from './Cruise';

/** The widget fills its overlay window, so the story supplies one. */
const sized =
  (width: number, height: number): Decorator =>
  (Story) => (
    <div style={{ width, height }}>
      <Story />
    </div>
  );

/**
 * Half-way up the hill at Laguna Seca in an LMGT3: a little over 1,200 km
 * and twelve and a half hours in this car on this track.
 */
const reading = (extra: Partial<CruiseSnapshot> = {}): CruiseSnapshot => ({
  available: true,
  headingDeg: 45,
  driftDeg: 3.2,
  elevationM: 38,
  lapDistanceM: 2345,
  sessionMetres: 9816.6,
  sessionSeconds: 240,
  totalMetres: 1_234_560,
  totalSeconds: 12 * 3600 + 34 * 60 + 56,
  sessionNum: 0,
  version: 1,
  ...extra,
});

interface Scene {
  cruise?: CruiseSnapshot;
  config?: Record<string, unknown>;
  /** 1 for metric, 0 for imperial, as the sim says. */
  displayUnits?: number;
  width?: number;
  height?: number;
}

const scene = ({
  cruise = reading(),
  config = {},
  displayUnits = 1,
  width = 300,
  height = 92,
}: Scene = {}) => ({
  decorators: [
    TelemetryDecoratorWithConfig('/test-data/1747384033336', {
      cruise: config,
    }),
    ChannelSnapshotDecorator({
      'cruise.snapshot': cruise,
      'session-bar.snapshot': { ...sessionBarStorySnapshot, displayUnits },
      'track-state.snapshot': trackStateStorySnapshot,
    }),
    sized(width, height),
  ],
});

const meta: Meta<typeof Cruise> = {
  component: Cruise,
  title: 'widgets/Cruise',
};

export default meta;

type Story = StoryObj<typeof Cruise>;

/**
 * Three cells over two: the heading with its bearing, the height of the
 * road, the distance and the time driven on this track in this car, and
 * the distance into the lap.
 */
export const Grid: Story = {
  ...scene(),
};

/** The same five as one strip. */
export const Row: Story = {
  ...scene({ config: { layout: 'row' }, width: 470, height: 44 }),
};

/** With the compass dial: the rose turned under the car, the needle on the path. */
export const WithDial: Story = {
  ...scene({
    config: { compass: { enabled: true, dial: true } },
    width: 390,
  }),
};

/**
 * Sliding: the nose 14 degrees to the left of where the car is going, and
 * the needle red.
 */
export const Sliding: Story = {
  ...scene({
    cruise: reading({ headingDeg: 212, driftDeg: -14.3 }),
    config: { compass: { enabled: true, dial: true } },
    width: 390,
  }),
};

/** Feet and miles, as the sim is set to. */
export const Imperial: Story = {
  ...scene({ displayUnits: 0 }),
};

/** This session only: the two totals since it began. */
export const SessionScope: Story = {
  ...scene({
    config: {
      odometer: { enabled: true, scope: 'session' },
      timeOnTrack: { enabled: true, scope: 'session' },
    },
  }),
};

/** In the dip after the hairpin, below the track model's own zero. */
export const BelowTheDatum: Story = {
  ...scene({
    cruise: reading({ headingDeg: 344, elevationM: -15, lapDistanceM: 662 }),
  }),
};

/** The stored totals have not been read yet: a dash for those two. */
export const TotalsNotLoaded: Story = {
  ...scene({ cruise: reading({ totalMetres: null, totalSeconds: null }) }),
};

/** Out of the car: every reading a dash, and the dial at rest. */
export const OutOfTheCar: Story = {
  ...scene({
    cruise: reading({
      available: false,
      headingDeg: null,
      driftDeg: null,
      elevationM: null,
      lapDistanceM: null,
    }),
    config: { compass: { enabled: true, dial: true } },
    width: 390,
  }),
};

/** Three cells chosen, in another order. */
export const ThreeCells: Story = {
  ...scene({
    config: {
      displayOrder: ['odometer', 'timeOnTrack', 'compass'],
      elevation: { enabled: false },
      lapDistance: { enabled: false },
    },
    height: 44,
  }),
};

/** The dial alone, every cell switched off. */
export const DialOnly: Story = {
  ...scene({
    config: {
      compass: { enabled: false, dial: true },
      elevation: { enabled: false },
      odometer: { enabled: false, scope: 'allTime' },
      timeOnTrack: { enabled: false, scope: 'allTime' },
      lapDistance: { enabled: false },
    },
    width: 120,
    height: 120,
  }),
};
