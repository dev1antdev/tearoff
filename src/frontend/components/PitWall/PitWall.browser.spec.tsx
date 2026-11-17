import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BrowserConnection,
  DashboardLayout,
  DashboardWidget,
} from '@irdashies/types';

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
import { PitWallConnection } from './PitWallConnection';
import {
  PIT_WALL_DEVICE_LAYOUT_KEY,
  PIT_WALL_DEVICE_TAB_KEY,
  PitWallDeviceLayout,
} from './PitWallDeviceLayout';

const layout = { x: 0, y: 0, width: 100, height: 100 };
const widget = (
  id: string,
  extra: Partial<DashboardWidget> = {}
): DashboardWidget => ({ id, enabled: false, layout, ...extra });

/** The Race layout saved in the profile, with the Our Car widget missing. */
const savedDashboard = (): DashboardLayout => ({
  widgets: [
    widget('pitwall', { enabled: true, config: { layout: 'race' } }),
    widget('timingtower'),
    widget('classrivals'),
    widget('racelog'),
    widget('map'),
  ],
});

const shownLayout = () => screen.getByRole('main').getAttribute('data-layout');
const shownTab = () => screen.getByRole('main').getAttribute('data-tab');
const choose = (name: string) =>
  fireEvent.click(
    within(screen.getByRole('navigation', { name: 'Layout' })).getByRole(
      'button',
      { name }
    )
  );
const chooseTab = (name: string) =>
  fireEvent.click(
    within(screen.getByRole('navigation', { name: 'Tabs' })).getByRole(
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
      screen.getByRole('button', { name: 'Open Timing Tower settings' })
    );
    expect(mocks.openWidgetSettings).toHaveBeenLastCalledWith('timingtower');
  });

  it('offers the settings of a widget the profile has lost', () => {
    renderInWindow();
    const ourCar = screen.getByRole('region', { name: 'Our Car' });

    fireEvent.click(
      within(ourCar).getByRole('button', { name: 'Open Our Car settings' })
    );
    expect(mocks.openWidgetSettings).toHaveBeenLastCalledWith('ourcar');
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

  it('saves a chosen tab into the profile, and keeps nothing in the browser', () => {
    mocks.dashboard = {
      widgets: savedDashboard().widgets.map((saved) =>
        saved.id === 'pitwall'
          ? { ...saved, config: { layout: 'compact' } }
          : saved
      ),
    };
    renderInWindow();
    expect(shownTab()).toBe('overview');

    chooseTab('Strategy');

    expect(mocks.onDashboardUpdated).toHaveBeenCalledTimes(1);
    expect(mocks.onDashboardUpdated.mock.calls[0][0].widgets[0].config).toEqual(
      { layout: 'compact', tab: 'strategy' }
    );
    expect(localStorage.getItem(PIT_WALL_DEVICE_TAB_KEY)).toBeNull();
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
    const ourCar = screen.getByRole('region', { name: 'Our Car' });

    expect(ourCar).toHaveTextContent('This profile has no Our Car widget.');
    expect(within(ourCar).queryByRole('button')).toBeNull();
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

  it('keeps a chosen tab on the device and leaves the profile alone', () => {
    renderInBrowser();
    choose('Compact');
    expect(shownTab()).toBe('overview');

    chooseTab('Crew');

    expect(shownTab()).toBe('crew');
    expect(screen.getByRole('button', { name: 'Crew' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(
      screen.getAllByRole('region').map((region) => region.ariaLabel)
    ).toEqual(['Crew and Stints', 'Car Laps']);
    expect(localStorage.getItem(PIT_WALL_DEVICE_TAB_KEY)).toBe('crew');
    // A tablet on another tab must not turn the page in the window.
    expect(mocks.onDashboardUpdated).not.toHaveBeenCalled();
  });

  it('opens on the tab chosen here last time', () => {
    localStorage.setItem(PIT_WALL_DEVICE_LAYOUT_KEY, 'compact');
    localStorage.setItem(PIT_WALL_DEVICE_TAB_KEY, 'log');

    renderInBrowser();

    expect(shownTab()).toBe('log');
  });

  it('shows the profile’s tab until one is chosen here', () => {
    mocks.dashboard = {
      widgets: savedDashboard().widgets.map((saved) =>
        saved.id === 'pitwall'
          ? { ...saved, config: { layout: 'compact', tab: 'map' } }
          : saved
      ),
    };

    renderInBrowser();

    expect(shownTab()).toBe('map');
    expect(localStorage.getItem(PIT_WALL_DEVICE_TAB_KEY)).toBeNull();
  });

  it('takes nothing but a known tab from what the browser kept', () => {
    localStorage.setItem(PIT_WALL_DEVICE_LAYOUT_KEY, 'compact');
    localStorage.setItem(PIT_WALL_DEVICE_TAB_KEY, 'everything');

    renderInBrowser();

    expect(shownTab()).toBe('overview');
  });

  it('keeps the tab through a change of layout and back', () => {
    renderInBrowser();
    choose('Compact');
    chooseTab('Charts');

    // Race is one page: it has the first tab and no bar.
    choose('Race');
    expect(shownTab()).toBe('overview');
    expect(screen.queryByRole('navigation', { name: 'Tabs' })).toBeNull();

    choose('Compact');
    expect(shownTab()).toBe('charts');
  });
});

/** A page's socket, taken down and put back by the spec. */
const stagedConnection = (connected = true) => {
  const listeners = new Set<(connected: boolean) => void>();
  const state = { connected };
  const connection: BrowserConnection = {
    isConnected: () => state.connected,
    onConnectionChanged: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    connection,
    listeners,
    set: (next: boolean) =>
      act(() => {
        state.connected = next;
        listeners.forEach((listener) => listener(next));
      }),
  };
};

const mark = () => document.querySelector('[data-item="reconnecting"]');

describe('the Pit Wall in a browser whose socket drops', () => {
  const renderWith = (socket: ReturnType<typeof stagedConnection>) => {
    mocks.inBrowser = true;
    return render(
      <PitWallConnection connection={socket.connection}>
        <PitWallDeviceLayout>
          <PitWall />
        </PitWallDeviceLayout>
      </PitWallConnection>
    );
  };

  it('says nothing while the socket is up', () => {
    renderWith(stagedConnection());

    expect(mark()).toBeNull();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('says it is reconnecting while the socket is down, and stops when it is back', () => {
    const socket = stagedConnection();
    renderWith(socket);

    socket.set(false);

    expect(mark()).toHaveTextContent('Reconnecting');
    // Said to a reader as well, from the region that was there before.
    expect(screen.getByRole('status')).toHaveTextContent(
      'Reconnecting to Tearoff'
    );
    // The page keeps what it had: the panels are still drawn.
    expect(screen.getByRole('main')).toBeVisible();

    socket.set(true);

    expect(mark()).toBeNull();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('says so from the first frame of a page that opens with no socket', () => {
    renderWith(stagedConnection(false));

    expect(mark()).toHaveTextContent('Reconnecting');
  });

  it('hangs the mark under the tab bar on a layout of tabs, clear of every tab', () => {
    localStorage.setItem(PIT_WALL_DEVICE_LAYOUT_KEY, 'compact');
    renderWith(stagedConnection(false));

    const strip = screen.getByRole('banner');
    const tabs = screen.getByRole('navigation', { name: 'Tabs' });
    const block = tabs.parentElement as HTMLElement;
    // One positioned block holds the strip and the bar, and the strip is
    // not positioned itself: the mark hangs from the foot of the block,
    // which is the foot of the bar.
    expect(block).toHaveClass('relative');
    expect(block).toContainElement(strip);
    expect(block.lastElementChild).toBe(tabs);
    expect(strip).not.toHaveClass('relative');
    expect(mark()).toHaveClass('absolute', 'top-full');
    expect(block).toContainElement(mark() as HTMLElement);
    // None of the page's panels is inside the block.
    expect(block).not.toContainElement(screen.getByRole('main'));
  });

  it('hangs it under the strip on a layout that is one page', () => {
    renderWith(stagedConnection(false));

    const strip = screen.getByRole('banner');
    const block = strip.parentElement as HTMLElement;
    expect(screen.queryByRole('navigation', { name: 'Tabs' })).toBeNull();
    expect(block).toHaveClass('relative');
    // The strip is all there is in the block: its foot is the strip's.
    expect(block.children).toHaveLength(1);
    expect(block).toContainElement(mark() as HTMLElement);
  });

  it('changes nothing else in the header', () => {
    const socket = stagedConnection();
    renderWith(socket);
    const header = screen.getByRole('banner');
    const before = header.innerHTML;

    socket.set(false);
    mark()?.remove();
    screen.getByRole('status').textContent = '';

    expect(header.innerHTML).toBe(before);
  });

  it('hangs the mark from the header, out of the flow of its items', () => {
    // Set into the strip beside the controls, the mark took room a tablet's
    // strip does not have: the controls went onto a second line and every
    // panel moved down, and back when the socket returned. That was seen
    // and measured in a browser, which lays a page out; here it can only
    // be said where the mark is, which is what keeps it from happening.
    renderWith(stagedConnection(false));
    const header = screen.getByRole('banner');
    const controls = screen.getByRole('navigation', {
      name: 'Layout',
    }).parentElement;

    expect(mark()?.parentElement).toBe(header);
    expect(mark()).toHaveClass('absolute', 'top-full');
    // On the page the mark hangs from the block the strip shares with the
    // tab bar, so that it is under the bar where there is one.
    expect(header.parentElement).toHaveClass('relative');
    expect(header).not.toHaveClass('relative');
    expect(controls?.contains(mark())).toBe(false);
  });

  it('stops listening to the socket when the page goes', () => {
    const socket = stagedConnection();
    const { unmount } = renderWith(socket);
    expect(socket.listeners.size).toBe(1);

    unmount();

    expect(socket.listeners.size).toBe(0);
  });
});

describe('the Pit Wall in the app’s window, which has no socket', () => {
  it('never says it is reconnecting', () => {
    renderInWindow();

    expect(mark()).toBeNull();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});
