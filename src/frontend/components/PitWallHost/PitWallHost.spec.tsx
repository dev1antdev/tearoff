import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type {
  ActiveSimulator,
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
}));

vi.mock('@irdashies/context', () => ({
  useDashboard: () => ({
    bridge: { openWidgetSettings: mocks.openWidgetSettings },
    currentDashboard: mocks.dashboard,
    onDashboardUpdated: mocks.onDashboardUpdated,
  }),
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
    disabledWidgets: { iracing: ['weather'], lmu: ['map'] },
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
}));

vi.mock('../RendererDataProviders/RendererDataProviders', () => ({
  RendererDataProviders: (props: Record<string, unknown>) => {
    mocks.providerProps(props);
    return null;
  },
}));

vi.mock('../../WidgetIndex', () => ({
  getWidget: (type: string) => {
    if (type === 'pitstop') {
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

import { PitWallHost, panelFit } from './PitWallHost';

const layout = { x: 0, y: 0, width: 100, height: 100 };
const widget = (
  id: string,
  extra: Partial<DashboardWidget> = {}
): DashboardWidget => ({ id, enabled: false, layout, ...extra });

/** The Compact layout: standings, fuel, pitstop, finishorder and weather. */
const compactDashboard = (
  widgets: DashboardWidget[] = [
    widget('standings', {
      config: { showOnlyWhenOnTrack: true, pitStatus: { enabled: true } },
    }),
    widget('finishorder'),
    widget('fuel', { config: { safetyMargin: 1 }, scale: 150 }),
    widget('pitstop'),
    widget('weather'),
  ],
  layoutId = 'compact'
): DashboardLayout => ({
  widgets: [
    widget('pitwall', { enabled: true, config: { layout: layoutId } }),
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

    for (const type of ['standings', 'finishorder', 'fuel', 'weather']) {
      expect(screen.getByTestId(`widget-${type}`)).toBeInTheDocument();
    }
    expect(mocks.widgetProps.get('fuel')).toEqual({
      safetyMargin: 1,
      embedded: true,
    });
    // Named after the widget, as the settings menu names it.
    expect(
      within(panel('Fuel Calculator')).getByTestId('widget-fuel')
    ).toBeInTheDocument();
  });

  it('hosts a widget whether or not it is switched on for the overlay', () => {
    mocks.dashboard = compactDashboard([
      widget('fuel', { enabled: false }),
      widget('standings', { enabled: true }),
    ]);
    render(<PitWallHost />);
    expect(screen.getByTestId('widget-fuel')).toBeInTheDocument();
    expect(screen.getByTestId('widget-standings')).toBeInTheDocument();
  });

  it('hands the widgets a dashboard with the overlay’s hide rules lifted', () => {
    render(<PitWallHost />);
    const hosted = mocks.hostedDashboards[0];
    const standings = hosted?.widgets.find((w) => w.id === 'standings');
    expect(standings?.config).toMatchObject({
      showOnlyWhenOnTrack: false,
      pitStatus: { enabled: true },
    });
    // The page's own widget and the saved dashboard are left as they were.
    expect(hosted?.widgets.find((w) => w.id === 'pitwall')).toBe(
      mocks.dashboard?.widgets[0]
    );
    expect(mocks.dashboard?.widgets[1].config).toMatchObject({
      showOnlyWhenOnTrack: true,
    });
  });

  it('draws a widget at the page’s scale, not the one saved for the overlay', () => {
    render(<PitWallHost />);
    const scaled = screen
      .getByTestId('widget-fuel')
      .closest('[data-widget-scale]');
    expect(scaled).toHaveAttribute('data-widget-scale', '100');
  });

  it('scales a widget down to fit a panel narrower than it needs', () => {
    // The fuel panel asks for 300 px.
    mocks.panelWidth = 240;
    render(<PitWallHost />);
    expect(
      screen.getByTestId('widget-fuel').closest('[data-widget-scale]')
    ).toHaveAttribute('data-widget-scale', '80');
  });

  it('says so, and offers the settings page, for a widget the profile lacks', () => {
    mocks.dashboard = compactDashboard([widget('standings')]);
    render(<PitWallHost />);

    const fuel = panel('Fuel Calculator');
    expect(
      within(fuel).getByText('This profile has no Fuel Calculator widget.')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('widget-fuel')).not.toBeInTheDocument();

    fireEvent.click(
      within(fuel).getByRole('button', {
        name: 'Open Fuel Calculator settings',
      })
    );
    expect(mocks.openWidgetSettings).toHaveBeenCalledWith('fuel');
  });

  it('leaves out a panel the running sim cannot support', () => {
    mocks.simulator = 'iracing';
    render(<PitWallHost />);
    expect(screen.queryByRole('region', { name: 'Weather' })).toBeNull();
    expect(screen.queryByTestId('widget-weather')).not.toBeInTheDocument();
    expect(screen.getByTestId('widget-fuel')).toBeInTheDocument();
  });

  it('leaves the track map out of the Race layout under Le Mans Ultimate', () => {
    mocks.dashboard = compactDashboard([widget('map'), widget('fuel')], 'race');
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
    expect(screen.queryByTestId('widget-fuel')).not.toBeInTheDocument();
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
      within(panel('Pit Stop')).getByText(
        'This panel hit a problem. It will try again shortly.'
      )
    ).toBeInTheDocument();
    expect(screen.getByTestId('widget-fuel')).toBeInTheDocument();
  });

  it('opens a panel’s widget settings from its gear, and its own from the header', () => {
    render(<PitWallHost />);
    fireEvent.click(
      within(panel('Fuel Calculator')).getByRole('button', {
        name: 'Open Fuel Calculator settings',
      })
    );
    expect(mocks.openWidgetSettings).toHaveBeenLastCalledWith('fuel');

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
      'standings',
      'fuel',
      'pitstop',
      'finishorder',
      'weather',
    ]);
    expect(sessionAlreadyMounted).toBe(true);
    // Standings has its pit column on; nothing here reads sector timing.
    expect(mocks.pitLapUpdater).toHaveBeenCalledWith(true);
    expect(mocks.pushToPassUpdater).not.toHaveBeenCalled();
    expect(mocks.sectorTimingMounted).not.toHaveBeenCalled();
  });

  it('mounts sector timing for a layout with a panel that reads it', () => {
    mocks.dashboard = compactDashboard([widget('timing')], 'watching');
    render(<PitWallHost />);
    expect(mocks.sectorTimingMounted).toHaveBeenCalled();
  });
});
