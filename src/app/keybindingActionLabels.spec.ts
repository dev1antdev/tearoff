import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardWidget } from '@irdashies/types';
import { WIDGET_GROUP_ID } from '@irdashies/types';
import { widgetToggleLabel } from './keybindingActionLabels';

const readData = vi.hoisted(() => vi.fn());

vi.mock('./storage/storage', () => ({
  readData,
  writeData: vi.fn(),
}));

const widget = (id: string, type: string): DashboardWidget =>
  ({
    id,
    type,
    enabled: true,
    layout: { x: 0, y: 0, width: 1, height: 1 },
  }) as DashboardWidget;

describe('widgetToggleLabel', () => {
  beforeEach(() => {
    readData.mockReset();
  });

  it('names a widget as the settings menu names it', () => {
    expect(
      widgetToggleLabel('toggle-widget:fuel', [widget('fuel', 'fuel')])
    ).toBe('Fuel Calculator');
  });

  it('numbers a group as the dashboard has it now', () => {
    const widgets = [
      widget('group-a', WIDGET_GROUP_ID),
      widget('group-b', WIDGET_GROUP_ID),
    ];

    expect(widgetToggleLabel('toggle-widget:group-b', widgets)).toBe(
      'Widget Group 2'
    );
  });

  it('has no name for a widget the dashboard does not hold', () => {
    // Another profile's widget, or a deleted one: the settings page shows the
    // name saved with the key then, and so must a conflict message.
    expect(
      widgetToggleLabel('toggle-widget:deleted', [widget('fuel', 'fuel')])
    ).toBeUndefined();
  });
});
