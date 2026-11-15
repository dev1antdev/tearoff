import { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  TelemetryDecoratorWithConfig,
} from '@irdashies/storybook';
import type { DamageSnapshot, DamageWheel } from '@irdashies/types';
import { Damage } from './Damage';

const wheel = (values: Partial<DamageWheel> = {}): DamageWheel => ({
  detached: false,
  punctured: false,
  suspensionDamage: 0,
  ...values,
});

/** A sound car, part-way through a stint. */
const snapshot = (values: Partial<DamageSnapshot> = {}): DamageSnapshot => ({
  available: true,
  body: [0, 0, 0, 0, 0, 0, 0, 0],
  wheels: [wheel(), wheel(), wheel(), wheel()],
  bodyIntegrity: 1,
  aeroIntegrity: 1,
  suspensionIntegrity: 1,
  tyreIntegrity: 0.98,
  overheating: false,
  impactBearingRad: null,
  repairSeconds: 0,
  repairChoice: null,
  sessionNum: 0,
  version: 1,
  ...values,
});

/** The car of the recorded race from 240.7 s on: one light dent at the nose. */
const frontDent = (values: Partial<DamageSnapshot> = {}): DamageSnapshot =>
  snapshot({
    body: [1, 0, 0, 0, 0, 0, 0, 0],
    bodyIntegrity: 0.94,
    aeroIntegrity: 0.97,
    repairChoice: 'Do Not Repair',
    ...values,
  });

const story = (
  damage: DamageSnapshot | undefined,
  config: Record<string, unknown> = {},
  size: { width: number; height: number } = { width: 220, height: 132 }
) => ({
  decorators: [
    TelemetryDecoratorWithConfig('/test-data/1747384033336', {
      damage: config,
    }),
    ChannelSnapshotDecorator(damage ? { 'damage.snapshot': damage } : {}),
    // The widget fills its overlay window, so the story supplies one of the
    // default size and the overlay's own type scale.
    (Story: React.ComponentType) => (
      <div
        className="overlay-window overlay-theme-sm overlay-theme-font-face-lato overlay-theme-font-weight-normal"
        style={size}
      >
        <Story />
      </div>
    ),
  ],
});

const meta: Meta<typeof Damage> = {
  component: Damage,
  title: 'widgets/Damage',
};

export default meta;

type Story = StoryObj<typeof Damage>;

/** Nothing wrong with the car: a grey outline and four green wheels. */
export const Undamaged: Story = {
  ...story(snapshot()),
};

/**
 * The recorded race just after its hardest knock: the nose dented, the aero
 * figure down three per cent, the impact still marked, and the pit menu
 * offering a body repair it has not been told to make.
 */
export const FrontDent: Story = {
  ...story(frontDent({ impactBearingRad: 0.23 })),
};

/** The same car once the impact mark has gone: how it stays for the race. */
export const FrontDentSettled: Story = {
  ...story(frontDent()),
};

/** The repair chosen in the pit menu, and the time it adds to the stop. */
export const RepairSelected: Story = {
  ...story(frontDent({ repairSeconds: 35, repairChoice: 'Repair Body' })),
};

/**
 * A heavy crash: the right-hand side stove in, the rear wing gone, the right
 * rear wheel off, the right front tyre flat, the left rear suspension bent,
 * and the engine overheating. Built from TinyPedal's reading of the sim: no
 * recording holds any of it.
 */
export const HeavyDamage: Story = {
  ...story(
    snapshot({
      body: [1, 2, 2, 2, 3, 1, 0, 0],
      wheels: [
        wheel({ suspensionDamage: 0.04 }),
        wheel({ punctured: true, suspensionDamage: 0.22 }),
        wheel({ suspensionDamage: 0.47 }),
        wheel({ detached: true, suspensionDamage: 1 }),
      ],
      bodyIntegrity: 0.31,
      aeroIntegrity: 0.38,
      suspensionIntegrity: 0,
      tyreIntegrity: 0.61,
      overheating: true,
      impactBearingRad: 1.92,
      repairSeconds: 95,
      repairChoice: 'Repair All',
    })
  ),
};

/** A hit from behind on the left, counted as damage rather than integrity. */
export const DamageCounted: Story = {
  ...story(
    snapshot({
      body: [0, 0, 0, 0, 1, 2, 1, 0],
      wheels: [
        wheel(),
        wheel(),
        wheel({ suspensionDamage: 0.18 }),
        wheel({ suspensionDamage: 0.03 }),
      ],
      bodyIntegrity: 0.75,
      aeroIntegrity: 0.82,
      suspensionIntegrity: 0.82,
      tyreIntegrity: 0.9,
      impactBearingRad: 3.75,
      repairChoice: 'Do Not Repair',
    }),
    { diagram: { reading: 'aero', showDamage: true } }
  ),
};

/**
 * In the car before the sim's REST API has answered: the dents are there, the
 * wheels are unknown, and the figure in the car is the body's.
 */
export const WaitingForTheSim: Story = {
  ...story(
    snapshot({
      wheels: [
        wheel({ suspensionDamage: null }),
        wheel({ suspensionDamage: null }),
        wheel({ suspensionDamage: null }),
        wheel({ suspensionDamage: null }),
      ],
      aeroIntegrity: null,
      suspensionIntegrity: null,
      repairSeconds: null,
    })
  ),
};

/**
 * Out of the car: the sim publishes nothing, and the widget keeps its shape
 * so it can still be placed.
 */
export const NoData: Story = {
  ...story({
    ...snapshot(),
    available: false,
    aeroIntegrity: null,
    suspensionIntegrity: null,
    tyreIntegrity: null,
    repairSeconds: null,
  }),
};

/** Before the first snapshot has arrived at all. */
export const NoSnapshot: Story = {
  ...story(undefined),
};

/** The car on its own, for a narrow slot. */
export const DiagramOnly: Story = {
  ...story(
    frontDent({ impactBearingRad: 0.23 }),
    { stats: { enabled: false }, repair: { enabled: false } },
    { width: 104, height: 132 }
  ),
};

/** The four figures and the repair, without the car. */
export const FiguresOnly: Story = {
  ...story(
    frontDent({ repairSeconds: 35, repairChoice: 'Repair Body' }),
    { diagram: { enabled: false } },
    { width: 150, height: 132 }
  ),
};

/** Twice the default size: the diagram scales with the window. */
export const Large: Story = {
  ...story(
    frontDent({ impactBearingRad: 0.23 }),
    {},
    { width: 440, height: 264 }
  ),
};
