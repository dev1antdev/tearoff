import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useDashboard,
  useDrivingState,
  useSessionVisibility,
  useWheelDynamicsSnapshot,
} from '@irdashies/context';
import type { ChassisConfig, WheelDynamicsSnapshot } from '@irdashies/types';
import { Chassis } from './Chassis';

vi.mock('@irdashies/context', () => ({
  useDashboard: vi.fn(),
  useDrivingState: vi.fn(),
  useSessionVisibility: vi.fn(),
  useWheelDynamicsSnapshot: vi.fn(),
}));

/** An LMGT3 on a straight, as recorded. */
const wheels = (
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
  rollMm: [4, -4],
  rollShareFront: 0.55,
  sessionNum: 0,
  version: 1,
  ...over,
});

const outOfTheCar: WheelDynamicsSnapshot = {
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

const dashboard = (config: Partial<ChassisConfig> = {}) =>
  vi.mocked(useDashboard).mockReturnValue({
    currentDashboard: {
      widgets: [{ id: 'chassis', enabled: true, config }],
    },
  } as unknown as ReturnType<typeof useDashboard>);

/** Stands for the channel before its first snapshot has arrived. */
const NOT_YET = 'not yet';

const draw = (
  snapshot: WheelDynamicsSnapshot | typeof NOT_YET = wheels(),
  config: Partial<ChassisConfig> = {}
) => {
  dashboard(config);
  vi.mocked(useWheelDynamicsSnapshot).mockReturnValue(
    snapshot === NOT_YET ? undefined : snapshot
  );
  return render(<Chassis />).container;
};

const row = (container: HTMLElement, id: string) =>
  container.querySelector(
    `[data-testid="chassis-${id}"]`
  ) as HTMLElement | null;

/** The figures of a row, in the order they are drawn, without its caption. */
const figures = (container: HTMLElement, id: string) =>
  [...(row(container, id)?.querySelectorAll('.tabular-nums > span') ?? [])].map(
    (element) => element.textContent
  );

describe('Chassis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useDrivingState).mockReturnValue({
      isDriving: true,
      isWatching: false,
      isWatchingOwnCar: false,
      isWatchingOtherCar: false,
    });
    vi.mocked(useSessionVisibility).mockReturnValue(true);
  });

  describe('the rows', () => {
    it('draws the default rows and leaves the two optional ones out', () => {
      const container = draw();

      for (const id of ['ride', 'rake', 'roll', 'camber', 'toe']) {
        expect(row(container, id), id).not.toBeNull();
      }
      expect(row(container, 'suspension')).toBeNull();
    });

    it('gives ride height front above rear, left beside right, in whole millimetres', () => {
      const container = draw();

      expect(figures(container, 'ride')).toEqual(['51', '50', '60', '59']);
      expect(row(container, 'ride')?.textContent).toContain('Ridemm');
    });

    it('gives the rake as an angle with the millimetres behind it', () => {
      const container = draw();

      expect(figures(container, 'rake')).toEqual(['+0.18°', '9 mm']);
    });

    it('gives the roll of each axle, with its letter', () => {
      const container = draw();

      expect(figures(container, 'roll')).toEqual(['F+0.13', 'R-0.13']);
    });

    it('adds the share of the roll the front axle takes when asked', () => {
      const container = draw(wheels(), { showRollShare: true });

      expect(figures(container, 'roll')).toEqual(['F+0.13', 'R-0.13', '55%']);
    });

    it('gives camber at the four wheels to a tenth of a degree', () => {
      const container = draw();

      expect(figures(container, 'camber')).toEqual([
        '-2.0',
        '-2.2',
        '-1.7',
        '-1.6',
      ]);
    });

    it('gives toe per axle as a magnitude and a word', () => {
      const container = draw();

      expect(figures(container, 'toe')).toEqual(['F0.10 out', 'R0.21 in']);
    });

    it('gives toe at each wheel instead when asked, toe-in positive', () => {
      const container = draw(wheels(), { toeDisplay: 'wheel' });

      expect(figures(container, 'toe')).toEqual([
        '-0.05',
        '-0.05',
        '+0.10',
        '+0.11',
      ]);
    });

    it('gives suspension travel in whole millimetres when asked', () => {
      const container = draw(wheels(), { showSuspension: true });

      expect(figures(container, 'suspension')).toEqual([
        '65',
        '66',
        '77',
        '78',
      ]);
    });

    it('leaves out each row that is switched off', () => {
      const container = draw(wheels(), {
        showRideHeight: false,
        showRake: false,
        showRoll: false,
        showCamber: false,
        showToe: false,
      });

      for (const id of ['ride', 'rake', 'roll', 'camber', 'toe']) {
        expect(row(container, id), id).toBeNull();
      }
    });
  });

  describe('the colours', () => {
    it('draws a corner below its bottoming height in red, figure and bar', () => {
      const container = draw(
        wheels({ rideHeightMm: [8.6, -1.5, 44.7, 52.3] }),
        {
          bottomingFront: 10,
          bottomingRear: 10,
        }
      );
      const ride = row(container, 'ride');
      const red = [...(ride?.querySelectorAll('.text-red-400') ?? [])].map(
        (element) => element.textContent
      );

      expect(red).toEqual(['9', '-1']);
      // The whole track of the bar, as a corner on the road has no fill left.
      expect(ride?.querySelectorAll('.bg-red-500')).toHaveLength(4);
      expect(ride?.querySelectorAll('.bg-slate-300')).toHaveLength(2);
    });

    it('draws nothing red with the default bottoming height of 0', () => {
      const container = draw(wheels({ rideHeightMm: [8.6, 0.4, 44.7, 52.3] }));

      expect(container.querySelector('.text-red-400')).toBeNull();
      expect(container.querySelector('.bg-red-500')).toBeNull();
    });

    it('draws a negative rake in blue', () => {
      const noseUp = draw(wheels({ rakeMm: -20.9 }));
      expect(
        row(noseUp, 'rake')?.querySelector('.text-sky-400')?.textContent
      ).toBe('-0.43°');

      const noseDown = draw();
      expect(row(noseDown, 'rake')?.querySelector('.text-sky-400')).toBeNull();
    });

    it('draws a camber at zero or above in amber', () => {
      const container = draw(wheels({ camberDeg: [-2.6, 0.42, -1.9, -1.48] }));
      const amber = [
        ...(row(container, 'camber')?.querySelectorAll('.text-amber-400') ??
          []),
      ].map((element) => element.textContent);

      expect(amber).toEqual(['+0.4']);
    });
  });

  describe('missing data', () => {
    it('keeps every row in place with placeholders out of the car', () => {
      const container = draw(outOfTheCar, { showOnlyWhenOnTrack: false });

      expect(figures(container, 'ride')).toEqual(['--', '--', '--', '--']);
      expect(figures(container, 'rake')).toEqual(['--', '--']);
      expect(figures(container, 'roll')).toEqual(['F--', 'R--']);
      expect(figures(container, 'camber')).toEqual(['--', '--', '--', '--']);
      expect(figures(container, 'toe')).toEqual(['F--', 'R--']);
    });

    it('does the same before the first snapshot arrives', () => {
      const container = draw(NOT_YET, { showOnlyWhenOnTrack: false });

      expect(figures(container, 'ride')).toEqual(['--', '--', '--', '--']);
      expect(row(container, 'toe')).not.toBeNull();
    });

    it('leaves out a row the sim gives nothing for, in the car', () => {
      // Camber and toe, for a car the sim publishes none for.
      const container = draw(
        wheels({ camberDeg: null, toeDeg: null, toeTotalDeg: null })
      );

      expect(row(container, 'camber')).toBeNull();
      expect(row(container, 'toe')).toBeNull();
      expect(row(container, 'ride')).not.toBeNull();
      expect(row(container, 'rake')).not.toBeNull();
    });
  });

  describe('when it is drawn', () => {
    it('hides while the user is not driving, by default', () => {
      vi.mocked(useDrivingState).mockReturnValue({
        isDriving: false,
        isWatching: false,
        isWatchingOwnCar: false,
        isWatchingOtherCar: false,
      });

      expect(draw().innerHTML).toBe('');
    });

    it('hides while the user only watches a car: the figures are of their own', () => {
      vi.mocked(useDrivingState).mockReturnValue({
        isDriving: false,
        isWatching: true,
        isWatchingOwnCar: false,
        isWatchingOtherCar: true,
      });

      expect(draw().innerHTML).toBe('');
    });

    it('stays up off track when told to', () => {
      vi.mocked(useDrivingState).mockReturnValue({
        isDriving: false,
        isWatching: false,
        isWatchingOwnCar: false,
        isWatchingOtherCar: false,
      });

      const container = draw(outOfTheCar, { showOnlyWhenOnTrack: false });

      expect(row(container, 'ride')).not.toBeNull();
    });

    it('hides in a session it is switched off for', () => {
      vi.mocked(useSessionVisibility).mockReturnValue(false);

      expect(draw().innerHTML).toBe('');
    });

    it('does not subscribe to the wheel channel while hidden', () => {
      vi.mocked(useDrivingState).mockReturnValue({
        isDriving: false,
        isWatching: false,
        isWatchingOwnCar: false,
        isWatchingOtherCar: false,
      });
      draw();
      expect(useWheelDynamicsSnapshot).toHaveBeenLastCalledWith(false);

      vi.mocked(useDrivingState).mockReturnValue({
        isDriving: true,
        isWatching: false,
        isWatchingOwnCar: false,
        isWatchingOtherCar: false,
      });
      draw();
      expect(useWheelDynamicsSnapshot).toHaveBeenLastCalledWith(true);
    });
  });

  describe('the layout', () => {
    // The hairline above a block is its ::before, the one beside it its ::after.
    const rules = (container: HTMLElement, id: string) => {
      const className = row(container, id)?.className ?? '';
      return {
        above: className.includes('before:h-px'),
        before: className.includes('after:w-px'),
      };
    };

    it('stacks the blocks, a hairline between each, by default', () => {
      const container = draw();

      expect(rules(container, 'ride')).toEqual({ above: false, before: false });
      expect(rules(container, 'rake')).toEqual({ above: true, before: false });
      expect(rules(container, 'toe')).toEqual({ above: true, before: false });
    });

    it('lays them in one row, a hairline before each but the first', () => {
      const container = draw(wheels(), { layout: 'oneRow' });

      expect(container.firstElementChild?.className).toContain('flex-row');
      expect(rules(container, 'ride')).toEqual({ above: false, before: false });
      expect(rules(container, 'camber')).toEqual({
        above: false,
        before: true,
      });
    });

    it('fills two rows column by column, ruled between rows and columns', () => {
      const container = draw(wheels(), { layout: 'twoRows' });

      // Ride and rake share the first column; roll heads the second.
      expect(rules(container, 'ride')).toEqual({ above: false, before: false });
      expect(rules(container, 'rake')).toEqual({ above: true, before: false });
      expect(rules(container, 'roll')).toEqual({ above: false, before: true });
      expect(rules(container, 'camber')).toEqual({ above: true, before: true });
    });
  });
});
