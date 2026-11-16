import type { ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  createMockBridgeWithConfig,
  trackStateStorySnapshot,
} from '@irdashies/storybook';
import { DashboardProvider, useSessionStore } from '@irdashies/context';
import {
  EMPTY_PLAYER_STINT,
  type FuelLapData,
  type FuelProjectionSnapshot,
  type FuelSaverConfig,
  type LedgerStint,
  type PitStopSnapshot,
  type PlayerStintSnapshot,
  type Session,
  type TrackStateSnapshot,
} from '@irdashies/types';
import { FuelSaver } from './FuelSaver';

/** The widget's default box: stories show what the driver gets. */
const BOX = { width: 300, height: 112 };

const session = (sessionType: string): Session =>
  ({
    WeekendInfo: { NumCarClasses: 3 },
    SessionInfo: { Sessions: [{ SessionNum: 0, SessionType: sessionType }] },
    DriverInfo: { DriverCarIdx: 0, Drivers: [{ CarIdx: 0 }] },
  }) as unknown as Session;

const lap = (
  fuelUsed: number,
  values: Partial<FuelLapData> = {}
): FuelLapData => ({
  lapNumber: 1,
  fuelUsed,
  lapTime: 86.7,
  isGreenFlag: true,
  isValidForCalc: true,
  isOutLap: false,
  timestamp: 0,
  ...values,
});

/** Everything the saver reads of the projection; the rest is left empty. */
const projection = (
  values: Partial<FuelProjectionSnapshot>
): FuelProjectionSnapshot =>
  ({
    isReplay: false,
    fuelLevel: 0,
    fuelLevelPct: 0,
    currentLap: 3,
    lapDistPct: 0.4,
    currentLapUsage: 0,
    projectedLapUsage: 0,
    lastLapUsage: 0,
    estimatedLapsRemaining: 0,
    hasValidRaceEstimate: false,
    isOnTrack: true,
    completedLaps: [],
    ...values,
  }) as FuelProjectionSnapshot;

/**
 * The recorded LMGT3 as the recording leaves it: 38.7 % of its energy
 * aboard, 2.33 % on the last lap and 1.7 % into this one.
 */
const recorded = (
  values: Partial<FuelProjectionSnapshot> = {}
): FuelProjectionSnapshot =>
  projection({
    budget: 'virtualEnergy',
    fuelLevel: 38.7,
    currentLapUsage: 1.7,
    projectedLapUsage: 2.33,
    lastLapUsage: 2.33,
    fuelTankCapacity: 100,
    completedLaps: [lap(2.33), lap(2.4)],
    ...values,
  });

/** A car on fuel half way through a stint. */
const fuelCar = (
  values: Partial<FuelProjectionSnapshot> = {}
): FuelProjectionSnapshot =>
  projection({
    fuelLevel: 41.6,
    currentLapUsage: 1.1,
    projectedLapUsage: 2.71,
    lastLapUsage: 2.78,
    fuelTankCapacity: 110,
    completedLaps: [lap(2.78), lap(2.74), lap(2.69)],
    ...values,
  });

const stintOf = (laps: number): PlayerStintSnapshot => ({
  ...EMPTY_PLAYER_STINT,
  available: true,
  state: 'running',
  stint: { laps } as LedgerStint,
  version: 1,
});

interface StoryOptions {
  config?: Partial<FuelSaverConfig>;
  sessionType?: string;
  stint?: PlayerStintSnapshot;
  trackState?: Partial<TrackStateSnapshot>;
  pitEntryPct?: number;
  size?: { width: number; height: number };
}

const story = (
  fuel: FuelProjectionSnapshot | undefined,
  {
    config = {},
    sessionType = 'Race',
    stint = stintOf(2),
    trackState = {},
    pitEntryPct,
    size = BOX,
  }: StoryOptions = {}
) => {
  const bridge = createMockBridgeWithConfig({ fuelsaver: config });
  return {
    loaders: [
      async () => {
        useSessionStore.setState({ session: session(sessionType) });
      },
    ],
    decorators: [
      (Story: ComponentType) => (
        <DashboardProvider bridge={bridge}>
          {/* The widget fills its overlay window, so the story supplies
              one of the default size and the overlay's own type scale. */}
          <div
            className="overlay-window overlay-theme-sm overlay-theme-font-face-lato overlay-theme-font-weight-normal"
            style={size}
          >
            <Story />
          </div>
        </DashboardProvider>
      ),
      ChannelSnapshotDecorator({
        ...(fuel ? { 'fuel.projection': fuel } : {}),
        'player-stint.snapshot': stint,
        'track-state.snapshot': { ...trackStateStorySnapshot, ...trackState },
        ...(pitEntryPct === undefined
          ? {}
          : {
              'pit-stop.snapshot': {
                lane: { entryPct: pitEntryPct },
              } as PitStopSnapshot,
            }),
      }),
    ],
  };
};

const meta: Meta<typeof FuelSaver> = {
  component: FuelSaver,
  title: 'widgets/FuelSaver',
};

export default meta;

type Story = StoryObj<typeof FuelSaver>;

/**
 * The recorded car at the end of the recording, in practice: the energy
 * lasts 17 laps from the start of this one, and each lap more asks for a
 * little less a lap. All three are within the 15 % that is called reachable.
 */
export const EnergyCar: Story = {
  ...story(recorded(), {
    sessionType: 'Practice',
    size: { width: 300, height: 96 },
  }),
};

/** The same in a race that needs one more stop, which saving cannot drop. */
export const EnergyCarRace: Story = {
  ...story(
    recorded({ hasValidRaceEstimate: true, estimatedLapsRemaining: 41.6 })
  ),
};

/**
 * A stop that can be dropped: 20 laps to go on a budget that lasts a little
 * over 19, so 6 % less a lap makes it to the flag.
 */
export const Achievable: Story = {
  ...story(
    recorded({
      fuelLevel: 44.2,
      currentLapUsage: 0.9,
      hasValidRaceEstimate: true,
      estimatedLapsRemaining: 20.2,
    }),
    { stint: stintOf(14) }
  ),
};

/**
 * Two laps short with a third of the race left: the stop cannot be dropped
 * by any driving, and the widget says how far off it is.
 */
export const NotAchievable: Story = {
  ...story(
    recorded({
      fuelLevel: 30.1,
      currentLapUsage: 0.9,
      hasValidRaceEstimate: true,
      estimatedLapsRemaining: 18.4,
    }),
    { stint: stintOf(21) }
  ),
};

/**
 * Already saving: the lap under way projects under the target, the centre
 * column turns green and, with the finish in reach, the stop line goes.
 */
export const InsideTheTarget: Story = {
  ...story(
    recorded({
      fuelLevel: 44.2,
      currentLapUsage: 0.9,
      projectedLapUsage: 2.18,
      hasValidRaceEstimate: true,
      estimatedLapsRemaining: 20.2,
    }),
    { stint: stintOf(14) }
  ),
};

/** A car on fuel, in litres. */
export const FuelCar: Story = {
  ...story(
    fuelCar({ hasValidRaceEstimate: true, estimatedLapsRemaining: 33.5 }),
    { stint: stintOf(9) }
  ),
};

/** The same in gallons, with a gallon held back. */
export const FuelCarGallons: Story = {
  ...story(
    fuelCar({ hasValidRaceEstimate: true, estimatedLapsRemaining: 33.5 }),
    { stint: stintOf(9), config: { fuelUnits: 'gal', reserve: 1 } }
  ),
};

/** Two laps fewer and five more: the widest the table gets. */
export const WidestTable: Story = {
  ...story(recorded(), {
    sessionType: 'Practice',
    config: { fewerLaps: 2, moreLaps: 5 },
    size: { width: 440, height: 96 },
  }),
};

/** Compared with the average, without the last lap or the stop line. */
export const AverageBasis: Story = {
  ...story(
    recorded({ hasValidRaceEstimate: true, estimatedLapsRemaining: 41.6 }),
    {
      config: { basis: 'average', showLast: false, showStopTarget: false },
      size: { width: 300, height: 96 },
    }
  ),
};

/** Counting the last lap of the stint only as far as a pit entry at 95 %. */
export const ToPitEntry: Story = {
  ...story(recorded(), {
    sessionType: 'Practice',
    config: { pitEntryAllowance: true },
    pitEntryPct: 0.95,
    size: { width: 300, height: 96 },
  }),
};

/**
 * No stint on record: a team-mate's stint, or the stint channel not there
 * yet. The captions fall back to the laps to go.
 */
export const NoStint: Story = {
  ...story(recorded(), {
    sessionType: 'Practice',
    stint: EMPTY_PLAYER_STINT,
    size: { width: 300, height: 96 },
  }),
};

/** In the car before a lap has been measured: dashes, in the same shape. */
export const NoConsumptionYet: Story = {
  ...story(
    projection({ budget: 'virtualEnergy', fuelLevel: 45, lapDistPct: 0.3 }),
    { stint: stintOf(0), size: { width: 300, height: 96 } }
  ),
};

/** A team-mate at the wheel with the camera on the team car: it stays up. */
export const TeamMateDriving: Story = {
  ...story(recorded({ watched: true }), {
    sessionType: 'Practice',
    stint: EMPTY_PLAYER_STINT,
    trackState: {
      isOnTrack: false,
      outOfCar: true,
      watching: true,
      watchingOwnCar: true,
      focusCarIdx: 0,
    },
    size: { width: 300, height: 96 },
  }),
};

/** The camera on a rival: the figures are not that car's, and it hides. */
export const WatchingARival: Story = {
  ...story(recorded(), {
    trackState: {
      isOnTrack: false,
      outOfCar: true,
      watching: true,
      watchingOwnCar: false,
      focusCarIdx: 5,
    },
  }),
};
