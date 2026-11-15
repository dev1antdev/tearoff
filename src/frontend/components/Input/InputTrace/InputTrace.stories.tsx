import type { Meta, StoryObj } from '@storybook/react-vite';
import { InputTrace } from './InputTrace';
import { useEffect, useState } from 'react';
import { WidgetScale } from '@irdashies/domain/widgetPresentation/WidgetScale';
import { cornerExitFrames } from '../fixtures/cornerExit';

const meta: Meta<typeof InputTrace> = {
  component: InputTrace,
  title: 'widgets/Input/components/InputTrace',
  decorators: [
    (Story) => (
      <div className="w-[600px] h-[150px]">
        <Story />
      </div>
    ),
  ],
};
export default meta;

const Traces = ({ brakeAbsActive }: { brakeAbsActive: boolean }) => {
  const [throttle, setThrottle] = useState(0);
  const [brake, setBrake] = useState(0);
  const [clutch, setClutch] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setThrottle((value) =>
        Math.max(0, Math.min(1, value + Math.random() * 0.1 - 0.05))
      );

      setBrake((value) =>
        Math.max(0, Math.min(1, value + Math.random() * 0.1 - 0.05))
      );

      setClutch((value) =>
        Math.max(0, Math.min(1, value + Math.random() * 0.1 - 0.05))
      );
    }, 1000 / 60);

    return () => clearInterval(interval);
  }, []);
  return (
    <InputTrace
      input={{
        brake,
        throttle,
        clutch,
        brakeAbsActive: brakeAbsActive ?? false,
      }}
      settings={{
        includeBrake: true,
        includeThrottle: true,
        includeClutch: true,
      }}
    />
  );
};

export const Primary: StoryObj<typeof Traces> = {
  render: (args: { brakeAbsActive: boolean }) => (
    <Traces brakeAbsActive={args.brakeAbsActive} />
  ),
  args: {
    brakeAbsActive: false,
  } as { brakeAbsActive: boolean },
};

export const OutsideRange: StoryObj<typeof InputTrace> = {
  render: (args) => {
    const [input, setInput] = useState({
      brake: 2,
      throttle: -1,
      brakeAbsActive: false,
    });
    useEffect(() => {
      const interval = setInterval(() => {
        setInput(() => ({
          brake: args.input.brake ?? 0,
          throttle: args.input.throttle ?? 0,
          brakeAbsActive: args.input.brakeAbsActive ?? false,
        }));
      }, 1000 / 60);

      return () => clearInterval(interval);
    }, [args.input.brake, args.input.throttle, args.input.brakeAbsActive]);

    return (
      <InputTrace
        input={input}
        settings={{ includeBrake: true, includeThrottle: true }}
      />
    );
  },
  args: {
    input: {
      brake: 2,
      throttle: -1,
      brakeAbsActive: true,
    },
  },
};

const ConfigurableStrokeWidthComponent = ({
  strokeWidth,
}: {
  strokeWidth: number;
}) => {
  const [throttle, setThrottle] = useState(0);
  const [brake, setBrake] = useState(0);
  const [brakeAbsActive, setBrakeAbsActive] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setThrottle((value) =>
        Math.max(0, Math.min(1, value + Math.random() * 0.1 - 0.05))
      );

      setBrake((value) =>
        Math.max(0, Math.min(1, value + Math.random() * 0.1 - 0.05))
      );

      setBrakeAbsActive((value) => (Math.random() > 0.7 ? !value : value));
    }, 1000 / 60);

    return () => clearInterval(interval);
  }, []);

  return (
    <InputTrace
      input={{ brake, throttle, brakeAbsActive }}
      settings={{
        includeBrake: true,
        includeThrottle: true,
        includeAbs: true,
        strokeWidth,
      }}
    />
  );
};

const AbsBarStyleComponent = () => {
  const [throttle, setThrottle] = useState(0);
  const [brake, setBrake] = useState(0);
  const [brakeAbsActive, setBrakeAbsActive] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setBrake((prev) => {
        const next = Math.max(
          0,
          Math.min(1, prev + Math.random() * 0.15 - 0.05)
        );
        // ABS fires when brake is above 0.5
        setBrakeAbsActive(next > 0.5 && Math.random() > 0.4);
        return next;
      });
      setThrottle((prev) =>
        Math.max(0, Math.min(1, prev + Math.random() * 0.08 - 0.04))
      );
    }, 1000 / 60);

    return () => clearInterval(interval);
  }, []);

  return (
    <InputTrace
      input={{ brake, throttle, brakeAbsActive }}
      settings={{
        includeBrake: true,
        includeThrottle: true,
        includeAbs: true,
        absStyle: 'bar',
        strokeWidth: 3,
      }}
    />
  );
};

export const AbsBarStyle: StoryObj<typeof AbsBarStyleComponent> = {
  render: () => <AbsBarStyleComponent />,
  name: 'ABS Bar Style',
};

export const ConfigurableStrokeWidth: StoryObj<
  typeof ConfigurableStrokeWidthComponent
> = {
  render: (args) => (
    <ConfigurableStrokeWidthComponent strokeWidth={args.strokeWidth} />
  ),
  args: {
    strokeWidth: 3,
  },
  argTypes: {
    strokeWidth: {
      control: { type: 'range', min: 1, max: 10, step: 1 },
      description: 'Stroke width for throttle, brake, and ABS traces',
    },
  },
};

// Exercise the physical backing-buffer scale as well as responsive CSS sizing.
export const Scaled: StoryObj<typeof Traces> = {
  render: () => (
    <WidgetScale scale={150}>
      <Traces brakeAbsActive />
    </WidgetScale>
  ),
};

const cornerExit = cornerExitFrames({ brakeOverlap: true });

/**
 * Plays the made-up corner into the trace at 60 Hz and stops on its last
 * frame, in one of the two input sources.
 */
const CornerExit = ({
  pedals,
  absStyle,
}: {
  pedals: boolean;
  absStyle: 'overlay' | 'bar';
}) => {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const interval = setInterval(
      () => setIndex((current) => Math.min(current + 1, cornerExit.length - 1)),
      1000 / 60
    );
    return () => clearInterval(interval);
  }, []);
  const frame = cornerExit[index];
  return (
    <InputTrace
      input={{
        brake: frame.brake,
        throttle: pedals ? frame.throttleRaw : frame.throttle,
        brakeAbsActive: frame.brakeAbsActive,
        tcActive: frame.tcActive,
        steer: frame.steeringWheelAngle,
      }}
      settings={{
        includeBrake: true,
        includeThrottle: true,
        includeClutch: false,
        includeAbs: true,
        includeTc: true,
        absStyle,
      }}
    />
  );
};

type CornerExitStory = StoryObj<typeof CornerExit>;

/** What the car receives: the throttle dips under each cut. */
export const TractionControl: CornerExitStory = {
  render: (args) => <CornerExit {...args} />,
  args: { pedals: false, absStyle: 'overlay' },
};

/** What the driver presses: the pedal stays flat through the same cuts. */
export const TractionControlPedals: CornerExitStory = {
  ...TractionControl,
  args: { pedals: true, absStyle: 'overlay' },
};

export const TractionControlBarStyle: CornerExitStory = {
  ...TractionControl,
  args: { pedals: false, absStyle: 'bar' },
};
