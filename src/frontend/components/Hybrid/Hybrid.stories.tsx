import type { ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  TelemetryDecoratorWithConfig,
  trackStateStorySnapshot,
} from '@irdashies/storybook';
import type {
  HybridConfig,
  HybridMotorReadings,
  HybridSnapshot,
  TrackStateSnapshot,
} from '@irdashies/types';
import { Hybrid } from './Hybrid';

/**
 * Every figure in these stories is made up. No recording holds a car with a
 * hybrid system, so they are of the size the units would give if they are
 * what TinyPedal takes them for: a 200 kW motor, a battery that swings a
 * tenth of its charge over a lap.
 */
const MOTOR: HybridMotorReadings = {
  torqueNm: 212.5,
  rpm: 9150,
  powerKw: 203.6,
  motorTempC: 68.4,
  coolantTempC: 51.2,
  regenKw: 0,
};

const hybrid = (values: Partial<HybridSnapshot> = {}): HybridSnapshot => ({
  available: true,
  chargePct: 74.3,
  motorState: 2,
  motorStateInferred: false,
  drainLapPct: 6.21,
  regenLapPct: 3.08,
  drainLastLapPct: 12.44,
  regenLastLapPct: 10.87,
  netLapEstimatePct: -1.63,
  deployTimeLapS: 8.4,
  sinceDeployS: null,
  lapElapsedS: 30,
  motor: MOTOR,
  stateOfCharge: 0.743,
  sessionNum: 0,
  version: 1,
  ...values,
});

interface StoryOptions {
  config?: Partial<HybridConfig>;
  width?: number;
  height?: number;
  trackState?: TrackStateSnapshot;
}

const story = (
  snapshot: HybridSnapshot,
  { config = {}, width = 260, height = 96, trackState }: StoryOptions = {}
) => ({
  decorators: [
    TelemetryDecoratorWithConfig('/test-data/1747384033336', {
      hybrid: config,
    }),
    ChannelSnapshotDecorator({
      'hybrid.snapshot': snapshot,
      'track-state.snapshot': trackState ?? trackStateStorySnapshot,
    }),
    // The widget fills its overlay window, so the story supplies one of the
    // default size rather than letting it span the page.
    (Story: ComponentType) => (
      <div style={{ width, height }}>
        <Story />
      </div>
    ),
  ],
});

const meta: Meta<typeof Hybrid> = {
  component: Hybrid,
  title: 'widgets/Hybrid',
};

export default meta;

type Story = StoryObj<typeof Hybrid>;

/** A Hypercar deploying out of a corner, half way round a lap. */
export const Deploying: Story = { ...story(hybrid()) };

/** The same lap in a braking zone: the motor is charging the battery. */
export const Regenerating: Story = {
  ...story(
    hybrid({
      chargePct: 71.9,
      motorState: 3,
      drainLapPct: 8.64,
      regenLapPct: 3.11,
      sinceDeployS: 1.2,
      motor: { ...MOTOR, torqueNm: -140, powerKw: 0, regenKw: -84.3 },
    })
  ),
};

/** Coasting: neither. */
export const Idle: Story = {
  ...story(hybrid({ motorState: 1, sinceDeployS: 3.4 })),
};

/**
 * Just over the line: Used and Regen hold last lap's totals for the first
 * ten seconds, marked LAST, and Net starts from that lap's total.
 */
export const AfterTheLine: Story = {
  ...story(
    hybrid({
      chargePct: 68.7,
      drainLapPct: 0.42,
      regenLapPct: 0,
      netLapEstimatePct: -1.57,
      deployTimeLapS: 0.6,
      lapElapsedS: 2,
    })
  ),
};

/**
 * The first lap out: no last lap to hold and none to measure this one
 * against, so Net is blank.
 */
export const FirstLap: Story = {
  ...story(
    hybrid({
      chargePct: 82.4,
      motorState: 1,
      drainLapPct: 2.3,
      regenLapPct: 4.75,
      drainLastLapPct: null,
      regenLastLapPct: null,
      netLapEstimatePct: null,
      deployTimeLapS: 1.9,
      lapElapsedS: 30,
    })
  ),
};

/** A lap on course to gain: Net is green. */
export const GainingLap: Story = {
  ...story(
    hybrid({
      chargePct: 58.2,
      motorState: 3,
      drainLapPct: 4.1,
      regenLapPct: 7.9,
      netLapEstimatePct: 2.35,
      deployTimeLapS: 5.1,
    })
  ),
};

/**
 * Nearly empty: the charge and its bar are red. The flash is off here so the
 * picture holds; LowChargeFlashing shows it as it happens.
 */
export const LowCharge: Story = {
  ...story(hybrid({ chargePct: 8.4, motorState: 1, netLapEstimatePct: -6.2 }), {
    config: { warningFlash: false },
  }),
};

/** Entering the low band: ten pulses, then the colour holds. */
export const LowChargeFlashing: Story = {
  ...story(hybrid({ chargePct: 8.4, motorState: 1, netLapEstimatePct: -6.2 })),
};

/** Empty. */
export const EmptyBattery: Story = {
  ...story(
    hybrid({
      chargePct: 0,
      motorState: 1,
      drainLapPct: 14.8,
      regenLapPct: 2.2,
      netLapEstimatePct: -11.9,
    }),
    { config: { warningFlash: false } }
  ),
};

/**
 * Nearly full: amber, a caution rather than a best, because what the next
 * braking zone recovers has nowhere to go.
 */
export const FullCharge: Story = {
  ...story(
    hybrid({
      chargePct: 97.6,
      motorState: 3,
      drainLapPct: 1.2,
      regenLapPct: 6.9,
      netLapEstimatePct: 4.4,
      deployTimeLapS: 1.4,
    }),
    { config: { warningFlash: false } }
  ),
};

/** With the motor row, which wants the taller box. */
export const WithMotorRow: Story = {
  ...story(hybrid(), { config: { showMotor: true }, height: 132 }),
};

/** The motor row while regenerating: no power, and a regeneration reading. */
export const MotorRowRegenerating: Story = {
  ...story(
    hybrid({
      chargePct: 71.9,
      motorState: 3,
      motor: {
        ...MOTOR,
        torqueNm: -140,
        rpm: 7800,
        powerKw: 0,
        regenKw: -84.3,
      },
    }),
    { config: { showMotor: true }, height: 132 }
  ),
};

/**
 * A motor past its threshold and a coolant within ten degrees of its own:
 * red and amber. In Fahrenheit and horsepower.
 */
export const MotorHot: Story = {
  ...story(
    hybrid({ motor: { ...MOTOR, motorTempC: 84.2, coolantTempC: 73.6 } }),
    {
      config: {
        showMotor: true,
        temperatureUnit: 'fahrenheit',
        powerUnit: 'hp',
      },
      height: 132,
    }
  ),
};

/**
 * A unit with no coolant circuit, or a reading the sim does not fill: a
 * placeholder, not a zero.
 */
export const MotorRowWithoutCoolant: Story = {
  ...story(hybrid({ motor: { ...MOTOR, coolantTempC: null } }), {
    config: { showMotor: true },
    height: 132,
  }),
};

/** Temperatures and power only. */
export const MotorRowTrimmed: Story = {
  ...story(hybrid(), {
    config: {
      showMotor: true,
      motor: {
        showTemps: true,
        showRpm: false,
        showTorque: false,
        showPower: true,
        showRegen: false,
      },
    },
    height: 132,
  }),
};

/** No decimals. */
export const WholeNumbers: Story = {
  ...story(hybrid(), { config: { decimals: 0 } }),
};

/** Two decimals, as TinyPedal draws them. */
export const TwoDecimals: Story = {
  ...story(hybrid(), { config: { decimals: 2 } }),
};

/** The charge alone, in a short box. */
export const ChargeOnly: Story = {
  ...story(hybrid(), {
    config: {
      showLapUse: false,
      showNetEstimate: false,
      showDeployTimer: false,
    },
    height: 58,
  }),
};

/** Without the Net cell. */
export const WithoutNet: Story = {
  ...story(hybrid(), { config: { showNetEstimate: false } }),
};

/** On no background. */
export const NoBackground: Story = {
  ...story(hybrid(), { config: { background: { opacity: 0 } } }),
};

/**
 * A car with no hybrid system: every GT3, LMP2 and LMP3, and the recorded
 * Ferrari 296. The channel says so and the widget draws nothing.
 */
export const NoHybridSystem: Story = {
  ...story(
    hybrid({
      available: false,
      chargePct: null,
      motorState: 0,
      drainLapPct: 0,
      regenLapPct: 0,
      drainLastLapPct: null,
      regenLastLapPct: null,
      netLapEstimatePct: null,
      deployTimeLapS: 0,
      stateOfCharge: null,
      sessionNum: null,
      version: 0,
    })
  ),
};

/** Out of the car, with the default "show only when on track": not there. */
export const OutOfTheCar: Story = {
  ...story(hybrid(), {
    trackState: { ...trackStateStorySnapshot, isOnTrack: false },
  }),
};
