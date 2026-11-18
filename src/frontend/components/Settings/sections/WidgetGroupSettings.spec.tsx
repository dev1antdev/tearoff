import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardLayout, WidgetGroupMember } from '@irdashies/types';
import { WidgetGroupSettings } from './WidgetGroupSettings';

const mocks = vi.hoisted(() => ({
  dashboard: undefined as unknown,
  profile: 'default',
  onDashboardUpdated: vi.fn(),
}));

vi.mock('@irdashies/context', async () => {
  const { DEFAULT_SIM_WIDGET_SUPPORT } = await import('@irdashies/types');
  return {
    useDashboard: () => ({
      currentDashboard: mocks.dashboard,
      currentProfile: { id: mocks.profile },
      onDashboardUpdated: mocks.onDashboardUpdated,
    }),
    useActiveSimulator: () => null,
    useSimWidgetSupport: () => DEFAULT_SIM_WIDGET_SUPPORT,
    // Half the group's width, so the layout is drawn at half size.
    useElementSize: () => ({ width: 300, height: 0 }),
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
const saveLayout = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));
const tile = (id: string) =>
  document.querySelector(`[data-member-tile="${id}"]`) as HTMLElement;
const dragBy = (from: Element, clientX: number, clientY: number) => {
  fireEvent.pointerDown(from, { clientX: 0, clientY: 0 });
  // Shift leaves the grid out of it, as on the overlay.
  fireEvent.pointerMove(window, { clientX, clientY, shiftKey: true });
  fireEvent.pointerUp(window);
};

describe('WidgetGroupSettings', () => {
  beforeEach(() => {
    mocks.onDashboardUpdated.mockClear();
    mocks.profile = 'default';
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
    expect(mocks.onDashboardUpdated).not.toHaveBeenCalled();
    saveLayout();

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
    saveLayout();

    expect(saved().members[1].scale).toBe(150);
  });

  it('changes the drawing order', () => {
    render(<WidgetGroupSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'Move Flag up' }));
    saveLayout();

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

  describe('the layout editor', () => {
    it('moves a widget by the pointer, at the scale it is drawn', () => {
      render(<WidgetGroupSettings />);

      dragBy(tile('flag'), 40, 20);

      // Drawn at half size, so 40 on screen is 80 in the group.
      expect(tile('flag')).toHaveStyle({ left: '85px', top: '46px' });
      expect(
        card('Flag').getByRole('spinbutton', { name: 'X' })
      ).toHaveValue(85);
    });

    it('sizes a widget by its edge', () => {
      render(<WidgetGroupSettings />);

      const edge = tile('input').querySelector('[data-resize-handle="e"]');
      dragBy(edge as Element, 30, 0);

      expect(tile('input')).toHaveStyle({ width: '160px' });
    });

    it('shows what the fields are set to before anything is saved', () => {
      render(<WidgetGroupSettings />);

      fireEvent.change(
        card('Flag').getByRole('spinbutton', { name: 'Height' }),
        { target: { value: '77' } }
      );

      expect(tile('flag')).toHaveStyle({ height: '77px' });
    });

    it('saves what was arranged', () => {
      render(<WidgetGroupSettings />);

      dragBy(tile('flag'), 40, 20);
      saveLayout();

      expect(saved().members[1]).toMatchObject({ x: 85, y: 46 });
    });

    it('drops what was arranged on Revert', () => {
      render(<WidgetGroupSettings />);

      dragBy(tile('flag'), 40, 20);
      fireEvent.click(screen.getByRole('button', { name: 'Revert' }));

      expect(tile('flag')).toHaveStyle({ left: '5px', top: '6px' });
      expect(mocks.onDashboardUpdated).not.toHaveBeenCalled();
    });

    it('stacks the widgets on Reset layout', () => {
      render(<WidgetGroupSettings />);

      fireEvent.click(screen.getByRole('button', { name: 'Reset layout' }));

      expect(tile('input')).toHaveStyle({ left: '0px', top: '0px' });
      expect(tile('flag')).toHaveStyle({ top: '80px', width: '200px' });
    });

    it('grows the frame for a stack that needs it, once saved', () => {
      (mocks.dashboard as DashboardLayout).widgets[0].layout.height = 100;
      render(<WidgetGroupSettings />);

      fireEvent.click(screen.getByRole('button', { name: 'Reset layout' }));
      expect(
        screen.getByRole('spinbutton', { name: 'Group height' })
      ).toHaveValue(160);
      expect(mocks.onDashboardUpdated).not.toHaveBeenCalled();
      saveLayout();

      expect(saved().group.layout.height).toBe(160);
    });

    it('says when there is something to save', () => {
      render(<WidgetGroupSettings />);
      expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();

      dragBy(tile('flag'), 40, 20);

      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    });

    it('does not carry what was arranged into another profile', () => {
      const { rerender } = render(<WidgetGroupSettings />);
      dragBy(tile('flag'), 40, 20);

      mocks.profile = 'race';
      rerender(<WidgetGroupSettings />);

      expect(tile('flag')).toHaveStyle({ left: '5px', top: '6px' });
    });

    it('is left out while the group is empty', () => {
      mocks.dashboard = dashboard([]);
      render(<WidgetGroupSettings />);

      expect(
        screen.queryByRole('button', { name: 'Save layout' })
      ).not.toBeInTheDocument();
    });

    it('keeps what was arranged when a widget is removed', () => {
      render(<WidgetGroupSettings />);

      dragBy(tile('input'), 40, 20);
      fireEvent.click(
        screen.getByRole('button', { name: 'Remove Flag from the group' })
      );

      expect(saved().members).toEqual([
        { widgetId: 'input', ...place, x: 85, y: 46 },
      ]);
    });
  });

  it('sets the shape of the group', () => {
    render(<WidgetGroupSettings />);

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Group width' }), {
      target: { value: '720' },
    });

    expect(saved().group.layout.width).toBe(720);
  });
});
