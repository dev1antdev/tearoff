import type { DashboardLayout, DashboardWidget } from './dashboardLayout';
import type { DockSimFilter } from './gantryDock';
import { PIT_WALL_WIDGET_ID } from './pitWall';
import { isWidgetDisabledForSim } from './simWidgetSupport';
import type { WidgetGroupMember } from './widgetConfigs';
import { normalizeWidgetScale } from './widgetScale';

/*
 * The widget group: one block on the overlay with other widgets placed inside
 * it. Who is in it is kept in the group's own config and nowhere else, so
 * taking a widget out of the list is all it takes to put it back on the
 * overlay, where its own layout and settings have stayed as they were.
 */

export const WIDGET_GROUP_ID = 'widgetgroup';

/** A saved list is read this far and no further. */
const MAX_MEMBERS = 64;

type WidgetRef = Pick<DashboardWidget, 'id' | 'type'>;

const widgetType = (widget: WidgetRef) => widget.type || widget.id;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const isWidgetGroup = (widget: WidgetRef): boolean =>
  widgetType(widget) === WIDGET_GROUP_ID;

export const findWidgetGroup = (
  widgets: readonly DashboardWidget[] | undefined
): DashboardWidget | undefined => widgets?.find(isWidgetGroup);

/**
 * Whether a widget can be placed in the group. Not the group itself, nor what
 * is drawn in a window of its own or only docked in one, nor the diagnostic
 * inspector, which has no place in the settings menu either.
 */
export const canJoinWidgetGroup = (
  widget: Pick<DashboardWidget, 'id' | 'type' | 'placement'>
): boolean => {
  const type = widgetType(widget);
  return (
    type !== WIDGET_GROUP_ID &&
    type !== 'gantry' &&
    type !== 'telemetryinspector' &&
    type !== PIT_WALL_WIDGET_ID &&
    widget.placement !== 'gantry'
  );
};

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
  for (const raw of value.slice(0, MAX_MEMBERS)) {
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

const memberIdsByWidgets = new WeakMap<
  readonly DashboardWidget[],
  ReadonlySet<string>
>();

/**
 * The widgets drawn by the group and so not as blocks of their own. Asked for
 * every widget of a dashboard, so the answer is kept per list of widgets.
 */
export const widgetGroupMemberIds = (
  widgets: readonly DashboardWidget[] | undefined
): ReadonlySet<string> => {
  if (!widgets) return new Set();
  const known = memberIdsByWidgets.get(widgets);
  if (known) return known;
  const listed = new Set(
    sanitizeWidgetGroupMembers(findWidgetGroup(widgets)?.config?.members).map(
      (member) => member.widgetId
    )
  );
  const ids = new Set(
    widgets
      .filter((widget) => listed.has(widget.id) && canJoinWidgetGroup(widget))
      .map((widget) => widget.id)
  );
  memberIdsByWidgets.set(widgets, ids);
  return ids;
};

export interface ResolvedWidgetGroupMember {
  member: WidgetGroupMember;
  widget: DashboardWidget;
}

/**
 * What the group draws, in order: the listed widgets that exist, are switched
 * on and, with `sim`, can work under the running simulator.
 */
export const resolveWidgetGroupMembers = (
  dashboard: DashboardLayout | null | undefined,
  sim?: DockSimFilter
): ResolvedWidgetGroupMember[] => {
  const widgets = dashboard?.widgets ?? [];
  const group = findWidgetGroup(widgets);
  if (!group) return [];
  return sanitizeWidgetGroupMembers(group.config?.members).flatMap((member) => {
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
 * These widgets, and what the group draws if the group is among them: what a
 * window has to fetch data for, which is more than the blocks it positions.
 */
export const withWidgetGroupMembers = (
  widgets: DashboardWidget[],
  dashboard: DashboardLayout | null | undefined,
  sim?: DockSimFilter
): DashboardWidget[] =>
  widgets.some(isWidgetGroup)
    ? [
        ...widgets,
        ...resolveWidgetGroupMembers(dashboard, sim).map(
          ({ widget }) => widget
        ),
      ]
    : widgets;
