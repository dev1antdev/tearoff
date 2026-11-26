import {
  WIDGET_GROUP_ID,
  WIDGET_MANIFESTS,
  isWidgetGroup,
  widgetGroups,
  type DashboardWidget,
  type WidgetToggleActionId,
} from '@irdashies/types';

/**
 * Prefix marking a keybinding action as a per-widget show/hide toggle. The text
 * after the prefix is the widget instance id, e.g. `toggle-widget:standings`.
 */
export const WIDGET_TOGGLE_PREFIX = 'toggle-widget:';

/** True when an action id is a dynamic per-widget toggle. */
export function isWidgetToggleActionId(
  actionId: string
): actionId is WidgetToggleActionId {
  return actionId.startsWith(WIDGET_TOGGLE_PREFIX);
}

/** Build the toggle action id for a widget instance id. */
export function widgetToggleActionId(widgetId: string): WidgetToggleActionId {
  return `${WIDGET_TOGGLE_PREFIX}${widgetId}`;
}

/** Extract the widget instance id from a toggle action id. */
export function widgetIdFromToggleActionId(
  actionId: WidgetToggleActionId
): string {
  return actionId.slice(WIDGET_TOGGLE_PREFIX.length);
}

/**
 * True when an action id is a widget toggle with a non-empty widget id. Use at
 * boundaries (storage merge, IPC) to reject malformed `toggle-widget:` keys.
 */
export function isValidWidgetToggleActionId(actionId: string): boolean {
  return (
    isWidgetToggleActionId(actionId) &&
    widgetIdFromToggleActionId(actionId).length > 0
  );
}

/** What the settings menu calls a widget of this type. */
const widgetName = (widgetType: string): string => {
  const manifest = WIDGET_MANIFESTS.find(({ id }) => id === widgetType);
  return manifest ? (manifest.menuLabel ?? manifest.name) : widgetType;
};

/**
 * What a widget toggle is called where a person sees it, or undefined when the
 * widget is not in the given dashboard -- another profile's, or a deleted one,
 * where only the name saved with the key is left to go by.
 *
 * A group goes by its number, counted from the widgets as they are now: the
 * saved name says the number the group had when the key was set, and deleting
 * one group renumbers those after it.
 */
export function widgetToggleLabel(
  actionId: WidgetToggleActionId,
  widgets: readonly DashboardWidget[]
): string | undefined {
  const widgetId = widgetIdFromToggleActionId(actionId);
  const widget = widgets.find((candidate) => candidate.id === widgetId);
  if (!widget) return undefined;
  if (!isWidgetGroup(widget)) return widgetName(widget.type ?? widget.id);

  const index = widgetGroups(widgets).findIndex(({ id }) => id === widgetId);
  const name = widgetName(WIDGET_GROUP_ID);
  return index > 0 ? `${name} ${index + 1}` : name;
}

/**
 * The widget toggles holding a key with no widget here to show them under: the
 * widget was deleted or is in another profile. Bindings are shared by all
 * profiles, so they cannot simply go with the widget.
 */
export function unplacedWidgetToggleIds(
  bindings: Readonly<Record<string, { accelerator: string }>>,
  widgetIds: readonly string[]
): WidgetToggleActionId[] {
  const placed = new Set(widgetIds.map(widgetToggleActionId));
  return Object.keys(bindings).filter(
    (id): id is WidgetToggleActionId =>
      isWidgetToggleActionId(id) &&
      !placed.has(id) &&
      !!bindings[id].accelerator
  );
}

/**
 * Target index when cycling profiles. Returns -1 when at an edge and cycle is
 * off (i.e. no switch should happen).
 */
export const nextProfileIndex = (
  currentIndex: number,
  length: number,
  direction: 1 | -1,
  cycle: boolean
): number => {
  if (length === 0) return -1;
  const start = currentIndex === -1 ? 0 : currentIndex;
  const next = start + direction;
  if (cycle) return (next + length) % length;
  if (next < 0 || next >= length) return -1;
  return next;
};
