import type { DashboardWidget } from './dashboardLayout';
import { PIT_WALL_WIDGET_ID } from './pitWall';

/** Shown only docked in the Gantry, never on an overlay or browser source. */
export const isGantryOnly = (widget: DashboardWidget): boolean =>
  widget.placement === 'gantry';

/**
 * The Pit Wall is a page in a window of its own, which mounts what the page
 * needs. No overlay window or browser source draws it, so none subscribes to
 * data on its behalf either.
 */
export const isPitWallPage = (widget: DashboardWidget): boolean =>
  (widget.type || widget.id) === PIT_WALL_WIDGET_ID;

/**
 * Does this widget render in its own window instead of the overlay (see the
 * hash routes in App.tsx)? Such a widget still lives in the dashboard and
 * still subscribes to data, so only the overlay's renderer excludes it.
 */
export const rendersInOwnWindow = (widget: DashboardWidget): boolean =>
  (widget.type || widget.id) === 'gantry' ||
  isPitWallPage(widget) ||
  isGantryOnly(widget);
