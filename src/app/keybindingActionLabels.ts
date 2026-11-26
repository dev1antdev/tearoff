import type {
  DashboardWidget,
  KeybindingActionId,
  KeybindingEntry,
  WidgetToggleActionId,
} from '@irdashies/types';
import { WIDGET_GROUP_ID, isWidgetGroup, widgetGroups } from '@irdashies/types';
import { WIDGET_MANIFESTS } from '../types/widgets';
import {
  isWidgetToggleActionId,
  widgetIdFromToggleActionId,
} from '@irdashies/shared';
import { getCurrentProfileId, getDashboard } from './storage/dashboards';

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
export const widgetToggleLabel = (
  actionId: WidgetToggleActionId,
  widgets: readonly DashboardWidget[]
): string | undefined => {
  const widgetId = widgetIdFromToggleActionId(actionId);
  const widget = widgets.find((candidate) => candidate.id === widgetId);
  if (!widget) return undefined;
  if (!isWidgetGroup(widget)) return widgetName(widget.type ?? widget.id);

  const index = widgetGroups(widgets).findIndex(({ id }) => id === widgetId);
  const name = widgetName(WIDGET_GROUP_ID);
  return index > 0 ? `${name} ${index + 1}` : name;
};

/**
 * What an action is called where a person sees it. A widget toggle goes by the
 * widget in the profile on screen, and only where that widget is not there
 * does the name saved with the key stand, which is what the settings page
 * shows for a key of another profile's widget.
 */
export const keybindingActionLabel = (
  actionId: KeybindingActionId,
  entry: KeybindingEntry
): string => {
  if (isWidgetToggleActionId(actionId)) {
    const live = widgetToggleLabel(
      actionId,
      getDashboard(getCurrentProfileId())?.widgets ?? []
    );
    if (live) return live;
  }
  return entry.label;
};
