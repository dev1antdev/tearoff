import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type {
  ChannelBridge,
  DashboardLayout,
  DashboardWidget,
  PitWallCustomPanel,
} from '@irdashies/types';

// What the panels read while the Custom layout is being arranged.
//
// A channel is worked out in the main process only while somebody reads it,
// and what these panels show is counted over the race: the laps since a
// stop, the place forecast some laps ago, the record of the race itself.
// While the page is arranged its panels show a placeholder in place of
// their widget. Were the widgets unmounted for that, every channel only
// they read would lose its last reader, its processor would be let go, and
// the counts would begin again when the edit was over.
//
// So the widgets are kept mounted behind the placeholders, and a panel
// taken off the page is kept, unseen, until the edit is over. This spec
// holds the page to that with widgets that read the way the real ones do,
// for as long as they are mounted, on a bridge that counts the readers of
// each channel as the app's own bridge does.

const mocks = vi.hoisted(() => ({
  onDashboardUpdated: vi.fn(),
  dashboard: undefined as DashboardLayout | undefined,
  version: 0,
  listeners: new Set<() => void>(),
  providerWidgets: [] as string[][],
  mounted: [] as string[],
  unmounted: [] as string[],
}));

vi.mock('@irdashies/context', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useDashboard: () => {
      useSyncExternalStore(
        (listener) => {
          mocks.listeners.add(listener);
          return () => mocks.listeners.delete(listener);
        },
        () => mocks.version
      );
      return {
        bridge: { openWidgetSettings: vi.fn() },
        currentDashboard: mocks.dashboard,
        onDashboardUpdated: mocks.onDashboardUpdated,
      };
    },
    HostedDashboardProvider: ({ children }: { children: ReactNode }) => (
      <>{children}</>
    ),
    useActiveSimulator: () => 'lmu',
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
    useElementSize: () => ({ width: 600, height: 300 }),
    usePitLapStoreUpdater: vi.fn(),
    usePushToPassStoreUpdater: vi.fn(),
    SessionTimingStoreUpdater: () => null,
    SectorTimingUpdater: () => null,
  };
});

vi.mock('../RendererDataProviders/RendererDataProviders', () => ({
  RendererDataProviders: ({ widgets }: { widgets: DashboardWidget[] }) => {
    mocks.providerWidgets.push(widgets.map((entry) => entry.id));
    return null;
  },
}));

// A widget that reads what its runtime definition names from the moment it
// is mounted until it is unmounted, as the real ones do through their hooks.
vi.mock('../../WidgetIndex', async () => {
  const { useEffect } = await import('react');
  const { getWidgetRuntimeDefinition } = await import('../../widgetRuntime');
  const widgets = new Map<string, () => ReactNode>();
  return {
    getWidget: (type: string) => {
      let Widget = widgets.get(type);
      if (!Widget) {
        Widget = function HostedWidgetStandIn() {
          useEffect(() => {
            mocks.mounted.push(type);
            const stops = (getWidgetRuntimeDefinition(type).channels ?? []).map(
              (channel) =>
                window.channelBridge.subscribe(channel, () => undefined)
            );
            return () => {
              mocks.unmounted.push(type);
              stops.forEach((stop) => stop());
            };
          }, []);
          return <div data-testid={`widget-${type}`} />;
        };
        widgets.set(type, Widget);
      }
      return Widget;
    },
  };
});

vi.mock('@irdashies/utils/logger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { PIT_WALL_CUSTOM_START } from '@irdashies/types';
import { getWidgetRuntimeDefinition } from '../../widgetRuntime';
import { PitWallHost } from './PitWallHost';

const layout = { x: 0, y: 0, width: 100, height: 100 };
const widget = (id: string): DashboardWidget => ({
  id,
  enabled: false,
  layout,
});

const HOSTED = PIT_WALL_CUSTOM_START.map((panel) => panel.widget as string);

/** A profile on the Custom layout as it starts, with every widget of it. */
const dashboardWith = (config: Record<string, unknown>): DashboardLayout => ({
  widgets: [
    { ...widget('pitwall'), enabled: true, config },
    ...HOSTED.map(widget),
    widget('standings'),
  ],
});

const channelsOf = (type: string): readonly string[] =>
  getWidgetRuntimeDefinition(type).channels ?? [];

/**
 * A channel bridge that counts the readers of each channel, as the app's
 * own does for a window, and notes every channel that is left with none:
 * that is the moment the main process is told the window has stopped
 * reading, and lets the channel's processor go.
 */
const stageBridge = () => {
  const readers = new Map<string, number>();
  const dropped: string[] = [];
  window.channelBridge = {
    subscribe: (channel: string) => {
      readers.set(channel, (readers.get(channel) ?? 0) + 1);
      let reading = true;
      return () => {
        if (!reading) return;
        reading = false;
        const left = (readers.get(channel) ?? 0) - 1;
        readers.set(channel, left);
        if (left === 0) dropped.push(channel);
      };
    },
  } as unknown as ChannelBridge;
  return {
    dropped,
    read: () =>
      [...readers]
        .filter(([, count]) => count > 0)
        .map(([channel]) => channel)
        .sort(),
  };
};

const PITCH = { x: 62, y: 42 };
const press = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name }));

/** Down on a handle, so many cells away, and let go of there. */
const drag = (name: string, cellsAcross: number, cellsDown: number) => {
  const end = {
    pointerId: 1,
    clientX: 300 + cellsAcross * PITCH.x,
    clientY: 200 + cellsDown * PITCH.y,
  };
  fireEvent.pointerDown(screen.getByRole('button', { name }), {
    pointerId: 1,
    button: 0,
    isPrimary: true,
    clientX: 300,
    clientY: 200,
  });
  fireEvent.pointerMove(document.body, { ...end, buttons: 1 });
  fireEvent.pointerUp(document.body, end);
};

const cellsOf = (name: string) =>
  screen.getByRole('region', { name }).getAttribute('data-cells');

const original = window.channelBridge;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dashboard = dashboardWith({ layout: 'custom' });
  mocks.providerWidgets.length = 0;
  mocks.mounted.length = 0;
  mocks.unmounted.length = 0;
  mocks.onDashboardUpdated.mockImplementation((next: DashboardLayout) => {
    mocks.dashboard = next;
    mocks.version += 1;
    mocks.listeners.forEach((listener) => listener());
  });
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 24 * PITCH.x + 12,
    height: 16 * PITCH.y + 12,
  } as DOMRect);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.channelBridge = original;
});

describe('the channels of the Custom layout while it is arranged', () => {
  it('are read by its panels alone: one page keeps nothing of its own', () => {
    const bridge = stageBridge();
    render(<PitWallHost />);

    expect(mocks.mounted).toEqual(HOSTED);
    expect(bridge.read()).toEqual(
      [...new Set(HOSTED.flatMap(channelsOf))].sort()
    );
    // What is counted over a race is among them, or the cases below are
    // about nothing.
    for (const channel of [
      'race-forecast.snapshot',
      'car-pit.snapshot',
      'race-history.summary',
      'race-log.snapshot',
      'class-tyres.snapshot',
    ]) {
      expect(bridge.read()).toContain(channel);
    }
  });

  it('go on being read, every one, when the edit begins', () => {
    const bridge = stageBridge();
    render(<PitWallHost />);
    const before = bridge.read();

    press('Edit layout');

    // Placeholders are on show, and behind them nothing has stopped.
    expect(screen.getByRole('group', { name: 'Edit layout' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Our Car' })).toHaveTextContent(
      '5 × 6 cells'
    );
    expect(bridge.dropped).toEqual([]);
    expect(bridge.read()).toEqual(before);
    expect(mocks.unmounted).toEqual([]);
    expect(mocks.mounted).toEqual(HOSTED);
  });

  it('go on being read while panels are taken off, moved and sized', () => {
    const bridge = stageBridge();
    render(<PitWallHost />);
    const before = bridge.read();
    press('Edit layout');

    // The forecast and the charts off the page, and the others about it.
    press('Remove Weather Forecast');
    press('Remove Race Charts');
    drag('Size Timing Tower', 0, 5);
    drag('Move Race Log', 0, 2);
    drag('Size Crew and Stints', 0, 2);
    expect(cellsOf('Timing Tower')).toBe('0,0,14,16');
    expect(cellsOf('Race Log')).toBe('19,12,5,4');
    expect(cellsOf('Crew and Stints')).toBe('14,10,5,6');

    expect(bridge.dropped).toEqual([]);
    expect(bridge.read()).toEqual(before);
    expect(mocks.unmounted).toEqual([]);
  });

  it('are all still read when the edit is cancelled, by the widgets that read them before', () => {
    const bridge = stageBridge();
    render(<PitWallHost />);
    const before = bridge.read();
    press('Edit layout');
    press('Remove Weather Forecast');
    press('Remove Our Car');
    drag('Move Race Log', 0, 2);
    expect(cellsOf('Race Log')).toBe('19,12,5,4');

    press('Cancel');

    expect(bridge.dropped).toEqual([]);
    expect(bridge.read()).toEqual(before);
    // Not mounted again: the same widgets, with whatever they held.
    expect(mocks.unmounted).toEqual([]);
    expect(mocks.mounted).toEqual(HOSTED);
    expect(mocks.onDashboardUpdated).not.toHaveBeenCalled();
  });

  it('are let go of on Done, and only those nothing left on the page reads', () => {
    const bridge = stageBridge();
    render(<PitWallHost />);
    press('Edit layout');
    press('Remove Weather Forecast');
    drag('Move Race Log', 0, 2);
    expect(cellsOf('Race Log')).toBe('19,12,5,4');
    expect(bridge.dropped).toEqual([]);

    press('Done');

    const kept = HOSTED.filter((type) => type !== 'weatherforecast');
    const stillRead = new Set(kept.flatMap(channelsOf));
    expect(mocks.unmounted).toEqual(['weatherforecast']);
    expect([...bridge.dropped].sort()).toEqual(
      channelsOf('weatherforecast')
        .filter((channel) => !stillRead.has(channel))
        .sort()
    );
    expect(bridge.read()).toEqual([...stillRead].sort());
    // The panels that stayed were not mounted again by the save.
    expect(mocks.mounted).toEqual(HOSTED);
  });

  it('are joined on Done by what a panel put on the page reads, with nothing let go of', () => {
    const bridge = stageBridge();
    mocks.dashboard = dashboardWith({
      layout: 'custom',
      custom: PIT_WALL_CUSTOM_START.filter(
        (panel) => panel.widget !== 'racecharts'
      ) as PitWallCustomPanel[],
    });
    render(<PitWallHost />);
    press('Edit layout');
    press('Add panel');
    press('Add Standings');
    // Placed where the charts were, and not read for yet: the page hosts
    // what is saved.
    expect(cellsOf('Standings')).toBe('0,11,6,3');
    expect(mocks.mounted).not.toContain('standings');

    press('Done');

    expect(mocks.mounted.at(-1)).toBe('standings');
    expect(mocks.unmounted).toEqual([]);
    expect(bridge.dropped).toEqual([]);
    for (const channel of channelsOf('standings')) {
      expect(bridge.read()).toContain(channel);
    }
  });

  it('keeps the page’s data providers on the widgets of the saved page throughout', () => {
    stageBridge();
    render(<PitWallHost />);
    press('Edit layout');
    press('Remove Weather Forecast');
    drag('Move Race Log', 0, 2);
    press('Cancel');

    // The edit is the page's own affair: the host, which mounts the
    // providers and the updaters for the saved page's widgets, is not so
    // much as drawn again by it.
    expect(mocks.providerWidgets).toEqual([HOSTED]);
  });
});
