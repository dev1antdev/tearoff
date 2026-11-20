import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  TelemetryDecorator,
  trackStateStorySnapshot,
} from '@irdashies/storybook';
import { GarageCover } from './GarageCover';

/** In the garage, with no picture chosen: the cover shows the logo. */
export default {
  component: GarageCover,
  title: 'widgets/GarageCover',
  decorators: [
    TelemetryDecorator(),
    ChannelSnapshotDecorator({
      'track-state.snapshot': {
        ...trackStateStorySnapshot,
        isInGarage: true,
        isGarageVisible: true,
        isOnTrack: false,
      },
    }),
    (Story) => (
      <div className="h-60 w-100">
        <Story />
      </div>
    ),
  ],
} as Meta;

type Story = StoryObj<typeof GarageCover>;

export const InTheGarage: Story = {};
