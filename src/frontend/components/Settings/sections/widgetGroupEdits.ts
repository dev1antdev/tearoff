import {
  WIDGET_GROUP_ID,
  WIDGET_GROUP_MAX_MEMBERS,
  canJoinWidgetGroup,
  defaultDashboard,
  findWidgetGroup,
  isWidgetGroup,
  normalizeWidgetScale,
  sanitizeWidgetGroupMembers,
  widgetGroupMemberIds,
  widgetGroupMembers,
  widgetGroups,
  type DashboardLayout,
  type DashboardWidget,
  type WidgetGroupMember,
  type WidgetLayout,
} from '@irdashies/types';
import { widgetLabel } from '../menuItems';

/** What the settings page changes about one member. */
export interface WidgetGroupFrameSize {
  width?: number;
  height?: number;
}

export type WidgetGroupMemberChange = Partial<
  Pick<WidgetGroupMember, 'x' | 'y' | 'width' | 'height' | 'scale'>
>;

const membersOf = (dashboard: DashboardLayout, group: DashboardWidget) =>
  widgetGroupMembers(dashboard.widgets, group.id);

/** What a group is called: groups have no names, so they go by their order. */
export const widgetGroupName = (
  widgets: readonly DashboardWidget[],
  groupId: string
) => {
  const index = widgetGroups(widgets).findIndex(({ id }) => id === groupId);
  const name = widgetLabel(WIDGET_GROUP_ID);
  return index > 0 ? `${name} ${index + 1}` : name;
};

/** A new empty group, off until a widget is put in it. */
export const addWidgetGroup = (
  dashboard: DashboardLayout,
  id: string
): DashboardLayout => {
  const defaults = defaultDashboard.widgets.find(
    (widget) => widget.id === WIDGET_GROUP_ID
  );
  if (!defaults) return dashboard;
  return {
    ...dashboard,
    widgets: [
      ...dashboard.widgets,
      { ...defaults, id, type: WIDGET_GROUP_ID },
    ],
  };
};

/** Screen pixels per pixel of the group, which is what members are placed in. */
export const widgetGroupScale = (group: DashboardWidget) =>
  normalizeWidgetScale(group.scale) / 100;

/** The group's frame, grown where it is too small to show these members. */
export const widgetGroupFrameFor = (
  group: DashboardWidget,
  members: WidgetGroupMember[]
): WidgetLayout => {
  const scale = widgetGroupScale(group);
  const reach = (edge: (member: WidgetGroupMember) => number) =>
    Math.ceil(Math.max(0, ...members.map(edge)) * scale);
  return {
    ...group.layout,
    width: Math.max(group.layout.width, reach((m) => m.x + m.width)),
    height: Math.max(group.layout.height, reach((m) => m.y + m.height)),
  };
};

/** A width or height: whole pixels, and at least one of them. */
const toSize = (value: number) => Math.max(1, Math.round(value));

const withGroup = (
  dashboard: DashboardLayout,
  group: DashboardWidget,
  members: WidgetGroupMember[],
  changes: Partial<DashboardWidget> = {}
): DashboardLayout => ({
  ...dashboard,
  widgets: dashboard.widgets.map((widget) =>
    widget.id === group.id
      ? { ...widget, ...changes, config: { ...widget.config, members } }
      : widget
  ),
});

const setEnabled = (
  dashboard: DashboardLayout,
  widgetId: string,
  enabled: boolean
): DashboardLayout => ({
  ...dashboard,
  widgets: dashboard.widgets.map((widget) =>
    widget.id === widgetId ? { ...widget, enabled } : widget
  ),
});

/** The widgets that can still be added, in the dashboard's order. */
export const widgetGroupCandidates = (
  dashboard: DashboardLayout,
  groupId: string
): DashboardWidget[] => {
  const group = findWidgetGroup(dashboard.widgets, groupId);
  if (
    !group ||
    membersOf(dashboard, group).length >= WIDGET_GROUP_MAX_MEMBERS
  ) {
    return [];
  }
  const members = widgetGroupMemberIds(dashboard.widgets);
  return dashboard.widgets.filter(
    (widget) => canJoinWidgetGroup(widget) && !members.has(widget.id)
  );
};

/**
 * Puts a widget below the others at its own size and turns the group on, so
 * that the widget does not leave the screen. The frame grows to show it. A
 * widget that was off is switched on for as long as it is in the group.
 */
export const addWidgetGroupMember = (
  dashboard: DashboardLayout,
  groupId: string,
  widgetId: string
): DashboardLayout => {
  const group = findWidgetGroup(dashboard.widgets, groupId);
  const widget = dashboard.widgets.find(({ id }) => id === widgetId);
  if (!group || !widget || !canJoinWidgetGroup(widget)) return dashboard;
  const members = membersOf(dashboard, group);
  if (
    members.length >= WIDGET_GROUP_MAX_MEMBERS ||
    // A widget is in one group at most.
    widgetGroupMemberIds(dashboard.widgets).has(widgetId)
  ) {
    return dashboard;
  }

  const y = Math.max(0, ...members.map((m) => m.y + m.height));
  const member: WidgetGroupMember = {
    widgetId,
    x: 0,
    y,
    width: toSize(widget.layout.width),
    height: toSize(widget.layout.height),
    ...(!widget.enabled && { restoreDisabled: true }),
  };
  const next = [...members, member];
  return setEnabled(
    withGroup(dashboard, group, next, {
      enabled: true,
      layout: widgetGroupFrameFor(group, next),
    }),
    widgetId,
    true
  );
};

/** Takes a widget out, which puts it back on the overlay as it was. */
export const removeWidgetGroupMember = (
  dashboard: DashboardLayout,
  groupId: string,
  widgetId: string
): DashboardLayout => {
  const group = findWidgetGroup(dashboard.widgets, groupId);
  if (!group) return dashboard;
  const members = membersOf(dashboard, group);
  const member = members.find((m) => m.widgetId === widgetId);
  if (!member) return dashboard;
  // Out of every group: a repeat saved in another would otherwise take it over
  // instead of it going back to the overlay.
  const without: DashboardLayout = {
    ...dashboard,
    widgets: dashboard.widgets.map((widget) =>
      isWidgetGroup(widget)
        ? {
            ...widget,
            config: {
              ...widget.config,
              members: sanitizeWidgetGroupMembers(
                widget.config?.members
              ).filter((m) => m.widgetId !== widgetId),
            },
          }
        : widget
    ),
  };
  return member.restoreDisabled
    ? setEnabled(without, widgetId, false)
    : without;
};

/**
 * Deletes a group, which puts its widgets back on the overlay as they were.
 * The default group stays: it would come back with the next load.
 */
export const deleteWidgetGroup = (
  dashboard: DashboardLayout,
  groupId: string
): DashboardLayout => {
  const group = findWidgetGroup(dashboard.widgets, groupId);
  if (!group || groupId === WIDGET_GROUP_ID) return dashboard;
  const emptied = membersOf(dashboard, group).reduce(
    (next, { widgetId }) => removeWidgetGroupMember(next, groupId, widgetId),
    dashboard
  );
  return {
    ...emptied,
    widgets: emptied.widgets.filter((widget) => widget.id !== groupId),
  };
};

/** The list with one member changed, and no other. */
export const changeWidgetGroupMember = (
  members: WidgetGroupMember[],
  widgetId: string,
  change: WidgetGroupMemberChange
): WidgetGroupMember[] =>
  members.map((member) => {
    if (member.widgetId !== widgetId) return member;
    const next = { ...member, ...change };
    return {
      ...next,
      x: Math.round(next.x),
      y: Math.round(next.y),
      width: toSize(next.width),
      height: toSize(next.height),
      ...(next.scale !== undefined && {
        scale: normalizeWidgetScale(next.scale),
      }),
    };
  });

/** The members one under the other, each at its widget's own size. */
export const stackWidgetGroupMembers = (
  dashboard: DashboardLayout,
  members: WidgetGroupMember[]
): WidgetGroupMember[] => {
  let y = 0;
  return members.map((member) => {
    const layout = dashboard.widgets.find(
      ({ id }) => id === member.widgetId
    )?.layout;
    const width = toSize(layout?.width ?? member.width);
    const height = toSize(layout?.height ?? member.height);
    const placed = { ...member, x: 0, y, width, height };
    y += height;
    return placed;
  });
};

/** The dashboard with this arrangement of the group, in this frame. */
export const setWidgetGroupMembers = (
  dashboard: DashboardLayout,
  groupId: string,
  members: WidgetGroupMember[],
  frame: WidgetLayout
): DashboardLayout => {
  const group = findWidgetGroup(dashboard.widgets, groupId);
  return group
    ? withGroup(dashboard, group, members, { layout: frame })
    : dashboard;
};

/** The frame at this size. */
export const sizedWidgetGroupFrame = (
  frame: WidgetLayout,
  size: WidgetGroupFrameSize
): WidgetLayout => {
  const next = { ...frame, ...size };
  return { ...next, width: toSize(next.width), height: toSize(next.height) };
};

/** Sets the size of the group's frame on the overlay. */
export const resizeWidgetGroup = (
  dashboard: DashboardLayout,
  groupId: string,
  size: WidgetGroupFrameSize
): DashboardLayout => {
  const group = findWidgetGroup(dashboard.widgets, groupId);
  if (!group) return dashboard;
  return withGroup(dashboard, group, membersOf(dashboard, group), {
    layout: sizedWidgetGroupFrame(group.layout, size),
  });
};
