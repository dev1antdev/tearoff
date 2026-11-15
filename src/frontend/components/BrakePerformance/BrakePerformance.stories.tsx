import { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  TelemetryDecoratorWithConfig,
  trackStateStorySnapshot,
} from '@irdashies/storybook';
import type { BrakingSnapshot, BrakingZone } from '@irdashies/types';
import { BrakePerformance } from './BrakePerformance';

/** The hardest stop of the recorded Le Mans Ultimate race. */
const zone = (extra: Partial<BrakingZone> = {}): BrakingZone => ({
  peakG: 2.39,
  averageG: 1.48,
  distanceM: 81,
  durationS: 1.88,
  // 214 to 116 km/h.
  entrySpeed: 59.5,
  exitSpeed: 32.3,
  absS: 0.5,
  deltaG: 0.1,
  endedAt: 267.69,
  ...extra,
});

const braking = (extra: Partial<BrakingSnapshot> = {}): BrakingSnapshot => ({
  available: true,
  live: null,
  last: zone(),
  referenceG: 2.39,
  sessionBestG: 2.39,
  zoneCount: 15,
  lockS: [0, 0],
  sessionNum: 0,
  version: 1,
  ...extra,
});

const story = (
  snapshot: BrakingSnapshot,
  config: Record<string, unknown> = {},
  { imperial = false, width = 280, height = 96 } = {}
) => ({
  decorators: [
    TelemetryDecoratorWithConfig('/test-data/1747384033336', {
      brakeperformance: config,
    }),
    ChannelSnapshotDecorator({
      'braking.snapshot': snapshot,
      'track-state.snapshot': {
        ...trackStateStorySnapshot,
        displayUnits: imperial ? 0 : 1,
      },
    }),
    // The widget fills its overlay window, so the story supplies one of the
    // default size rather than letting it span the page.
    (Story: React.ComponentType) => (
      <div style={{ width, height }}>
        <Story />
      </div>
    ),
  ],
});

const meta: Meta<typeof BrakePerformance> = {
  component: BrakePerformance,
  title: 'widgets/BrakePerformance',
};

export default meta;

type Story = StoryObj<typeof BrakePerformance>;

/**
 * Just off the brakes after the best stop of the stint: 2.39 g, four percent
 * up on a best of 2.29 g, with half a second of ABS.
 */
export const BestStop: Story = {
  ...story(braking()),
};

/** An ordinary stop, softer than the best of the last minute. */
export const SofterThanBest: Story = {
  ...story(
    braking({
      last: zone({
        peakG: 1.76,
        averageG: 0.91,
        distanceM: 125,
        durationS: 2.94,
        entrySpeed: 58.3,
        exitSpeed: 32.1,
        absS: 0,
        deltaG: -0.53,
      }),
      referenceG: 2.29,
    })
  ),
};

/**
 * On the brakes: the peak so far, the speed the stop began at, and the
 * distance and time running. The comparison waits for the stop to end.
 */
export const InAZone: Story = {
  ...story(
    braking({
      live: { peakG: 2.14, distanceM: 46, durationS: 0.9, entrySpeed: 59.5 },
      last: zone({ peakG: 1.72, deltaG: -0.63 }),
      referenceG: 2.29,
    })
  ),
};

/** The difference in g instead of as a share. */
export const DeltaInG: Story = {
  ...story(braking(), { deltaUnit: 'g' }),
};

/**
 * Against the best of the session rather than of the last minute: a stop that
 * would be the best of the minute is still four percent off the session's.
 */
export const AgainstSessionBest: Story = {
  ...story(
    braking({
      last: zone({ peakG: 2.29, deltaG: 0.09, absS: 1.4, durationS: 3.95 }),
      referenceG: 2.29,
      sessionBestG: 2.39,
    }),
    { reference: 'session' }
  ),
};

/**
 * A car without ABS: the fronts locked for four tenths on this lap, and a
 * rear for well over a second.
 */
export const WheelLock: Story = {
  ...story(
    braking({
      last: zone({ peakG: 2.61, absS: 0, deltaG: -0.12 }),
      referenceG: 2.73,
      sessionBestG: 2.8,
      lockS: [0.4, 1.3],
    })
  ),
};

/**
 * iRacing, set to imperial units: no lock times, because the sim publishes no
 * wheel speeds, and the speeds and distance in mph and feet.
 */
export const IRacingImperial: Story = {
  ...story(
    braking({
      last: zone({
        peakG: 2.16,
        averageG: 1.15,
        distanceM: 186,
        durationS: 3.93,
        entrySpeed: 71.9,
        exitSpeed: 27.4,
        absS: 0.1,
        deltaG: 0.04,
      }),
      referenceG: 2.16,
      sessionBestG: 2.16,
      lockS: null,
    }),
    {},
    { imperial: true }
  ),
};

/** The first stop of a stint: nothing yet to measure it against. */
export const FirstStop: Story = {
  ...story(
    braking({
      last: zone({ peakG: 1.6, deltaG: 1.6, absS: 0 }),
      referenceG: 1.6,
      sessionBestG: 1.6,
      zoneCount: 1,
    })
  ),
};

/** The peak, the comparison and the lock times only. */
export const WithoutZoneDetail: Story = {
  ...story(braking({ lockS: [0.2, 0] }), { showZoneDetail: false }),
};

/** In the car, before the first stop. */
export const NoZoneYet: Story = {
  ...story(
    braking({ last: null, referenceG: 0, sessionBestG: 0, zoneCount: 0 })
  ),
};

/**
 * Out of the car: the sim publishes nothing for the player, and the widget
 * keeps its shape so that it can still be placed.
 */
export const NoReading: Story = {
  ...story(
    {
      available: false,
      live: null,
      last: null,
      referenceG: 0,
      sessionBestG: 0,
      zoneCount: 0,
      lockS: null,
      sessionNum: null,
      version: 1,
    },
    { showOnlyWhenOnTrack: false }
  ),
};
