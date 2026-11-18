import type { DashboardLayout, DashboardWidget } from './dashboardLayout';
import type { DockSimFilter } from './gantryDock';
import { isWidgetDisabledForSim } from './simWidgetSupport';
import type { WidgetGroupMember } from './widgetConfigs';
import { rendersInOwnWindow } from './widgetPlacement';
import { normalizeWidgetScale } from './widgetScale';

/*
 * The widget group: one block on the overlay with other widgets placed inside
 * it. Who is in it is kept in the group's own config and nowhere else, so
 * taking a widget out of the list is all it takes to put it back on the
 * overlay, where its own layout and settings have stayed as they were. A
 * dashboard can hold several groups, and a widget is in one of them at most.
 */

export const WIDGET_GROUP_ID = 'widgetgroup';

/** The most widgets a group holds. A saved list is read no further. */
export const WIDGET_GROUP_MAX_MEMBERS = 64;

type WidgetRef = Pick<DashboardWidget, 'id' | 'type'>;

const widgetType = (widget: WidgetRef) => widget.type || widget.id;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const isWidgetGroup = (widget: WidgetRef): boolean =>
  widgetType(widget) === WIDGET_GROUP_ID;

/** The settings page of a widget: its type's, or a group's own. */
export const widgetSettingsTarget = (widget: WidgetRef): string =>
  isWidgetGroup(widget) ? widget.id : widgetType(widget);

/** The groups of a dashboard, in its order. */
export const widgetGroups = (
  widgets: readonly DashboardWidget[] | undefined
): DashboardWidget[] => widgets?.filter(isWidgetGroup) ?? [];

/** The group with this id or, without one, the dashboard's first. */
export const findWidgetGroup = (
  widgets: readonly DashboardWidget[] | undefined,
  id?: string
): DashboardWidget | undefined =>
  widgets?.find(
    (widget) => isWidgetGroup(widget) && (id === undefined || widget.id === id)
  );

/**
 * Whether a widget can be placed in the group: anything the overlay draws,
 * other than the group itself.
 */
export const canJoinWidgetGroup = (widget: DashboardWidget): boolean =>
  !isWidgetGroup(widget) && !rendersInOwnWindow(widget);

/**
 * Reads the saved list, which is untrusted. Drops what is not a usable entry
 * and repeats of a widget, keeping the order, which is the order of drawing.
 */
export const sanitizeWidgetGroupMembers = (
  value: unknown
): WidgetGroupMember[] => {
  if (!Array.isArray(value)) return [];
  const members: WidgetGroupMember[] = [];
  const seen = new Set<string>();
  for (const raw of value.slice(0, WIDGET_GROUP_MAX_MEMBERS)) {
    if (!isRecord(raw)) continue;
    const { widgetId, x, y, width, height, scale, restoreDisabled } = raw;
    if (typeof widgetId !== 'string' || !widgetId || seen.has(widgetId)) {
      continue;
    }
    if (
      !isNumber(x) ||
      !isNumber(y) ||
      !isNumber(width) ||
      !isNumber(height) ||
      width <= 0 ||
      height <= 0
    ) {
      continue;
    }
    seen.add(widgetId);
    members.push({
      widgetId,
      x,
      y,
      width,
      height,
      ...(isNumber(scale) && { scale: normalizeWidgetScale(scale) }),
      ...(restoreDisabled === true && { restoreDisabled }),
    });
  }
  return members;
};

interface GroupedWidgets {
  /** Who is in each group, by the group's id. */
  members: ReadonlyMap<string, WidgetGroupMember[]>;
  /** The widgets drawn by a group and so not as blocks of their own. */
  memberIds: ReadonlySet<string>;
}

const groupedByWidgets = new WeakMap<
  readonly DashboardWidget[],
  GroupedWidgets
>();

/**
 * What the groups of a dashboard hold. A widget listed by several stays in the
 * first of them. Asked for every widget, so kept per list of widgets.
 */
const groupedWidgets = (widgets: readonly DashboardWidget[]) => {
  const known = groupedByWidgets.get(widgets);
  if (known) return known;
  const listed = new Set<string>();
  const members = new Map(
    widgetGroups(widgets).map((group) => [
      group.id,
      sanitizeWidgetGroupMembers(group.config?.members).filter(
        ({ widgetId }) => {
          if (listed.has(widgetId)) return false;
          listed.add(widgetId);
          return true;
        }
      ),
    ])
  );
  const memberIds = new Set(
    widgets
      .filter((widget) => listed.has(widget.id) && canJoinWidgetGroup(widget))
      .map((widget) => widget.id)
  );
  const grouped = { members, memberIds };
  groupedByWidgets.set(widgets, grouped);
  return grouped;
};

/** The saved members of one group, in drawing order. */
export const widgetGroupMembers = (
  widgets: readonly DashboardWidget[],
  groupId: string
): WidgetGroupMember[] => groupedWidgets(widgets).members.get(groupId) ?? [];

/** The widgets drawn by a group and so not as blocks of their own. */
export const widgetGroupMemberIds = (
  widgets: readonly DashboardWidget[] | undefined
): ReadonlySet<string> =>
  widgets ? groupedWidgets(widgets).memberIds : new Set();

/**
 * The widgets that are on only because a group switched them on. Whatever
 * empties the groups other than removing them one by one has to put them back.
 */
export const widgetsSwitchedOnByGroup = (
  widgets: readonly DashboardWidget[]
): ReadonlySet<string> =>
  new Set(
    [...groupedWidgets(widgets).members.values()]
      .flat()
      .filter((member) => member.restoreDisabled)
      .map((member) => member.widgetId)
  );

export interface ResolvedWidgetGroupMember {
  member: WidgetGroupMember;
  widget: DashboardWidget;
}

/**
 * What a group draws, in order: the listed widgets that exist, are switched
 * on and, with `sim`, can work under the running simulator. Without `groupId`,
 * for the dashboard's first group.
 */
export const resolveWidgetGroupMembers = (
  dashboard: DashboardLayout | null | undefined,
  sim?: DockSimFilter,
  groupId?: string
): ResolvedWidgetGroupMember[] => {
  const widgets = dashboard?.widgets ?? [];
  const group = findWidgetGroup(widgets, groupId);
  if (!group) return [];
  return widgetGroupMembers(widgets, group.id).flatMap((member) => {
    const widget = widgets.find((other) => other.id === member.widgetId);
    if (!widget?.enabled || !canJoinWidgetGroup(widget)) return [];
    if (
      sim &&
      isWidgetDisabledForSim(sim.support, widgetType(widget), sim.simulator)
    ) {
      return [];
    }
    return [{ member, widget }];
  });
};

/**
 * These widgets, and what the groups among them draw: what a window has to
 * fetch data for, which is more than the blocks it positions.
 */
export const withWidgetGroupMembers = <T extends WidgetRef>(
  widgets: T[],
  dashboard: DashboardLayout | null | undefined,
  sim?: DockSimFilter
): (T | DashboardWidget)[] => {
  const groups = widgets.filter(isWidgetGroup);
  return groups.length === 0
    ? widgets
    : [
        ...widgets,
        ...groups.flatMap((group) =>
          resolveWidgetGroupMembers(dashboard, sim, group.id).map(
            ({ widget }) => widget
          )
        ),
      ];
};
