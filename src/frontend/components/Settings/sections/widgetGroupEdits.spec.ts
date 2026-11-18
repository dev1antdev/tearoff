import { describe, expect, it } from 'vitest';
import type {
  DashboardLayout,
  DashboardWidget,
  WidgetGroupMember,
  WidgetLayout,
} from '@irdashies/types';
import {
  addWidgetGroup,
  addWidgetGroupMember as addMemberTo,
  changeWidgetGroupMember,
  deleteWidgetGroup,
  removeWidgetGroupMember as removeMemberFrom,
  resizeWidgetGroup as resizeGroup,
  setWidgetGroupMembers as setMembersOf,
  stackWidgetGroupMembers,
  widgetGroupCandidates as candidatesFor,
  widgetGroupFrameFor,
  widgetGroupName,
} from './widgetGroupEdits';

const GROUP = 'widgetgroup';
const addWidgetGroupMember = (layout: DashboardLayout, id: string) =>
  addMemberTo(layout, GROUP, id);
const removeWidgetGroupMember = (layout: DashboardLayout, id: string) =>
  removeMemberFrom(layout, GROUP, id);
const widgetGroupCandidates = (layout: DashboardLayout) =>
  candidatesFor(layout, GROUP);
const resizeWidgetGroup = (
  layout: DashboardLayout,
  size: { width?: number; height?: number }
) => resizeGroup(layout, GROUP, size);
const setWidgetGroupMembers = (
  layout: DashboardLayout,
  members: WidgetGroupMember[],
  frame: WidgetLayout
) => setMembersOf(layout, GROUP, members, frame);

const place = { x: 0, y: 0, width: 100, height: 50 };
const widget = (
  id: string,
  extra: Partial<DashboardWidget> = {}
): DashboardWidget => ({
  id,
  enabled: true,
  layout: { x: 500, y: 600, width: 200, height: 80 },
  ...extra,
});

const dashboard = (
  members: WidgetGroupMember[] = [],
  group: Partial<DashboardWidget> = {}
): DashboardLayout => ({
  widgets: [
    widget('widgetgroup', {
      enabled: false,
      layout: { x: 10, y: 20, width: 150, height: 60 },
      config: { showOnlyWhenOnTrack: true, members },
      ...group,
    }),
    widget('input'),
    widget('flag', { enabled: false }),
    widget('radar'),
    widget('gantry'),
  ],
});

const groupOf = (layout: DashboardLayout) => layout.widgets[0];
const membersOf = (layout: DashboardLayout) =>
  groupOf(layout).config?.members as WidgetGroupMember[];
const find = (layout: DashboardLayout, id: string) =>
  layout.widgets.find((candidate) => candidate.id === id);

describe('widgetGroupCandidates', () => {
  it('offers overlay widgets that are not in the group yet', () => {
    const candidates = widgetGroupCandidates(
      dashboard([{ widgetId: 'input', ...place }])
    );
    expect(candidates.map(({ id }) => id)).toEqual(['flag', 'radar']);
  });
});

describe('addWidgetGroupMember', () => {
  it('puts the widget below the others at its own size', () => {
    const next = addWidgetGroupMember(
      dashboard([{ widgetId: 'radar', ...place, y: 10 }]),
      'input'
    );
    expect(membersOf(next)[1]).toEqual({
      widgetId: 'input',
      x: 0,
      y: 60,
      width: 200,
      height: 80,
    });
  });

  it('turns the group on and grows its frame to show the widget', () => {
    const next = addWidgetGroupMember(dashboard([], { scale: 150 }), 'input');
    expect(groupOf(next).enabled).toBe(true);
    expect(groupOf(next).layout).toEqual({
      x: 10,
      y: 20,
      width: 300,
      height: 120,
    });
  });

  it('keeps the other settings of the group', () => {
    const next = addWidgetGroupMember(dashboard(), 'input');
    expect(groupOf(next).config?.showOnlyWhenOnTrack).toBe(true);
  });

  it('leaves the widget its own place on the overlay', () => {
    const before = dashboard();
    const next = addWidgetGroupMember(before, 'input');
    expect(find(next, 'input')?.layout).toEqual(find(before, 'input')?.layout);
  });

  it('switches on a widget that was off, and remembers it', () => {
    const next = addWidgetGroupMember(dashboard(), 'flag');
    expect(find(next, 'flag')?.enabled).toBe(true);
    expect(membersOf(next)[0].restoreDisabled).toBe(true);
  });

  it('ignores a widget that cannot join or already has', () => {
    const joined = dashboard([{ widgetId: 'input', ...place }]);
    expect(addWidgetGroupMember(joined, 'input')).toBe(joined);
    expect(addWidgetGroupMember(joined, 'gantry')).toBe(joined);
    expect(addWidgetGroupMember(joined, 'unknown')).toBe(joined);
  });
});

describe('a full group', () => {
  const full = () =>
    dashboard(
      Array.from({ length: 64 }, (_, index) => ({
        widgetId: `member-${index}`,
        ...place,
      }))
    );

  it('offers nothing more', () => {
    expect(widgetGroupCandidates(full())).toEqual([]);
  });

  it('changes nothing when asked to take one more', () => {
    const layout = full();
    expect(addWidgetGroupMember(layout, 'flag')).toBe(layout);
  });
});

describe('removeWidgetGroupMember', () => {
  it('takes the widget out and leaves it switched on', () => {
    const next = removeWidgetGroupMember(
      dashboard([{ widgetId: 'input', ...place }]),
      'input'
    );
    expect(membersOf(next)).toEqual([]);
    expect(find(next, 'input')?.enabled).toBe(true);
  });

  it('switches off again a widget that was off when added', () => {
    const added = addWidgetGroupMember(dashboard(), 'flag');
    expect(find(removeWidgetGroupMember(added, 'flag'), 'flag')?.enabled).toBe(
      false
    );
  });
});

describe('changeWidgetGroupMember', () => {
  const two = (): WidgetGroupMember[] => [
    { widgetId: 'input', ...place },
    { widgetId: 'radar', ...place, x: 7 },
  ];

  it('changes one member and no other', () => {
    expect(
      changeWidgetGroupMember(two(), 'input', {
        x: 12.4,
        width: 300,
        scale: 120,
      })
    ).toEqual([
      { widgetId: 'input', ...place, x: 12, width: 300, scale: 120 },
      { widgetId: 'radar', ...place, x: 7 },
    ]);
  });

  it('keeps the member at least a pixel in size', () => {
    const [member] = changeWidgetGroupMember(two(), 'input', {
      width: 0,
      height: -5,
    });
    expect(member).toMatchObject({ width: 1, height: 1 });
  });
});

describe('stackWidgetGroupMembers', () => {
  it('puts the members in a column at their own sizes, keeping their scale', () => {
    expect(
      stackWidgetGroupMembers(dashboard(), [
        { widgetId: 'input', ...place, x: 40, scale: 120 },
        { widgetId: 'radar', ...place },
      ])
    ).toEqual([
      { widgetId: 'input', x: 0, y: 0, width: 200, height: 80, scale: 120 },
      { widgetId: 'radar', x: 0, y: 80, width: 200, height: 80 },
    ]);
  });
});

describe('widgetGroupFrameFor', () => {
  const group = groupOf(dashboard([], { scale: 200 }));

  it('grows the frame to reach the members, at the scale of the group', () => {
    expect(
      widgetGroupFrameFor(group, [{ widgetId: 'input', ...place, y: 40 }])
    ).toMatchObject({ width: 200, height: 180 });
  });

  it('leaves a frame that is large enough', () => {
    expect(
      widgetGroupFrameFor(group, [
        { widgetId: 'input', ...place, width: 10, height: 10 },
      ])
    ).toMatchObject({ width: 150, height: 60 });
  });
});

describe('setWidgetGroupMembers', () => {
  it('saves the members and the frame as given', () => {
    const input = { widgetId: 'input', ...place };
    const radar = { widgetId: 'radar', ...place };
    const frame = { x: 1, y: 2, width: 300, height: 200 };
    const next = setWidgetGroupMembers(
      dashboard([input, radar]),
      [radar, input],
      frame
    );
    expect(membersOf(next)).toEqual([radar, input]);
    expect(groupOf(next).layout).toEqual(frame);
  });
});

describe('resizeWidgetGroup', () => {
  it('changes the frame, in whole pixels and at least one', () => {
    const next = resizeWidgetGroup(dashboard(), { width: 320.6, height: 0 });
    expect(groupOf(next).layout).toEqual({
      x: 10,
      y: 20,
      width: 321,
      height: 1,
    });
  });
});

describe('several groups', () => {
  const SECOND = 'widgetgroup-2';
  const input = { widgetId: 'input', ...place };
  const flag = { widgetId: 'flag', ...place, restoreDisabled: true };
  const two = (
    first: WidgetGroupMember[],
    second: WidgetGroupMember[]
  ): DashboardLayout => {
    const layout = dashboard(first);
    return {
      ...layout,
      widgets: [
        ...layout.widgets,
        widget(SECOND, { type: GROUP, config: { members: second } }),
      ],
    };
  };
  const membersIn = (layout: DashboardLayout, id: string) =>
    find(layout, id)?.config?.members as WidgetGroupMember[];

  it('adds to the group named and leaves the other as it was', () => {
    const next = addMemberTo(two([input], []), SECOND, 'radar');
    expect(membersIn(next, SECOND).map((m) => m.widgetId)).toEqual(['radar']);
    expect(membersIn(next, GROUP)).toEqual([input]);
  });

  it('offers only widgets that no group holds', () => {
    const candidates = candidatesFor(two([input], [flag]), SECOND);
    expect(candidates.map(({ id }) => id)).toEqual(['radar']);
  });

  it('will not put a widget in a second group', () => {
    const layout = two([input], []);
    expect(addMemberTo(layout, SECOND, 'input')).toBe(layout);
  });

  it('takes a removed widget out of a group that repeats it', () => {
    const next = removeMemberFrom(two([input], [input]), GROUP, 'input');
    expect(membersIn(next, GROUP)).toEqual([]);
    expect(membersIn(next, SECOND)).toEqual([]);
  });

  it('creates an empty group that is off', () => {
    const created = find(addWidgetGroup(dashboard(), SECOND), SECOND);
    expect(created).toMatchObject({
      type: GROUP,
      enabled: false,
      alwaysEnabled: true,
      config: { members: [] },
    });
  });

  it('deletes a group and switches off what it had switched on', () => {
    const layout = two([input], [flag]);
    const switchedOn = {
      ...layout,
      widgets: layout.widgets.map((item) =>
        item.id === 'flag' ? { ...item, enabled: true } : item
      ),
    };
    const next = deleteWidgetGroup(switchedOn, SECOND);
    expect(find(next, SECOND)).toBeUndefined();
    expect(find(next, 'flag')?.enabled).toBe(false);
    expect(find(next, 'input')?.enabled).toBe(true);
  });

  it('keeps the default group', () => {
    const layout = two([input], []);
    expect(deleteWidgetGroup(layout, GROUP)).toBe(layout);
  });

  it('names the groups by their order', () => {
    const { widgets } = two([], []);
    expect(widgetGroupName(widgets, GROUP)).toBe('Widget Group');
    expect(widgetGroupName(widgets, SECOND)).toBe('Widget Group 2');
  });
});
