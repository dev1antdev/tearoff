import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useDashboard,
  useDrivingState,
  useFuelProjectionSnapshot,
  usePitStopSnapshot,
  usePlayerStintSnapshot,
  useSessionVisibility,
} from '@irdashies/context';
import {
  EMPTY_PLAYER_STINT,
  type FuelLapData,
  type FuelProjectionSnapshot,
  type FuelSaverConfig,
  type LedgerStint,
  type PitStopSnapshot,
  type PlayerStintSnapshot,
} from '@irdashies/types';
import { FuelSaver } from './FuelSaver';

vi.mock('@irdashies/context', () => ({
  useDashboard: vi.fn(),
  useDrivingState: vi.fn(),
  useFuelProjectionSnapshot: vi.fn(),
  usePitStopSnapshot: vi.fn(),
  usePlayerStintSnapshot: vi.fn(),
  useSessionVisibility: vi.fn(),
}));

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

/**
 * The recorded LMGT3 as the recording leaves it: 38.7 % of its energy
 * aboard, 2.33 % on the last lap and 1.7 % into this one.
 */
const recorded = (
  values: Partial<FuelProjectionSnapshot> = {}
): FuelProjectionSnapshot =>
  ({
    isReplay: false,
    budget: 'virtualEnergy',
    fuelLevel: 38.7,
    lapDistPct: 0.4,
    currentLapUsage: 1.7,
    projectedLapUsage: 2.33,
    lastLapUsage: 2.33,
    estimatedLapsRemaining: 0,
    hasValidRaceEstimate: false,
    fuelTankCapacity: 100,
    completedLaps: [lap(2.33), lap(2.4)],
    ...values,
  }) as FuelProjectionSnapshot;

const stintOf = (laps: number): PlayerStintSnapshot => ({
  ...EMPTY_PLAYER_STINT,
  available: true,
  state: 'running',
  stint: { laps } as LedgerStint,
});

interface Scene {
  config?: Partial<FuelSaverConfig>;
  stint?: PlayerStintSnapshot;
  pitEntryPct?: number | null;
  isDriving?: boolean;
  isWatchingOwnCar?: boolean;
  isWatchingOtherCar?: boolean;
  sessionVisible?: boolean;
}

const show = (
  fuel: FuelProjectionSnapshot | undefined,
  {
    config = {},
    stint = stintOf(2),
    pitEntryPct = 0.95,
    isDriving = true,
    isWatchingOwnCar = false,
    isWatchingOtherCar = false,
    sessionVisible = true,
  }: Scene = {}
) => {
  vi.mocked(useDashboard).mockReturnValue({
    currentDashboard: { widgets: [{ id: 'fuelsaver', config }] },
  } as unknown as ReturnType<typeof useDashboard>);
  vi.mocked(useFuelProjectionSnapshot).mockReturnValue(fuel);
  vi.mocked(usePlayerStintSnapshot).mockReturnValue(stint);
  vi.mocked(usePitStopSnapshot).mockImplementation((enabled = true) =>
    enabled
      ? ({ lane: { entryPct: pitEntryPct } } as PitStopSnapshot)
      : undefined
  );
  vi.mocked(useDrivingState).mockReturnValue({
    isDriving,
    isWatching: isWatchingOwnCar || isWatchingOtherCar,
    isWatchingOwnCar,
    isWatchingOtherCar,
  });
  vi.mocked(useSessionVisibility).mockReturnValue(sessionVisible);
  return render(<FuelSaver />);
};

/** Each column as "caption|target|saving|tone", the centre one starred. */
const columns = () =>
  screen.getAllByTestId('fuel-saver-column').map((column) => {
    const [caption, target, saving] = [...column.children].map(
      (cell) => cell.textContent
    );
    return `${column.dataset.current === 'true' ? '*' : ''}${caption}|${target}|${saving}|${column.dataset.tone}`;
  });

const text = (testId: string) => screen.getByTestId(testId).textContent;
const isDrawn = () => screen.queryByTestId('fuel-saver') !== null;

describe('FuelSaver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('gives the laps the energy lasts and a target for each lap more', () => {
    show(recorded());
    // 38.7 aboard and 1.7 used this lap, less 0.2 held back: 40.2 %, which
    // is 17 laps at 2.33. The pit menu's own word for 45 % is "20 laps".
    expect(columns()).toEqual([
      '*2/19|2.36|-0.03|inside',
      '20|2.23|+0.10|reachable',
      '21|2.12|+0.21|reachable',
      '22|2.01|+0.32|reachable',
    ]);
    expect(text('fuel-saver-use')).toBe('2.33');
    expect(text('fuel-saver-last')).toBe('2.33');
    expect(screen.getByTestId('fuel-saver').textContent).toContain('%/lap');
  });

  it('draws a saving beyond reach in grey', () => {
    show(recorded(), { config: { reachShare: 5 } });
    expect(columns().map((column) => column.split('|')[3])).toEqual([
      'inside',
      'reachable',
      'outOfReach',
      'outOfReach',
    ]);
  });

  it('follows the lap under way, the last lap or the average, as set', () => {
    show(recorded({ projectedLapUsage: 2.21 }));
    expect(text('fuel-saver-use')).toBe('2.21');

    show(recorded({ projectedLapUsage: 2.21 }), { config: { basis: 'last' } });
    expect(screen.getAllByTestId('fuel-saver-use')[1].textContent).toBe('2.33');

    show(
      recorded({
        projectedLapUsage: 2.21,
        completedLaps: [lap(2.3), lap(2.5), lap(3.4, { isOutLap: true })],
      }),
      { config: { basis: 'average', averageLaps: 5 } }
    );
    // 2.30 and 2.50: the lap out of the pits is not one of them.
    expect(screen.getAllByTestId('fuel-saver-use')[2].textContent).toBe('2.40');
  });

  it('gives as many columns either side as it is asked for', () => {
    show(recorded(), { config: { fewerLaps: 2, moreLaps: 1 } });
    expect(columns().map((column) => column.split('|')[0])).toEqual([
      '17',
      '18',
      '*2/19',
      '20',
    ]);
  });

  it('counts the stint to the pit entry when asked to', () => {
    show(recorded(), { config: { pitEntryAllowance: true } });
    // A twentieth of a lap less to drive: 0.12 % more to spread.
    expect(columns()[0]).toBe('*2/19|2.37|-0.04|inside');
    expect(usePitStopSnapshot).toHaveBeenCalledWith(true);
  });

  it('does not ask for the pit lane while the allowance is off', () => {
    show(recorded());
    expect(usePitStopSnapshot).toHaveBeenCalledWith(false);
  });

  it('ignores the allowance where the pit entry is not known', () => {
    show(recorded(), {
      config: { pitEntryAllowance: true },
      pitEntryPct: null,
    });
    expect(columns()[0]).toBe('*2/19|2.36|-0.03|inside');
  });

  it('captions the columns with laps to go when there is no stint on record', () => {
    show(recorded(), { stint: EMPTY_PLAYER_STINT });
    expect(columns().map((column) => column.split('|')[0])).toEqual([
      '*17',
      '18',
      '19',
      '20',
    ]);
  });

  describe('the line that drops a stop', () => {
    const race = (values: Partial<FuelProjectionSnapshot>) =>
      recorded({ hasValidRaceEstimate: true, ...values });

    it('says what a lap may cost for one stop fewer, when that is in reach', () => {
      show(
        race({
          fuelLevel: 44.2,
          currentLapUsage: 0.9,
          estimatedLapsRemaining: 20.2,
        })
      );
      // 44.2 % over 20.2 laps.
      expect(text('fuel-saver-stop')).toBe('1 stop fewer2.19+0.14 (6%)');
      expect(screen.getByTestId('fuel-saver-stop').dataset.tone).toBe(
        'reachable'
      );
    });

    it('draws it in grey when it is further off than can be driven for', () => {
      show(
        race({
          fuelLevel: 30.1,
          currentLapUsage: 0.9,
          estimatedLapsRemaining: 18.4,
        })
      );
      expect(text('fuel-saver-stop')).toBe('1 stop fewer1.64+0.69 (30%)');
      expect(screen.getByTestId('fuel-saver-stop').dataset.tone).toBe(
        'outOfReach'
      );
    });

    it('leaves it out when it would take more than half of what the car uses', () => {
      show(race({ estimatedLapsRemaining: 41.6 }));
      expect(screen.queryByTestId('fuel-saver-stop')).toBeNull();
    });

    it('leaves it out when no stop is needed, outside a race, and when switched off', () => {
      show(race({ fuelLevel: 90, estimatedLapsRemaining: 20 }));
      expect(screen.queryByTestId('fuel-saver-stop')).toBeNull();

      show(recorded({ fuelLevel: 44.2, estimatedLapsRemaining: 20.2 }));
      expect(screen.queryByTestId('fuel-saver-stop')).toBeNull();

      show(
        race({
          fuelLevel: 44.2,
          currentLapUsage: 0.9,
          estimatedLapsRemaining: 20.2,
        }),
        { config: { showStopTarget: false } }
      );
      expect(screen.queryByTestId('fuel-saver-stop')).toBeNull();
    });
  });

  describe('a car on fuel', () => {
    const fuelCar = recorded({
      budget: undefined,
      fuelLevel: 41.6,
      currentLapUsage: 1.1,
      projectedLapUsage: 2.71,
      lastLapUsage: 2.78,
      fuelTankCapacity: 110,
    });

    it('counts in litres', () => {
      show(fuelCar, { stint: stintOf(9) });
      // 42.5 L from the start of the lap: 15 laps at 2.71.
      expect(columns()[0]).toBe('*9/24|2.83|-0.12|inside');
      expect(screen.getByTestId('fuel-saver').textContent).toContain('L/lap');
    });

    it('counts in gallons when set to, the reserve with it', () => {
      show(fuelCar, {
        stint: stintOf(9),
        config: { fuelUnits: 'gal', reserve: 1 },
      });
      // 11.28 gal less the gallon held back, at 0.716 a lap: 14 laps.
      expect(columns()[0]).toBe('*9/23|0.73|-0.02|inside');
      expect(text('fuel-saver-use')).toBe('0.72');
      expect(screen.getByTestId('fuel-saver').textContent).toContain('gal/lap');
    });
  });

  it('keeps its shape with dashes before a lap has been measured', () => {
    show(
      recorded({ projectedLapUsage: 0, lastLapUsage: 0, completedLaps: [] })
    );
    expect(columns()).toEqual([
      '*--|--|--|none',
      '--|--|--|none',
      '--|--|--|none',
      '--|--|--|none',
    ]);
    expect(text('fuel-saver-use')).toBe('--');
    expect(text('fuel-saver-last')).toBe('--');
  });

  it('keeps its shape before the first projection', () => {
    show(undefined);
    expect(columns()).toHaveLength(4);
    expect(text('fuel-saver-use')).toBe('--');
  });

  it('can leave the last lap out', () => {
    show(recorded(), { config: { showLast: false } });
    expect(screen.queryByTestId('fuel-saver-last')).toBeNull();
  });

  describe('when it shows', () => {
    it('hides outside the sessions it is set to show in', () => {
      show(recorded(), { sessionVisible: false });
      expect(isDrawn()).toBe(false);
    });

    it('hides out of the car, unless set to stay', () => {
      show(recorded(), { isDriving: false });
      expect(isDrawn()).toBe(false);

      show(recorded(), {
        isDriving: false,
        config: { showOnlyWhenOnTrack: false },
      });
      expect(isDrawn()).toBe(true);
    });

    it('stays up while a team-mate drives the car, on the laps to go', () => {
      show(recorded({ watched: true }), {
        isDriving: false,
        isWatchingOwnCar: true,
        stint: EMPTY_PLAYER_STINT,
      });
      expect(columns()[0]).toBe('*17|2.36|-0.03|inside');
    });

    it('hides with the camera on a rival, whatever the settings', () => {
      show(recorded(), {
        isDriving: false,
        isWatchingOtherCar: true,
        config: { showOnlyWhenOnTrack: false },
      });
      expect(isDrawn()).toBe(false);
    });
  });
});
