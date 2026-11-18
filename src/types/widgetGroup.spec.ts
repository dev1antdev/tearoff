import { describe, expect, it } from 'vitest';
import type { DashboardLayout, DashboardWidget } from './dashboardLayout';
import type { SimWidgetSupportConfig } from './simWidgetSupport';
import {
  canJoinWidgetGroup,
  resolveWidgetGroupMembers,
  sanitizeWidgetGroupMembers,
  widgetGroupMemberIds,
  widgetsSwitchedOnByGroup,
  withWidgetGroupMembers,
} from './widgetGroup';

const layout = { x: 0, y: 0, width: 100, height: 100 };
const place = { x: 1, y: 2, width: 30, height: 40 };

const widget = (
  id: string,
  extra: Partial<DashboardWidget> = {}
): DashboardWidget => ({ id, enabled: true, layout, ...extra });

const dashboard = (
  members: unknown[],
  others: DashboardWidget[]
): DashboardLayout => ({
  widgets: [widget('widgetgroup', { config: { members } }), ...others],
});

describe('sanitizeWidgetGroupMembers', () => {
  it('keeps usable entries in their order', () => {
    const members = [
      { widgetId: 'input', ...place, scale: 120 },
      { widgetId: 'flag', ...place, restoreDisabled: true },
    ];
    expect(sanitizeWidgetGroupMembers(members)).toEqual(members);
  });

  it('reads anything that is not a list as no members', () => {
    expect(sanitizeWidgetGroupMembers(undefined)).toEqual([]);
    expect(sanitizeWidgetGroupMembers({ widgetId: 'input' })).toEqual([]);
  });

  it('drops broken entries and repeats of a widget', () => {
    expect(
      sanitizeWidgetGroupMembers([
        null,
        { ...place },
        { widgetId: 'input', ...place, width: 0 },
        { widgetId: 'input', ...place, x: 'left' },
        { widgetId: 'flag', ...place },
        { widgetId: 'flag', ...place, x: 9 },
      ])
    ).toEqual([{ widgetId: 'flag', ...place }]);
  });

  it('holds a saved scale to the range a widget can have', () => {
    const [member] = sanitizeWidgetGroupMembers([
      { widgetId: 'input', ...place, scale: 100000 },
    ]);
    expect(member.scale).toBeLessThan(100000);
  });
});

describe('canJoinWidgetGroup', () => {
  it('takes overlay widgets and second instances', () => {
    expect(canJoinWidgetGroup(widget('input'))).toBe(true);
    expect(canJoinWidgetGroup(widget('fuel-2', { type: 'fuel' }))).toBe(true);
  });

  it.each(['widgetgroup', 'gantry', 'pitwall'])(
    'refuses %s',
    (id) => expect(canJoinWidgetGroup(widget(id))).toBe(false)
  );

  it('refuses a widget docked in the Gantry', () => {
    expect(
      canJoinWidgetGroup(widget('fuel-3', { placement: 'gantry' }))
    ).toBe(false);
  });
});

describe('widgetGroupMemberIds', () => {
  it('names listed widgets that exist and may be in a group', () => {
    const { widgets } = dashboard(
      [
        { widgetId: 'input', ...place },
        { widgetId: 'gantry', ...place },
        { widgetId: 'deleted', ...place },
      ],
      [widget('input'), widget('gantry'), widget('flag')]
    );
    expect([...widgetGroupMemberIds(widgets)]).toEqual(['input']);
  });

  it('counts a member that is switched off, which stays out of the overlay', () => {
    const { widgets } = dashboard(
      [{ widgetId: 'input', ...place }],
      [widget('input', { enabled: false })]
    );
    expect(widgetGroupMemberIds(widgets).has('input')).toBe(true);
  });

  it('is empty without a dashboard', () => {
    expect(widgetGroupMemberIds(undefined).size).toBe(0);
  });
});

describe('widgetsSwitchedOnByGroup', () => {
  it('names the members that were off when added', () => {
    const { widgets } = dashboard(
      [
        { widgetId: 'input', ...place, restoreDisabled: true },
        { widgetId: 'flag', ...place },
      ],
      [widget('input'), widget('flag')]
    );
    expect([...widgetsSwitchedOnByGroup(widgets)]).toEqual(['input']);
  });
});

describe('resolveWidgetGroupMembers', () => {
  const support: SimWidgetSupportConfig = {
    message: 'no',
    disabledWidgets: { iracing: [], lmu: ['radar'] },
  };
  const layoutWithMembers = dashboard(
    [
      { widgetId: 'radar', ...place },
      { widgetId: 'input', ...place },
      { widgetId: 'flag', ...place },
    ],
    [widget('input'), widget('radar'), widget('flag', { enabled: false })]
  );
  const ids = (sim?: Parameters<typeof resolveWidgetGroupMembers>[1]) =>
    resolveWidgetGroupMembers(layoutWithMembers, sim).map(
      ({ widget: found }) => found.id
    );

  it('gives the enabled members in the saved order', () => {
    expect(ids()).toEqual(['radar', 'input']);
  });

  it('leaves out what the running sim cannot show', () => {
    expect(ids({ support, simulator: 'lmu' })).toEqual(['input']);
  });

  it('adds members only when the group is among the widgets', () => {
    const input = widget('input');
    expect(withWidgetGroupMembers([input], layoutWithMembers)).toEqual([input]);
    expect(
      withWidgetGroupMembers(
        [layoutWithMembers.widgets[0]],
        layoutWithMembers
      ).map(({ id }) => id)
    ).toEqual(['widgetgroup', 'radar', 'input']);
  });
});
