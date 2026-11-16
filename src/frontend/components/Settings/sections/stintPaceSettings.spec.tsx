import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getWidgetDefaultConfig,
  type DashboardLayout,
  type DashboardWidget,
} from '@irdashies/types';
import { STINT_PACE_HINT } from '../stintPaceHint';
import { RelativeSettings } from './RelativeSettings';
import { StandingsSettings } from './StandingsSettings';

/**
 * The vs stint row and the "Pace against" choice, which the Standings and
 * the Relative settings pages both carry.
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

const VS_STINT = 'vs Stint (Pace Against an Earlier Stint)';

describe.each([
  ['standings', () => <StandingsSettings />],
  ['relative', () => <RelativeSettings />],
] as const)('the vs stint column on the %s settings page', (id, page) => {
  const defaults = () =>
    getWidgetDefaultConfig(id) as unknown as Record<string, unknown>;
  const widget = (config: Record<string, unknown> = {}): DashboardWidget => ({
    id,
    enabled: true,
    layout: { x: 0, y: 0, width: 100, height: 100 },
    config: { ...defaults(), ...config },
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

  it('lists the column switched off, with nothing under it', () => {
    render(page());

    expect(screen.getByRole('switch', { name: VS_STINT })).toHaveAttribute(
      'aria-checked',
      'false'
    );
    expect(screen.queryByText(STINT_PACE_HINT)).toBeNull();
  });

  it('switches it on and says what it waits for and what it starts', () => {
    render(page());

    fireEvent.click(screen.getByRole('switch', { name: VS_STINT }));

    // Nothing else of the widget was written over.
    expect(saved()).toEqual({ ...defaults(), stintPace: { enabled: true } });
    expect(screen.getByRole('switch', { name: VS_STINT })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    const hint = screen.getByText(STINT_PACE_HINT).textContent;
    expect(hint).toContain('three clean laps');
    expect(hint).toContain('Options, Stint Pace');
    expect(hint).toContain('records the race');
  });

  it('switches on a column a build before it did not save', () => {
    const before = defaults();
    delete before.stintPace;
    mocks.dashboard = {
      widgets: [{ ...widget(), config: before }],
    };
    render(page());

    fireEvent.click(screen.getByRole('switch', { name: VS_STINT }));

    expect(saved().stintPace).toEqual({ enabled: true });
  });

  it('chooses the stint on the Options tab and says what the column compares', () => {
    render(page());
    fireEvent.click(screen.getByRole('button', { name: 'Options' }));

    expect(screen.getByText('Stint Pace')).toBeTruthy();
    expect(screen.getByText('Pace against')).toBeTruthy();
    const description = screen.getByText(
      /What the vs stint column compares/
    ).textContent;
    expect(description).toContain('negative and green');
    expect(description).toContain('after a double stint');
    expect(description).toContain('three clean laps');
    expect(description).toContain('has the race recorded');
    expect(
      screen.getByRole('button', { name: 'Previous stint' })
    ).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Previous driver' }));

    expect(saved()).toEqual({ ...defaults(), paceAgainst: 'driver' });
    expect(
      screen.getByRole('button', { name: 'Previous driver' })
    ).toHaveAttribute('aria-pressed', 'true');
  });
});
