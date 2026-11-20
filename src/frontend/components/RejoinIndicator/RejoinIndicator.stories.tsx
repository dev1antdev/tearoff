import type { Meta, StoryObj } from '@storybook/react-vite';
import { RejoinIndicatorDisplay } from './RejoinIndicator';

const meta: Meta<typeof RejoinIndicatorDisplay> = {
  title: 'widgets/RejoinIndicator',
  component: RejoinIndicatorDisplay,
};

export default meta;

type Story = StoryObj<typeof RejoinIndicatorDisplay>;

export const AllStates: Story = {
  render: () => (
    <div className="flex flex-col gap-4 w-64">
      <RejoinIndicatorDisplay gap="4.0s" state="clear" />
      <RejoinIndicatorDisplay gap="2.3s" state="caution" />
      <RejoinIndicatorDisplay gap="0.6s" state="danger" />
    </div>
  ),
};

export const Clear: Story = {
  args: {
    gap: '4.0s',
    state: 'clear',
  },
};

export const Caution: Story = {
  args: {
    gap: '2.3s',
    state: 'caution',
  },
};

export const DoNotRejoin: Story = {
  args: {
    gap: '0.6s',
    state: 'danger',
  },
};
