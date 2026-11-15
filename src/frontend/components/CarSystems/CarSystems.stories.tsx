import { useEffect, useRef, type ComponentType } from 'react';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  TelemetryDecoratorWithConfig,
  createMockBridgeWithConfig,
  trackStateStorySnapshot,
} from '@irdashies/storybook';
import { DashboardProvider, useSessionStore } from '@irdashies/context';
import {
  CAR_SYSTEM_ADJUSTMENTS,
  type CarSystemAdjustment,
  type CarSystemsConfig,
  type CarSystemsSnapshot,
  type ChannelBridge,
  type ChannelName,
  type ChannelPayloads,
  type DashboardBridge,
  type Session,
} from '@irdashies/types';
import { CarSystems } from './CarSystems';

const adjustment = (
  key: string,
  label: string,
  value: number,
  extra: Partial<CarSystemAdjustment> = {}
): CarSystemAdjustment => ({
  key,
  label,
  value,
  isOff: false,
  precision: 0,
  ...extra,
});

const brakeBias = (value: number) =>
  adjustment('dcBrakeBias', 'Brake Bias', value, {
    precision: 1,
    unit: '%',
  });

const snapshot = (
  adjustments: CarSystemAdjustment[],
  lastChange: CarSystemsSnapshot['lastChange'] = null
): CarSystemsSnapshot => ({
  adjustments,
  discovered: true,
  lastChange,
  sessionNum: 0,
  version: 1,
});

const ROWS = [
  'dcBrakeBias',
  'dcABS',
  'dcTractionControl',
  'dcTractionControl2',
  'dcThrottleShape',
];

const story = (
  systems: CarSystemsSnapshot,
  config: Record<string, unknown> = {}
) => ({
  decorators: [
    TelemetryDecoratorWithConfig('/test-data/1747384033336', {
      carsystems: { rows: ROWS, showUnsupportedRows: true, ...config },
    }),
    ChannelSnapshotDecorator({ 'car-systems.snapshot': systems }),
    // The widget is full-width by design and takes its size from its overlay
    // window, so the story supplies one rather than letting it span the page.
    // Wide enough for a strip of columns rather than the old stacked table.
    (Story: React.ComponentType) => (
      <div style={{ width: 420 }}>
        <Story />
      </div>
    ),
  ],
});

const meta: Meta<typeof CarSystems> = {
  component: CarSystems,
  title: 'widgets/CarSystems',
};

export default meta;

type Story = StoryObj<typeof CarSystems>;

/** A GT3 car: every configured row is supported. */
export const Gt3: Story = {
  ...story(
    snapshot([
      brakeBias(54.5),
      adjustment('dcABS', 'ABS', 2),
      adjustment('dcTractionControl', 'TC', 3),
      adjustment('dcTractionControl2', 'TC2', 5),
      adjustment('dcThrottleShape', 'Throttle Shape', 1),
    ])
  ),
};

/**
 * A Formula Vee exposes brake bias alone. The other rows are kept so the table
 * does not change shape between cars.
 */
export const BrakeBiasOnly: Story = {
  ...story(snapshot([brakeBias(48)])),
};

/**
 * A Dallara IR18, with the values from a recorded Monza stint. It publishes no
 * ABS or traction control at all, so those columns sit blank, and its two
 * hybrid dials take their own rows. The energy those dials govern is not here:
 * it swings the full 0..100% within a lap and belongs in a gauge.
 */
export const Ir18Hybrid: Story = {
  ...story(
    snapshot([
      brakeBias(46.8),
      adjustment('dcMGUKDeployFixed', 'Deploy Level', 1, { precision: 1 }),
      adjustment('dcMGUKRegenGain', 'Regen Level', 0.7, { precision: 1 }),
    ]),
    {
      rows: [
        'dcBrakeBias',
        'dcABS',
        'dcTractionControl',
        'dcMGUKDeployFixed',
        'dcMGUKRegenGain',
      ],
    }
  ),
};

/** The same car with the blank rows turned off. */
export const SupportedRowsOnly: Story = {
  ...story(snapshot([brakeBias(48)]), { showUnsupportedRows: false }),
};

/** ABS and TC switched off: subdued, and distinguishable from a blank row. */
export const AssistsOff: Story = {
  ...story(
    snapshot([
      brakeBias(52),
      adjustment('dcABS', 'ABS', 0, { isOff: true }),
      adjustment('dcTractionControl', 'TC', 0, { isOff: true }),
    ])
  ),
};

/**
 * A signed scale. The BMW M Hybrid V8 reports ABS between -5 and -3, so a zero
 * there is an ordinary setting and must not read as off.
 */
export const SignedScale: Story = {
  ...story(
    snapshot([
      brakeBias(51.5),
      adjustment('dcABS', 'ABS', 0),
      adjustment('dcTractionControl', 'TC', 4),
    ])
  ),
};

/** Every adjustment a heavily configurable car might expose. */
export const AllRows: Story = {
  ...story(
    snapshot([
      brakeBias(53.5),
      adjustment('dcABS', 'ABS', 4),
      adjustment('dcTractionControl', 'TC', 6),
      adjustment('dcTractionControl2', 'TC2', 2),
      adjustment('dcThrottleShape', 'Throttle Shape', 3),
      adjustment('dcEnginePower', 'Engine Power', 5),
      adjustment('dcFuelMixture', 'Fuel Mixture', 2),
      adjustment('dcAntiRollFront', 'ARB Front', 4),
      adjustment('dcAntiRollRear', 'ARB Rear', 3),
    ]),
    {
      rows: [
        'dcBrakeBias',
        'dcABS',
        'dcTractionControl',
        'dcTractionControl2',
        'dcThrottleShape',
        'dcEnginePower',
        'dcFuelMixture',
        'dcAntiRollFront',
        'dcAntiRollRear',
      ],
    }
  ),
};

/**
 * The Mercedes W13's real strip, values taken from a capture matched against a
 * photograph of the car's own screen. It is the widest case the brake family
 * has: a coarse bias, a fine trim either side of zero, a target and a migration
 * dial, all four of which used to be two.
 *
 * The headers read their catalogue names here - Storybook has no W13 capture to
 * take a CarPath from, so the per-car renames (PBB to MIGR) are covered by the
 * component spec instead.
 */
export const BrakeFamily: Story = {
  ...story(
    snapshot([
      brakeBias(52.0),
      adjustment('dcBrakeBiasFine', 'Brake Bias Fine', 0, { precision: 1 }),
      adjustment('dcBrakeMisc', 'Brake Bias Target', 0),
      adjustment('dcPeakBrakeBias', 'Rear Brake Valve', 3),
      adjustment('dcDiffEntry', 'Diff Entry', 3),
      adjustment('dcDiffMiddle', 'Diff Mid', 2),
      adjustment('dcDiffExit', 'Diff High Speed', 3),
      adjustment('dcEngineBraking', 'Engine Braking', 3),
    ]),
    {
      rows: [
        'dcBrakeBias',
        'dcBrakeBiasFine',
        'dcBrakeMisc',
        'dcPeakBrakeBias',
        'dcDiffEntry',
        'dcDiffMiddle',
        'dcDiffExit',
        'dcEngineBraking',
      ],
    }
  ),
};

/**
 * A Toyota GR86 with both filters off. The car publishes brake bias, ABS and a
 * single traction control and nothing else, and here its traction control is
 * switched off - so the five configured rows collapse to the two that are
 * actually telling the driver something.
 *
 * The two filters answer different questions. TC2 and THR are gone because the
 * GR86 has no such adjustments; TC is gone because the driver turned it off.
 */
export const LiveReadingsOnly: Story = {
  ...story(
    snapshot([
      brakeBias(50.0),
      adjustment('dcABS', 'ABS', 2),
      adjustment('dcTractionControl', 'Traction Control', 0, { isOff: true }),
    ]),
    { showUnsupportedRows: false, showOffRows: false }
  ),
};

// Le Mans Ultimate. The sim is the running one in every story below, the
// columns are the LMU list, and the box is the widget's default 380 px unless
// a story says otherwise.

/** A row as the processor builds it from the catalogue. */
const dial = (
  key: string,
  value: number,
  extra: Partial<CarSystemAdjustment> = {}
): CarSystemAdjustment => {
  const definition = CAR_SYSTEM_ADJUSTMENTS.find((d) => d.key === key);
  if (!definition) throw new Error(`no catalogue entry for ${key}`);
  return {
    key,
    label: definition.label,
    value,
    isOff: value === 0 && definition.offAtZero !== false,
    precision: definition.precision,
    unit: definition.unit,
    ...extra,
  };
};

/** In the car, in a race. Only what the widget reads of a session. */
const lmuSession = (regenLevel?: string): Session =>
  ({
    WeekendInfo: {},
    SessionInfo: { Sessions: [{ SessionNum: 0, SessionType: 'Race' }] },
    DriverInfo: {
      DriverCarIdx: 0,
      // What LMU puts in CarPath: the car's file name.
      Drivers: [{ CarIdx: 0, CarPath: '74_26_KESS40986092' }],
    },
    ...(regenLevel === undefined
      ? {}
      : {
          LmuRest: {
            garage: {
              regenLevel: { text: regenLevel, value: 3, positions: 6 },
            },
          },
        }),
  }) as unknown as Session;

/**
 * A channel bridge that plays snapshots one after another: the first at once,
 * each of the rest `everyMs` after the one before, and the last pair again and
 * again with a new sequence number when `repeat` is set.
 */
const TurningDialDecorator = (
  frames: (seq: number) => CarSystemsSnapshot[],
  everyMs: number,
  repeat: boolean
): Decorator => {
  const bridge: ChannelBridge = {
    subscribe: <K extends ChannelName>(
      channel: K,
      callback: (payload: ChannelPayloads[K]) => void
    ) => {
      if (channel === 'track-state.snapshot') {
        callback(trackStateStorySnapshot as unknown as ChannelPayloads[K]);
        return () => undefined;
      }
      if (channel !== 'car-systems.snapshot') return () => undefined;
      let seq = 1;
      let queue = frames(seq);
      let version = 1;
      const send = () => {
        if (queue.length === 0 && repeat) {
          seq += 1;
          // The first frame is the car before the dial moved.
          queue = frames(seq).slice(1);
        }
        const next = queue.shift();
        if (!next) return;
        version += 1;
        callback({ ...next, version } as ChannelPayloads[K]);
      };
      send();
      const timer = setInterval(send, everyMs);
      return () => clearInterval(timer);
    },
  };

  const DecoratorComponent: Decorator = (Story) => {
    const previousBridge = useRef(window.channelBridge);
    window.channelBridge = bridge;
    useEffect(
      () => () => {
        if (previousBridge.current === undefined) {
          Reflect.deleteProperty(window, 'channelBridge');
        } else {
          window.channelBridge = previousBridge.current;
        }
      },
      []
    );
    return <Story />;
  };
  return DecoratorComponent;
};

interface LmuStoryOptions {
  config?: Partial<CarSystemsConfig>;
  /** The garage's regeneration level, for a car that has one. */
  regenLevel?: string;
  width?: number;
  /** In place of the one still snapshot: a dial that moves. */
  channel?: Decorator;
}

const lmuStory = (
  systems: CarSystemsSnapshot,
  { config = {}, regenLevel, width = 380, channel }: LmuStoryOptions = {}
) => {
  const bridge: DashboardBridge = {
    ...createMockBridgeWithConfig({ carsystems: config }),
    getActiveSimulator: async () => 'lmu',
  };
  return {
    loaders: [
      async () => {
        useSessionStore.setState({ session: lmuSession(regenLevel) });
      },
    ],
    decorators: [
      (Story: ComponentType) => (
        <DashboardProvider bridge={bridge}>
          <div style={{ width }}>
            <Story />
          </div>
        </DashboardProvider>
      ),
      channel ??
        ChannelSnapshotDecorator({
          'car-systems.snapshot': systems,
          'track-state.snapshot': trackStateStorySnapshot,
        }),
    ],
  };
};

/**
 * The Ferrari 296 LMGT3 of the recorded race, with the figures the recording
 * holds: the bias, ABS at the top of its scale, and all three traction dials.
 * It has no brake migration, so that column sits blank in the default list.
 */
const LMGT3 = [
  dial('dcBrakeBias', 51.75),
  dial('dcABS', 9, { max: 9, active: false }),
  dial('dcTractionControl', 6, { max: 11, active: false }),
  dial('LmuTcSlip', 7, { max: 11 }),
  dial('LmuTcCut', 7, { max: 11 }),
  dial('LmuMotorMap', 1, { max: 1 }),
  dial('dcAntiRollFront', 3, { max: 7 }),
  dial('dcAntiRollRear', 1, { max: 7 }),
  dial('LmuWiper', 1),
];

export const LmuGt3: Story = { ...lmuStory(snapshot(LMGT3)) };

/** The same car showing only what it has. */
export const LmuGt3SupportedOnly: Story = {
  ...lmuStory(snapshot(LMGT3), { config: { showUnsupportedRows: false } }),
};

/**
 * A Hypercar: no ABS, brake migration, a motor map and a regeneration level.
 * The figures are made up, since no recording holds one. The regeneration
 * level is the garage's own text, from the session; its row is off by default
 * and is switched on here.
 */
export const LmuHypercar: Story = {
  ...lmuStory(
    snapshot([
      dial('dcBrakeBias', 53.5),
      dial('dcTractionControl', 4, { max: 11, active: false }),
      dial('LmuTcSlip', 6, { max: 11 }),
      dial('LmuTcCut', 5, { max: 11 }),
      dial('LmuBrakeMigration', 0, { max: 8 }),
      dial('LmuMotorMap', 2, { max: 5 }),
      dial('LmuWiper', 1),
    ]),
    {
      regenLevel: '60%',
      config: {
        lmuRows: [
          'dcBrakeBias',
          'dcABS',
          'dcTractionControl',
          'LmuTcSlip',
          'LmuTcCut',
          'LmuBrakeMigration',
          'LmuMotorMap',
          'LmuRegenLevel',
        ],
        showUnsupportedRows: false,
      },
    }
  ),
};

const FEW_DIALS = [
  dial('dcBrakeBias', 55.25),
  dial('dcTractionControl', 3, { max: 9, active: false }),
  dial('LmuMotorMap', 0, { max: 1 }),
];

/**
 * A car with little to adjust: a bias, one traction dial and a two-position
 * map. The default list keeps its blanks, so each dial is where it was on
 * the last car.
 */
export const LmuFewDials: Story = { ...lmuStory(snapshot(FEW_DIALS)) };

/** The same car showing only what it has. */
export const LmuFewDialsSupportedOnly: Story = {
  ...lmuStory(snapshot(FEW_DIALS), { config: { showUnsupportedRows: false } }),
};

/** Traction control cutting power and ABS working: both headers light. */
export const LmuAssistsWorking: Story = {
  ...lmuStory(
    snapshot(
      LMGT3.map((row) =>
        row.active === undefined ? row : { ...row, active: true }
      )
    )
  ),
};

/** The same moment with the light switched off in settings. */
export const LmuAssistsWorkingLightOff: Story = {
  ...lmuStory(
    snapshot(
      LMGT3.map((row) =>
        row.active === undefined ? row : { ...row, active: true }
      )
    ),
    { config: { highlightActive: false } }
  ),
};

/** The top of each scale after the value, and the bias against its baseline. */
export const LmuScaleAndBiasDelta: Story = {
  ...lmuStory(
    snapshot(
      LMGT3.map((row) =>
        row.key === 'dcBrakeBias'
          ? { ...row, value: 52.25, baselineDelta: 0.5 }
          : row
      )
    ),
    { config: { showScale: true, showBrakeBiasDelta: true }, width: 440 }
  ),
};

/** Everything the LMU list offers, which wants about 500 px. */
export const LmuAllRows: Story = {
  ...lmuStory(snapshot(LMGT3), {
    config: {
      lmuRows: [
        'dcBrakeBias',
        'dcABS',
        'dcTractionControl',
        'LmuTcSlip',
        'LmuTcCut',
        'LmuMotorMap',
        'dcAntiRollFront',
        'dcAntiRollRear',
        'LmuWiper',
      ],
    },
    width: 500,
  }),
};

/** The LMGT3 with its traction control level at `tc`. */
const lmgt3At = (tc: number) =>
  LMGT3.map((row) =>
    row.key === 'dcTractionControl' ? { ...row, value: tc } : row
  );

/** Traction control turned from 6 to 7, as change number `seq`. */
const tcUp = (seq: number): CarSystemsSnapshot[] => [
  snapshot(lmgt3At(6)),
  snapshot(lmgt3At(7), { key: 'dcTractionControl', from: 6, to: 7, seq }),
];

/** Up a click and back down: two changes, numbered from round `seq`. */
const tcUpAndDown = (seq: number): CarSystemsSnapshot[] => [
  snapshot(lmgt3At(6)),
  snapshot(lmgt3At(7), {
    key: 'dcTractionControl',
    from: 6,
    to: 7,
    seq: seq * 2,
  }),
  snapshot(lmgt3At(6), {
    key: 'dcTractionControl',
    from: 7,
    to: 6,
    seq: seq * 2 + 1,
  }),
];

/**
 * The driver has just turned traction control up a click: the value of that
 * column is lit. The light lasts 0.6 s in the car; here the same change is
 * sent again before it goes out, so the state stays up to be looked at.
 */
export const LmuDialMoved: Story = {
  ...lmuStory(snapshot(LMGT3), {
    channel: TurningDialDecorator(tcUp, 400, true),
  }),
};

/** The same as it happens: a click every three seconds, lit and let go. */
export const LmuDialMovedLive: Story = {
  ...lmuStory(snapshot(LMGT3), {
    channel: TurningDialDecorator(tcUpAndDown, 3000, true),
  }),
};

/**
 * Show only when a dial changes: nothing is drawn until one moves, then the
 * whole strip comes up with every column in its usual place. Held on screen
 * here by repeating the change.
 */
export const LmuShowOnChange: Story = {
  ...lmuStory(snapshot(LMGT3), {
    config: { displayMode: 'onChange' },
    channel: TurningDialDecorator(tcUp, 400, true),
  }),
};

/**
 * The same as it happens, with a short stay: a click every five seconds, the
 * strip up for two of them and gone for the rest.
 */
export const LmuShowOnChangeLive: Story = {
  ...lmuStory(snapshot(LMGT3), {
    config: { displayMode: 'onChange', changeHoldSeconds: 2 },
    channel: TurningDialDecorator(tcUpAndDown, 5000, true),
  }),
};

/** Show only when a dial changes, before any has: the widget is not there. */
export const LmuShowOnChangeIdle: Story = {
  ...lmuStory(snapshot(LMGT3), { config: { displayMode: 'onChange' } }),
};
