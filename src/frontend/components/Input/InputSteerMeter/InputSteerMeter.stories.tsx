import type { Meta, StoryObj } from '@storybook/react-vite';
import { InputSteerMeter } from './InputSteerMeter';

const radians = (degrees: number) => (degrees * Math.PI) / 180;

const meta: Meta<typeof InputSteerMeter> = {
  component: InputSteerMeter,
  title: 'widgets/Input/components/InputSteerMeter',
  decorators: [
    (Story) => (
      <div className="w-[220px] h-[76px] p-2 rounded-md bg-slate-800">
        <Story />
      </div>
    ),
  ],
  argTypes: {
    angleRad: {
      control: { type: 'range', min: -8, max: 8, step: 0.01 },
    },
    rangeDeg: {
      control: { type: 'range', min: 0, max: 1440, step: 10 },
    },
    markDeg: {
      control: { type: 'range', min: 30, max: 180, step: 10 },
    },
  },
};
export default meta;

type Story = StoryObj<typeof InputSteerMeter>;

/** Half the lock to the left on a 476 degree wheel. */
export const Primary: Story = {
  args: {
    angleRad: radians(119),
    rangeDeg: 476,
    markDeg: 90,
    showAngle: true,
  },
};

export const Right: Story = {
  args: { ...Primary.args, angleRad: radians(-42) },
};

export const Centred: Story = {
  args: { ...Primary.args, angleRad: 0 },
};

/** At the lock, where the fill covers both marks on its side. */
export const FullLock: Story = {
  args: { ...Primary.args, angleRad: radians(-238) },
};

/** A road car's wheel, marked every 90 degrees. */
export const WideRange: Story = {
  args: { ...Primary.args, angleRad: radians(200), rangeDeg: 990 },
};

export const WithoutAngle: Story = {
  args: { ...Primary.args, showAngle: false },
};

/** No range from the sim: half a turn either way fills it, as in the trace. */
export const NoRange: Story = {
  args: { ...Primary.args, angleRad: radians(90), rangeDeg: undefined },
};
