import { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  TelemetryDecoratorWithConfig,
  trackStateStorySnapshot,
} from '@irdashies/storybook';
import type { WheelDynamicsSnapshot } from '@irdashies/types';
import { Chassis } from './Chassis';

/**
 * An LMGT3 on a straight, as recorded: 51 and 50 mm at the front, 60 and 59
 * at the rear, a little toe-out at the front and toe-in at the rear.
 */
const wheels = (
  over: Partial<WheelDynamicsSnapshot> = {}
): WheelDynamicsSnapshot => ({
  available: true,
  rideHeightMm: [51.2, 50.1, 60.3, 59.4],
  suspensionPositionMm: [64.8, 65.6, 76.6, 77.9],
  loadShare: [0.232, 0.228, 0.274, 0.266],
  loadSource: 'suspensionForce',
  loadTotalN: 18_940,
  tyreDeflectionMm: [15.9, 17.1, 18.9, 20.1],
  camberDeg: [-2.01, -2.18, -1.7, -1.61],
  toeDeg: [-0.05, -0.05, 0.1, 0.11],
  toeTotalDeg: [-0.1, 0.21],
  rakeMm: 8.9,
  rollMm: [-1.1, -0.9],
  rollShareFront: 0.55,
  sessionNum: 0,
  version: 1,
  ...over,
});

const story = (
  snapshot: WheelDynamicsSnapshot,
  config: Record<string, unknown> = {},
  size: { width: number; height: number } = { width: 240, height: 220 }
) => ({
  decorators: [
    TelemetryDecoratorWithConfig('/test-data/1747384033336', {
      chassis: config,
    }),
    ChannelSnapshotDecorator({
      'wheel-dynamics.snapshot': snapshot,
      // The widget hides while the player is not driving.
      'track-state.snapshot': trackStateStorySnapshot,
    }),
    // The widget fills its overlay window, so the story supplies one of the
    // default size rather than letting it span the page.
    (Story: React.ComponentType) => (
      <div style={size}>
        <Story />
      </div>
    ),
  ],
});

const meta: Meta<typeof Chassis> = {
  component: Chassis,
  title: 'widgets/Chassis',
};

export default meta;

type Story = StoryObj<typeof Chassis>;

/** On a straight with the default rows: the car sits level and nose down. */
export const OnTheStraight: Story = {
  ...story(wheels()),
};

/**
 * Through a fast right-hander: the left side is pressed down, so the right
 * side rides higher and both roll figures are positive.
 */
export const RightHander: Story = {
  ...story(
    wheels({
      rideHeightMm: [38.4, 63.2, 49.1, 68.5],
      rakeMm: 8,
      rollMm: [24.8, 19.4],
      rollShareFront: 0.56,
      camberDeg: [-3.42, -0.84, -2.71, -0.62],
      toeTotalDeg: [-0.14, 0.24],
    }),
    { showRollShare: true }
  ),
};

/**
 * Over a kerb: the right front is on the ground and its neighbour nearly so,
 * with the bottoming threshold set to 10 mm, and the kerb has thrown the
 * right front past upright.
 */
export const Bottoming: Story = {
  ...story(
    wheels({
      rideHeightMm: [8.6, -1.5, 44.7, 52.3],
      rakeMm: 44.9,
      rollMm: [-9.3, 6.8],
      camberDeg: [-2.6, 0.42, -1.9, -1.48],
    }),
    { bottomingFront: 10, bottomingRear: 10 }
  ),
};

/** Under braking the nose dips and the rake grows. */
export const NoseDown: Story = {
  ...story(
    wheels({
      rideHeightMm: [31.5, 30.9, 78.2, 77.4],
      rakeMm: 46.6,
      rollMm: [-0.6, -0.8],
    })
  ),
};

/** Over a crest the nose comes up, and a negative rake is drawn blue. */
export const NoseUp: Story = {
  ...story(
    wheels({
      rideHeightMm: [82.4, 80.7, 61.1, 60.2],
      rakeMm: -20.9,
      rollMm: [-1.7, -0.9],
    })
  ),
};

/** The Layout setting: the blocks in two rows, for a wider, lower widget. */
export const TwoRows: Story = {
  ...story(
    wheels({
      rideHeightMm: [38.4, 63.2, 49.1, 68.5],
      rakeMm: 8,
      rollMm: [24.8, 19.4],
      rollShareFront: 0.56,
      camberDeg: [-3.42, -0.84, -2.71, -0.62],
      toeTotalDeg: [-0.14, 0.24],
    }),
    { showRollShare: true, layout: 'twoRows' },
    { width: 600, height: 130 }
  ),
};

/** All in one row, for a strip along the screen. */
export const OneRow: Story = {
  ...story(
    wheels({
      rideHeightMm: [38.4, 63.2, 49.1, 68.5],
      rakeMm: 8,
      rollMm: [24.8, 19.4],
      rollShareFront: 0.56,
      camberDeg: [-3.42, -0.84, -2.71, -0.62],
      toeTotalDeg: [-0.14, 0.24],
    }),
    { layout: 'oneRow' },
    { width: 720, height: 70 }
  ),
};

/**
 * One Row chosen in the default window, before it is widened: the blocks
 * wrap rather than draw over each other.
 */
export const OneRowInADefaultWindow: Story = {
  ...story(wheels(), { layout: 'oneRow' }),
};

/** Every row on, toe at each wheel: the widget wants more height. */
export const EveryRow: Story = {
  ...story(
    wheels(),
    {
      showRollShare: true,
      showSuspension: true,
      toeDisplay: 'wheel',
    },
    { width: 240, height: 290 }
  ),
};

/** Ride height alone, for a narrow slot. */
export const RideHeightOnly: Story = {
  ...story(
    wheels(),
    {
      showRake: false,
      showRoll: false,
      showCamber: false,
      showToe: false,
    },
    { width: 240, height: 70 }
  ),
};

/**
 * A car the sim gives no camber or toe for: those rows are left out rather
 * than drawn empty.
 */
export const NoCamberOrToe: Story = {
  ...story(wheels({ camberDeg: null, toeDeg: null, toeTotalDeg: null })),
};

/**
 * Out of the car, with "show only when on track" off: the sim publishes no
 * wheel data, and the widget keeps its shape so it can still be placed.
 */
export const NoReading: Story = {
  ...story(
    {
      available: false,
      rideHeightMm: null,
      suspensionPositionMm: null,
      loadShare: null,
      loadSource: null,
      loadTotalN: null,
      tyreDeflectionMm: null,
      camberDeg: null,
      toeDeg: null,
      toeTotalDeg: null,
      rakeMm: null,
      rollMm: null,
      rollShareFront: null,
      sessionNum: null,
      version: 1,
    },
    { showOnlyWhenOnTrack: false }
  ),
};
