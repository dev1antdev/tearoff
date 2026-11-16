import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getWidgetDefaultConfig,
  type DashboardLayout,
  type DashboardWidget,
} from '@irdashies/types';
import { RelativeSettings } from './RelativeSettings';
import { StandingsSettings } from './StandingsSettings';

/**
 * The Avg 5 and Avg 10 rows and the "Averages over" choice, which the
 * Standings and the Relative settings pages both carry.
 */
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

const AVG_5 = 'Avg 5 (Last 5 Laps)';
const AVG_10 = 'Avg 10 (Last 10 Laps)';

describe.each([
  ['standings', () => <StandingsSettings />],
  ['relative', () => <RelativeSettings />],
] as const)('lap averages on the %s settings page', (id, page) => {
  const widget = (config: Record<string, unknown> = {}): DashboardWidget => ({
    id,
    enabled: true,
    layout: { x: 0, y: 0, width: 100, height: 100 },
    config: {
      ...(getWidgetDefaultConfig(id) as unknown as Record<string, unknown>),
      ...config,
    },
  });
  /** The widget's config as the page last saved it. */
  const saved = () =>
    (
      mocks.onDashboardUpdated.mock.calls.at(-1)?.[0] as DashboardLayout
    ).widgets.find((entry) => entry.id === id)?.config as Record<
      string,
      unknown
    >;

  beforeEach(() => {
    mocks.onDashboardUpdated.mockClear();
    localStorage.clear();
    mocks.dashboard = { widgets: [widget()] };
  });

  it('lists the two columns switched off, with nothing under them', () => {
    render(page());

    for (const name of [AVG_5, AVG_10]) {
      expect(screen.getByRole('switch', { name })).toHaveAttribute(
        'aria-checked',
        'false'
      );
    }
    expect(screen.queryByText(/^Reads -- until/)).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Time Format' })).toBeNull();
  });

  it('switches one on, and only that one', () => {
    render(page());

    fireEvent.click(screen.getByRole('switch', { name: AVG_5 }));

    expect(saved().avgLast5).toEqual({ enabled: true, timeFormat: 'full' });
    expect(saved().avgLast10).toEqual({ enabled: false, timeFormat: 'full' });
    expect(saved().averagesOver).toBe('clean');
    expect(screen.getByRole('switch', { name: AVG_5 })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    // What it waits for, and where the choice of laps is.
    expect(
      screen.getByText(
        'Reads -- until a car has 5 clean laps. Which laps count is set under Options, Lap Averages.'
      )
    ).toBeTruthy();
  });

  it('gives a column that is on its own time format', () => {
    mocks.dashboard = {
      widgets: [widget({ avgLast10: { enabled: true, timeFormat: 'full' } })],
    };
    render(page());

    const format = screen.getByRole('combobox', { name: 'Time Format' });
    expect((format as HTMLSelectElement).value).toBe('full');
    fireEvent.change(format, { target: { value: 'seconds-full' } });

    expect(saved().avgLast10).toEqual({
      enabled: true,
      timeFormat: 'seconds-full',
    });
    expect(saved().avgLast5).toEqual({ enabled: false, timeFormat: 'full' });
  });

  it('chooses the laps on the Options tab and says what a clean lap is', () => {
    render(page());
    fireEvent.click(screen.getByRole('button', { name: 'Options' }));

    expect(screen.getByText('Lap Averages')).toBeTruthy();
    expect(screen.getByText('Averages over')).toBeTruthy();
    // The description names what is left out and what is not.
    const description = screen.getByText(/never on pit road/).textContent;
    expect(description).toContain('in-laps and out-laps are left out');
    expect(description).toContain('a lap under yellow counts');
    expect(description).toContain('voided for track limits');
    expect(screen.getByRole('button', { name: 'Clean laps' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    fireEvent.click(screen.getByRole('button', { name: 'All laps' }));

    expect(saved().averagesOver).toBe('all');
    expect(screen.getByRole('button', { name: 'All laps' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    // Nothing else of the widget was written over.
    expect(saved()).toEqual({
      ...(getWidgetDefaultConfig(id) as unknown as Record<string, unknown>),
      averagesOver: 'all',
    });
  });

  it('says a column waits for timed laps once every lap counts', () => {
    mocks.dashboard = {
      widgets: [
        widget({
          avgLast10: { enabled: true, timeFormat: 'full' },
          averagesOver: 'all',
        }),
      ],
    };
    render(page());

    expect(
      screen.getByText(
        'Reads -- until a car has 10 timed laps. Which laps count is set under Options, Lap Averages.'
      )
    ).toBeTruthy();
  });
});
