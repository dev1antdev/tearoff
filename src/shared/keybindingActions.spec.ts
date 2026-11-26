import { describe, it, expect } from 'vitest';
import { WIDGET_GROUP_ID, type DashboardWidget } from '@irdashies/types';
import {
  WIDGET_TOGGLE_PREFIX,
  isWidgetToggleActionId,
  isValidWidgetToggleActionId,
  widgetToggleActionId,
  widgetIdFromToggleActionId,
  nextProfileIndex,
  unplacedWidgetToggleIds,
  widgetToggleLabel,
} from './keybindingActions';

const widget = (id: string, type: string): DashboardWidget =>
  ({
    id,
    type,
    enabled: true,
    layout: { x: 0, y: 0, width: 1, height: 1 },
  }) as DashboardWidget;

describe('widgetToggleLabel', () => {
  it('names a widget as the settings menu names it', () => {
    expect(
      widgetToggleLabel(widgetToggleActionId('fuel'), [widget('fuel', 'fuel')])
    ).toBe('Fuel Calculator');
  });

  it('numbers a group as the dashboard has it now', () => {
    const widgets = [
      widget('group-a', WIDGET_GROUP_ID),
      widget('group-b', WIDGET_GROUP_ID),
    ];

    expect(widgetToggleLabel(widgetToggleActionId('group-b'), widgets)).toBe(
      'Widget Group 2'
    );
  });

  it('has no name for a widget the dashboard does not hold', () => {
    // Another profile's widget, or a deleted one: the settings page shows the
    // name saved with the key then, and so must a conflict message.
    expect(
      widgetToggleLabel(widgetToggleActionId('deleted'), [
        widget('fuel', 'fuel'),
      ])
    ).toBeUndefined();
  });
});

describe('widget toggle action id helpers', () => {
  it('builds a toggle action id from a widget id', () => {
    expect(widgetToggleActionId('standings')).toBe('toggle-widget:standings');
    expect(widgetToggleActionId('standings')).toBe(
      `${WIDGET_TOGGLE_PREFIX}standings`
    );
  });

  it('detects widget toggle action ids vs static actions', () => {
    expect(isWidgetToggleActionId('toggle-widget:fuel')).toBe(true);
    expect(isWidgetToggleActionId('toggle-hide-ui')).toBe(false);
    expect(isWidgetToggleActionId('save-telemetry')).toBe(false);
  });

  it('round-trips a widget id through build/extract', () => {
    const id = widgetToggleActionId('relative-2');
    expect(widgetIdFromToggleActionId(id)).toBe('relative-2');
  });

  it('extracts ids containing characters beyond the prefix', () => {
    expect(widgetIdFromToggleActionId('toggle-widget:my:weird:id')).toBe(
      'my:weird:id'
    );
  });

  it('treats a prefix with an empty widget id as invalid', () => {
    expect(isValidWidgetToggleActionId('toggle-widget:fuel')).toBe(true);
    expect(isValidWidgetToggleActionId('toggle-widget:')).toBe(false);
    expect(isValidWidgetToggleActionId('toggle-hide-ui')).toBe(false);
  });
});

describe('unplacedWidgetToggleIds', () => {
  it('names the bound toggles of widgets that are not here', () => {
    expect(
      unplacedWidgetToggleIds(
        {
          'toggle-hide-ui': { accelerator: 'Alt+H' },
          'toggle-widget:fuel': { accelerator: 'Alt+F' },
          'toggle-widget:widgetgroup-2': { accelerator: 'Alt+G' },
          'toggle-widget:deleted': { accelerator: '' },
        },
        ['fuel']
      )
    ).toEqual(['toggle-widget:widgetgroup-2']);
  });
});

describe('nextProfileIndex', () => {
  it('advances and goes back without wrapping when loop is off', () => {
    expect(nextProfileIndex(0, 3, 1, false)).toBe(1);
    expect(nextProfileIndex(1, 3, -1, false)).toBe(0);
  });

  it('returns -1 at the edges when loop is off', () => {
    expect(nextProfileIndex(2, 3, 1, false)).toBe(-1); // last -> next
    expect(nextProfileIndex(0, 3, -1, false)).toBe(-1); // first -> prev
  });

  it('wraps around at the edges when loop is on', () => {
    expect(nextProfileIndex(2, 3, 1, true)).toBe(0); // last -> first
    expect(nextProfileIndex(0, 3, -1, true)).toBe(2); // first -> last
  });

  it('treats an unknown current index as the start', () => {
    expect(nextProfileIndex(-1, 3, 1, false)).toBe(1);
  });
});
