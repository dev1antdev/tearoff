import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardLayout, DashboardWidget } from '@irdashies/types';

// The page in the app's window and the same page in a browser. The two
// differ in what the dashboard bridge can do and in where a layout is kept.

const mocks = vi.hoisted(() => ({
  openWidgetSettings: vi.fn(),
  onDashboardUpdated: vi.fn(),
  /** A browser's bridge has no call that opens the settings window. */
  inBrowser: false,
  dashboard: undefined as DashboardLayout | undefined,
}));

vi.mock('@irdashies/context', () => ({
  useDashboard: () => ({
    bridge: mocks.inBrowser
      ? {}
      : { openWidgetSettings: mocks.openWidgetSettings },
    currentDashboard: mocks.dashboard,
    onDashboardUpdated: mocks.onDashboardUpdated,
  }),
  useActiveSimulator: () => null,
  useSimWidgetSupport: () => ({ message: '', disabledWidgets: {} }),
  useRunningState: () => ({ running: true }),
  useSessionDrivers: () => [
    { CarIdx: 0, CarNumber: '77', UserName: 'Alex Mercer' },
  ],
  useDriverCarIdx: () => 0,
  useDrivingState: () => ({ isDriving: true }),
  useSessionBarSelector: () => undefined,
  useChannelSelector: () => undefined,
  useSessionTimeTiming: () => ({
    sessionType: 'Race',
    time: 0,
    timeRemaining: 0,
    timeTotal: 0,
    state: 4,
    greenFlagTimestamp: 0,
    isFixedLapRace: false,
    totalRaceTime: 0,
    adjustedRaceTime: 0,
  }),
  trackStateSelectors: { notInSession: 'notInSession' },
  useTrackStateSelector: () => undefined,
  SessionTimingStoreUpdater: () => null,
}));

vi.mock('@irdashies/utils/logger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { PitWall } from './PitWall';
import {
  PIT_WALL_DEVICE_LAYOUT_KEY,
  PitWallDeviceLayout,
} from './PitWallDeviceLayout';

const layout = { x: 0, y: 0, width: 100, height: 100 };
const widget = (
  id: string,
  extra: Partial<DashboardWidget> = {}
): DashboardWidget => ({ id, enabled: false, layout, ...extra });

/** The Race layout saved in the profile, with the Fuel widget missing. */
const savedDashboard = (): DashboardLayout => ({
  widgets: [
    widget('pitwall', { enabled: true, config: { layout: 'race' } }),
    widget('standings'),
    widget('pitstop'),
    widget('finishorder'),
    widget('weather'),
  ],
});

const shownLayout = () => screen.getByRole('main').getAttribute('data-layout');
const choose = (name: string) =>
  fireEvent.click(
    within(screen.getByRole('navigation', { name: 'Layout' })).getByRole(
      'button',
      { name }
    )
  );

const renderInWindow = () => render(<PitWall />);
const renderInBrowser = () => {
  mocks.inBrowser = true;
  return render(
    <PitWallDeviceLayout>
      <PitWall />
    </PitWallDeviceLayout>
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inBrowser = false;
  mocks.dashboard = savedDashboard();
  localStorage.clear();
});

afterEach(() => vi.restoreAllMocks());

describe('the Pit Wall in the app’s window', () => {
  it('has the gear for its own settings and one on each panel', () => {
    renderInWindow();

    fireEvent.click(screen.getByRole('button', { name: 'Pit Wall settings' }));
    expect(mocks.openWidgetSettings).toHaveBeenLastCalledWith('pitwall');
    fireEvent.click(
      screen.getByRole('button', { name: 'Open Standings settings' })
    );
    expect(mocks.openWidgetSettings).toHaveBeenLastCalledWith('standings');
  });

  it('offers the settings of a widget the profile has lost', () => {
    renderInWindow();
    const fuel = screen.getByRole('region', { name: 'Fuel Calculator' });

    fireEvent.click(
      within(fuel).getByRole('button', {
        name: 'Open Fuel Calculator settings',
      })
    );
    expect(mocks.openWidgetSettings).toHaveBeenLastCalledWith('fuel');
  });

  it('saves a chosen layout into the profile, and keeps nothing in the browser', () => {
    renderInWindow();

    choose('Compact');

    expect(mocks.onDashboardUpdated).toHaveBeenCalledTimes(1);
    expect(mocks.onDashboardUpdated.mock.calls[0][0].widgets[0].config).toEqual(
      { layout: 'compact' }
    );
    expect(localStorage.getItem(PIT_WALL_DEVICE_LAYOUT_KEY)).toBeNull();
  });
});

describe('the Pit Wall in a browser', () => {
  it('has no gear, in the header or on a panel', () => {
    renderInBrowser();

    expect(screen.getByRole('button', { name: 'Full screen' })).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Pit Wall settings' })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: /settings/i })).toBeNull();
  });

  it('says a widget is missing without offering settings it cannot open', () => {
    renderInBrowser();
    const fuel = screen.getByRole('region', { name: 'Fuel Calculator' });

    expect(fuel).toHaveTextContent(
      'This profile has no Fuel Calculator widget.'
    );
    expect(within(fuel).queryByRole('button')).toBeNull();
  });

  it('shows the profile’s layout until one is chosen here', () => {
    renderInBrowser();

    expect(shownLayout()).toBe('race');
    expect(localStorage.getItem(PIT_WALL_DEVICE_LAYOUT_KEY)).toBeNull();
  });

  it('keeps a chosen layout on the device and leaves the profile alone', () => {
    renderInBrowser();

    choose('Compact');

    expect(shownLayout()).toBe('compact');
    expect(screen.getByRole('button', { name: 'Compact' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(localStorage.getItem(PIT_WALL_DEVICE_LAYOUT_KEY)).toBe('compact');
    // A tablet on Compact must not switch the window on the monitor.
    expect(mocks.onDashboardUpdated).not.toHaveBeenCalled();
  });

  it('opens with the layout chosen here last time', () => {
    renderInBrowser().unmount();
    localStorage.setItem(PIT_WALL_DEVICE_LAYOUT_KEY, 'watching');

    renderInBrowser();

    expect(shownLayout()).toBe('watching');
  });

  it('keeps its own layout when the profile’s is changed from the window', () => {
    const { rerender } = renderInBrowser();
    choose('Compact');

    mocks.dashboard = {
      widgets: savedDashboard().widgets.map((saved) =>
        saved.id === 'pitwall'
          ? { ...saved, config: { layout: 'watching' } }
          : saved
      ),
    };
    rerender(
      <PitWallDeviceLayout>
        <PitWall />
      </PitWallDeviceLayout>
    );

    expect(shownLayout()).toBe('compact');
  });

  it('takes nothing but a known layout from what the browser kept', () => {
    localStorage.setItem(PIT_WALL_DEVICE_LAYOUT_KEY, 'everything');

    renderInBrowser();

    expect(shownLayout()).toBe('race');
  });

  it('holds a choice for as long as the page is open where nothing can be kept', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage is off');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage is off');
    });

    renderInBrowser();
    expect(shownLayout()).toBe('race');
    choose('Watching');

    expect(shownLayout()).toBe('watching');
    expect(mocks.onDashboardUpdated).not.toHaveBeenCalled();
  });
});
