import { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  TelemetryDecoratorWithConfig,
} from '@irdashies/storybook';
import type {
  TyreStateSnapshot,
  TyreWheelState,
  WheelDynamicsSnapshot,
} from '@irdashies/types';
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
  pressureDeviationKpa: null,
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

/**
 * The wheel channel as an LMGT3 gives it on a straight: no tyre load, so the
 * shares come from suspension force, 46 % of it on the front axle.
 */
const dynamics = (
  over: Partial<WheelDynamicsSnapshot> = {}
): WheelDynamicsSnapshot => ({
  available: true,
  rideHeightMm: [51.2, 50.1, 60.3, 59.4],
  suspensionPositionMm: [64.8, 65.6, 76.6, 77.9],
  loadShare: [0.232, 0.228, 0.274, 0.266],
  loadSource: 'suspensionForce',
  loadTotalN: 18_940,
  tyreDeflectionMm: [15.9, 17.1, 18.9, 20.1],
  camberDeg: [-2.01, -2.18, -1.7, -1.61],
  toeDeg: [-0.05, -0.05, 0.1, 0.11],
  toeTotalDeg: [-0.1, 0.21],
  rakeMm: 8.9,
  rollMm: [-1.1, -0.9],
  rollShareFront: 0.55,
  sessionNum: 0,
  version: 1,
  ...over,
});

const noDynamics: WheelDynamicsSnapshot = {
  available: false,
  rideHeightMm: null,
  suspensionPositionMm: null,
  loadShare: null,
  loadSource: null,
  loadTotalN: null,
  tyreDeflectionMm: null,
  camberDeg: null,
  toeDeg: null,
  toeTotalDeg: null,
  rakeMm: null,
  rollMm: null,
  rollShareFront: null,
  sessionNum: null,
  version: 1,
};

/** The height the widget wants with the load and deflection rows on. */
const TALL = 430;

const story = (
  tyres: TyreStateSnapshot,
  config: Record<string, unknown> = {},
  wheelDynamics?: WheelDynamicsSnapshot,
  height = 380
) => ({
  decorators: [
    TelemetryDecoratorWithConfig('/test-data/1747384033336', {
      tyres: config,
    }),
    ChannelSnapshotDecorator({
      'tyre-state.snapshot': tyres,
      ...(wheelDynamics ? { 'wheel-dynamics.snapshot': wheelDynamics } : {}),
    }),
    // The widget fills its overlay window, so the story supplies one of the
    // default size rather than letting it span the page.
    (Story: React.ComponentType) => (
      <div style={{ width: 240, height }}>
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

/**
 * Leaving the pits: tyres and brakes both well under temperature, and the
 * pressures drawn blue, as the carcasses are under 65 C and these are not
 * yet the pressures the tyres will run.
 */
export const ColdOutLap: Story = {
  ...story(
    snapshot([
      wheel([52, 54, 55], 160, 168.4, { carcassTempC: 47 }),
      wheel([51, 54, 56], 165, 168.1, { carcassTempC: 47 }),
      wheel([55, 56, 56], 150, 167.5, { carcassTempC: 49 }),
      wheel([54, 56, 57], 152, 167.9, { carcassTempC: 49 }),
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

const midStint = [
  wheel([88, 92, 95], 480, 171.2, {
    treadRemaining: 0.91,
    pressureDeviationKpa: 2.4,
  }),
  wheel([87, 91, 96], 495, 173.6, {
    treadRemaining: 0.9,
    pressureDeviationKpa: 0,
  }),
  wheel([90, 93, 94], 410, 169.8, {
    treadRemaining: 0.94,
    pressureDeviationKpa: 3.8,
  }),
  wheel([89, 92, 95], 405, 172.5, {
    treadRemaining: 0.93,
    pressureDeviationKpa: 1.1,
  }),
];

const everyRow = {
  showWear: true,
  showLoad: true,
  showDeflection: true,
  showPressureDeviation: true,
};

/**
 * Every optional row on: the offset from the highest pressure under each
 * pressure, tyre deflection beside the tread, and the load bar under each
 * tyre, growing outwards and full at half the load of the car.
 */
export const LoadDeflectionAndDeviation: Story = {
  ...story(snapshot(midStint), everyRow, dynamics(), TALL),
};

/**
 * Through a fast right-hander: the load sits on the left-hand wheels and the
 * right-hand bars shrink towards the centre of the car.
 */
export const LoadInACorner: Story = {
  ...story(
    snapshot(midStint),
    { showLoad: true, showDeflection: true },
    dynamics({
      loadShare: [0.352, 0.098, 0.401, 0.149],
      tyreDeflectionMm: [27.4, 8.2, 31.6, 11.3],
    }),
    TALL
  ),
};

/**
 * Over a kerb with the right front in the air: no deflection and no load, so
 * the figure and the whole bar turn red.
 */
export const WheelInTheAir: Story = {
  ...story(
    snapshot(midStint),
    everyRow,
    dynamics({
      loadShare: [0.386, 0, 0.268, 0.346],
      tyreDeflectionMm: [29.3, 0, 17.2, 24.8],
    }),
    TALL
  ),
};

/** The pressure offsets alone, in kPa: nothing else changes, and it fits. */
export const PressureDeviation: Story = {
  ...story(snapshot(midStint), {
    showPressureDeviation: true,
    pressureUnit: 'kpa',
  }),
};

/**
 * Fresh rears against a target: the warm fronts are judged against it and
 * read green. The rears are over it and would read red, but their carcasses
 * are under 65 C, so they are drawn blue instead: a cold pressure will climb
 * as the tyre warms and cannot be judged against a hot target.
 */
export const ColdRearsAgainstTarget: Story = {
  ...story(
    snapshot([
      wheel([88, 92, 95], 480, 186.1),
      wheel([87, 91, 96], 495, 186.9),
      wheel([52, 54, 55], 410, 191.6, { carcassTempC: 48 }),
      wheel([51, 54, 56], 405, 192.3, { carcassTempC: 47 }),
    ]),
    {
      pressureTarget: { enabled: true, front: 186, rear: 186, tolerance: 3.5 },
    }
  ),
};

/**
 * A build of the sim that publishes neither tyre load nor suspension force:
 * the deflection is still read, and the load bar is not drawn at all.
 */
export const NoLoadPublished: Story = {
  ...story(
    snapshot(midStint),
    everyRow,
    dynamics({ loadShare: null, loadSource: null, loadTotalN: null }),
    TALL
  ),
};

/**
 * Out of the car with every row on: each keeps its place, with a placeholder
 * and an empty bar.
 */
export const NoReadingEveryRow: Story = {
  ...story(
    { available: false, wheels: [], sessionNum: null, version: 1 },
    everyRow,
    noDynamics,
    TALL
  ),
};
