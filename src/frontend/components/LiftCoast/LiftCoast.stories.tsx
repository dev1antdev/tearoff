import type { ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelPlaybackDecorator,
  ChannelSnapshotDecorator,
  TelemetryDecoratorWithConfig,
  trackStateStorySnapshot,
} from '@irdashies/storybook';
import type {
  DriverControlsSnapshot,
  LiftCoastConfig,
  TrackStateSnapshot,
} from '@irdashies/types';
import { LiftCoast } from './LiftCoast';

const controls = (
  values: Partial<DriverControlsSnapshot> = {}
): DriverControlsSnapshot => ({
  throttle: 0,
  throttleRaw: 0,
  brake: 0,
  brakeRaw: 0,
  brakeAbsActive: false,
  tcActive: false,
  liftAndCoast: 0,
  version: 1,
  ...values,
});

interface StoryOptions {
  config?: Partial<LiftCoastConfig>;
  width?: number;
  height?: number;
  trackState?: TrackStateSnapshot;
}

const frame = (
  { config = {}, width = 340, height = 44 }: StoryOptions = {},
  channel: ReturnType<typeof ChannelSnapshotDecorator>
) => ({
  decorators: [
    TelemetryDecoratorWithConfig('/test-data/1747384033336', {
      liftcoast: config,
    }),
    channel,
    // The strip fills its overlay window, so the story supplies one of the
    // default size rather than letting it span the page.
    (Story: ComponentType) => (
      <div style={{ width, height }}>
        <Story />
      </div>
    ),
  ],
});

const story = (snapshot: DriverControlsSnapshot, options: StoryOptions = {}) =>
  frame(
    options,
    ChannelSnapshotDecorator({
      'driver-controls.snapshot': snapshot,
      'track-state.snapshot': options.trackState ?? trackStateStorySnapshot,
    })
  );

const meta: Meta<typeof LiftCoast> = {
  component: LiftCoast,
  title: 'widgets/LiftCoast',
};

export default meta;

type Story = StoryObj<typeof LiftCoast>;

/**
 * No energy-saving target set, which is every car in the one recording there
 * is: the signal reads 0 and the strip is dark.
 */
export const NoTarget: Story = { ...story(controls()) };

/** The signal a third of the way up: four of ten lights. */
export const Building: Story = {
  ...story(controls({ liftAndCoast: 90 / 255 })),
};

/** Exactly at the critical share: eight lights, still violet. */
export const AtTheThreshold: Story = {
  ...story(controls({ liftAndCoast: 204 / 255 })),
};

/** Past it: the lit lights turn pink. This is "lift now". */
export const LiftNow: Story = {
  ...story(controls({ liftAndCoast: 218 / 255 })),
};

/** The signal at its top: every light, pink. */
export const Full: Story = { ...story(controls({ liftAndCoast: 1 })) };

/** Traction control cutting: the whole strip, whatever the signal says. */
export const TractionControl: Story = {
  ...story(
    controls({
      liftAndCoast: 0.6,
      tcActive: true,
      throttle: 0.4,
      throttleRaw: 1,
    })
  ),
};

/** ABS working. With both assists at once the brake's has the strip. */
export const Abs: Story = {
  ...story(controls({ brakeAbsActive: true, brake: 0.9, brakeRaw: 0.9 })),
};

/**
 * A locked wheel. Not reachable in the app yet: nothing publishes the slip
 * ratio this stage reads, and the setting for it is switched off and greyed.
 * The story feeds one in to show the colour it will have.
 */
export const WheelLock: Story = {
  ...story(controls({ slipRatioMin: -0.42, brake: 0.8, brakeRaw: 0.8 }), {
    config: { showWheelLock: true },
  }),
};

/** A spinning wheel, on the same terms as the lock above. */
export const Wheelspin: Story = {
  ...story(controls({ slipRatioMax: 0.24, throttle: 1, throttleRaw: 1 }), {
    config: { showWheelSlip: true },
  }),
};

/** Two strips filling toward each other from the ends of a wider box. */
export const Mirrored: Story = {
  ...story(controls({ liftAndCoast: 0.55 }), {
    config: { mirrored: true, ledCount: 8 },
    width: 420,
  }),
};

/** The same two strips filling outward from the middle. */
export const MirroredOutward: Story = {
  ...story(controls({ liftAndCoast: 0.55 }), {
    config: { mirrored: true, ledCount: 8, direction: 'left' },
    width: 420,
  }),
};

/** Filling from the right. */
export const RightToLeft: Story = {
  ...story(controls({ liftAndCoast: 0.55 }), {
    config: { direction: 'left' },
  }),
};

/** A column at the side of the screen, filling upward. */
export const Vertical: Story = {
  ...story(controls({ liftAndCoast: 0.86 }), {
    config: { direction: 'up' },
    width: 44,
    height: 320,
  }),
};

/** Five larger lights in a taller box, on a background. */
export const FiveLightsOnABackground: Story = {
  ...story(controls({ liftAndCoast: 0.5 }), {
    config: { ledCount: 5, background: { opacity: 80 } },
    width: 240,
    height: 56,
  }),
};

/** Twenty lights: they shrink to fit the box. */
export const TwentyLights: Story = {
  ...story(controls({ liftAndCoast: 0.72 }), { config: { ledCount: 20 } }),
};

/** "Hide while dark" with nothing lit: the widget is not there. */
export const HiddenWhileDark: Story = {
  ...story(controls(), { config: { hideWhenDark: true } }),
};

/** Out of the car, with the default "show only when on track": not there. */
export const OutOfTheCar: Story = {
  ...story(controls({ liftAndCoast: 0.6 }), {
    trackState: { ...trackStateStorySnapshot, isOnTrack: false },
  }),
};

/**
 * A braking approach as it might run: the signal climbs to full over three
 * seconds and holds, then traction control takes the strip on the way out.
 * Invented, like every figure here: no recording holds a rising signal.
 */
const approach = (): DriverControlsSnapshot[] => {
  const frames: DriverControlsSnapshot[] = [];
  for (let tick = 0; tick <= 75; tick += 1) {
    frames.push(
      controls({
        liftAndCoast: Math.round((tick / 75) * 255) / 255,
        version: tick + 1,
      })
    );
  }
  for (let tick = 0; tick < 25; tick += 1) {
    frames.push(controls({ liftAndCoast: 1, version: 77 + tick }));
  }
  for (let tick = 0; tick < 20; tick += 1) {
    frames.push(controls({ tcActive: true, version: 102 + tick }));
  }
  frames.push(controls({ version: 122 }));
  return frames;
};

export const ApproachLive: Story = {
  ...frame(
    {},
    ChannelPlaybackDecorator(
      'driver-controls.snapshot',
      approach(),
      { 'track-state.snapshot': trackStateStorySnapshot },
      25
    )
  ),
};
