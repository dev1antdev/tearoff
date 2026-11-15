import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useDrivingState } from '@irdashies/context';
import type {
  ChannelBridge,
  ChannelName,
  ChannelPayloads,
  FuelProjectionSnapshot,
  LayoutNode,
} from '@irdashies/types';
import { defaultFuelCalculatorSettings } from './defaults';
import { demoFuelData } from './demoData';
import { FuelCalculatorDisplay } from './FuelCalculatorDisplay';
import type { FuelCalculation } from './types';

vi.mock('@irdashies/context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@irdashies/context')>()),
  useDashboard: () => ({ editMode: false, currentDashboard: undefined }),
  useDrivingState: vi.fn(),
}));

/** Where the user is, as useDrivingState says it; nowhere unless told. */
const where = (
  state: Partial<ReturnType<typeof useDrivingState>> = {}
): ReturnType<typeof useDrivingState> => ({
  isDriving: false,
  isWatching: false,
  isWatchingOwnCar: false,
  isWatchingOtherCar: false,
  ...state,
});

/** An LMGT3 on virtual energy, as the processor publishes it at the wheel. */
const atTheWheel: FuelProjectionSnapshot = {
  isReplay: false,
  budget: 'virtualEnergy',
  tank: { level: 40.3, perLap: 2.3 },
  fuelLevel: 40.4,
  fuelLevelPct: 0.404,
  currentLap: 3,
  lapDistPct: 0.4,
  currentLapUsage: 0.9,
  projectedLapUsage: 2.3,
  lastLapUsage: 2.3,
  sessionLapsRemain: 32767,
  sessionTimeRemain: 700,
  sessionTimeTotal: 1035,
  sessionFlags: 0,
  sessionState: 4,
  sessionNum: 0,
  sessionLaps: '2147483647',
  calculatedTotalRaceLaps: 11,
  estimatedLapsRemaining: 9,
  hasValidRaceEstimate: true,
  isFixedLapRace: false,
  sessionType: 'Race',
  isOnTrack: true,
  trackId: 'Laguna Seca',
  carName: 'Ferrari 296 LMGT3 Evo (virtual energy)',
  fuelTankCapacity: 100,
  completedLaps: [],
  engine: {
    accumulatedRefuel: 0,
    isLapDistPctReset: false,
    lapCrossingTime: 320,
    lapStartFuel: 41.3,
    lastLap: 3,
    lastLapDistPct: 0.4,
    lastSessionFlags: 0,
    wasOnPitRoad: false,
  },
};

/** The same car with a team-mate in it, its energy still being written. */
const teamMateDriving: FuelProjectionSnapshot = {
  ...atTheWheel,
  isOnTrack: false,
  watched: true,
};

/**
 * A car counted in litres with the AI driving it for the user: the sim goes
 * on writing its tank in the car's telemetry block, which is read for it.
 */
const aiDrivingOnFuel: FuelProjectionSnapshot = {
  ...atTheWheel,
  budget: 'fuel',
  tank: undefined,
  fuelLevel: 54.2,
  fuelLevelPct: 0.7227,
  fuelTankCapacity: 75,
  carName: 'Oreca 07',
  isOnTrack: false,
  watched: true,
};

/**
 * A team-mate in a car the sim writes no budget for: one counted in litres
 * that a person is driving on another machine, or one on energy with no
 * telemetry block. The figures are the last read.
 */
const teamMateUnread: FuelProjectionSnapshot = {
  ...atTheWheel,
  isOnTrack: false,
};

const energyData: FuelCalculation = {
  ...demoFuelData,
  budget: 'virtualEnergy',
  tank: { level: 40.3, laps: 17.5 },
  fuelLevel: 40.4,
  fuelTankCapacity: 100,
};

const litresData: FuelCalculation = {
  ...demoFuelData,
  budget: 'fuel',
  tank: undefined,
  fuelLevel: 54.2,
  fuelTankCapacity: 75,
};

const layout: LayoutNode = {
  id: 'spec',
  type: 'box',
  direction: 'col',
  widgets: ['fuelHeader', 'fuelGauge'],
};

const show = (
  projection: FuelProjectionSnapshot,
  state: ReturnType<typeof useDrivingState>,
  showOnlyWhenOnTrack = true,
  fuelData: FuelCalculation = energyData
) => {
  const bridge: ChannelBridge = {
    subscribe: <K extends ChannelName>(
      channel: K,
      callback: (payload: ChannelPayloads[K]) => void
    ) => {
      if (channel === 'fuel.projection') {
        callback(projection as ChannelPayloads[K]);
      }
      return () => undefined;
    },
  };
  window.channelBridge = bridge;
  vi.mocked(useDrivingState).mockReturnValue(state);
  return render(
    <FuelCalculatorDisplay
      {...defaultFuelCalculatorSettings}
      showOnlyWhenOnTrack={showOnlyWhenOnTrack}
      layoutTree={layout}
      fuelData={fuelData}
    />
  ).container;
};

const watchingOwnCar = where({ isWatching: true, isWatchingOwnCar: true });
const watchingRival = where({ isWatching: true, isWatchingOtherCar: true });

describe('Fuel Calculator on and off the track', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is shown while the user drives', () => {
    expect(show(atTheWheel, where({ isDriving: true })).firstChild).not.toBe(
      null
    );
  });

  it('is hidden out of the car with nothing watched', () => {
    expect(show(teamMateUnread, where()).firstChild).toBeNull();
  });

  it('is shown through a team-mate’s stint in a car on virtual energy', () => {
    const container = show(teamMateDriving, watchingOwnCar);

    expect(container.firstChild).not.toBeNull();
    // The team car's energy, in percent.
    expect(container.textContent).toContain('40.4');
  });

  it('is shown in litres while the AI drives the car, where the sim writes its tank', () => {
    const container = show(aiDrivingOnFuel, watchingOwnCar, true, litresData);

    expect(container.firstChild).not.toBeNull();
    expect(container.textContent).toContain('54.2');
  });

  it('stays hidden while the camera is on another car', () => {
    // The energy is still the team car's, which is not the car on screen.
    expect(show(teamMateDriving, watchingRival).firstChild).toBeNull();
  });

  it('stays hidden for a car the sim writes nothing for', () => {
    // No fuel level for a car the user is not in, and no energy without a
    // telemetry block: the figures would be the last ones read.
    expect(show(teamMateUnread, watchingOwnCar).firstChild).toBeNull();
  });

  it('is shown wherever the user is when told to stay on screen', () => {
    expect(show(teamMateUnread, where(), false).firstChild).not.toBeNull();
    expect(show(teamMateDriving, watchingRival, false).firstChild).not.toBe(
      null
    );
  });
});
