import type { Meta, StoryObj } from '@storybook/react-vite';
import { WindCompass } from './WindCompass';

export default {
  component: WindCompass,
  title: 'shared/WindCompass',
  argTypes: {
    direction: {
      control: { type: 'range', min: 0, max: Math.PI * 2, step: 0.1 },
    },
  },
  decorators: [
    (Story) => (
      <div className="flex size-40 items-center justify-center bg-slate-900 p-4 text-sky-400">
        <Story />
      </div>
    ),
  ],
} as Meta<typeof WindCompass>;

type Story = StoryObj<typeof WindCompass>;

/** Straight ahead, where it sits before the wind is told. */
export const Calm: Story = {
  args: { direction: 0, className: 'size-full' },
};

/** A wind from the left, drawn with the Weather widget's heavier stroke. */
export const FromTheLeft: Story = {
  args: {
    direction: -Math.PI / 2,
    className: 'size-full',
    strokeWidth: 'stroke-[3]',
  },
};
