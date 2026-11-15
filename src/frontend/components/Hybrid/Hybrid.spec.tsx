import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getWidgetDefaultConfig,
  type HybridConfig,
  type HybridSnapshot,
} from '@irdashies/types';
import * as Context from '@irdashies/context';
import { Hybrid } from './Hybrid';

vi.mock('@irdashies/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@irdashies/context')>();
  return {
    ...actual,
    useHybridSnapshot: vi.fn(),
    useDrivingState: vi.fn(),
    useSessionVisibility: vi.fn(),
  };
});

const DEFAULTS = getWidgetDefaultConfig('hybrid');

// Prefixed so Vitest allows the hoisted vi.mock factory to close over it.
const mockSettings: { current: HybridConfig } = { current: DEFAULTS };

vi.mock('./hooks/useHybridSettings', () => ({
  useHybridSettings: () => mockSettings.current,
}));

/** A Hypercar deploying, half way round its third lap. Invented figures. */
const snapshot = (values: Partial<HybridSnapshot> = {}): HybridSnapshot => ({
  available: true,
  chargePct: 74.26,
  motorState: 2,
  motorStateInferred: false,
  drainLapPct: 6.21,
  regenLapPct: 3.08,
  drainLastLapPct: 12.44,
  regenLastLapPct: 10.87,
  netLapEstimatePct: -1.63,
  deployTimeLapS: 8.4,
  sinceDeployS: null,
  lapElapsedS: 30,
  motor: {
    torqueNm: 212.5,
    rpm: 9150,
    powerKw: 203.6,
    motorTempC: 68.4,
    coolantTempC: 51.2,
    regenKw: 0,
  },
  stateOfCharge: 0.743,
  sessionNum: 0,
  version: 1,
  ...values,
});

const show = (values: Partial<HybridSnapshot> = {}) =>
  vi.mocked(Context.useHybridSnapshot).mockReturnValue(snapshot(values));

const configure = (config: Partial<HybridConfig>) => {
  mockSettings.current = { ...DEFAULTS, ...config };
};

const charge = () => screen.getByTestId('hybrid-charge');
const bar = () => screen.getByTestId('hybrid-bar');

beforeEach(() => {
  vi.clearAllMocks();
  mockSettings.current = DEFAULTS;
  vi.mocked(Context.useDrivingState).mockReturnValue({
    isDriving: true,
    isWatching: false,
    isWatchingOwnCar: false,
    isWatchingOtherCar: false,
  });
  vi.mocked(Context.useSessionVisibility).mockReturnValue(true);
  show();
});

describe('Hybrid', () => {
  describe('on a car without the system', () => {
    it('draws nothing while the channel says there is none', () => {
      // The recorded GT3, and every car that never shows a charge.
      show({ available: false, chargePct: null, motorState: 0 });
      const { container } = render(<Hybrid />);

      expect(container).toBeEmptyDOMElement();
    });

    it('draws nothing before the channel has delivered anything', () => {
      vi.mocked(Context.useHybridSnapshot).mockReturnValue(undefined);
      const { container } = render(<Hybrid />);

      expect(container).toBeEmptyDOMElement();
    });
  });

  describe('the charge and the motor', () => {
    it('draws the charge to one decimal, with what the motor is doing', () => {
      render(<Hybrid />);

      expect(charge()).toHaveTextContent('74.3');
      expect(screen.getByText('DEPLOY')).toBeInTheDocument();
      expect(bar().style.getPropertyValue('--charge')).toBe('74.26%');
    });

    it.each([
      [3, 'REGEN'],
      [1, 'IDLE'],
      [0, '--'],
    ] as const)('names motor state %i %s', (motorState, label) => {
      show({ motorState });
      render(<Hybrid />);

      expect(screen.getByText(label)).toBeInTheDocument();
    });

    it('is plain between the thresholds', () => {
      render(<Hybrid />);

      expect(charge()).toHaveClass('text-white');
      expect(bar()).toHaveClass('bg-green-500');
    });

    it('is red at or below the low threshold', () => {
      show({ chargePct: 10 });
      render(<Hybrid />);

      expect(charge()).toHaveClass('text-red-400');
      expect(bar()).toHaveClass('bg-red-500');
    });

    it('is amber at or above the high threshold', () => {
      show({ chargePct: 95 });
      render(<Hybrid />);

      expect(charge()).toHaveClass('text-amber-300');
      expect(bar()).toHaveClass('bg-amber-400');
    });

    it('draws a placeholder for a charge with no reading', () => {
      show({ chargePct: null });
      render(<Hybrid />);

      expect(charge()).toHaveTextContent('--');
      expect(bar().style.getPropertyValue('--charge')).toBe('0%');
    });
  });

  describe('the warning flash', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const advance = (ms: number) =>
      act(() => {
        vi.advanceTimersByTime(ms);
      });

    it('pulses ten times on entering a band, then holds the colour', () => {
      show({ chargePct: 8 });
      render(<Hybrid />);

      for (let pulse = 0; pulse < 10; pulse += 1) {
        // Lit for 0.4 s, then out for 0.2 s.
        expect(charge()).toHaveClass('text-red-400');
        advance(400);
        expect(charge()).toHaveClass('text-white');
        advance(200);
      }
      // And then it stays.
      expect(charge()).toHaveClass('text-red-400');
      advance(5000);
      expect(charge()).toHaveClass('text-red-400');
      // The bar never goes out.
      expect(bar()).toHaveClass('bg-red-500');
    });

    it('starts again when the charge moves to the other band', () => {
      show({ chargePct: 8 });
      const { rerender } = render(<Hybrid />);
      advance(400);
      expect(charge()).toHaveClass('text-white');

      // Mid-pulse, straight to full: the new colour shows at once.
      show({ chargePct: 97 });
      rerender(<Hybrid />);
      expect(charge()).toHaveClass('text-amber-300');
      advance(400);
      expect(charge()).toHaveClass('text-white');
      advance(200);
      expect(charge()).toHaveClass('text-amber-300');
    });

    it('stops as the charge leaves the band', () => {
      show({ chargePct: 8 });
      const { rerender } = render(<Hybrid />);
      show({ chargePct: 40 });
      rerender(<Hybrid />);

      advance(3000);
      expect(charge()).toHaveClass('text-white');
    });

    it('holds the colour from the start with the flash switched off', () => {
      configure({ warningFlash: false });
      show({ chargePct: 8 });
      render(<Hybrid />);

      advance(400);
      expect(charge()).toHaveClass('text-red-400');
      advance(200);
      expect(charge()).toHaveClass('text-red-400');
    });
  });

  describe('the figures for the lap', () => {
    it('shows what this lap has used and recovered, signed', () => {
      render(<Hybrid />);

      expect(screen.getByText('Used')).toBeInTheDocument();
      expect(screen.getByText('-6.2')).toHaveClass('text-orange-300');
      expect(screen.getByText('Regen')).toBeInTheDocument();
      expect(screen.getByText('+3.1')).toHaveClass('text-emerald-300');
      expect(screen.getByText('-1.6')).toHaveClass('text-amber-300');
      expect(screen.getByText('8.4')).toBeInTheDocument();
    });

    it('holds last lap’s totals for the first seconds after the line', () => {
      show({ lapElapsedS: 4 });
      render(<Hybrid />);

      expect(screen.getAllByText('Last')).toHaveLength(2);
      expect(screen.queryByText('Used')).not.toBeInTheDocument();
      expect(screen.getByText('-12.4')).toBeInTheDocument();
      expect(screen.getByText('+10.9')).toBeInTheDocument();
    });

    it('goes back to this lap’s once the hold set is over', () => {
      configure({ freezeSeconds: 4 });
      show({ lapElapsedS: 4 });
      render(<Hybrid />);

      expect(screen.queryByText('Last')).not.toBeInTheDocument();
      expect(screen.getByText('-6.2')).toBeInTheDocument();
    });

    it('shows this lap’s from the start before a lap has been completed', () => {
      show({
        lapElapsedS: 2,
        drainLastLapPct: null,
        regenLastLapPct: null,
        netLapEstimatePct: null,
      });
      render(<Hybrid />);

      expect(screen.getByText('Used')).toBeInTheDocument();
      expect(screen.getByText('-6.2')).toBeInTheDocument();
      // And no estimate without a lap to measure against.
      expect(screen.getByText('Net').nextElementSibling).toHaveTextContent(
        '--'
      );
    });

    it('is green for a lap on course to gain', () => {
      show({ netLapEstimatePct: 2.35 });
      render(<Hybrid />);

      expect(screen.getByText('+2.4')).toHaveClass('text-emerald-300');
    });

    it('follows the decimals set', () => {
      configure({ decimals: 0 });
      render(<Hybrid />);

      expect(charge()).toHaveTextContent('74');
      expect(screen.getByText('-6')).toBeInTheDocument();
    });

    it('leaves out the cells that are switched off', () => {
      configure({
        showLapUse: false,
        showNetEstimate: false,
        showDeployTimer: false,
      });
      render(<Hybrid />);

      expect(screen.queryByText('Used')).not.toBeInTheDocument();
      expect(screen.queryByText('Net')).not.toBeInTheDocument();
      expect(screen.queryByText('Deploy')).not.toBeInTheDocument();
      expect(charge()).toHaveTextContent('74.3');
    });
  });

  describe('the motor row', () => {
    it('is not drawn unless asked for', () => {
      render(<Hybrid />);

      expect(screen.queryByText('Motor')).not.toBeInTheDocument();
    });

    it('draws the motor’s readings in whole numbers', () => {
      configure({ showMotor: true });
      render(<Hybrid />);

      expect(screen.getByText('Motor').nextElementSibling).toHaveTextContent(
        '68°'
      );
      expect(screen.getByText('Coolant').nextElementSibling).toHaveTextContent(
        '51°'
      );
      expect(screen.getByText('9150')).toBeInTheDocument();
      expect(screen.getByText('213')).toBeInTheDocument();
      expect(screen.getByText('204')).toBeInTheDocument();
    });

    it('colours a temperature against its own threshold', () => {
      configure({ showMotor: true });
      show({
        motor: { ...snapshot().motor, motorTempC: 84.2, coolantTempC: 73.6 },
      });
      render(<Hybrid />);

      expect(screen.getByText('Motor').nextElementSibling).toHaveClass(
        'text-red-400'
      );
      expect(screen.getByText('Coolant').nextElementSibling).toHaveClass(
        'text-amber-300'
      );
    });

    it('draws a placeholder for a reading the sim does not give', () => {
      configure({ showMotor: true });
      show({ motor: { ...snapshot().motor, coolantTempC: null } });
      render(<Hybrid />);

      const coolant = screen.getByText('Coolant').nextElementSibling;
      // No degree sign after it: that would read as a value.
      expect(coolant?.textContent).toBe('--');
    });

    it('converts to the units set', () => {
      configure({
        showMotor: true,
        temperatureUnit: 'fahrenheit',
        powerUnit: 'hp',
      });
      render(<Hybrid />);

      expect(screen.getByText('Motor').nextElementSibling).toHaveTextContent(
        '155°'
      );
      expect(screen.getByText('273')).toBeInTheDocument();
    });

    it('draws only the cells that are switched on', () => {
      configure({
        showMotor: true,
        motor: {
          showTemps: false,
          showRpm: true,
          showTorque: false,
          showPower: false,
          showRegen: false,
        },
      });
      render(<Hybrid />);

      expect(screen.getByText('RPM')).toBeInTheDocument();
      expect(screen.queryByText('Motor')).not.toBeInTheDocument();
      expect(screen.queryByText('Torque')).not.toBeInTheDocument();
    });
  });

  describe('when it is shown', () => {
    it('is hidden out of the car, and shown there once that is switched off', () => {
      vi.mocked(Context.useDrivingState).mockReturnValue({
        isDriving: false,
        // The battery is the driver's own: a watched car does not show it,
        // the team car included, whose telemetry block is not read yet.
        isWatching: true,
        isWatchingOwnCar: true,
        isWatchingOtherCar: false,
      });
      const { container, rerender } = render(<Hybrid />);
      expect(container).toBeEmptyDOMElement();

      configure({ showOnlyWhenOnTrack: false });
      rerender(<Hybrid />);
      // The last readings from the car stand.
      expect(charge()).toHaveTextContent('74.3');
    });

    it('is hidden in a session it is switched off for', () => {
      vi.mocked(Context.useSessionVisibility).mockReturnValue(false);
      const { container } = render(<Hybrid />);

      expect(container).toBeEmptyDOMElement();
    });
  });
});
