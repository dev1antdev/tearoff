import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
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
import {
  formatFuel,
  fuelDisplayUnit,
  fuelDisplayValue,
  refuelLevelPercent,
} from './fuelCalculations';
import { useFuelStore } from './FuelStore';
import type { FuelCalculation } from './types';
import { useFuelCalculation } from './useFuelCalculation';

const lap = (lapNumber: number, fuelUsed: number) => ({
  lapNumber,
  fuelUsed,
  lapTime: 87,
  isGreenFlag: true,
  isValidForCalc: true,
  isOutLap: false,
  isInLap: false,
  wasTowed: false,
  timestamp: lapNumber * 87000,
  sessionNum: 0,
});

/** An LMGT3 two laps into a timed race, as the processor publishes it. */
const energyProjection: FuelProjectionSnapshot = {
  isReplay: false,
  budget: 'virtualEnergy',
  tank: { level: 40.3, perLap: 2.3 },
  fuelLevel: 40.4,
  fuelLevelPct: 0.404,
  currentLap: 3,
  lapDistPct: 0.001,
  currentLapUsage: 0,
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
  completedLaps: [lap(2, 2.3), lap(1, 2.25)],
  engine: {
    accumulatedRefuel: 0,
    isLapDistPctReset: false,
    lapCrossingTime: 320,
    lapStartFuel: 40.4,
    lastLap: 3,
    lastLapDistPct: 0.001,
    lastSessionFlags: 0,
    wasOnPitRoad: false,
  },
};

vi.mock('@irdashies/context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@irdashies/context')>()),
  useDashboard: () => ({ editMode: false, currentDashboard: undefined }),
}));

/** The same snapshot from a car on fuel: no budget and no tank beside it. */
const fuelProjection: FuelProjectionSnapshot = { ...energyProjection };
delete fuelProjection.budget;
delete fuelProjection.tank;

const bridgeFor = (snapshot: FuelProjectionSnapshot): ChannelBridge => ({
  subscribe: <K extends ChannelName>(
    _channel: K,
    callback: (payload: ChannelPayloads[K]) => void
  ) => {
    callback(snapshot as ChannelPayloads[K]);
    return () => undefined;
  },
});

describe('virtual energy units', () => {
  it('shows virtual energy in percent whatever fuel unit is chosen', () => {
    expect(fuelDisplayUnit('virtualEnergy', 'L')).toBe('%');
    expect(fuelDisplayUnit('virtualEnergy', 'gal')).toBe('%');
    expect(fuelDisplayUnit('fuel', 'gal')).toBe('gal');
    expect(fuelDisplayUnit(undefined, 'L')).toBe('L');
  });

  it('writes percent against the number and converts nothing', () => {
    expect(fuelDisplayValue(45, '%')).toBe(45);
    expect(formatFuel(45, '%', 1)).toBe('45.0%');
    expect(formatFuel(2.326, '%')).toBe('2.33%');
    // The fuel units are as they were.
    expect(formatFuel(45, 'L', 1)).toBe('45.0 L');
    expect(formatFuel(10, 'gal', 1)).toBe('2.6 gal');
  });

  it('rounds the level to set up to a whole percent and holds it at full', () => {
    expect(refuelLevelPercent(61.2)).toBe(62);
    expect(refuelLevelPercent(62)).toBe(62);
    // Float noise above a whole number is not another percent.
    expect(refuelLevelPercent(62.0000001)).toBe(62);
    expect(refuelLevelPercent(133.4)).toBe(100);
    expect(refuelLevelPercent(-3)).toBe(0);
    expect(refuelLevelPercent(Number.NaN)).toBe(0);
  });
});

describe('useFuelCalculation on virtual energy', () => {
  beforeEach(() => {
    useFuelStore.getState().clearAllData();
    window.channelBridge = bridgeFor(energyProjection);
  });

  const calculate = (settings = {}) =>
    renderHook(() =>
      useFuelCalculation(1, {
        ...defaultFuelCalculatorSettings,
        safetyMargin: 1,
        enableStorage: false,
        enableLogging: false,
        ...settings,
      })
    );

  it('passes the budget through and counts in percent', async () => {
    const { result } = calculate();

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.budget).toBe('virtualEnergy');
    expect(result.current?.fuelLevel).toBe(40.4);
    expect(result.current?.avgLaps).toBeCloseTo(2.275, 6);
    // 40.4 % at 2.275 % a lap.
    expect(result.current?.lapsWithFuel).toBeCloseTo(40.4 / 2.275, 6);
    // Full at 100, from the processor, not a tank size guessed in litres.
    expect(result.current?.fuelTankCapacity).toBe(100);
  });

  it('works out how many laps the tank lasts', async () => {
    const { result } = calculate();

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.tank?.level).toBe(40.3);
    expect(result.current?.tank?.laps).toBeCloseTo(40.3 / 2.3, 6);
  });

  it('has no laps for a tank no lap has been measured on', async () => {
    window.channelBridge = bridgeFor({
      ...energyProjection,
      tank: { level: 44.9, perLap: 0 },
    });
    const { result } = calculate();

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.tank).toEqual({ level: 44.9, laps: null });
  });

  it('reads the safety margin as percent, not as gallons', async () => {
    const litres = calculate({ fuelUnits: 'L' });
    await waitFor(() => expect(litres.result.current).not.toBeNull());
    const inLitres = litres.result.current?.fuelToFinish;
    litres.unmount();

    const gallons = calculate({ fuelUnits: 'gal' });
    await waitFor(() => expect(gallons.result.current).not.toBeNull());

    // A margin of 1 is 1 % of energy either way. Read as gallons it was
    // multiplied into litres and asked for nearly four times as much.
    expect(gallons.result.current?.fuelToFinish).toBe(inLitres);
  });

  it('leaves a car on fuel without a budget or a tank line', async () => {
    window.channelBridge = bridgeFor(fuelProjection);
    const { result } = calculate();

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).not.toHaveProperty('budget');
    expect(result.current).not.toHaveProperty('tank');
  });
});

describe('Fuel Calculator on virtual energy', () => {
  const energyData: FuelCalculation = {
    ...demoFuelData,
    budget: 'virtualEnergy',
    tank: { level: 41.5, laps: 17.9 },
    fuelLevel: 38.9,
    lastLapUsage: 2.33,
    avgLaps: 2.29,
    avg10Laps: 2.29,
    minLapUsage: 2.25,
    maxLapUsage: 2.33,
    projectedLapUsage: 2.31,
    lapsWithFuel: 17,
    lapsRemaining: 32,
    totalLaps: 35,
    currentLap: 3,
    pitWindowOpen: 4,
    pitWindowClose: 16,
    fuelTankCapacity: 100,
  };
  const layout = (widgets: string[]): LayoutNode => ({
    id: 'spec',
    type: 'box',
    direction: 'col',
    widgets,
  });
  const show = (
    fuelData: FuelCalculation,
    widgets = ['fuelHeader', 'fuelGauge', 'fuelGrid']
  ) =>
    render(
      <FuelCalculatorDisplay
        {...defaultFuelCalculatorSettings}
        showOnlyWhenOnTrack={false}
        layoutTree={layout(widgets)}
        fuelData={fuelData}
      />
    );

  beforeEach(() => {
    window.channelBridge = bridgeFor(energyProjection);
  });

  it('shows the level to fill to where a tank has the amount to add', () => {
    show(energyData);

    expect(screen.getAllByText('FILL TO').length).toBeGreaterThan(0);
    expect(screen.queryByText('TO ADD')).toBeNull();
    // At the average: 31 laps after a stop at the end of this one, at
    // 2.29 % a lap, is 70.99 %, so the menu is set to 71.
    expect(screen.getAllByText('71%').length).toBeGreaterThan(0);
    expect(screen.getByText('Energy 38.90%')).toBeInTheDocument();
    expect(screen.getByText('Energy')).toBeInTheDocument();
    expect(screen.queryByText('Tank')).toBeNull();
    expect(screen.getByLabelText('Virtual energy')).toBeInTheDocument();
  });

  it('keeps the tank on a line of its own, in the fuel unit chosen', () => {
    show(energyData);

    const tank = screen.getByTestId('fuel-gauge-tank');
    expect(tank).toHaveTextContent('Fuel');
    expect(tank).toHaveTextContent('41.5 L');
    expect(tank).toHaveTextContent('17.9 laps');
    expect(tank).not.toHaveTextContent('Fuel ends first');
    expect(tank.className).toContain('text-slate-400');
  });

  it('says so when the tank will be empty before the energy', () => {
    show({ ...energyData, tank: { level: 38.8, laps: 16.7 } });

    const tank = screen.getByTestId('fuel-gauge-tank');
    expect(tank).toHaveTextContent('Fuel ends first');
    expect(tank).toHaveTextContent('16.7 laps');
    expect(tank.className).toContain('text-amber-400');
  });

  it('asks for a full budget, in red, when one stop is not enough', () => {
    show({ ...energyData, lapsRemaining: 70, totalLaps: 73 });

    const full = screen.getAllByText('100%');
    expect(full.length).toBeGreaterThan(0);
    expect(full[0].className).toContain('text-red-400');
  });

  it('has nothing to set when the energy reaches the flag', () => {
    show({ ...energyData, lapsRemaining: 12, totalLaps: 15 });

    expect(screen.getAllByText('OK').length).toBeGreaterThan(0);
    expect(screen.queryByText(/^\d+%$/)).toBeNull();
  });

  it('reads the planning rows as levels too', () => {
    render(
      <FuelCalculatorDisplay
        {...defaultFuelCalculatorSettings}
        showOnlyWhenOnTrack={false}
        enableTargetPitLap
        targetPitLap={15}
        layoutTree={layout(['fuelTargetMessage', 'fuelAtFinish'])}
        fuelData={{ ...energyData, fuelAtFinish: -34.4 }}
      />
    );

    // 20 laps from lap 15 to the flag at 2.29 % is 45.8 %.
    expect(screen.getByText('Fill to:')).toBeInTheDocument();
    expect(screen.getByText('46%')).toBeInTheDocument();
    expect(screen.getByText('Energy at end')).toBeInTheDocument();
    expect(screen.getByText('-34.4%')).toBeInTheDocument();
  });

  it('is unchanged for a car on fuel', () => {
    window.channelBridge = bridgeFor(fuelProjection);
    show(demoFuelData);

    expect(screen.getByText('TO ADD')).toBeInTheDocument();
    expect(screen.queryByText('FILL TO')).toBeNull();
    expect(screen.getByText('Tank')).toBeInTheDocument();
    expect(screen.getByText('60 L cap')).toBeInTheDocument();
    expect(screen.queryByTestId('fuel-gauge-tank')).toBeNull();
  });
});
