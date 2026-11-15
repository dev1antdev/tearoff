import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getWidgetDefaultConfig,
  type CarSystemsConfig,
  type DashboardLayout,
} from '@irdashies/types';
import { CarSystemsSettings } from './CarSystemsSettings';

const mocks = vi.hoisted(() => ({
  dashboard: undefined as unknown,
  simulator: null as 'iracing' | 'lmu' | null,
  onDashboardUpdated: vi.fn(),
}));

vi.mock('@irdashies/context', async () => {
  // Imported inside the factory: vi.mock is hoisted above the file's own
  // imports, so a top-level binding would not exist yet.
  const { DEFAULT_SIM_WIDGET_SUPPORT } = await import('@irdashies/types');
  return {
    useDashboard: () => ({
      currentDashboard: mocks.dashboard,
      onDashboardUpdated: mocks.onDashboardUpdated,
    }),
    useActiveSimulator: () => mocks.simulator,
    useSimWidgetSupport: () => DEFAULT_SIM_WIDGET_SUPPORT,
  };
});

const dashboardWith = (config: Partial<CarSystemsConfig>) =>
  ({
    widgets: [
      {
        id: 'carsystems',
        enabled: true,
        layout: { x: 0, y: 0, width: 380, height: 70 },
        config: { ...getWidgetDefaultConfig('carsystems'), ...config },
      },
    ],
  }) as unknown as DashboardLayout;

/** The panel under a heading, to tell the two lists' toggles apart. */
const panel = (title: string) => {
  const section = screen
    .getByRole('heading', { name: title })
    .closest('section');
  if (!section) throw new Error(`no panel titled ${title}`);
  return within(section);
};

const rowTitles = (title: string) =>
  panel(title)
    .getAllByRole('switch')
    .map((toggle) => toggle.getAttribute('aria-label'));

/** The carsystems config the page last saved. */
const savedConfig = (): CarSystemsConfig => {
  const dashboard = mocks.onDashboardUpdated.mock.lastCall?.[0] as
    DashboardLayout | undefined;
  return dashboard?.widgets.find((widget) => widget.id === 'carsystems')
    ?.config as unknown as CarSystemsConfig;
};

describe('CarSystemsSettings', () => {
  beforeEach(() => {
    localStorage.removeItem('carSystemsTab');
    mocks.onDashboardUpdated.mockClear();
    mocks.dashboard = dashboardWith({});
    mocks.simulator = null;
  });

  it('puts the list of the running sim first', () => {
    const listTitles = () =>
      screen
        .getAllByRole('heading', { name: / Rows$/ })
        .map((heading) => heading.textContent);

    const { unmount } = render(<CarSystemsSettings />);
    expect(listTitles()).toEqual(['iRacing Rows', 'Le Mans Ultimate Rows']);
    unmount();

    mocks.simulator = 'lmu';
    render(<CarSystemsSettings />);
    expect(listTitles()).toEqual(['Le Mans Ultimate Rows', 'iRacing Rows']);
  });

  it('lists the rows of each simulator apart', () => {
    render(<CarSystemsSettings />);

    expect(rowTitles('Le Mans Ultimate Rows')).toEqual([
      'Brake Bias',
      'ABS',
      'Traction Control',
      'TC Slip',
      'TC Cut',
      'Brake Migration',
      'Map',
      'Regen Level (setup)',
      'ARB Front',
      'ARB Rear',
      'Wipers',
    ]);
    const iracing = rowTitles('iRacing Rows');
    expect(iracing).toHaveLength(21);
    expect(iracing).toContain('Traction Control 2');
    expect(iracing).not.toContain('TC Slip');
  });

  it('switches on the default rows of each list, and only those', () => {
    render(<CarSystemsSettings />);

    const on = (title: string) =>
      panel(title)
        .getAllByRole('switch')
        .filter((toggle) => toggle.getAttribute('aria-checked') === 'true')
        .map((toggle) => toggle.getAttribute('aria-label'));

    expect(on('Le Mans Ultimate Rows')).toEqual([
      'Brake Bias',
      'ABS',
      'Traction Control',
      'TC Slip',
      'TC Cut',
      'Brake Migration',
      'Map',
    ]);
    expect(on('iRacing Rows')).toEqual([
      'Brake Bias',
      'ABS',
      'Traction Control',
      'Traction Control 2',
      'Throttle Shape',
    ]);
  });

  it('adds an LMU row in catalogue order and leaves the iRacing rows alone', () => {
    const rows = ['dcBrakeBias', 'dcDiffEntry'];
    mocks.dashboard = dashboardWith({ rows });
    render(<CarSystemsSettings />);

    fireEvent.click(
      panel('Le Mans Ultimate Rows').getByRole('switch', { name: 'ARB Front' })
    );

    expect(savedConfig().lmuRows).toEqual([
      'dcBrakeBias',
      'dcABS',
      'dcTractionControl',
      'LmuTcSlip',
      'LmuTcCut',
      'LmuBrakeMigration',
      'LmuMotorMap',
      'dcAntiRollFront',
    ]);
    expect(savedConfig().rows).toEqual(rows);
  });

  it('removes an iRacing row and leaves the LMU rows alone', () => {
    render(<CarSystemsSettings />);

    fireEvent.click(panel('iRacing Rows').getByRole('switch', { name: 'ABS' }));

    expect(savedConfig().rows).toEqual([
      'dcBrakeBias',
      'dcTractionControl',
      'dcTractionControl2',
      'dcThrottleShape',
    ]);
    expect(savedConfig().lmuRows).toEqual(
      getWidgetDefaultConfig('carsystems').lmuRows
    );
  });

  it('works on a config that has no LMU list at all', () => {
    // A config saved before LMU had a list is given the default one when the
    // dashboard loads. Should one reach the page without it, the list reads
    // as empty rather than taking the page down.
    mocks.dashboard = dashboardWith({
      lmuRows: undefined as unknown as string[],
    });

    render(<CarSystemsSettings />);
    fireEvent.click(
      panel('Le Mans Ultimate Rows').getByRole('switch', { name: 'Wipers' })
    );

    expect(savedConfig().lmuRows).toEqual(['LmuWiper']);
  });

  it('says a row is renamed on some cars only in the iRacing list', () => {
    render(<CarSystemsSettings />);

    const note = /Named differently on some cars/;
    expect(panel('iRacing Rows').getAllByText(note).length).toBeGreaterThan(0);
    expect(panel('Le Mans Ultimate Rows').queryByText(note)).toBeNull();
  });

  it('offers the hold time only in the show-on-change mode', () => {
    const { unmount } = render(<CarSystemsSettings />);
    expect(screen.queryByText('Stay On Screen For')).not.toBeInTheDocument();
    unmount();

    mocks.dashboard = dashboardWith({ displayMode: 'onChange' });
    render(<CarSystemsSettings />);

    expect(screen.getByText('Stay On Screen For')).toBeInTheDocument();
  });
});
