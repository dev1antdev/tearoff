import { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  TelemetryDecoratorWithConfig,
} from '@irdashies/storybook';
import type { TyreStateSnapshot, TyreWheelState } from '@irdashies/types';
import { Tyres } from './Tyres';

const wheel = (
  surface: [number, number, number],
  brake: number,
  pressureKpa: number,
  extra: Partial<TyreWheelState> = {}
): TyreWheelState => ({
  surfaceTempC: surface,
  innerLayerTempC: surface.map((value) => value + 6),
  carcassTempC: surface[1] + 9,
  optimalTempC: 92,
  pressureKpa,
  treadRemaining: 0.96,
  brakeTempC: brake,
  compound: 0,
  ...extra,
});

const snapshot = (wheels: TyreWheelState[]): TyreStateSnapshot => ({
  available: true,
  wheels,
  sessionNum: 0,
  version: 1,
});

const story = (
  tyres: TyreStateSnapshot,
  config: Record<string, unknown> = {}
) => ({
  decorators: [
    TelemetryDecoratorWithConfig('/test-data/1747384033336', {
      tyres: config,
    }),
    ChannelSnapshotDecorator({ 'tyre-state.snapshot': tyres }),
    // The widget fills its overlay window, so the story supplies one of the
    // default size rather than letting it span the page.
    (Story: React.ComponentType) => (
      <div style={{ width: 240, height: 380 }}>
        <Story />
      </div>
    ),
  ],
});

const meta: Meta<typeof Tyres> = {
  component: Tyres,
  title: 'widgets/Tyres',
};

export default meta;

type Story = StoryObj<typeof Tyres>;

/** A GT3 mid-stint: everything in its window. */
export const InTheWindow: Story = {
  ...story(
    snapshot([
      wheel([88, 92, 95], 480, 186.1),
      wheel([87, 91, 96], 495, 186.9),
      wheel([90, 93, 94], 410, 185.2),
      wheel([89, 92, 95], 405, 185.9),
    ])
  ),
};

/** Leaving the pits: tyres and brakes both well under temperature. */
export const ColdOutLap: Story = {
  ...story(
    snapshot([
      wheel([52, 54, 55], 160, 168.4),
      wheel([51, 54, 56], 165, 168.1),
      wheel([55, 56, 56], 150, 167.5),
      wheel([54, 56, 57], 152, 167.9),
    ])
  ),
};

/**
 * A front left taking a beating: the outer shoulder far hotter than the inner,
 * and the front brakes past their window while the rears are fine.
 */
export const OverheatingFronts: Story = {
  ...story(
    snapshot([
      wheel([131, 118, 104], 760, 196.4),
      wheel([112, 109, 101], 735, 194.8),
      wheel([97, 96, 95], 520, 188.2),
      wheel([98, 97, 95], 515, 188.9),
    ])
  ),
};

/**
 * Colouring pressures against a target: on target, low and high, with tread
 * remaining shown.
 */
export const TargetPressure: Story = {
  ...story(
    snapshot([
      wheel([88, 92, 95], 480, 186.1, { treadRemaining: 0.91 }),
      wheel([87, 91, 96], 495, 191.7, { treadRemaining: 0.9 }),
      wheel([90, 93, 94], 410, 180.4, { treadRemaining: 0.94 }),
      wheel([89, 92, 95], 405, 186.4, { treadRemaining: 0.93 }),
    ]),
    {
      showWear: true,
      pressureTarget: { enabled: true, front: 186, rear: 186, tolerance: 3.5 },
    }
  ),
};

/** The carcass, in Fahrenheit and bar. */
export const CarcassImperial: Story = {
  ...story(
    snapshot([
      wheel([88, 92, 95], 480, 186.1),
      wheel([87, 91, 96], 495, 186.9),
      wheel([90, 93, 94], 410, 185.2),
      wheel([89, 92, 95], 405, 185.9),
    ]),
    {
      temperatureSource: 'carcass',
      temperatureUnit: 'fahrenheit',
      pressureUnit: 'bar',
    }
  ),
};

/** Tyres only, for a narrow slot. */
export const WithoutBrakes: Story = {
  ...story(
    snapshot([
      wheel([88, 92, 95], 480, 186.1),
      wheel([87, 91, 96], 495, 186.9),
      wheel([90, 93, 94], 410, 185.2),
      wheel([89, 92, 95], 405, 185.9),
    ]),
    { showBrakes: false }
  ),
};

/**
 * Out of the car: the sim publishes no wheel data, and the widget keeps its
 * shape so it can still be placed.
 */
export const NoReading: Story = {
  ...story({ available: false, wheels: [], sessionNum: null, version: 1 }),
};
