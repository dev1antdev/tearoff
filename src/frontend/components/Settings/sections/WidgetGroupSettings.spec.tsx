import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardLayout, WidgetGroupMember } from '@irdashies/types';
import { WidgetGroupSettings } from './WidgetGroupSettings';

const mocks = vi.hoisted(() => ({
  dashboard: undefined as unknown,
  onDashboardUpdated: vi.fn(),
}));

vi.mock('@irdashies/context', async () => {
  const { DEFAULT_SIM_WIDGET_SUPPORT } = await import('@irdashies/types');
  return {
    useDashboard: () => ({
      currentDashboard: mocks.dashboard,
      onDashboardUpdated: mocks.onDashboardUpdated,
    }),
    useActiveSimulator: () => null,
    useSimWidgetSupport: () => DEFAULT_SIM_WIDGET_SUPPORT,
  };
});

const layout = { x: 0, y: 0, width: 200, height: 80 };
const place = { x: 5, y: 6, width: 100, height: 50 };

const dashboard = (members: WidgetGroupMember[]): DashboardLayout => ({
  widgets: [
    {
      id: 'widgetgroup',
      enabled: true,
      layout: { ...layout, width: 600, height: 300 },
      config: { members },
    },
    { id: 'input', enabled: true, layout },
    { id: 'flag', enabled: true, layout },
    { id: 'gantry', enabled: true, layout },
  ],
});

const saved = () => {
  const layoutSaved = mocks.onDashboardUpdated.mock
    .lastCall?.[0] as DashboardLayout;
  return {
    group: layoutSaved.widgets[0],
    members: layoutSaved.widgets[0].config?.members as WidgetGroupMember[],
  };
};

const card = (name: string) => within(screen.getByRole('group', { name }));

describe('WidgetGroupSettings', () => {
  beforeEach(() => {
    mocks.onDashboardUpdated.mockClear();
    mocks.dashboard = dashboard([
      { widgetId: 'input', ...place },
      { widgetId: 'flag', ...place },
    ]);
  });

  it('offers only the widgets that can still join', () => {
    mocks.dashboard = dashboard([{ widgetId: 'input', ...place }]);
    render(<WidgetGroupSettings />);

    const options = within(
      screen.getByRole('combobox', { name: 'Add widget' })
    ).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Select a widget...',
      'Flag',
    ]);
  });

  it('adds the chosen widget', () => {
    mocks.dashboard = dashboard([]);
    render(<WidgetGroupSettings />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Add widget' }), {
      target: { value: 'flag' },
    });

    expect(saved().members.map(({ widgetId }) => widgetId)).toEqual(['flag']);
  });

  it('changes each value of one widget on its own', () => {
    render(<WidgetGroupSettings />);

    fireEvent.change(card('Flag').getByRole('spinbutton', { name: 'Width' }), {
      target: { value: '240' },
    });

    expect(saved().members).toEqual([
      { widgetId: 'input', ...place },
      { widgetId: 'flag', ...place, width: 240 },
    ]);
  });

  it('gives a widget a scale of its own', () => {
    render(<WidgetGroupSettings />);

    fireEvent.change(card('Flag').getByRole('spinbutton', { name: 'Scale' }), {
      target: { value: '150' },
    });

    expect(saved().members[1].scale).toBe(150);
  });

  it('changes the drawing order', () => {
    render(<WidgetGroupSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'Move Flag up' }));

    expect(saved().members.map(({ widgetId }) => widgetId)).toEqual([
      'flag',
      'input',
    ]);
  });

  it('removes a widget from the group', () => {
    render(<WidgetGroupSettings />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Flag from the group' })
    );

    expect(saved().members.map(({ widgetId }) => widgetId)).toEqual(['input']);
  });

  it('sets the shape of the group', () => {
    render(<WidgetGroupSettings />);

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Group width' }), {
      target: { value: '720' },
    });

    expect(saved().group.layout.width).toBe(720);
  });
});
