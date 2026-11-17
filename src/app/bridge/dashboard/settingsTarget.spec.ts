import { describe, expect, it } from 'vitest';
import type { DashboardLayout } from '@irdashies/types';
import { settingsTargetOf } from './settingsTarget';

const dashboard = {
  widgets: [
    { id: 'fuel', enabled: true },
    { id: 'fuel-2', type: 'fuel', enabled: true },
    { id: 'left-over', type: 'not-a-widget', enabled: true },
  ],
} as unknown as DashboardLayout;

describe('the settings page a window may ask for', () => {
  it.each(['fuel', 'standings', 'pitwall', 'gantry'])(
    'is the page of the widget type "%s"',
    (type) => {
      expect(settingsTargetOf(type, dashboard)).toBe(type);
      // A type is a page whether or not the dashboard has that widget.
      expect(settingsTargetOf(type, null)).toBe(type);
    }
  );

  it('is the page of a layout copy in the active dashboard', () => {
    expect(settingsTargetOf('fuel-2', dashboard)).toBe('fuel-2');
    expect(settingsTargetOf('fuel-2', { widgets: [] })).toBeNull();
    expect(settingsTargetOf('fuel-2', undefined)).toBeNull();
  });

  it.each([
    ['a route out of the settings pages', '../pitwall'],
    ['a query', 'fuel?x=1'],
    ['a second path segment', 'fuel/extra'],
    ['a page that is not a widget', 'advanced'],
    ['a name every object has', 'constructor'],
    ['another such name', '__proto__'],
    ['an unknown id', 'nosuchwidget'],
    ['a stored widget of no known type', 'left-over'],
    ['nothing', ''],
    ['a text too long for an id', 'fuel'.repeat(40)],
    ['a number', 7],
    ['an object', { toString: () => 'fuel' }],
    ['a list', ['fuel']],
    ['null', null],
    ['undefined', undefined],
  ])('refuses %s', (_what, target) => {
    expect(settingsTargetOf(target, dashboard)).toBeNull();
  });

  it('refuses rather than throws on a dashboard that is not one', () => {
    expect(
      settingsTargetOf('fuel-2', {
        widgets: null,
      } as unknown as DashboardLayout)
    ).toBeNull();
    expect(
      settingsTargetOf('fuel-2', {
        widgets: [null, 'text'],
      } as unknown as DashboardLayout)
    ).toBeNull();
  });
});
