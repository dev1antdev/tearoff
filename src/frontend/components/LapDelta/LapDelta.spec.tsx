import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useDashboard,
  useDrivingState,
  useLapDeltaSnapshot,
  useSessionVisibility,
} from '@irdashies/context';
import {
  getWidgetDefaultConfig,
  type LapDeltaConfig,
  type LapDeltaFinal,
  type LapDeltaReference,
  type LapDeltaSnapshot,
} from '@irdashies/types';
import { LapDelta, LapDeltaView } from './LapDelta';
import { resolveLapDeltaSettings } from './hooks/useLapDeltaSettings';
import type { LapDeltaReadings } from './lapDeltaDisplay';

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

const ALL_OTHERS = {
  sessionBest: true,
  allTime: true,
  stintBest: true,
  lastLap: true,
};

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

/** Readings with one reference filled in: the session best unless told. */
const readingsOf = (
  reading: LapDeltaReference,
  reference: LapDeltaConfig['reference'] = 'sessionBest'
): LapDeltaReadings => ({
  sessionBest: none,
  allTime: none,
  stintBest: none,
  lastLap: none,
  lastLapFinal: null,
  [reference]: reading,
});

const view = (
  reading: LapDeltaReference,
  overrides: Partial<LapDeltaConfig> = {}
) =>
  render(
    <LapDeltaView
      settings={settings(overrides)}
      readings={readingsOf(reading, overrides.reference)}
    />
  ).container;

const value = (container: HTMLElement) =>
  container.querySelector('[data-testid="lap-delta-value"]') as HTMLElement;

const barWidth = (container: HTMLElement, side: 'faster' | 'slower') =>
  (container.querySelector(`[data-testid="trend-${side}"]`) as HTMLElement)
    .style.width;

const strip = (container: HTMLElement) =>
  container.querySelector('[data-testid="lap-delta-strip"]');

const cell = (container: HTMLElement, key: LapDeltaConfig['reference']) =>
  container.querySelector(`[data-testid="lap-delta-cell-${key}"]`);

// Three laps into a stint, a third of a second up on the session best.
const stintReadings: LapDeltaReadings = {
  sessionBest: { lapTime: 98.556, delta: -0.342, trend: -0.11 },
  allTime: { lapTime: 97.91, delta: 0.304, trend: -0.11 },
  stintBest: { lapTime: 98.802, delta: -0.588, trend: -0.11 },
  lastLap: { lapTime: 99.137, delta: -0.923, trend: -0.11 },
  lastLapFinal: null,
};

/** How the lap before this one ended, at 1090 s on the session clock. */
const final = (overrides: Partial<LapDeltaFinal> = {}): LapDeltaFinal => ({
  lapTime: 99.137,
  completedAt: 1090,
  sessionBest: 0.581,
  allTime: 1.227,
  stintBest: 0.335,
  lastLap: -0.214,
  ...overrides,
});

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

  it('names the stint best and the last lap when one of them is chosen', () => {
    const stint = view(
      { lapTime: 98.802, delta: -0.588, trend: 0 },
      { reference: 'stintBest' }
    );
    expect(value(stint).textContent).toBe('-0.59');
    expect(stint.textContent).toContain('Stint best1:38.802');

    const last = view(
      { lapTime: 99.137, delta: -0.923, trend: 0 },
      { reference: 'lastLap' }
    );
    expect(value(last).textContent).toBe('-0.92');
    expect(last.textContent).toContain('Last lap1:39.137');
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

describe('the strip of other references', () => {
  const withStrip = (
    overrides: Partial<LapDeltaConfig> = {},
    readings: LapDeltaReadings = stintReadings,
    held = false
  ) =>
    render(
      <LapDeltaView
        settings={settings({ secondary: ALL_OTHERS, ...overrides })}
        readings={readings}
        held={held}
      />
    ).container;

  it('is not drawn while none of them is switched on', () => {
    const { container } = render(
      <LapDeltaView settings={settings()} readings={stintReadings} />
    );

    expect(strip(container)).toBeNull();
  });

  it('shows the others by their letter and leaves the chosen one out', () => {
    const container = withStrip();

    expect(cell(container, 'sessionBest')).toBeNull();
    expect(cell(container, 'allTime')?.textContent).toBe('A+0.30');
    expect(cell(container, 'stintBest')?.textContent).toBe('T-0.59');
    expect(cell(container, 'lastLap')?.textContent).toBe('L-0.92');
    expect(strip(container)?.children).toHaveLength(3);

    const againstStint = withStrip({ reference: 'stintBest' });
    expect(value(againstStint).textContent).toBe('-0.59');
    expect(cell(againstStint, 'stintBest')).toBeNull();
    expect(cell(againstStint, 'sessionBest')?.textContent).toBe('S-0.34');
  });

  it('colours each delta as the large figure is coloured', () => {
    const container = withStrip();

    expect(cell(container, 'allTime')?.innerHTML).toContain('text-red-400');
    expect(cell(container, 'lastLap')?.innerHTML).toContain('text-green-400');
  });

  it('shows only the references that are switched on', () => {
    const container = withStrip({
      secondary: { ...defaults.secondary, lastLap: true },
    });

    expect(strip(container)?.children).toHaveLength(1);
    expect(cell(container, 'lastLap')?.textContent).toBe('L-0.92');
  });

  it('keeps a cell for a reference that does not exist, with dashes', () => {
    // The first lap of a stint: its best is yet to be set.
    const container = withStrip({}, { ...stintReadings, stintBest: none });

    expect(strip(container)?.children).toHaveLength(3);
    expect(cell(container, 'stintBest')?.textContent).toBe('T-.--');
    expect(cell(container, 'stintBest')?.innerHTML).toContain('text-slate-500');
  });

  it('follows the precision setting', () => {
    const container = withStrip({ decimals: 3 });

    expect(cell(container, 'stintBest')?.textContent).toBe('T-0.588');
  });

  it('shows the result of the lap just finished while it is held', () => {
    const container = withStrip(
      {},
      { ...stintReadings, lastLapFinal: final() },
      true
    );

    // Half a second down on the session best at the line.
    expect(value(container).textContent).toBe('+0.58');
    expect(value(container).className).toContain('text-red-400');
    expect(cell(container, 'allTime')?.textContent).toBe('A+1.23');
    expect(cell(container, 'stintBest')?.textContent).toBe('T+0.34');
    expect(cell(container, 'lastLap')?.textContent).toBe('L-0.21');
    // The last row is the lap just finished, by name.
    expect(container.textContent).toContain('Last lap1:39.137');
    expect(container.textContent).not.toContain('Session best');
  });
});

describe('LapDelta', () => {
  const snapshot: LapDeltaSnapshot = {
    ...stintReadings,
    stintId: 2,
    sessionNum: 0,
    version: 1,
  };

  const withConfig = (config: unknown) =>
    vi.mocked(useDashboard).mockReturnValue({
      isDemoMode: false,
      currentDashboard: {
        widgets: config === undefined ? [] : [{ id: 'lapdelta', config }],
      },
    } as never);

  beforeEach(() => {
    vi.clearAllMocks();
    withConfig({});
    vi.mocked(useDrivingState).mockReturnValue(where({ isDriving: true }));
    vi.mocked(useSessionVisibility).mockReturnValue(true);
    vi.mocked(useLapDeltaSnapshot).mockReturnValue(snapshot);
  });

  it('measures against the session best by default', () => {
    const { container } = render(<LapDelta />);

    expect(value(container).textContent).toBe('-0.34');
    expect(container.textContent).toContain('Session best1:38.556');
    expect(strip(container)).toBeNull();
  });

  it('measures against the all-time best when set to', () => {
    withConfig({ reference: 'allTime' });

    const { container } = render(<LapDelta />);

    expect(value(container).textContent).toBe('+0.30');
    expect(container.textContent).toContain('All-time best1:37.910');
  });

  it('measures against the stint best and the last lap when set to', () => {
    withConfig({ reference: 'stintBest' });
    const stint = render(<LapDelta />);
    expect(value(stint.container).textContent).toBe('-0.59');
    expect(stint.container.textContent).toContain('Stint best1:38.802');
    stint.unmount();

    withConfig({ reference: 'lastLap' });
    const last = render(<LapDelta />);
    expect(value(last.container).textContent).toBe('-0.92');
    expect(last.container.textContent).toContain('Last lap1:39.137');
  });

  it('does not fall back to another reference when the chosen one is missing', () => {
    for (const reference of ['allTime', 'stintBest', 'lastLap'] as const) {
      withConfig({ reference });
      vi.mocked(useLapDeltaSnapshot).mockReturnValue({
        ...snapshot,
        [reference]: none,
      });

      const { container, unmount } = render(<LapDelta />);

      expect(value(container).textContent).toBe('-.--');
      expect(container.textContent).toContain('Predicted-:--.---');
      unmount();
    }
  });

  it('shows the other references that the settings switch on', () => {
    withConfig({ secondary: { stintBest: true, lastLap: true } });

    const { container } = render(<LapDelta />);

    expect(strip(container)?.children).toHaveLength(2);
    expect(cell(container, 'stintBest')?.textContent).toBe('T-0.59');
    expect(cell(container, 'lastLap')?.textContent).toBe('L-0.92');
  });

  it('shows dashes before the first snapshot arrives', () => {
    vi.mocked(useLapDeltaSnapshot).mockReturnValue(undefined);

    const { container } = render(<LapDelta />);

    expect(value(container).textContent).toBe('-.--');
  });

  it('hides while not driving, unless told to stay', () => {
    vi.mocked(useDrivingState).mockReturnValue(where());

    expect(render(<LapDelta />).container.firstChild).toBeNull();

    withConfig({ showOnlyWhenOnTrack: false });
    expect(render(<LapDelta />).container.firstChild).not.toBeNull();
  });

  it('shows through a team-mate’s stint in the user’s own car', () => {
    // Their lap, in the team car, against the user's own references: the
    // stint best and the last lap as much as the session best.
    withConfig({ secondary: ALL_OTHERS });
    vi.mocked(useDrivingState).mockReturnValue(
      where({ isWatching: true, isWatchingOwnCar: true })
    );

    const { container } = render(<LapDelta />);

    expect(value(container).textContent).toBe('-0.34');
    expect(container.textContent).toContain('Session best1:38.556');
    expect(cell(container, 'stintBest')?.textContent).toBe('T-0.59');
    expect(cell(container, 'lastLap')?.textContent).toBe('L-0.92');
  });

  it('stays hidden while the camera is on another car', () => {
    // The delta is still the team car's, and that is not the car on screen.
    vi.mocked(useDrivingState).mockReturnValue(
      where({ isWatching: true, isWatchingOtherCar: true })
    );

    expect(render(<LapDelta />).container.firstChild).toBeNull();
  });

  it('shows no delta over another car when told to stay on screen', () => {
    withConfig({ showOnlyWhenOnTrack: false, secondary: ALL_OTHERS });
    vi.mocked(useDrivingState).mockReturnValue(
      where({ isWatching: true, isWatchingOtherCar: true })
    );

    const { container } = render(<LapDelta />);

    expect(value(container).textContent).toBe('-.--');
    expect(barWidth(container, 'faster')).toBe('0px');
    expect(cell(container, 'stintBest')?.textContent).toBe('T-.--');
    expect(cell(container, 'lastLap')?.textContent).toBe('L-.--');
    // The lap to beat is the user's own and is still named.
    expect(container.textContent).toContain('Session best1:38.556');
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
    vi.mocked(useDrivingState).mockReturnValue(where());
    vi.mocked(useLapDeltaSnapshot).mockReturnValue(undefined);

    const { container } = render(<LapDelta />);

    expect(value(container).textContent).toBe('-0.34');
  });

  it('survives a saved config that names no known reference', () => {
    withConfig({
      reference: 'lifetime',
      decimals: 7,
      secondary: 'all',
      freezeSeconds: 'long',
    });

    const { container } = render(<LapDelta />);

    // Falls back to the session best at two decimals rather than throwing.
    expect(value(container).textContent).toBe('-0.34');
    expect(container.textContent).toContain('Session best1:38.556');
    expect(strip(container)).toBeNull();
  });

  it('works on a config saved before the strip and the hold existed', () => {
    // As an older build stored it: no `secondary`, no `freezeSeconds`.
    withConfig({ reference: 'allTime', decimals: 3, showTrend: true });

    const { container } = render(<LapDelta />);

    expect(value(container).textContent).toBe('+0.304');
    expect(strip(container)).toBeNull();
  });

  it('uses the defaults when the dashboard has no entry for it', () => {
    withConfig(undefined);

    const { container } = render(<LapDelta />);

    expect(value(container).textContent).toBe('-0.34');
  });
});

describe('the result of a lap, held after the line', () => {
  const live: LapDeltaSnapshot = {
    ...stintReadings,
    stintId: 2,
    sessionNum: 0,
    version: 1,
  };
  /** The lap that ended at `completedAt`, half a second down. */
  const ended = (completedAt: number): LapDeltaSnapshot => ({
    ...live,
    lastLapFinal: final({ completedAt }),
    version: completedAt,
  });

  const withConfig = (config: unknown) =>
    vi.mocked(useDashboard).mockReturnValue({
      isDemoMode: false,
      currentDashboard: { widgets: [{ id: 'lapdelta', config }] },
    } as never);

  /** Draws the widget and hands back a way to give it the next snapshot. */
  const mount = (first: LapDeltaSnapshot | undefined) => {
    vi.mocked(useLapDeltaSnapshot).mockReturnValue(first);
    const rendered = render(<LapDelta />);
    return {
      ...rendered,
      publish: (next: LapDeltaSnapshot) => {
        vi.mocked(useLapDeltaSnapshot).mockReturnValue(next);
        rendered.rerender(<LapDelta />);
      },
    };
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    withConfig({});
    vi.mocked(useDrivingState).mockReturnValue(where({ isDriving: true }));
    vi.mocked(useSessionVisibility).mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('takes the place of the live delta for the time the settings give', () => {
    const { container, publish } = mount(live);
    expect(value(container).textContent).toBe('-0.34');

    // The line: the lap ended half a second down on the session best.
    publish(ended(1090));
    expect(value(container).textContent).toBe('+0.58');
    expect(container.textContent).toContain('Last lap1:39.137');

    // Still there just short of three seconds, and gone just after.
    act(() => {
      vi.advanceTimersByTime(2900);
    });
    expect(value(container).textContent).toBe('+0.58');
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(value(container).textContent).toBe('-0.34');
    expect(container.textContent).toContain('Session best1:38.556');
  });

  it('is held again for the lap after', () => {
    const { container, publish } = mount(live);
    publish(ended(1090));
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(value(container).textContent).toBe('-0.34');

    // A tenth up on the session best this time.
    publish({
      ...ended(1189),
      lastLapFinal: final({ completedAt: 1189, sessionBest: -0.1 }),
    });

    expect(value(container).textContent).toBe('-0.10');
    expect(value(container).className).toContain('text-green-400');
  });

  it('follows the length the settings give it', () => {
    withConfig({ freezeSeconds: 8 });
    const { container, publish } = mount(live);
    publish(ended(1090));

    act(() => {
      vi.advanceTimersByTime(7500);
    });
    expect(value(container).textContent).toBe('+0.58');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(value(container).textContent).toBe('-0.34');
  });

  it('is never shown when the hold is set to zero', () => {
    withConfig({ freezeSeconds: 0 });
    const { container, publish } = mount(live);

    publish(ended(1090));

    expect(value(container).textContent).toBe('-0.34');
    expect(container.textContent).toContain('Session best1:38.556');
  });

  it('is not shown for a lap that ended before the widget was looking', () => {
    // Shown part-way round a lap: the result is of a lap that ended a
    // while ago, however long that is.
    const first = mount(ended(1090));
    expect(value(first.container).textContent).toBe('-0.34');
    first.unmount();

    // The same when the channel answers a moment after the widget is drawn.
    const late = mount(undefined);
    late.publish(ended(1090));
    expect(value(late.container).textContent).toBe('-0.34');

    // The next lap to end is news.
    late.publish(ended(1189));
    expect(value(late.container).textContent).toBe('+0.58');
  });

  it('holds the result against the reference the settings choose', () => {
    withConfig({ reference: 'lastLap', secondary: ALL_OTHERS });
    const { container, publish } = mount(live);

    publish(ended(1090));

    // Two tenths quicker than the lap before it.
    expect(value(container).textContent).toBe('-0.21');
    expect(value(container).className).toContain('text-green-400');
    expect(cell(container, 'sessionBest')?.textContent).toBe('S+0.58');
    expect(cell(container, 'stintBest')?.textContent).toBe('T+0.34');
  });

  it('holds dashes where the lap had no such reference to end against', () => {
    // The first timed lap of a stint: there was no stint best before it.
    withConfig({ reference: 'stintBest' });
    const { container, publish } = mount(live);

    publish({
      ...live,
      lastLapFinal: final({ stintBest: null }),
      version: 2,
    });

    expect(value(container).textContent).toBe('-.--');
    expect(container.textContent).toContain('Last lap1:39.137');
  });

  it('is not shown over another car', () => {
    withConfig({ showOnlyWhenOnTrack: false });
    vi.mocked(useDrivingState).mockReturnValue(
      where({ isWatching: true, isWatchingOtherCar: true })
    );
    const { container, publish } = mount(live);

    publish(ended(1090));

    expect(value(container).textContent).toBe('-.--');
    expect(container.textContent).toContain('Session best1:38.556');
  });

  it('is shown through a team-mate’s stint, against the user’s own laps', () => {
    vi.mocked(useDrivingState).mockReturnValue(
      where({ isWatching: true, isWatchingOwnCar: true })
    );
    const { container, publish } = mount(live);

    publish(ended(1090));

    expect(value(container).textContent).toBe('+0.58');
  });
});

describe('resolveLapDeltaSettings', () => {
  it('keeps each of the four references', () => {
    for (const reference of [
      'sessionBest',
      'allTime',
      'stintBest',
      'lastLap',
    ] as const) {
      expect(resolveLapDeltaSettings({ reference }).reference).toBe(reference);
    }
  });

  it('fills in what an older config does not have', () => {
    const resolved = resolveLapDeltaSettings({ reference: 'allTime' });

    expect(resolved.secondary).toEqual(defaults.secondary);
    expect(resolved.freezeSeconds).toBe(3);
    expect(resolved.showTrend).toBe(true);
  });

  it('keeps the strip switches that are booleans and defaults the rest', () => {
    expect(
      resolveLapDeltaSettings({
        secondary: { stintBest: true, lastLap: 'yes', other: true },
      }).secondary
    ).toEqual({
      sessionBest: false,
      allTime: false,
      stintBest: true,
      lastLap: false,
    });
  });

  it('holds the hold inside its limits', () => {
    expect(resolveLapDeltaSettings({ freezeSeconds: 60 }).freezeSeconds).toBe(
      10
    );
    expect(resolveLapDeltaSettings({ freezeSeconds: -2 }).freezeSeconds).toBe(
      0
    );
    expect(resolveLapDeltaSettings({ freezeSeconds: 0 }).freezeSeconds).toBe(0);
    expect(
      resolveLapDeltaSettings({ freezeSeconds: Number.NaN }).freezeSeconds
    ).toBe(3);
  });

  it('is the defaults for anything that is not a config', () => {
    expect(resolveLapDeltaSettings(undefined)).toBe(defaults);
    expect(resolveLapDeltaSettings('lapdelta')).toBe(defaults);
    expect(resolveLapDeltaSettings([])).toBe(defaults);
  });
});
