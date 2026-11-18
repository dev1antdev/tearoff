import { useMemo } from 'react';
import {
  fitLayoutToDisplay,
  isGantryOnly,
  isLayoutOnDisplay,
  isPitWallPage,
  isWidgetDisabledForSim,
  rendersInOwnWindow,
  widgetGroupMemberIds,
  withWidgetGroupMembers,
  type DashboardWidget,
} from '@irdashies/types';
import { useDashboard } from '../DashboardContext/DashboardContext';
import { useActiveSimulator } from './useActiveSimulator';
import { useSimWidgetSupport } from './useSimWidgetSupport';

export { isGantryOnly, isPitWallPage, rendersInOwnWindow };

/**
 * The enabled widgets this overlay window is responsible for.
 *
 * With one window per display, a widget belongs to the window whose display
 * contains its centre. A widget that lands on no display at all renders on the
 * primary, moved inside it, so a layout saved against a monitor that has
 * since been unplugged or switched off is still visible.
 *
 * Shared because three callers need the same answer and must agree on it: the
 * container that renders the widgets, the data providers that subscribe on
 * their behalf, and the lap-trace recorder, which writes to disk and would
 * duplicate its work if every window ran one.
 *
 * A widget the running sim cannot support counts as switched off here, the
 * same as it does when main decides which windows to build. Window creation
 * alone is not enough: one window can span several widgets, so an unsupported
 * widget sitting between two supported ones is inside a window that was built
 * anyway, and would render and subscribe unless it is dropped here too.
 *
 * `browser` skips the display filtering — a browser-source view has no display
 * bounds of its own and should show the lot — but not the compatibility
 * filtering, which is about the sim rather than the screen.
 *
 * A widget placed in the widget group is not one of them: the group draws it.
 * `includeGroupMembers` adds those of a group that is, for a caller asking
 * what this window has to fetch data for rather than which blocks it places.
 */
export const useWidgetsForThisDisplay = (
  browser = false,
  { includeGroupMembers = false }: { includeGroupMembers?: boolean } = {}
): DashboardWidget[] => {
  const { currentDashboard, containerBoundsInfo } = useDashboard();
  const simulator = useActiveSimulator();
  const simWidgetSupport = useSimWidgetSupport();

  const blocks = useMemo(() => {
    const groupMembers = widgetGroupMemberIds(currentDashboard?.widgets);
    const enabled =
      currentDashboard?.widgets.filter(
        (widget) =>
          widget.enabled &&
          !groupMembers.has(widget.id) &&
          !isGantryOnly(widget) &&
          !isPitWallPage(widget) &&
          !isWidgetDisabledForSim(
            simWidgetSupport,
            widget.type ?? widget.id,
            simulator
          )
      ) ?? [];
    if (browser) return enabled;
    // A new individual renderer must not briefly mount every widget (and its
    // recording/audio effects) before main sends its assignment.
    if (!containerBoundsInfo) {
      return currentDashboard?.generalSettings?.overlayWindowMode === 'widget'
        ? []
        : enabled;
    }
    if (containerBoundsInfo.widgetId !== undefined) {
      return enabled.flatMap((widget) =>
        widget.id === containerBoundsInfo.widgetId
          ? [
              {
                ...widget,
                layout: containerBoundsInfo.widgetLayout ?? widget.layout,
              },
            ]
          : []
      );
    }
    if (containerBoundsInfo.displayId === undefined) return enabled;

    const displayBounds =
      containerBoundsInfo.displayBounds ?? containerBoundsInfo.expected;
    return enabled.flatMap((widget) => {
      if (isLayoutOnDisplay(widget.layout, displayBounds)) return [widget];
      const onAnyDisplay =
        containerBoundsInfo.allDisplayBounds?.some((bounds) =>
          isLayoutOnDisplay(widget.layout, bounds)
        ) ?? false;
      if (onAnyDisplay || !containerBoundsInfo.isPrimary) return [];
      return [
        { ...widget, layout: fitLayoutToDisplay(widget.layout, displayBounds) },
      ];
    });
  }, [
    browser,
    containerBoundsInfo,
    currentDashboard?.widgets,
    currentDashboard?.generalSettings?.overlayWindowMode,
    simWidgetSupport,
    simulator,
  ]);

  return useMemo(
    () =>
      includeGroupMembers
        ? withWidgetGroupMembers(blocks, currentDashboard, {
            support: simWidgetSupport,
            simulator,
          })
        : blocks,
    [includeGroupMembers, blocks, currentDashboard, simWidgetSupport, simulator]
  );
};
