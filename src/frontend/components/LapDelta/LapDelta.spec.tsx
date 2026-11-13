import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useDashboard,
  useDrivingState,
  useLapDeltaSnapshot,
  useSessionVisibility,
} from '@irdashies/context';
import {
  getWidgetDefaultConfig,
  type LapDeltaConfig,
  type LapDeltaReference,
} from '@irdashies/types';
import { LapDelta, LapDeltaView } from './LapDelta';

vi.mock('@irdashies/context', () => ({
  useDashboard: vi.fn(),
  useDrivingState: vi.fn(),
  useLapDeltaSnapshot: vi.fn(),
  useSessionVisibility: vi.fn(),
}));

const defaults = getWidgetDefaultConfig('lapdelta');

const settings = (overrides: Partial<LapDeltaConfig> = {}): LapDeltaConfig => ({
  ...defaults,
  ...overrides,
});

const none: LapDeltaReference = { lapTime: null, delta: null, trend: null };

const view = (
  reading: LapDeltaReference,
  overrides: Partial<LapDeltaConfig> = {}
) =>
  render(<LapDeltaView settings={settings(overrides)} reading={reading} />)
    .container;

const value = (container: HTMLElement) =>
  container.querySelector('[data-testid="lap-delta-value"]') as HTMLElement;

const barWidth = (container: HTMLElement, side: 'faster' | 'slower') =>
  (container.querySelector(`[data-testid="trend-${side}"]`) as HTMLElement)
    .style.width;

describe('LapDeltaView', () => {
  it('shows a lap that is up in green, with its sign', () => {
    const container = view({ lapTime: 98.556, delta: -0.342, trend: -0.11 });

    expect(value(container).textContent).toBe('-0.34');
    expect(value(container).className).toContain('text-green-400');
  });

  it('shows a lap that is down in red', () => {
    const container = view({ lapTime: 98.556, delta: 1.204, trend: 0.2 });

    expect(value(container).textContent).toBe('+1.20');
    expect(value(container).className).toContain('text-red-400');
  });

  it('fills the trend bar toward the side time is moving', () => {
    // Half the range, so half of that side's half of the bar.
    const gaining = view({ lapTime: 98.556, delta: -0.342, trend: -0.15 });
    expect(barWidth(gaining, 'faster')).toBe('25%');
    expect(barWidth(gaining, 'slower')).toBe('0px');

    // Up on the lap but losing: the figure is green, the bar is red.
    const losing = view({ lapTime: 98.556, delta: -0.342, trend: 0.3 });
    expect(value(losing).className).toContain('text-green-400');
    expect(barWidth(losing, 'slower')).toBe('50%');
    expect(barWidth(losing, 'faster')).toBe('0px');
  });

  it('shows the predicted lap and the reference lap', () => {
    const container = view({ lapTime: 98.556, delta: -0.342, trend: -0.11 });

    expect(container.textContent).toContain('Predicted1:38.214');
    expect(container.textContent).toContain('Session best1:38.556');
  });

  it('names the all-time reference when that is the one chosen', () => {
    const container = view(
      { lapTime: 97.91, delta: 0.304, trend: 0 },
      { reference: 'allTime' }
    );

    expect(container.textContent).toContain('All-time best1:37.910');
  });

  it('shows dashes when the reference does not exist yet', () => {
    const container = view(none);

    expect(value(container).textContent).toBe('-.--');
    expect(value(container).className).toContain('text-slate-500');
    expect(container.textContent).toContain('Predicted-:--.---');
    expect(container.textContent).toContain('Session best-:--.---');
    expect(barWidth(container, 'faster')).toBe('0px');
    expect(barWidth(container, 'slower')).toBe('0px');
  });

  it('keeps the reference time on a lap that is not being timed', () => {
    // The out-lap: there is a lap to beat, and nothing yet to compare.
    const container = view({ lapTime: 98.556, delta: null, trend: null });

    expect(value(container).textContent).toBe('-.--');
    expect(container.textContent).toContain('Predicted-:--.---');
    expect(container.textContent).toContain('Session best1:38.556');
  });

  it('follows the precision setting', () => {
    const container = view(
      { lapTime: 98.556, delta: -0.3421, trend: -0.11 },
      { decimals: 3 }
    );

    expect(value(container).textContent).toBe('-0.342');
  });

  it('leaves out what the settings switch off', () => {
    const container = view(
      { lapTime: 98.556, delta: -0.342, trend: -0.11 },
      { showTrend: false, showPredictedLap: false, showReferenceLap: false }
    );

    expect(container.querySelector('[data-testid="trend-faster"]')).toBeNull();
    expect(container.textContent).toBe('-0.34');
  });
});

describe('LapDelta', () => {
  const snapshot = {
    sessionBest: { lapTime: 98.556, delta: -0.342, trend: -0.11 },
    allTime: { lapTime: 97.91, delta: 0.304, trend: -0.11 },
    sessionNum: 0,
    version: 1,
  };

  const withConfig = (config: Partial<LapDeltaConfig> | undefined) =>
    vi.mocked(useDashboard).mockReturnValue({
      isDemoMode: false,
      currentDashboard: {
        widgets: config === undefined ? [] : [{ id: 'lapdelta', config }],
      },
    } as never);

  beforeEach(() => {
    vi.clearAllMocks();
    withConfig({});
    vi.mocked(useDrivingState).mockReturnValue({ isDriving: true });
    vi.mocked(useSessionVisibility).mockReturnValue(true);
    vi.mocked(useLapDeltaSnapshot).mockReturnValue(snapshot);
  });

  it('measures against the session best by default', () => {
    const { container } = render(<LapDelta />);

    expect(value(container).textContent).toBe('-0.34');
    expect(container.textContent).toContain('Session best1:38.556');
  });

  it('measures against the all-time best when set to', () => {
    withConfig({ reference: 'allTime' });

    const { container } = render(<LapDelta />);

    expect(value(container).textContent).toBe('+0.30');
    expect(container.textContent).toContain('All-time best1:37.910');
  });

  it('does not fall back to the other reference when the chosen one is missing', () => {
    withConfig({ reference: 'allTime' });
    vi.mocked(useLapDeltaSnapshot).mockReturnValue({
      ...snapshot,
      allTime: none,
    });

    const { container } = render(<LapDelta />);

    expect(value(container).textContent).toBe('-.--');
    expect(container.textContent).toContain('All-time best-:--.---');
  });

  it('shows dashes before the first snapshot arrives', () => {
    vi.mocked(useLapDeltaSnapshot).mockReturnValue(undefined);

    const { container } = render(<LapDelta />);

    expect(value(container).textContent).toBe('-.--');
  });

  it('hides while not driving, unless told to stay', () => {
    vi.mocked(useDrivingState).mockReturnValue({ isDriving: false });

    expect(render(<LapDelta />).container.firstChild).toBeNull();

    withConfig({ showOnlyWhenOnTrack: false });
    expect(render(<LapDelta />).container.firstChild).not.toBeNull();
  });

  it('hides in a session it is switched off for', () => {
    vi.mocked(useSessionVisibility).mockReturnValue(false);

    expect(render(<LapDelta />).container.firstChild).toBeNull();
  });

  it('shows a sample reading in demo mode, whatever the session', () => {
    vi.mocked(useDashboard).mockReturnValue({
      isDemoMode: true,
      currentDashboard: { widgets: [] },
    } as never);
    vi.mocked(useDrivingState).mockReturnValue({ isDriving: false });
    vi.mocked(useLapDeltaSnapshot).mockReturnValue(undefined);

    const { container } = render(<LapDelta />);

    expect(value(container).textContent).toBe('-0.34');
  });

  it('survives a saved config that names no known reference', () => {
    withConfig({ reference: 'lifetime' as never, decimals: 7 as never });

    const { container } = render(<LapDelta />);

    // Falls back to the session best at two decimals rather than throwing.
    expect(value(container).textContent).toBe('-0.34');
    expect(container.textContent).toContain('Session best1:38.556');
  });

  it('uses the defaults when the dashboard has no entry for it', () => {
    withConfig(undefined);

    const { container } = render(<LapDelta />);

    expect(value(container).textContent).toBe('-0.34');
  });
});
