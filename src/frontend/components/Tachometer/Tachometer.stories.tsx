import { Meta, StoryObj } from '@storybook/react-vite';
import { Tachometer } from './Tachometer';
import {
  ChannelSnapshotDecorator,
  TelemetryDecorator,
  trackStateStorySnapshot,
} from '@irdashies/storybook';

const driverControls = {
  gear: 4,
  rpm: 6200,
  shiftGrindRpm: 7600,
  shiftRpm: 6900,
  blinkRpm: 7400,
  engineWarnings: 0,
  version: 1,
};

const meta: Meta<typeof Tachometer> = {
  component: Tachometer,
  title: 'widgets/Tachometer/components/Widget',
  decorators: [
    TelemetryDecorator(),
    ChannelSnapshotDecorator({
      'track-state.snapshot': trackStateStorySnapshot,
      'driver-controls.snapshot': {
        ...driverControls,
        oilTemp: 105,
        waterTemp: 92,
      },
    }),
  ],
};
export default meta;

type Story = StoryObj<typeof Tachometer>;

export const Primary: Story = {
  render: () => (
    <div className="h-[100px] w-full">
      <Tachometer />
    </div>
  ),
  args: {},
};

/** A team-mate's stint under LMU: the revs arrive, the temperatures do not. */
export const WithoutTemperatures: Story = {
  ...Primary,
  decorators: [
    ChannelSnapshotDecorator({
      'track-state.snapshot': trackStateStorySnapshot,
      'driver-controls.snapshot': driverControls,
    }),
  ],
};
