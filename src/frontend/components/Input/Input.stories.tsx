import { Meta, StoryObj } from '@storybook/react-vite';
import { Input } from './Input';
import {
  TelemetryDecorator,
  TelemetryDecoratorWithConfig,
  ChannelPlaybackDecorator,
  ChannelSnapshotDecorator,
  trackStateStorySnapshot,
} from '@irdashies/storybook';
import {
  getWidgetDefaultConfig,
  type DriverControlsSnapshot,
  type LayoutNode,
} from '@irdashies/types';
import {
  cornerExitFrames,
  cornerExitMoment,
  type CornerExitOptions,
} from './fixtures/cornerExit';

const driverControls = ChannelSnapshotDecorator({
  'track-state.snapshot': trackStateStorySnapshot,
  'driver-controls.snapshot': {
    brake: 0.35,
    throttle: 0.72,
    clutch: 0.9,
    gear: 4,
    speed: 48,
    displayUnits: 1,
    steeringWheelAngle: 0.15,
    brakeAbsActive: false,
    version: 1,
  },
});

const meta: Meta<typeof Input> = {
  component: Input,
  title: 'widgets/Input',
  decorators: [TelemetryDecorator(), driverControls],
};
export default meta;

const defaultConfig = getWidgetDefaultConfig('input');

type Story = StoryObj<typeof Input>;

export const Primary: Story = {
  render: () => (
    <>
      <div className="h-23 w-105">
        <Input />
      </div>
    </>
  ),
  args: {},
};

export const Bigger: Story = {
  render: () => (
    <div className="h-full w-full">
      <Input />
    </div>
  ),
  args: {},
};

export const WithConfig: Story = {
  decorators: [
    driverControls,
    TelemetryDecoratorWithConfig(undefined, {
      input: {
        trace: { enabled: false },
        tachometer: { enabled: false },
      },
    }),
  ],
  render: () => (
    <div className="h-[150px] w-full">
      <Input />
    </div>
  ),
  args: {},
};

export const CustomLayout: Story = {
  render: () => (
    <div className="h-40 w-105">
      <Input
        {...defaultConfig}
        showOnlyWhenOnTrack={false}
        layoutTree={{
          id: 'root',
          type: 'split',
          direction: 'row',
          children: [
            {
              id: 'left',
              type: 'box',
              direction: 'col',
              widgets: ['trace', 'bar'],
              weight: 3,
            },
            {
              id: 'right',
              type: 'box',
              direction: 'col',
              widgets: ['gear', 'steer'],
              weight: 1,
            },
          ],
        }}
      />
    </div>
  ),
  args: {},
};

export const GearOnly: Story = {
  render: () => (
    <div className="h-23 w-23">
      <Input
        {...defaultConfig}
        showOnlyWhenOnTrack={false}
        layoutTree={{
          id: 'root',
          type: 'box',
          direction: 'col',
          widgets: ['gear'],
        }}
      />
    </div>
  ),
  args: {},
};

export const ShiftFlash: Story = {
  decorators: [
    ChannelSnapshotDecorator({
      'track-state.snapshot': trackStateStorySnapshot,
      'driver-controls.snapshot': {
        brake: 0,
        throttle: 1,
        clutch: 1,
        gear: 3,
        speed: 40,
        rpm: 7200,
        blinkRpm: 6800,
        displayUnits: 1,
        steeringWheelAngle: 0,
        brakeAbsActive: false,
        version: 1,
      },
    }),
  ],
  render: () => (
    <div className="h-23 w-105">
      <Input
        {...defaultConfig}
        showOnlyWhenOnTrack={false}
        shiftFlash={{ enabled: true, source: 'redline', color: '#9333ea' }}
      />
    </div>
  ),
  args: {},
};

/**
 * Plays a corner, braking to exit, into the trace and then stands on its
 * last frame: mid-way through a traction control cut, with the pedal flat
 * and the car getting about half of it. Seven seconds, at the widget's own
 * rate.
 */
const cornerExit = (options?: CornerExitOptions) =>
  ChannelPlaybackDecorator(
    'driver-controls.snapshot',
    cornerExitFrames(options),
    { 'track-state.snapshot': trackStateStorySnapshot }
  );

const atDefaultSize = (config: Partial<typeof defaultConfig>) => (
  <div className="h-23 w-105">
    <Input {...defaultConfig} showOnlyWhenOnTrack={false} {...config} />
  </div>
);

/**
 * The Car source while traction control cuts: the throttle is what the car
 * receives, so it falls away under the mark, and the full-travel marker
 * above the bar says the pedal itself is flat.
 */
export const CarSourceTractionControl: Story = {
  decorators: [cornerExit()],
  render: () => atDefaultSize({ useRawValues: false }),
  args: {},
};

/**
 * The same moment in the Pedals source: the throttle is what the driver
 * presses, flat, and the mark still says where traction control bit.
 */
export const PedalsSourceTractionControl: Story = {
  decorators: [cornerExit()],
  render: () => atDefaultSize({ useRawValues: true }),
  args: {},
};

/** Left-foot braking through the cut: ABS on the brake, TC on the throttle. */
export const AbsAndTractionControl: Story = {
  decorators: [cornerExit({ brakeOverlap: true })],
  render: () => atDefaultSize({ useRawValues: false }),
  args: {},
};

/** Both marks as fills under their curves rather than overlays on them. */
export const AbsAndTractionControlBarStyle: Story = {
  decorators: [cornerExit({ brakeOverlap: true })],
  render: () =>
    atDefaultSize({
      useRawValues: false,
      trace: { ...defaultConfig.trace, absStyle: 'bar' },
    }),
  args: {},
};

/**
 * A watched car, for which the sim gives no raw pedals, with the Pedals
 * source chosen: the widget shows what the car receives rather than nothing.
 */
export const WatchedCarWithoutRawInputs: Story = {
  decorators: [cornerExit({ withoutRawInputs: true })],
  render: () => atDefaultSize({ useRawValues: true }),
  args: {},
};

/**
 * Pedal travel beside what the car received for each pedal, the brake's wide
 * strip from the line pressure, and the force feedback bar.
 */
export const SideBySideBars: Story = {
  decorators: [cornerExit({ brakeOverlap: true })],
  render: () =>
    atDefaultSize({
      bar: {
        ...defaultConfig.bar,
        dual: true,
        brakeFromPressure: true,
        includeFfb: true,
      },
    }),
  args: {},
};

const steeringLayout: LayoutNode = {
  id: 'root',
  type: 'split',
  direction: 'row',
  children: [
    {
      id: 'steer',
      type: 'box',
      direction: 'col',
      widgets: ['steer'],
      weight: 1,
    },
    {
      id: 'meter',
      type: 'box',
      direction: 'col',
      widgets: ['steermeter'],
      weight: 3,
    },
  ],
};

/**
 * Half the lock to the left on the recorded LMGT3. At the setup's 476
 * degrees that is 119 at the wheel, where the cockpit animation's 719 drew
 * 180; the road wheels are at 8.6, which makes the ratio the setup's 13.8:1.
 */
const halfLockLeft: DriverControlsSnapshot = {
  ...cornerExitMoment(),
  steeringWheelAngle: (119 * Math.PI) / 180,
  steeringRangeDeg: 476,
  frontWheelAngleDeg: 8.6,
  speed: 0,
};

export const SteeringAtCorrectedRange: Story = {
  decorators: [
    ChannelSnapshotDecorator({
      'track-state.snapshot': trackStateStorySnapshot,
      'driver-controls.snapshot': halfLockLeft,
    }),
  ],
  render: () => (
    <div className="h-28 w-90">
      <Input
        {...defaultConfig}
        showOnlyWhenOnTrack={false}
        steer={{
          ...defaultConfig.steer,
          angleReadout: 'always',
          rotationArc: 'stationary',
          showWheelAngle: true,
        }}
        layoutTree={steeringLayout}
      />
    </div>
  ),
  args: {},
};

/**
 * The same wheel with a manual range of 900 degrees: half the lock is then
 * 225 degrees, and the meter's marks are spaced for the wider wheel.
 */
export const SteeringAtManualRange: Story = {
  ...SteeringAtCorrectedRange,
  render: () => (
    <div className="h-28 w-90">
      <Input
        {...defaultConfig}
        showOnlyWhenOnTrack={false}
        steer={{
          ...defaultConfig.steer,
          angleReadout: 'always',
          rotationArc: 'always',
          rangeDeg: 900,
        }}
        layoutTree={steeringLayout}
      />
    </div>
  ),
};
