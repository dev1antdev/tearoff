import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  TelemetryDecoratorWithConfig,
  trackStateStorySnapshot,
} from '@irdashies/storybook';
import { WidgetGroup } from './WidgetGroup';

const meta: Meta<typeof WidgetGroup> = {
  component: WidgetGroup,
  title: 'widgets/WidgetGroup',
  decorators: [
    TelemetryDecoratorWithConfig(undefined, {
      widgetgroup: {
        members: [
          { widgetId: 'input', x: 0, y: 0, width: 400, height: 120 },
          {
            widgetId: 'weather',
            x: 410,
            y: 0,
            width: 190,
            height: 300,
            scale: 80,
          },
        ],
      },
    }),
    ChannelSnapshotDecorator({
      'track-state.snapshot': trackStateStorySnapshot,
    }),
  ],
};
export default meta;

type Story = StoryObj<typeof WidgetGroup>;

/** Two widgets in one frame, the second at a scale of its own. */
export const Primary: Story = {
  render: () => (
    <div className="h-[300px] w-[600px]">
      <WidgetGroup />
    </div>
  ),
};
