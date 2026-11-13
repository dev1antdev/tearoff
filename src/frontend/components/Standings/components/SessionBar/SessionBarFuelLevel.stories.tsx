import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  TelemetryDecorator,
} from '@irdashies/storybook';
import { getWidgetDefaultConfig } from '@irdashies/types';
import type { SessionBarSnapshot } from '@irdashies/types';
import { SessionBar } from './SessionBar';

const snapshot = (
  overrides: Partial<SessionBarSnapshot>
): SessionBarSnapshot => ({
  displayUnits: 1,
  trackWetness: 1,
  brakeBiasIsClio: false,
  incidents: 0,
  playerCarIdx: 0,
  playerClassified: true,
  playerOverallPosition: 1,
  playerClassPosition: 1,
  playerClassSize: 1,
  competitorCarIds: [],
  competitorPositions: [],
  lastLapTopSpeed: null,
  sessionBestTopSpeed: null,
  sessionNum: 0,
  version: 1,
  ...overrides,
});

const meta = {
  component: SessionBar,
  title: 'widgets/Standings/components/SessionBar/FuelLevel',
  decorators: [TelemetryDecorator()],
  args: {
    settings: {
      ...getWidgetDefaultConfig('standings').headerBar,
      fuelLevel: { enabled: true },
      displayOrder: ['fuelLevel'],
    },
    position: 'header',
  },
} satisfies Meta<typeof SessionBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A fuel-limited car, and every car under iRacing: litres, as before. */
export const Fuel: Story = {
  decorators: [
    ChannelSnapshotDecorator({
      'session-bar.snapshot': snapshot({ fuelLevel: 32.5 }),
    }),
  ],
};

/**
 * A Le Mans Ultimate car that runs on virtual energy: the energy first,
 * because it is what ends the stint, then the litres.
 */
export const VirtualEnergy: Story = {
  decorators: [
    ChannelSnapshotDecorator({
      'session-bar.snapshot': snapshot({
        fuelLevel: 44.9,
        virtualEnergy: 0.452,
      }),
    }),
  ],
};

/** Out of energy with fuel still aboard, which is the case the item is for. */
export const VirtualEnergyEmpty: Story = {
  decorators: [
    ChannelSnapshotDecorator({
      'session-bar.snapshot': snapshot({ fuelLevel: 12.3, virtualEnergy: 0 }),
    }),
  ],
};

export const VirtualEnergyStandalone: Story = {
  ...VirtualEnergy,
  args: { standalone: true },
};
