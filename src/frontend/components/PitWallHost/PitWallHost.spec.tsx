import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type {
  ActiveSimulator,
  ChannelBridge,
  DashboardLayout,
  DashboardWidget,
} from '@irdashies/types';

const mocks = vi.hoisted(() => ({
  openWidgetSettings: vi.fn(),
  onDashboardUpdated: vi.fn(),
  running: true,
  notInSession: false,
  drivers: [] as unknown[],
  dashboard: undefined as DashboardLayout | undefined,
  simulator: null as ActiveSimulator | null,
  widgetProps: new Map<string, Record<string, unknown>>(),
  hostedDashboards: [] as (DashboardLayout | undefined)[],
  providerProps: vi.fn(),
  sectorTimingMounted: vi.fn(),
  pitLapUpdater: vi.fn(),
  pushToPassUpdater: vi.fn(),
  panelWidth: 600,
  /** The page is as narrow as a phone. */
  phone: false,
  /** Goes up when a spec has changed the dashboard under a drawn page. */
  version: 0,
  listeners: new Set<() => void>(),
}));

vi.mock('@irdashies/context', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useDashboard: () => {
      // The page is drawn again when a spec says the dashboard has changed,
      // as it is when the provider hands over a saved one.
      useSyncExternalStore(
        (listener) => {
          mocks.listeners.add(listener);
          return () => mocks.listeners.delete(listener);
        },
        () => mocks.version
      );
      return {
        bridge: { openWidgetSettings: mocks.openWidgetSettings },
        currentDashboard: mocks.dashboard,
        onDashboardUpdated: mocks.onDashboardUpdated,
      };
    },
    HostedDashboardProvider: ({
      dashboard,
      children,
    }: {
      dashboard: DashboardLayout | undefined;
      children: ReactNode;
    }) => {
      mocks.hostedDashboards.push(dashboard);
      return <>{children}</>;
    },
    useActiveSimulator: () => mocks.simulator,
    useSimWidgetSupport: () => ({
      message: 'nope',
      disabledWidgets: { iracing: ['weatherforecast'], lmu: ['map'] },
    }),
    useRunningState: () => ({ running: mocks.running }),
    useSessionDrivers: () => mocks.drivers,
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
    useTrackStateSelector: (selector: unknown) =>
      selector === 'notInSession' ? mocks.notInSession : undefined,
    useElementSize: () => ({ width: mocks.panelWidth, height: 300 }),
    usePitLapStoreUpdater: mocks.pitLapUpdater,
    usePushToPassStoreUpdater: mocks.pushToPassUpdater,
    SessionTimingStoreUpdater: () => null,
    SectorTimingUpdater: () => {
      mocks.sectorTimingMounted();
      return null;
    },
  };
});

/** Hands the drawn page another dashboard, as a save does. */
const saveDashboard = (dashboard: DashboardLayout) =>
  act(() => {
    mocks.dashboard = dashboard;
    mocks.version += 1;
    mocks.listeners.forEach((listener) => listener());
  });

vi.mock('../RendererDataProviders/RendererDataProviders', () => ({
  RendererDataProviders: (props: Record<string, unknown>) => {
    mocks.providerProps(props);
    return null;
  },
}));

vi.mock('../../WidgetIndex', () => ({
  getWidget: (type: string) => {
    if (type === 'racelog') {
      return () => {
        throw new Error('boom');
      };
    }
    return (props: Record<string, unknown>) => {
      mocks.widgetProps.set(type, props);
      return <div data-testid={`widget-${type}`} />;
    };
  },
}));

vi.mock('@irdashies/utils/logger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { getWidgetRuntimeDefinition } from '../../widgetRuntime';
import {
  KEPT_CHANNEL_RATE_HZ,
  PitWallHost,
  channelsOf,
  panelFit,
} from './PitWallHost';

const layout = { x: 0, y: 0, width: 100, height: 100 };
const widget = (
  id: string,
  extra: Partial<DashboardWidget> = {}
): DashboardWidget => ({ id, enabled: false, layout, ...extra });

/**
 * A profile with every widget the layouts host. The Compact layout opens on
 * Overview: the tower, Our Car, the forecast and the log.
 */
const compactDashboard = (
  widgets: DashboardWidget[] = [
    widget('timingtower', {
      config: { showOnlyWhenOnTrack: true, columns: { tyres: true } },
    }),
    widget('ourcar', { config: { showDamage: true }, scale: 150 }),
    widget('weatherforecast'),
    widget('racelog'),
    widget('classrivals'),
    widget('stinttimeline'),
    widget('crew'),
    widget('carlaps'),
    widget('map'),
    widget('racecharts'),
  ],
  layoutId = 'compact',
  tab?: string
): DashboardLayout => ({
  widgets: [
    widget('pitwall', {
      enabled: true,
      config: { layout: layoutId, ...(tab ? { tab } : {}) },
    }),
    ...widgets,
  ],
});

const panel = (name: string) => screen.getByRole('region', { name });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.running = true;
  mocks.notInSession = false;
  mocks.drivers = [{ CarIdx: 0, CarNumber: '77', UserName: 'Alex Mercer' }];
  mocks.dashboard = compactDashboard();
  mocks.simulator = null;
  mocks.widgetProps.clear();
  mocks.hostedDashboards.length = 0;
  mocks.panelWidth = 600;
  mocks.phone = false;
  // The page asks the browser whether it is as narrow as a phone.
  window.matchMedia = ((query: string) => ({
    matches: mocks.phone,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});

describe('panelFit', () => {
  it('draws at full size in a panel that is wide enough', () => {
    expect(panelFit(300, 300)).toBe(1);
    expect(panelFit(640, 300)).toBe(1);
  });

  it('scales down, in hundredths, for a panel that is narrower', () => {
    expect(panelFit(240, 300)).toBe(0.8);
    expect(panelFit(244, 330)).toBe(0.73);
    expect(panelFit(150, 300)).toBe(0.5);
  });

  it('does not scale before the panel has been measured', () => {
    expect(panelFit(0, 300)).toBe(1);
  });
});

describe('PitWallHost', () => {
  it('draws each panel’s widget with its saved config and never lets it persist', () => {
    render(<PitWallHost />);

    for (const type of ['timingtower', 'ourcar', 'weatherforecast']) {
      expect(screen.getByTestId(`widget-${type}`)).toBeInTheDocument();
    }
    expect(mocks.widgetProps.get('ourcar')).toEqual({
      showDamage: true,
      embedded: true,
    });
    // Named after the widget, as the settings menu names it.
    expect(
      within(panel('Our Car')).getByTestId('widget-ourcar')
    ).toBeInTheDocument();
  });

  it('hosts a widget whether or not it is switched on for the overlay', () => {
    mocks.dashboard = compactDashboard([
      widget('ourcar', { enabled: false }),
      widget('timingtower', { enabled: true }),
    ]);
    render(<PitWallHost />);
    expect(screen.getByTestId('widget-ourcar')).toBeInTheDocument();
    expect(screen.getByTestId('widget-timingtower')).toBeInTheDocument();
  });

  it('hands the widgets a dashboard with the overlay’s hide rules lifted', () => {
    render(<PitWallHost />);
    const hosted = mocks.hostedDashboards[0];
    const tower = hosted?.widgets.find((w) => w.id === 'timingtower');
    expect(tower?.config).toMatchObject({
      showOnlyWhenOnTrack: false,
      columns: { tyres: true },
    });
    // The page's own widget and the saved dashboard are left as they were.
    expect(hosted?.widgets.find((w) => w.id === 'pitwall')).toBe(
      mocks.dashboard?.widgets[0]
    );
    expect(mocks.dashboard?.widgets[1].config).toMatchObject({
      showOnlyWhenOnTrack: true,
    });
    // A widget of the profile that no panel of this tab hosts is as saved.
    expect(hosted?.widgets.find((w) => w.id === 'crew')).toBe(
      mocks.dashboard?.widgets.find((w) => w.id === 'crew')
    );
  });

  it('draws a widget at the page’s scale, not the one saved for the overlay', () => {
    render(<PitWallHost />);
    const scaled = screen
      .getByTestId('widget-ourcar')
      .closest('[data-widget-scale]');
    expect(scaled).toHaveAttribute('data-widget-scale', '100');
  });

  it('scales a widget down to fit a panel narrower than it needs', () => {
    // The Our Car panel asks for 320 px.
    mocks.panelWidth = 256;
    render(<PitWallHost />);
    expect(
      screen.getByTestId('widget-ourcar').closest('[data-widget-scale]')
    ).toHaveAttribute('data-widget-scale', '80');
  });

  it('says so, and offers the settings page, for a widget the profile lacks', () => {
    mocks.dashboard = compactDashboard([widget('timingtower')]);
    render(<PitWallHost />);

    const ourCar = panel('Our Car');
    expect(
      within(ourCar).getByText('This profile has no Our Car widget.')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('widget-ourcar')).not.toBeInTheDocument();

    fireEvent.click(
      within(ourCar).getByRole('button', { name: 'Open Our Car settings' })
    );
    expect(mocks.openWidgetSettings).toHaveBeenCalledWith('ourcar');
  });

  it('leaves out a panel the running sim cannot support', () => {
    mocks.simulator = 'iracing';
    render(<PitWallHost />);
    expect(
      screen.queryByRole('region', { name: 'Weather Forecast' })
    ).toBeNull();
    expect(
      screen.queryByTestId('widget-weatherforecast')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('widget-ourcar')).toBeInTheDocument();
  });

  it('leaves a panel out of the Race layout under a sim that lists its widget', () => {
    mocks.dashboard = compactDashboard(undefined, 'race');
    render(<PitWallHost />);
    expect(screen.getByTestId('widget-map')).toBeInTheDocument();

    mocks.simulator = 'lmu';
    render(<PitWallHost />);
    expect(screen.getAllByTestId('widget-map')).toHaveLength(1);
  });

  it('waits, with one sentence and no panels, while no simulator is running', () => {
    mocks.running = false;
    render(<PitWallHost />);
    expect(screen.getByText(/No simulator is running\./)).toBeInTheDocument();
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByTestId('widget-ourcar')).not.toBeInTheDocument();
  });

  it.each([
    ['the sim says it is in no session', () => (mocks.notInSession = true)],
    ['the session has no cars yet', () => (mocks.drivers = [])],
  ])('waits for a session while %s', (_name, stage) => {
    stage();
    render(<PitWallHost />);
    expect(screen.getByText(/Waiting for a session\./)).toBeInTheDocument();
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('keeps the other panels when one widget throws', () => {
    render(<PitWallHost />);
    expect(
      within(panel('Race Log')).getByText(
        'This panel hit a problem. It will try again shortly.'
      )
    ).toBeInTheDocument();
    expect(screen.getByTestId('widget-ourcar')).toBeInTheDocument();
  });

  it('opens a panel’s widget settings from its gear, and its own from the header', () => {
    render(<PitWallHost />);
    fireEvent.click(
      within(panel('Our Car')).getByRole('button', {
        name: 'Open Our Car settings',
      })
    );
    expect(mocks.openWidgetSettings).toHaveBeenLastCalledWith('ourcar');

    fireEvent.click(screen.getByRole('button', { name: 'Pit Wall settings' }));
    expect(mocks.openWidgetSettings).toHaveBeenLastCalledWith('pitwall');
  });

  it('saves the layout chosen in the header into its own config only', () => {
    render(<PitWallHost />);
    expect(screen.getByRole('button', { name: 'Compact' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Watching' }));
    expect(mocks.onDashboardUpdated).toHaveBeenCalledOnce();
    const saved = mocks.onDashboardUpdated.mock.calls[0][0] as DashboardLayout;
    expect(saved.widgets[0]).toMatchObject({
      id: 'pitwall',
      config: { layout: 'watching' },
    });
    expect(saved.widgets.slice(1)).toEqual(mocks.dashboard?.widgets.slice(1));

    // The layout already shown is not saved again.
    fireEvent.click(screen.getByRole('button', { name: 'Compact' }));
    expect(mocks.onDashboardUpdated).toHaveBeenCalledOnce();
  });

  it('mounts the data providers and updaters for the widgets it shows', () => {
    render(<PitWallHost />);
    const { widgets, sessionAlreadyMounted } = mocks.providerProps.mock
      .calls[0][0] as {
      widgets: DashboardWidget[];
      sessionAlreadyMounted: boolean;
    };
    expect(widgets.map((w) => w.id)).toEqual([
      'timingtower',
      'ourcar',
      'weatherforecast',
      'racelog',
    ]);
    expect(sessionAlreadyMounted).toBe(true);
    // None of these is one of the overlay's tables, and none reads the
    // sector timing store.
    expect(mocks.pitLapUpdater).not.toHaveBeenCalled();
    expect(mocks.pushToPassUpdater).not.toHaveBeenCalled();
    expect(mocks.sectorTimingMounted).not.toHaveBeenCalled();
  });

  it('mounts sector timing for a layout with a panel that reads it', () => {
    // The Track Map marks the sectors.
    mocks.dashboard = compactDashboard(undefined, 'race');
    render(<PitWallHost />);
    expect(mocks.sectorTimingMounted).toHaveBeenCalled();
  });

  describe('tabs', () => {
    const tabs = () => screen.getByRole('navigation', { name: 'Tabs' });
    const shown = () =>
      screen
        .getAllByRole('region')
        .map((region) => region.getAttribute('aria-label'));

    it('has no tab bar on a layout that is one page', () => {
      mocks.dashboard = compactDashboard(undefined, 'race');
      render(<PitWallHost />);
      expect(screen.queryByRole('navigation', { name: 'Tabs' })).toBeNull();
      expect(shown()).toHaveLength(8);
    });

    it('lists the seven tabs of Compact with Overview in front', () => {
      render(<PitWallHost />);
      expect(
        within(tabs())
          .getAllByRole('button')
          .map((button) => button.textContent)
      ).toEqual([
        'Overview',
        'Timing',
        'Strategy',
        'Crew',
        'Map',
        'Charts',
        'Log',
      ]);
      expect(
        within(tabs()).getByRole('button', { name: 'Overview' })
      ).toHaveAttribute('aria-pressed', 'true');
      expect(shown()).toEqual([
        'Timing Tower',
        'Our Car',
        'Weather Forecast',
        'Race Log',
      ]);
    });

    it('draws only the panels of the saved tab, and feeds only those', () => {
      mocks.dashboard = compactDashboard(undefined, 'compact', 'crew');
      render(<PitWallHost />);
      expect(shown()).toEqual(['Crew and Stints', 'Car Laps']);
      expect(screen.queryByTestId('widget-timingtower')).toBeNull();
      const { widgets } = mocks.providerProps.mock.calls[0][0] as {
        widgets: DashboardWidget[];
      };
      expect(widgets.map((w) => w.id)).toEqual(['crew', 'carlaps']);
    });

    it('saves a chosen tab into the page’s own config, beside the layout', () => {
      render(<PitWallHost />);
      fireEvent.click(within(tabs()).getByRole('button', { name: 'Charts' }));

      expect(mocks.onDashboardUpdated).toHaveBeenCalledOnce();
      const saved = mocks.onDashboardUpdated.mock
        .calls[0][0] as DashboardLayout;
      expect(saved.widgets[0].config).toEqual({
        layout: 'compact',
        tab: 'charts',
      });
      expect(saved.widgets.slice(1)).toEqual(mocks.dashboard?.widgets.slice(1));

      // The tab already in front is not saved again.
      fireEvent.click(within(tabs()).getByRole('button', { name: 'Overview' }));
      expect(mocks.onDashboardUpdated).toHaveBeenCalledOnce();
    });

    it('shows the first tab for a saved tab that is not one', () => {
      mocks.dashboard = compactDashboard(undefined, 'compact', 'pits');
      render(<PitWallHost />);
      expect(
        within(tabs()).getByRole('button', { name: 'Overview' })
      ).toHaveAttribute('aria-pressed', 'true');
    });
  });

  describe('on a phone', () => {
    beforeEach(() => {
      mocks.phone = true;
    });

    it('gives the tabs whatever layout is saved, and no choice of layout', () => {
      mocks.dashboard = compactDashboard(undefined, 'race');
      render(<PitWallHost />);
      expect(
        screen.getByRole('navigation', { name: 'Tabs' })
      ).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'Layout' })).toBeNull();
      expect(screen.getByRole('main')).toHaveAttribute(
        'data-layout',
        'compact'
      );
    });

    it('stacks the panels of a tab instead of laying them on a grid', () => {
      render(<PitWallHost />);
      const main = screen.getByRole('main');
      expect(main).toHaveAttribute('data-stacked', 'true');
      expect(main.style.gridTemplateAreas).toBe('');
      const regions = screen.getAllByRole('region');
      expect(regions).toHaveLength(4);
      for (const region of regions) {
        expect(region.style.gridArea).toBe('');
        // A height of its own that is never shrunk.
        expect(region.style.flex).toMatch(/^1 0 min\(\d+px, 86%\)$/);
      }
    });

    it('gives the one panel of a tab the whole page', () => {
      mocks.dashboard = compactDashboard(undefined, 'compact', 'map');
      render(<PitWallHost />);
      expect(screen.getAllByRole('region')).toHaveLength(1);
      expect(panel('Track Map').style.flex).toBe('1 0 100%');
    });

    it('draws a widget at its own size however narrow the page is', () => {
      // Narrower than Our Car asks for: on a grid it would be scaled down.
      mocks.panelWidth = 232;
      render(<PitWallHost />);
      expect(
        screen.getByTestId('widget-ourcar').closest('[data-widget-scale]')
      ).toHaveAttribute('data-widget-scale', '100');
    });
  });

  describe('the channels of the tabs that are not in front', () => {
    interface Reading {
      channel: string;
      rate: number | undefined;
      stopped: boolean;
    }
    const original = window.channelBridge;
    /** A bridge that only notes who reads what, and when they stop. */
    const stageBridge = (): Reading[] => {
      const readings: Reading[] = [];
      window.channelBridge = {
        subscribe: (channel: string, _callback: unknown, rate?: number) => {
          const reading = { channel, rate, stopped: false };
          readings.push(reading);
          return () => {
            reading.stopped = true;
          };
        },
      } as unknown as ChannelBridge;
      return readings;
    };
    const named = (types: readonly string[]): string[] =>
      [
        ...new Set(
          types.flatMap(
            (type) => getWidgetRuntimeDefinition(type).channels ?? []
          )
        ),
      ].sort();
    const ALL_TEN = [
      'timingtower',
      'ourcar',
      'weatherforecast',
      'racelog',
      'classrivals',
      'stinttimeline',
      'crew',
      'carlaps',
      'map',
      'racecharts',
    ];

    afterEach(() => {
      window.channelBridge = original;
    });

    it('lists every channel the runtime definitions of the widgets name, each once', () => {
      const channels = channelsOf([widget('ourcar'), widget('classrivals')]);
      expect(channels).toEqual(named(['ourcar', 'classrivals']));
      expect(new Set(channels).size).toBe(channels.length);
      // A copy of a widget is read as its type.
      expect(channelsOf([widget('ourcar-2', { type: 'ourcar' })])).toEqual(
        named(['ourcar'])
      );
    });

    it('stays a reader of what every tab of the layout reads, at a low rate', () => {
      const readings = stageBridge();
      render(<PitWallHost />);

      expect(readings.map((reading) => reading.channel)).toEqual(
        named(ALL_TEN)
      );
      // What only a tab that is not in front reads is among them: the
      // forecast with its place of some laps ago, the stops of every car,
      // the record of the race.
      for (const channel of [
        'race-forecast.snapshot',
        'car-pit.snapshot',
        'race-history.summary',
        'race-log.snapshot',
      ]) {
        expect(readings.map((reading) => reading.channel)).toContain(channel);
      }
      for (const reading of readings) {
        expect(reading.rate).toBe(KEPT_CHANNEL_RATE_HZ);
        expect(reading.stopped).toBe(false);
      }
    });

    it('goes on reading the same through a change of tab', () => {
      const readings = stageBridge();
      render(<PitWallHost />);
      const before = readings.length;

      saveDashboard(compactDashboard(undefined, 'compact', 'log'));

      // The page has turned to the Log, and reads what it read.
      expect(screen.getAllByRole('region')).toHaveLength(1);
      expect(readings).toHaveLength(before);
      expect(readings.some((reading) => reading.stopped)).toBe(false);
    });

    it('reads nothing of its own on a layout that is one page', () => {
      const readings = stageBridge();
      mocks.dashboard = compactDashboard(undefined, 'race');
      render(<PitWallHost />);
      expect(readings).toEqual([]);
    });

    it('leaves out what the running sim cannot show and what the profile lacks', () => {
      const readings = stageBridge();
      mocks.simulator = 'iracing';
      mocks.dashboard = compactDashboard([
        widget('weatherforecast'),
        widget('racelog'),
        widget('map'),
      ]);
      render(<PitWallHost />);
      // No forecast under iRacing here, and no other widget in the profile.
      expect(readings.map((reading) => reading.channel)).toEqual(
        named(['racelog', 'map'])
      );
      expect(readings.map((reading) => reading.channel)).not.toContain(
        'weather-forecast.snapshot'
      );
    });

    it('stops reading when the page goes', () => {
      const readings = stageBridge();
      const { unmount } = render(<PitWallHost />);
      expect(readings.length).toBeGreaterThan(0);

      unmount();

      expect(readings.every((reading) => reading.stopped)).toBe(true);
    });

    it('stops reading on a change to a layout that is one page', () => {
      const readings = stageBridge();
      render(<PitWallHost />);

      saveDashboard(compactDashboard(undefined, 'race'));

      expect(screen.queryByRole('navigation', { name: 'Tabs' })).toBeNull();
      expect(readings.every((reading) => reading.stopped)).toBe(true);
    });

    it('does without where the page has no channel bridge', () => {
      window.channelBridge = undefined as unknown as ChannelBridge;
      expect(() => render(<PitWallHost />)).not.toThrow();
    });
  });

  it('lays the panels on the grid on a page wider than a phone', () => {
    render(<PitWallHost />);
    const main = screen.getByRole('main');
    expect(main).not.toHaveAttribute('data-stacked');
    expect(main.style.gridTemplateAreas).toContain('timingtower');
    expect(panel('Our Car').style.gridArea).toBe('ourcar');
  });
});
