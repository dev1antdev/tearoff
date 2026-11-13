import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useDashboard,
  useDrivingState,
  useSessionVisibility,
  useTrackStateSelector,
} from '@irdashies/context';
import {
  NO_CORNER_READING,
  type CornerReading,
  type CornerResult,
} from '@irdashies/domain/cornerDelta/cornerReadings';
import {
  getWidgetDefaultConfig,
  type CornerDeltaConfig,
} from '@irdashies/types';
import { CornerDelta, CornerDeltaView } from './CornerDelta';
import { useCornerResults } from './hooks/useCornerResults';

vi.mock('@irdashies/context', () => ({
  trackStateSelectors: { displayUnits: vi.fn() },
  useDashboard: vi.fn(),
  useDrivingState: vi.fn(),
  useSessionVisibility: vi.fn(),
  useTrackStateSelector: vi.fn(),
}));

vi.mock('./hooks/useCornerResults', () => ({
  useCornerResults: vi.fn(),
}));

const defaults = getWidgetDefaultConfig('cornerdelta');

const settings = (
  overrides: Partial<CornerDeltaConfig> = {}
): CornerDeltaConfig => ({ ...defaults, ...overrides });

const reading = (
  timeDeltaSec: number | null,
  entrySpeedDeltaKph: number | null = null,
  exitSpeedDeltaKph: number | null = null
): CornerReading => ({ timeDeltaSec, entrySpeedDeltaKph, exitSpeedDeltaKph });

const result = (
  serial: number,
  label: string,
  readings: Partial<CornerResult['readings']> = {}
): CornerResult => ({
  serial,
  sectionId: `corner-${serial}`,
  label,
  timeSec: 4,
  entrySpeedKph: 171.4,
  exitSpeedKph: 142.2,
  readings: {
    allTime: NO_CORNER_READING,
    sessionBest: NO_CORNER_READING,
    lastLap: NO_CORNER_READING,
    ...readings,
  },
});

const threeCorners = [
  result(3, 'Variante Alta', { sessionBest: reading(-0.084, 3.2, 1.6) }),
  result(2, 'Acque Minerali', { sessionBest: reading(0.031, -1.4, -2.1) }),
  result(1, 'Piratella', { sessionBest: reading(0.012, 0.8, -0.6) }),
];

const view = (
  results: readonly CornerResult[],
  overrides: Partial<CornerDeltaConfig> = {},
  props: Partial<React.ComponentProps<typeof CornerDeltaView>> = {}
) =>
  render(
    <CornerDeltaView
      settings={settings(overrides)}
      unit="km/h"
      results={results}
      {...props}
    />
  ).container;

const byTestId = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

const value = (container: HTMLElement) =>
  byTestId(container, 'corner-delta-value') as HTMLElement;

describe('CornerDeltaView', () => {
  it('names the last corner and shows time gained through it in green', () => {
    const container = view(threeCorners);

    expect(byTestId(container, 'corner-delta-label')?.textContent).toBe(
      'Variante Alta'
    );
    expect(value(container).textContent).toBe('-0.08');
    expect(value(container).className).toContain('text-green-400');
    expect(container.textContent).toContain('Session best');
  });

  it('shows time lost in red', () => {
    const container = view([threeCorners[1]]);

    expect(value(container).textContent).toBe('+0.03');
    expect(value(container).className).toContain('text-red-400');
  });

  it('shows the speeds driven with how each compares', () => {
    const container = view(threeCorners);

    expect(container.textContent).toContain('Entry km/h171+3.2');
    expect(container.textContent).toContain('Exit km/h142+1.6');
  });

  it('draws the speeds in miles an hour when that is the unit', () => {
    const container = view(threeCorners, {}, { unit: 'mph' });

    // 171.4 km/h, and a difference of 3.2 km/h.
    expect(container.textContent).toContain('Entry mph107+2.0');
  });

  it('reads the reference the settings choose, and only that one', () => {
    const corner = result(1, 'Tosa', {
      sessionBest: reading(-0.084, 3.2, 1.6),
      lastLap: reading(0.21, -4, -2.5),
    });

    const lastLap = view([corner], { reference: 'lastLap' });
    expect(value(lastLap).textContent).toBe('+0.21');
    expect(lastLap.textContent).toContain('Last lap');

    // No all-time lap yet: dashes, not the session best in its place. The
    // speeds driven are still there.
    const allTime = view([corner], { reference: 'allTime' });
    expect(value(allTime).textContent).toBe('-.--');
    expect(value(allTime).className).toContain('text-slate-500');
    expect(allTime.textContent).toContain('All-time best');
    expect(allTime.textContent).toContain('Entry km/h171-.-');
  });

  it('draws the time to three decimals when asked', () => {
    const container = view(threeCorners, { decimals: 3 });

    expect(value(container).textContent).toBe('-0.084');
  });

  it('lists the corners before the last one, as many as the setting says', () => {
    const two = byTestId(view(threeCorners), 'corner-delta-history');
    expect(two?.textContent).toContain('Acque Minerali+0.03-1.4-2.1');
    expect(two?.textContent).toContain('Piratella+0.01+0.8-0.6');

    const one = byTestId(
      view(threeCorners, { historyCount: 1 }),
      'corner-delta-history'
    );
    expect(one?.textContent).toContain('Acque Minerali');
    expect(one?.textContent).not.toContain('Piratella');

    expect(
      byTestId(view(threeCorners, { historyCount: 0 }), 'corner-delta-history')
    ).toBeNull();
  });

  it('has no list while only one corner has been driven', () => {
    expect(
      byTestId(view([threeCorners[0]]), 'corner-delta-history')
    ).toBeNull();
  });

  it('drops a speed from the corner and from the list when switched off', () => {
    const container = view(threeCorners, { showEntrySpeed: false });

    expect(container.textContent).not.toContain('Entry');
    expect(container.textContent).toContain('Exit km/h142+1.6');
    const history = byTestId(container, 'corner-delta-history');
    expect(history?.textContent).toContain('EarlierTimeOut');
    expect(history?.textContent).toContain('Acque Minerali+0.03-2.1');

    const neither = view(threeCorners, {
      showEntrySpeed: false,
      showExitSpeed: false,
    });
    expect(neither.textContent).not.toContain('Exit');
    expect(byTestId(neither, 'corner-delta-history')?.textContent).toContain(
      'Acque Minerali+0.03'
    );
  });

  it('uses the label the track gives a corner now, over the one it had', () => {
    const container = view(
      threeCorners,
      {},
      { labels: new Map([['corner-3', 'T14']]) }
    );

    expect(byTestId(container, 'corner-delta-label')?.textContent).toBe('T14');
    // A corner the map does not know keeps its own.
    expect(container.textContent).toContain('Acque Minerali');
  });

  it('shows dashes before any corner has been driven', () => {
    const container = view([]);

    expect(byTestId(container, 'corner-delta-label')?.textContent).toBe(
      'No corner yet'
    );
    expect(value(container).textContent).toBe('-.--');
    expect(container.textContent).toContain('Entry km/h---.-');
  });

  it('says so on a track that has no corner data', () => {
    const container = view([], {}, { hasCorners: false });

    expect(container.textContent).toBe('No corner data for this track');
  });

  it('sets the background opacity from the settings', () => {
    const container = view(threeCorners, { background: { opacity: 35 } });

    expect(
      (container.firstChild as HTMLElement).style.getPropertyValue(
        '--bg-opacity'
      )
    ).toBe('35%');
  });
});

describe('CornerDelta', () => {
  const dashboard = (
    config: Partial<CornerDeltaConfig> = {},
    isDemoMode = false
  ) =>
    vi.mocked(useDashboard).mockReturnValue({
      isDemoMode,
      currentDashboard: {
        widgets: [{ id: 'cornerdelta', enabled: true, config }],
      },
    } as unknown as ReturnType<typeof useDashboard>);

  beforeEach(() => {
    vi.clearAllMocks();
    dashboard();
    vi.mocked(useDrivingState).mockReturnValue({ isDriving: true });
    vi.mocked(useSessionVisibility).mockReturnValue(true);
    // Metric display units.
    vi.mocked(useTrackStateSelector).mockReturnValue(1);
    vi.mocked(useCornerResults).mockReturnValue({
      hasCorners: true,
      results: threeCorners,
      labels: new Map(),
    });
  });

  it('shows the corners the feed reports', () => {
    const { container } = render(<CornerDelta />);

    expect(value(container).textContent).toBe('-0.08');
    expect(container.textContent).toContain('Entry km/h171+3.2');
    expect(useCornerResults).toHaveBeenCalledWith(true, 'name');
  });

  it('takes the speed unit from the sim unless the settings name one', () => {
    // Imperial display units.
    vi.mocked(useTrackStateSelector).mockReturnValue(0);
    expect(render(<CornerDelta />).container.textContent).toContain(
      'Entry mph107'
    );

    dashboard({ speedUnit: 'km/h' });
    expect(render(<CornerDelta />).container.textContent).toContain(
      'Entry km/h171'
    );
  });

  it('asks for the label style the settings choose', () => {
    dashboard({ cornerLabel: 'number' });
    render(<CornerDelta />);

    expect(useCornerResults).toHaveBeenCalledWith(true, 'number');
  });

  it('is hidden while not driving, unless told to stay', () => {
    vi.mocked(useDrivingState).mockReturnValue({ isDriving: false });
    expect(render(<CornerDelta />).container.textContent).toBe('');

    dashboard({ showOnlyWhenOnTrack: false });
    expect(value(render(<CornerDelta />).container).textContent).toBe('-0.08');
  });

  it('is hidden and stops timing in a session it is switched off for', () => {
    vi.mocked(useSessionVisibility).mockReturnValue(false);
    const { container } = render(<CornerDelta />);

    expect(container.textContent).toBe('');
    expect(useCornerResults).toHaveBeenCalledWith(false, 'name');
  });

  it('shows an example in demo mode, whatever the session says', () => {
    dashboard({}, true);
    vi.mocked(useDrivingState).mockReturnValue({ isDriving: false });
    vi.mocked(useSessionVisibility).mockReturnValue(false);
    vi.mocked(useCornerResults).mockReturnValue({
      hasCorners: undefined,
      results: [],
      labels: new Map(),
    });
    const { container } = render(<CornerDelta />);

    expect(byTestId(container, 'corner-delta-label')?.textContent).toBe(
      'Variante Alta'
    );
    expect(useCornerResults).toHaveBeenCalledWith(false, 'name');
  });

  it('falls back to the defaults on a config with unknown values', () => {
    dashboard({
      reference: 'bestEver',
      speedUnit: 'knots',
      decimals: 5,
      historyCount: 40,
    } as unknown as Partial<CornerDeltaConfig>);
    const { container } = render(<CornerDelta />);

    // The default reference, two decimals, and no more rows than there are.
    expect(container.textContent).toContain('Session best');
    expect(value(container).textContent).toBe('-0.08');
    expect(container.textContent).toContain('Entry km/h171');
    expect(byTestId(container, 'corner-delta-history')?.textContent).toContain(
      'Piratella'
    );
  });
});
