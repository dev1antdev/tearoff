import { describe, expect, it } from 'vitest';
import type {
  DashboardLayout,
  DashboardWidget,
  WidgetGroupMember,
} from '@irdashies/types';
import {
  addWidgetGroupMember,
  moveWidgetGroupMember,
  removeWidgetGroupMember,
  resizeWidgetGroup,
  updateWidgetGroupMember,
  widgetGroupCandidates,
} from './widgetGroupEdits';

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

describe('updateWidgetGroupMember', () => {
  const two = () =>
    dashboard([
      { widgetId: 'input', ...place },
      { widgetId: 'radar', ...place, x: 7 },
    ]);

  it('changes one member and no other', () => {
    const next = updateWidgetGroupMember(two(), 'input', {
      x: 12.4,
      width: 300,
      scale: 120,
    });
    expect(membersOf(next)).toEqual([
      { widgetId: 'input', ...place, x: 12, width: 300, scale: 120 },
      { widgetId: 'radar', ...place, x: 7 },
    ]);
  });

  it('keeps the member at least a pixel in size', () => {
    const [member] = membersOf(
      updateWidgetGroupMember(two(), 'input', { width: 0, height: -5 })
    );
    expect(member).toMatchObject({ width: 1, height: 1 });
  });
});

describe('moveWidgetGroupMember', () => {
  const two = () =>
    dashboard([
      { widgetId: 'input', ...place },
      { widgetId: 'radar', ...place },
    ]);

  it('swaps a member with its neighbour', () => {
    const next = moveWidgetGroupMember(two(), 'radar', -1);
    expect(membersOf(next).map(({ widgetId }) => widgetId)).toEqual([
      'radar',
      'input',
    ]);
  });

  it('stops at the ends of the list', () => {
    const layout = two();
    expect(moveWidgetGroupMember(layout, 'input', -1)).toBe(layout);
    expect(moveWidgetGroupMember(layout, 'radar', 1)).toBe(layout);
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
