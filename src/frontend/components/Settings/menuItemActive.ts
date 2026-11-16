import type { MenuItem } from './menuItems';
import { widgetSettingsType } from './widgetSettingsType';

/** The page id in a settings path: `/settings/flagpanel` gives `flagpanel`. */
const settingsPageId = (pathname: string): string =>
  pathname.replace(/^\/settings\/?/, '').split('/')[0];

/**
 * Whether a menu row is the current one: its own page, a layout copy's of
 * it, or a page it shares with the widgets grouped under it.
 *
 * Ids are compared whole. One can begin with another (Flag and Flag Panel,
 * Weather and Weather Forecast, Fuel and Fuel Saver), so matching the start
 * of the path lit two rows at once.
 */
export const isMenuItemActive = (
  item: Pick<MenuItem, 'path' | 'groupTypes'>,
  pathname: string,
  widgets: readonly { id: string; type?: string }[] | undefined
): boolean => {
  const pageId = settingsPageId(pathname);
  if (item.path === `/${pageId}`) return true;
  // A copy made in the layout editor has an id of its own and shows its
  // type's page; the grouped broadcast widgets share the group's page.
  const pageType = widgetSettingsType(widgets, pageId);
  return (
    item.path === `/${pageType}` ||
    (item.groupTypes?.includes(pageType) ?? false)
  );
};
