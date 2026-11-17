import { getWidgetManifest, type DashboardLayout } from '@irdashies/types';

/** Longer than any widget id or layout copy's id; a route is not a place for more. */
const MAX_TARGET_LENGTH = 64;

/**
 * The settings page a renderer may ask the settings window to open, or null.
 *
 * What a window names becomes a route of the settings window
 * (`#/settings/<target>`), so it is checked against what there is a page for
 * rather than passed on (N4, R4.3): a widget type that has a manifest, or the
 * id of a widget in the active dashboard, which is how a layout copy such as
 * `fuel-2` is named. Anything else, a string or not, is refused.
 *
 * The pages that are not a widget's (General, Profiles and the rest) are not
 * on the list: no window but the settings window itself goes to them.
 */
export function settingsTargetOf(
  target: unknown,
  dashboard: Pick<DashboardLayout, 'widgets'> | null | undefined
): string | null {
  if (
    typeof target !== 'string' ||
    target.length === 0 ||
    target.length > MAX_TARGET_LENGTH
  ) {
    return null;
  }
  if (getWidgetManifest(target)) return target;
  const widgets = Array.isArray(dashboard?.widgets) ? dashboard.widgets : [];
  const widget = widgets.find((w) => w?.id === target);
  return widget && getWidgetManifest(widget.type || widget.id) ? target : null;
}
