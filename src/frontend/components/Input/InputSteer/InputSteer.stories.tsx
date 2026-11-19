import { Meta, StoryObj } from '@storybook/react-vite';
import { InputSteer } from './InputSteer';

export default {
  component: InputSteer,
  title: 'widgets/Input/components/InputSteer',
  argTypes: {
    angleRad: {
      control: {
        type: 'range',
        min: -2 * 3.14,
        max: 2 * 3.14,
        step: 0.01,
      },
    },
  },
} as Meta;

type Story = StoryObj<typeof InputSteer>;

export const Primary: Story = {
  args: {
    angleRad: 0,
  },
};

export const Ring: Story = {
  args: {
    angleRad: 0.6,
    wheelStyle: 'ring',
    gear: 3,
    speedMs: 35, // ~126 km/h
    unit: 1, // metric
    gearSettings: {
      size: 100,
      unit: 'auto',
      showspeed: true,
      showspeedunit: true,
    },
  },
  render: (args) => (
    <div className="w-40 h-40 bg-slate-800 p-2 rounded-md">
      <InputSteer {...args} />
    </div>
  ),
};

/** The ring with the wheel angle in its centre, the gear shown elsewhere. */
export const Dial: Story = {
  args: {
    angleRad: 0.35,
    wheelStyle: 'dial',
  },
  render: (args) => (
    <div className="w-40 h-40 bg-slate-800 p-2 rounded-md">
      <InputSteer {...args} />
    </div>
  ),
};

/** Past 270 degrees the dial shows which way to unwind, as the wheels do. */
export const DialUnwind: Story = {
  ...Dial,
  args: { angleRad: 5.4, wheelStyle: 'dial' },
};

// Verifies the dial stays a maximal, centred square (and the speed/gear never
// overlaps the ring) across very different widget aspect ratios.
export const RingAspectRatios: Story = {
  args: {
    angleRad: 0.6,
    wheelStyle: 'ring',
    gear: 6,
    speedMs: 104, // ~374 km/h, wide 3-digit speed
    unit: 1,
    gearSettings: {
      size: 100,
      unit: 'auto',
      showspeed: true,
      showspeedunit: true,
    },
  },
  render: (args) => (
    <div className="flex items-start gap-6 p-4">
      <div className="space-y-2">
        <div className="text-sm text-white">Square 160x160</div>
        <div className="w-40 h-40 bg-slate-800 p-2 rounded-md">
          <InputSteer {...args} />
        </div>
      </div>
      <div className="space-y-2">
        <div className="text-sm text-white">Tall 80x220</div>
        <div className="w-20 h-[220px] bg-slate-800 p-2 rounded-md">
          <InputSteer {...args} />
        </div>
      </div>
      <div className="space-y-2">
        <div className="text-sm text-white">Wide 280x90</div>
        <div className="w-[280px] h-[90px] bg-slate-800 p-2 rounded-md">
          <InputSteer {...args} />
        </div>
      </div>
    </div>
  ),
};

export const AllWheels: Story = {
  args: {
    angleRad: 0,
  },
  render: ({ angleRad }) => {
    const wheelStyles = [
      'default',
      'formula',
      'lmp',
      'nascar',
      'ushape',
      'ring',
      'dial',
    ] as const;
    const colors = ['light', 'dark'] as const;

    return (
      <div className="p-8 space-y-8">
        {colors.map((color) => (
          <div key={color} className="space-y-4">
            <h3 className="text-xl font-semibold capitalize">{color} Mode</h3>
            <div className="grid grid-cols-5 gap-4">
              {wheelStyles.map((style) => (
                <div key={style} className="text-center space-y-2">
                  <div className="capitalize text-sm font-medium">{style}</div>
                  <div className="flex justify-center">
                    <InputSteer
                      angleRad={angleRad}
                      wheelStyle={style}
                      wheelColor={color}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  },
};

const radians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Half the lock to the left on the recorded Le Mans Ultimate LMGT3, drawn at
 * the range the setup states and at the cockpit animation's, which is what
 * the wheel used to be scaled by.
 */
export const CorrectedRange: Story = {
  render: () => (
    <div className="flex items-start gap-6 p-4">
      {(
        [
          ['Setup range, 476°', 119],
          ['Cockpit animation, 719° (before)', 179.75],
        ] as const
      ).map(([label, degrees]) => (
        <div key={label} className="space-y-2">
          <div className="text-sm text-white">{label}</div>
          <div className="w-40 h-40 bg-slate-800 p-2 rounded-md">
            <InputSteer
              angleRad={radians(degrees)}
              angleReadout="always"
              rotationArc="always"
            />
          </div>
        </div>
      ))}
    </div>
  ),
};

/** The readout, the arc and the two wheel-angle numbers, at widget size. */
export const ReadoutArcAndWheelAngle: Story = {
  args: {
    angleRad: radians(119),
    angleReadout: 'always',
    rotationArc: 'always',
    frontWheelAngleDeg: 8.6,
  },
  render: (args) => (
    <div className="flex items-start gap-6 p-4">
      <div className="w-[76px] h-[76px] bg-slate-800 rounded-md">
        <InputSteer {...args} />
      </div>
      <div className="w-40 h-40 bg-slate-800 p-2 rounded-md">
        <InputSteer {...args} />
      </div>
      <div className="w-40 h-40 bg-slate-800 p-2 rounded-md">
        <InputSteer
          {...args}
          angleRad={radians(-300)}
          frontWheelAngleDeg={-21.7}
        />
      </div>
    </div>
  ),
};
