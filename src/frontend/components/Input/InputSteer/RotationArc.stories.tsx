import { Meta, StoryObj } from '@storybook/react-vite';
import { RotationArc } from './RotationArc';
import { DefaultW } from './wheels';

const radians = (degrees: number) => (degrees * Math.PI) / 180;

const meta: Meta<typeof RotationArc> = {
  component: RotationArc,
  title: 'widgets/Input/components/RotationArc',
  argTypes: {
    angleRad: {
      control: { type: 'range', min: -8, max: 8, step: 0.01 },
    },
  },
  decorators: [
    (Story, { args }) => (
      <div className="w-24 h-24 relative flex p-1.5 bg-slate-800 rounded-md">
        <div
          className="w-full h-full flex justify-center"
          style={{ transform: `rotate(${-args.angleRad}rad)` }}
        >
          <DefaultW />
        </div>
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof RotationArc>;

/** A quarter turn to the left: the arc runs anticlockwise from the top. */
export const QuarterLeft: Story = {
  args: { angleRad: radians(90) },
};

export const QuarterRight: Story = {
  args: { angleRad: radians(-90) },
};

/** Past half a turn the arc takes the long way round. */
export const BeyondHalfTurn: Story = {
  args: { angleRad: radians(-238) },
};

/** A full turn or more is a full circle. */
export const FullTurn: Story = {
  args: { angleRad: radians(450) },
};

export const Centred: Story = {
  args: { angleRad: 0 },
};
