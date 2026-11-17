import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getWidgetDefaultConfig,
  type DashboardLayout,
  type DashboardWidget,
} from '@irdashies/types';
import { StandingsSettings } from './StandingsSettings';

const mocks = vi.hoisted(() => ({
  dashboard: undefined as DashboardLayout | undefined,
  onDashboardUpdated: vi.fn(),
}));

vi.mock('@irdashies/context', async () => {
  const { DEFAULT_SIM_WIDGET_SUPPORT: support } =
    await import('@irdashies/types');
  return {
    useDashboard: () => ({
      currentDashboard: mocks.dashboard,
      onDashboardUpdated: mocks.onDashboardUpdated,
    }),
    useActiveSimulator: () => null,
    useSimWidgetSupport: () => support,
  };
});

const layout = { x: 0, y: 0, width: 100, height: 100 };
const config = (opacity: number) => ({
  ...getWidgetDefaultConfig('standings'),
  background: { opacity },
});

const overlay: DashboardWidget = {
  id: 'standings',
  enabled: true,
  layout,
  config: config(80) as unknown as Record<string, unknown>,
};
const gantryLayout: DashboardWidget = {
  id: 'standings-g1',
  type: 'standings',
  enabled: true,
  layout,
  placement: 'gantry',
  config: config(20) as unknown as Record<string, unknown>,
};

const tab = (name: string) => screen.queryByRole('button', { name });

describe('StandingsSettings', () => {
  beforeEach(() => {
    mocks.onDashboardUpdated.mockClear();
    localStorage.clear();
    mocks.dashboard = { widgets: [overlay, gantryLayout] };
  });

  it('indents the manufacturer count options under a bar, like the estimated laps one', () => {
    const defaults = getWidgetDefaultConfig('standings');
    const withManufacturers = (enabled: boolean): DashboardWidget => ({
      ...overlay,
      config: {
        ...config(80),
        classHeaderStyle: {
          ...defaults.classHeaderStyle,
          manufacturerStats: { enabled, cap: 5, showPlayerManufacturer: false },
        },
      } as unknown as Record<string, unknown>,
    });

    mocks.dashboard = { widgets: [withManufacturers(true)] };
    const { unmount } = render(<StandingsSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Styling' }));
    const options = screen.getByTestId('manufacturer-counts-options');
    for (const indent of ['ml-2', 'pl-4', 'border-l-2']) {
      expect(options.classList).toContain(indent);
    }
    expect(within(options).getByText('Max manufacturers to show')).toBeTruthy();
    expect(
      within(options).getByText('Always show your manufacturer')
    ).toBeTruthy();
    unmount();

    // Switched off: no sub-options.
    mocks.dashboard = { widgets: [withManufacturers(false)] };
    render(<StandingsSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Styling' }));
    expect(screen.queryByTestId('manufacturer-counts-options')).toBeNull();
    expect(screen.queryByText('Max manufacturers to show')).toBeNull();
  });

  it('is the overlay page by default', () => {
    render(<StandingsSettings />);

    expect(tab('Visibility')).not.toBeNull();
    expect(screen.queryByText('Gantry')).toBeNull();
    expect(screen.queryByText('Copy settings from overlay')).toBeNull();
  });

  it('shows the rendered default name format and saves a new explicit selection', () => {
    render(<StandingsSettings />);
    const defaultFormat = screen.getByRole('button', {
      name: 'Max Emilian Verstappen',
    });
    expect(defaultFormat).toHaveAttribute('aria-pressed', 'true');
    expect(mocks.onDashboardUpdated).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Max Verstappen' }));
    expect(
      screen.getByRole('button', { name: 'Max Verstappen' })
    ).toHaveAttribute('aria-pressed', 'true');
    const next = mocks.onDashboardUpdated.mock.calls.at(
      -1
    )?.[0] as DashboardLayout;
    expect(
      next.widgets.find((widget) => widget.id === 'standings')?.config
        ?.driverName
    ).toMatchObject({ nameFormat: 'name-surname' });
  });

  it('puts the columns back in the order a new profile has, each once', () => {
    // Saved long ago and reordered since: no Avg 5, Avg 10 or stint pace,
    // one column twice and one that was retired.
    mocks.dashboard = {
      widgets: [
        {
          ...overlay,
          config: {
            ...config(80),
            displayOrder: [
              'gap',
              'position',
              'gap',
              'lmuBadge',
              'driverName',
              'carNumber',
            ],
          } as unknown as Record<string, unknown>,
        },
      ],
    };
    render(<StandingsSettings />);

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Reset to Default Order' })[0]
    );

    const next = mocks.onDashboardUpdated.mock.calls.at(
      -1
    )?.[0] as DashboardLayout;
    const saved = next.widgets[0].config?.displayOrder as string[];
    // The default order as the widget ships it, less the one column no
    // simulator has any more. The page used to write the order its own
    // rows are listed in, which put three columns somewhere else.
    expect(saved).toEqual(
      getWidgetDefaultConfig('standings').displayOrder.filter(
        (id) => id !== 'lmuBadge'
      )
    );
    expect(new Set(saved).size).toBe(saved.length);
    for (const added of ['avgLast5', 'avgLast10', 'stintPace']) {
      expect(saved).toContain(added);
    }
  });

  it('edits the Gantry-only layout it is given and marks it', () => {
    render(<StandingsSettings widgetId="standings-g1" />);

    expect(screen.getByText('Gantry')).toBeTruthy();
    expect(tab('Visibility')).toBeNull();
    expect(screen.queryByText('Reset Position')).toBeNull();
  });

  it('copies the overlay settings into the layout', () => {
    render(<StandingsSettings widgetId="standings-g1" />);

    fireEvent.click(screen.getByText('Copy settings from overlay'));

    const next = mocks.onDashboardUpdated.mock.calls.at(-1)?.[0] as
      DashboardLayout | undefined;
    expect(
      next?.widgets.find((w) => w.id === 'standings-g1')?.config
    ).toMatchObject({ background: { opacity: 80 } });
  });

  it('has no enabled switch on a Gantry-only layout', () => {
    const headerSwitch = () =>
      screen
        .getByRole('heading', { level: 2 })
        .parentElement?.querySelector('[role="switch"]') ?? null;
    mocks.dashboard = {
      widgets: [overlay, { ...gantryLayout, placement: undefined }],
    };
    const { unmount } = render(<StandingsSettings widgetId="standings-g1" />);
    expect(headerSwitch()).not.toBeNull();
    unmount();

    mocks.dashboard = { widgets: [overlay, gantryLayout] };
    render(<StandingsSettings widgetId="standings-g1" />);
    expect(headerSwitch()).toBeNull();
  });
});
