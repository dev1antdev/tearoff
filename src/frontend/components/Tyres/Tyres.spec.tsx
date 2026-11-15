import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useDashboard,
  useDrivingState,
  useSessionVisibility,
  useTyreStateSnapshot,
  useWheelDynamicsSnapshot,
} from '@irdashies/context';
import type {
  TyresConfig,
  TyreStateSnapshot,
  TyreWheelState,
  WheelDynamicsSnapshot,
} from '@irdashies/types';
import { Tyres } from './Tyres';

vi.mock('@irdashies/context', () => ({
  useDashboard: vi.fn(),
  useDrivingState: vi.fn(),
  // The compound glyph reads the session's tyre list; these wheels state no
  // compound, so it is never drawn.
  useDriverTires: vi.fn(),
  useSessionVisibility: vi.fn(),
  useTyreStateSnapshot: vi.fn(),
  useWheelDynamicsSnapshot: vi.fn(),
}));

const wheel = (over: Partial<TyreWheelState> = {}): TyreWheelState => ({
  surfaceTempC: [88, 92, 95],
  innerLayerTempC: [94, 98, 101],
  carcassTempC: 80,
  optimalTempC: 92,
  pressureKpa: 171.2,
  pressureDeviationKpa: 0,
  treadRemaining: 0.96,
  brakeTempC: 480,
  compound: -1,
  ...over,
});

/** LF, RF, LR, RR, with the right front the highest pressure. */
const tyres = (wheels?: TyreWheelState[]): TyreStateSnapshot => ({
  available: true,
  wheels: wheels ?? [
    wheel({ pressureKpa: 171.2, pressureDeviationKpa: 2.4 }),
    wheel({ pressureKpa: 173.6, pressureDeviationKpa: 0 }),
    wheel({ pressureKpa: 169.8, pressureDeviationKpa: 3.8 }),
    wheel({ pressureKpa: 172.5, pressureDeviationKpa: 1.1 }),
  ],
  sessionNum: 0,
  version: 1,
});

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

const outOfTheCar: TyreStateSnapshot = {
  available: false,
  wheels: [],
  sessionNum: null,
  version: 1,
};

const everyRow: Partial<TyresConfig> = {
  showWear: true,
  showLoad: true,
  showDeflection: true,
  showPressureDeviation: true,
};

interface Drawn {
  config?: Partial<TyresConfig>;
  tyreState?: TyreStateSnapshot;
  wheelDynamics?: WheelDynamicsSnapshot;
}

const draw = ({
  config = {},
  tyreState = tyres(),
  wheelDynamics = dynamics(),
}: Drawn = {}) => {
  vi.mocked(useDashboard).mockReturnValue({
    currentDashboard: {
      widgets: [{ id: 'tyres', enabled: true, config }],
    },
  } as unknown as ReturnType<typeof useDashboard>);
  vi.mocked(useTyreStateSnapshot).mockReturnValue(tyreState);
  vi.mocked(useWheelDynamicsSnapshot).mockReturnValue(wheelDynamics);
  return render(<Tyres />).container;
};

const all = (container: HTMLElement, id: string) => [
  ...container.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`),
];

const texts = (container: HTMLElement, id: string) =>
  all(container, id).map((element) => element.textContent);

describe('Tyres', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useDrivingState).mockReturnValue({
      isDriving: true,
      isWatching: false,
    });
    vi.mocked(useSessionVisibility).mockReturnValue(true);
  });

  describe('as a saved dashboard has it', () => {
    it('draws none of the optional rows', () => {
      const container = draw();

      expect(all(container, 'tyre-load')).toHaveLength(0);
      expect(all(container, 'tyre-deflection')).toHaveLength(0);
      expect(all(container, 'tyre-pressure-deviation')).toHaveLength(0);
      expect(texts(container, 'tyre-pressure')).toEqual([
        '24.8PSI',
        '25.2PSI',
        '24.6PSI',
        '25.0PSI',
      ]);
    });

    it('does not subscribe to the wheel channel', () => {
      draw();

      expect(useWheelDynamicsSnapshot).toHaveBeenLastCalledWith(false);
    });
  });

  describe('the load bar', () => {
    it('gives each wheel its share of the load, front left first', () => {
      const container = draw({ config: { showLoad: true } });

      expect(texts(container, 'tyre-load')).toEqual([
        '23%',
        '23%',
        '27%',
        '27%',
      ]);
    });

    it('fills each bar towards a full one at half the load of the car', () => {
      const container = draw({
        config: { showLoad: true },
        wheelDynamics: dynamics({ loadShare: [0.34, 0.1, 0.5, 0.06] }),
      });

      expect(
        all(container, 'tyre-load-fill').map((fill) => fill.style.width)
      ).toEqual(['68%', '20%', '100%', '12%']);
    });

    it('grows outwards from the centre of the car on both sides', () => {
      const container = draw({ config: { showLoad: true } });
      const [left, right] = all(container, 'tyre-load');

      // The figure sits at the outer end: first on the left, last on the
      // right, with the bar filling away from the other tyre.
      expect(left.className).not.toContain('flex-row-reverse');
      expect(left.querySelector('.justify-end')).not.toBeNull();
      expect(right.className).toContain('flex-row-reverse');
      expect(right.querySelector('.justify-start')).not.toBeNull();
    });

    it('turns red, figure and bar, on a wheel carrying next to nothing', () => {
      const container = draw({
        config: { showLoad: true },
        wheelDynamics: dynamics({ loadShare: [0.386, 0, 0.268, 0.346] }),
      });
      const [, rightFront, leftRear] = all(container, 'tyre-load');

      expect(rightFront.textContent).toBe('0%');
      expect(rightFront.querySelector('.text-red-400')).not.toBeNull();
      // The whole track, as there is no fill left to colour.
      expect(rightFront.querySelectorAll('.bg-red-500')).toHaveLength(2);
      expect(leftRear.querySelector('.text-red-400')).toBeNull();
      expect(leftRear.querySelector('.bg-red-500')).toBeNull();
    });

    it('follows the low-load threshold', () => {
      const container = draw({
        config: { showLoad: true, lowLoadThreshold: 10 },
        wheelDynamics: dynamics({ loadShare: [0.4, 0.1, 0.39, 0.11] }),
      });
      const red = all(container, 'tyre-load').map(
        (bar) => bar.querySelector('.text-red-400') !== null
      );

      expect(red).toEqual([false, true, false, false]);
    });

    it('is not drawn at all when the sim gives nothing to take a share from', () => {
      // Neither tyre load nor suspension force, with the wheels otherwise read.
      const container = draw({
        config: everyRow,
        wheelDynamics: dynamics({
          loadShare: null,
          loadSource: null,
          loadTotalN: null,
        }),
      });

      expect(all(container, 'tyre-load')).toHaveLength(0);
      expect(texts(container, 'tyre-deflection')).toEqual([
        '16 mm',
        '17 mm',
        '19 mm',
        '20 mm',
      ]);
    });

    it('keeps its place, empty, out of the car', () => {
      const container = draw({
        config: everyRow,
        tyreState: outOfTheCar,
        wheelDynamics: dynamics({ available: false }),
      });

      expect(texts(container, 'tyre-load')).toEqual(['--', '--', '--', '--']);
      expect(
        all(container, 'tyre-load-fill').map((fill) => fill.style.width)
      ).toEqual(['0%', '0%', '0%', '0%']);
      expect(container.querySelector('.bg-red-500')).toBeNull();
    });
  });

  describe('tyre deflection', () => {
    it('is drawn in whole millimetres', () => {
      const container = draw({ config: { showDeflection: true } });

      expect(texts(container, 'tyre-deflection')).toEqual([
        '16 mm',
        '17 mm',
        '19 mm',
        '20 mm',
      ]);
    });

    it('shares the line under the tyre with the tread', () => {
      const container = draw({
        config: { showDeflection: true, showWear: true },
      });
      const line = all(container, 'tyre-deflection')[0].parentElement;

      expect(line?.textContent).toBe('96%16 mm');
    });

    it('turns red on a wheel in the air', () => {
      const container = draw({
        config: { showDeflection: true },
        wheelDynamics: dynamics({ tyreDeflectionMm: [29.3, 0, 17.2, 0.6] }),
      });
      const red = all(container, 'tyre-deflection').map((figure) =>
        figure.className.includes('text-red-400')
      );

      expect(red).toEqual([false, true, false, true]);
    });

    it('is a placeholder out of the car, and not red', () => {
      const container = draw({
        config: { showDeflection: true },
        tyreState: outOfTheCar,
        wheelDynamics: dynamics({ available: false }),
      });

      expect(texts(container, 'tyre-deflection')).toEqual([
        '--',
        '--',
        '--',
        '--',
      ]);
      expect(container.querySelector('.text-red-400')).toBeNull();
    });
  });

  describe('pressure deviation', () => {
    it('is written under each pressure as an offset from the highest', () => {
      const container = draw({
        config: { showPressureDeviation: true, pressureUnit: 'kpa' },
      });

      expect(texts(container, 'tyre-pressure-deviation')).toEqual([
        '-2.4',
        '0.0',
        '-3.8',
        '-1.1',
      ]);
    });

    it('follows the pressure unit', () => {
      const container = draw({ config: { showPressureDeviation: true } });

      expect(texts(container, 'tyre-pressure-deviation')).toEqual([
        '-0.3',
        '0.0',
        '-0.6',
        '-0.2',
      ]);
    });

    it('is a placeholder until all four wheels have read', () => {
      const container = draw({
        config: { showPressureDeviation: true },
        tyreState: tyres([
          wheel({ pressureDeviationKpa: null }),
          wheel({ pressureDeviationKpa: null }),
          wheel({ pressureDeviationKpa: null }),
          wheel({ pressureKpa: null, pressureDeviationKpa: null }),
        ]),
      });

      expect(texts(container, 'tyre-pressure-deviation')).toEqual([
        '--',
        '--',
        '--',
        '--',
      ]);
    });
  });

  describe('a cold tyre', () => {
    const target = { enabled: true, front: 186, rear: 186, tolerance: 3.5 };
    const freshRears = tyres([
      wheel({ pressureKpa: 186.1 }),
      wheel({ pressureKpa: 186.9 }),
      wheel({ pressureKpa: 191.6, carcassTempC: 48 }),
      wheel({ pressureKpa: 192.3, carcassTempC: 47 }),
    ]);
    const tones = (container: HTMLElement) =>
      all(container, 'tyre-pressure').map(
        (pressure) =>
          ['text-sky-400', 'text-green-400', 'text-red-400', 'text-white'].find(
            (tone) => pressure.className.includes(tone)
          ) ?? ''
      );

    it('has its pressure drawn blue, though it is over the target', () => {
      const container = draw({
        config: { pressureTarget: target },
        tyreState: freshRears,
      });

      expect(tones(container)).toEqual([
        'text-green-400',
        'text-green-400',
        'text-sky-400',
        'text-sky-400',
      ]);
    });

    it('is drawn blue with no target to colour by, too', () => {
      const container = draw({ tyreState: freshRears });

      expect(tones(container)).toEqual([
        'text-white',
        'text-white',
        'text-sky-400',
        'text-sky-400',
      ]);
    });

    it('is judged against the target again with the threshold at 0', () => {
      const container = draw({
        config: { pressureTarget: target, pressureColdBelow: 0 },
        tyreState: freshRears,
      });

      expect(tones(container)).toEqual([
        'text-green-400',
        'text-green-400',
        'text-red-400',
        'text-red-400',
      ]);
    });
  });

  describe('when the wheel channel is read', () => {
    it('subscribes while either of its two rows is on', () => {
      draw({ config: { showLoad: true } });
      expect(useWheelDynamicsSnapshot).toHaveBeenLastCalledWith(true);

      draw({ config: { showDeflection: true } });
      expect(useWheelDynamicsSnapshot).toHaveBeenLastCalledWith(true);

      draw({ config: { showPressureDeviation: true } });
      expect(useWheelDynamicsSnapshot).toHaveBeenLastCalledWith(false);
    });

    it('does not while the widget is hidden', () => {
      vi.mocked(useDrivingState).mockReturnValue({
        isDriving: false,
        isWatching: true,
      });

      const container = draw({
        config: { ...everyRow, showOnlyWhenOnTrack: true },
      });

      // Hidden while the user only watches a car: the tyres are their own.
      expect(container.innerHTML).toBe('');
      expect(useWheelDynamicsSnapshot).toHaveBeenLastCalledWith(false);
    });
  });
});
