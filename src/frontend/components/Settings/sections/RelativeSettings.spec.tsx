import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getWidgetDefaultConfig,
  type DashboardLayout,
  type DashboardWidget,
} from '@irdashies/types';
import { RelativeSettings } from './RelativeSettings';

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

const defaults = getWidgetDefaultConfig('relative');

const relative = (
  enabled: boolean,
  values: Partial<typeof defaults> = {}
): DashboardWidget => ({
  id: 'relative',
  enabled,
  layout: { x: 0, y: 0, width: 100, height: 100 },
  config: { ...defaults, ...values } as unknown as Record<string, unknown>,
});

/** The rows of the column list, in the order shown. */
const firstRows = (count: number) =>
  screen
    .getAllByText(/^(Position|Car Number|Best Time|Driver Name)$/)
    .slice(0, count)
    .map((row) => row.textContent);

describe('RelativeSettings', () => {
  beforeEach(() => {
    mocks.onDashboardUpdated.mockClear();
    localStorage.clear();
    mocks.dashboard = { widgets: [relative(true)] };
  });

  it('follows a change made to the widget elsewhere while it is open', () => {
    const { rerender } = render(<RelativeSettings />);
    expect(firstRows(2)).toEqual(['Position', 'Car Number']);

    // Another profile, or another window: the best time comes first there.
    mocks.dashboard = {
      widgets: [
        relative(false, {
          displayOrder: ['fastestTime', ...defaults.displayOrder],
        }),
      ],
    };
    rerender(<RelativeSettings />);

    // Read once when the page opened, the list went on showing the order
    // it opened with.
    expect(firstRows(2)).toEqual(['Best Time', 'Position']);
  });

  it('builds its next edit on that change, not on what it opened with', () => {
    // What is saved was already made from the dashboard as it stands; this
    // holds it there now that what is shown follows too.
    const { rerender } = render(<RelativeSettings />);
    mocks.dashboard = {
      widgets: [
        relative(false, {
          displayOrder: ['fastestTime', ...defaults.displayOrder],
        }),
      ],
    };
    rerender(<RelativeSettings />);

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Reset to Default Order' })[0]
    );

    const next = mocks.onDashboardUpdated.mock.calls.at(
      -1
    )?.[0] as DashboardLayout;
    // Still switched off, as it is where the change was made.
    expect(next.widgets[0].enabled).toBe(false);
    expect(next.widgets[0].config?.displayOrder).toEqual(
      defaults.displayOrder.filter((id) => id !== 'lmuBadge')
    );
  });
});
