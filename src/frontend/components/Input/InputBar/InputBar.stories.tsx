import type { Meta, StoryObj } from '@storybook/react-vite';
import { InputBar } from './InputBar';

const meta: Meta<typeof InputBar> = {
  component: InputBar,
  title: 'widgets/Input/components/InputBar',
  decorators: [
    (Story) => (
      <div className="w-[100px] m-5 h-[120px]">
        <Story />
      </div>
    ),
  ],
  argTypes: {
    brake: {
      control: {
        type: 'range',
        min: 0,
        max: 1,
        step: 0.01,
      },
    },
    throttle: {
      control: {
        type: 'range',
        min: 0,
        max: 1,
        step: 0.01,
      },
    },
    clutch: {
      control: {
        type: 'range',
        min: 0,
        max: 1,
        step: 0.01,
      },
    },
    ffb: {
      control: {
        type: 'range',
        min: -1.2,
        max: 1.2,
        step: 0.01,
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof InputBar>;

export const Primary: Story = {
  render: (args) => <InputBar {...args} />,
  args: {
    brake: 0.5,
    throttle: 0.5,
    clutch: 0.5,
    brakeAbsActive: false,
    settings: {
      includeBrake: true,
      includeThrottle: true,
      includeClutch: true,
      includeAbs: true,
    },
  },
};

export const Zero: Story = {
  ...Primary,
  args: {
    ...Primary.args,
    brake: 0,
    throttle: 0,
    clutch: 0,
  },
};

export const Full: Story = {
  ...Primary,
  args: {
    ...Primary.args,
    brake: 1,
    throttle: 1,
    clutch: 1,
  },
};

export const AbsActive: Story = {
  ...Primary,
  args: {
    ...Primary.args,
    brake: 0.75,
    throttle: 0.1234567,
    clutch: 0,
    brakeAbsActive: true,
  },
};

export const OutsideRange: Story = {
  ...Primary,
  args: {
    ...Primary.args,
    brake: 2,
    throttle: -1,
    clutch: 0.5,
  },
};

/** Traction control cutting, in the Car source: the throttle the car gets. */
export const TractionControlActive: Story = {
  ...Primary,
  args: {
    ...Primary.args,
    brake: 0,
    throttle: 0.5,
    throttlePedal: 1,
    clutch: 0,
    tcActive: true,
  },
};

/** The same moment in the Pedals source: the pedal, flat, with the mark. */
export const TractionControlActivePedals: Story = {
  ...Primary,
  args: {
    ...Primary.args,
    brake: 0,
    throttle: 1,
    throttlePedal: 1,
    clutch: 0,
    tcActive: true,
  },
};

export const AbsAndTractionControl: Story = {
  ...Primary,
  args: {
    ...Primary.args,
    brake: 0.62,
    throttle: 0.5,
    throttlePedal: 1,
    clutch: 0,
    brakeAbsActive: true,
    tcActive: true,
  },
};

/**
 * Pedal travel as a narrow strip beside what the car received, with the
 * number reading the larger of the two.
 */
export const SideBySide: Story = {
  ...Primary,
  args: {
    ...Primary.args,
    brake: 0.62,
    brakePedal: 0.62,
    brakeCar: 0.4,
    throttle: 0.5,
    throttlePedal: 1,
    throttleCar: 0.5,
    clutch: 0.3,
    clutchPedal: 0.3,
    clutchCar: 0.1,
    tcActive: true,
    settings: {
      includeBrake: true,
      includeThrottle: true,
      includeClutch: true,
      includeAbs: true,
      dual: true,
    },
  },
};

export const ForceFeedback: Story = {
  ...Primary,
  args: {
    ...Primary.args,
    brake: 0.2,
    throttle: 0.7,
    clutch: 0,
    ffb: 0.55,
    settings: {
      includeBrake: true,
      includeThrottle: true,
      includeClutch: true,
      includeAbs: true,
      includeFfb: true,
    },
  },
};

/** The whole bar turns amber while the force is at or beyond full. */
export const ForceFeedbackClipping: Story = {
  ...ForceFeedback,
  args: {
    ...ForceFeedback.args,
    ffb: -1.02,
  },
};

/** As it was before the full-travel marker. */
export const WithoutFullTravelMarker: Story = {
  ...Primary,
  args: {
    ...Primary.args,
    brake: 0.5,
    throttle: 1,
    clutch: 0.5,
    settings: {
      includeBrake: true,
      includeThrottle: true,
      includeClutch: true,
      includeAbs: true,
      showMaxMarker: false,
    },
  },
};
