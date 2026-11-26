import type { Meta, StoryObj } from '@storybook/react-vite';
import { LoadBar } from './LoadBar';

export default {
  component: LoadBar,
  title: 'shared/LoadBar',
  argTypes: {
    fill: { control: { type: 'range', min: 0, max: 1, step: 0.01 } },
    warn: { control: { type: 'boolean' } },
    side: { control: { type: 'radio' }, options: ['left', 'right'] },
  },
  decorators: [
    (Story) => (
      <div className="w-40 bg-slate-950 p-2 text-white">
        <Story />
      </div>
    ),
  ],
} as Meta<typeof LoadBar>;

type Story = StoryObj<typeof LoadBar>;

/** A bar grown from the left of its track. */
export const PartlyFilled: Story = {
  args: { fill: 0.6, warn: false, side: 'right' },
};

/** Its side is the side of the car: the fill starts from the centreline. */
export const FromTheCentreline: Story = {
  args: { fill: 0.6, warn: false, side: 'left' },
};

/** A warning colours the whole track, not only the fill. */
export const Warning: Story = {
  args: { fill: 0.1, warn: true, side: 'right' },
};
