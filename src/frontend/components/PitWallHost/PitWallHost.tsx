import { memo, useCallback, useMemo, useRef } from 'react';
import {
  HostedDashboardProvider,
  SectorTimingUpdater,
  useDashboard,
  useElementSize,
  usePitLapStoreUpdater,
  usePushToPassStoreUpdater,
  useRunningState,
} from '@irdashies/context';
import { widgetUpdaterNeeds } from '@irdashies/domain/widgetUpdaterNeeds';
import { useWidgetScale } from '@irdashies/domain/widgetPresentation/WidgetScale';
import {
  pitWallHostedDashboard,
  type DashboardLayout,
  type DashboardWidget,
  type PitWallSlot,
  type ResolvedPitWallPanel,
} from '@irdashies/types';
import { WidgetRuntimeProvider } from '../../widgetRuntime';
import { PitWall } from '../PitWall/PitWall';
import { usePitWallPage } from '../PitWall/hooks/usePitWallPage';
import { RendererDataProviders } from '../RendererDataProviders/RendererDataProviders';
import { HostedWidget } from '../WidgetPanelHost/HostedWidget';

const widgetType = (widget: DashboardWidget) => widget.type || widget.id;

/**
 * How much smaller than life the widget is drawn so that it fits the panel's
 * width: 1 while the panel is at least as wide as the widget needs, in steps
 * of a hundredth below that so a resize does not redraw on every pixel.
 */
export const panelFit = (panelWidth: number, minWidth: number): number =>
  panelWidth <= 0 || panelWidth >= minWidth
    ? 1
    : Math.floor((panelWidth / minWidth) * 100) / 100;

const PushToPassUpdater = () => {
  usePushToPassStoreUpdater(true);
  return null;
};
const PitLapUpdater = () => {
  usePitLapStoreUpdater(true);
  return null;
};

/**
 * The overlay mounts these beside its widgets; here the panels are the
 * widgets, so the page mounts them for whichever of them are shown.
 */
const PanelUpdaters = ({
  widgets,
}: {
  widgets: readonly DashboardWidget[];
}) => {
  const sectorTiming = widgets.find(
    (widget) => widgetUpdaterNeeds(widget).sectorTiming
  );
  return (
    <>
      {sectorTiming && (
        // At the rates of the widget that reads it, as on the overlay.
        <WidgetRuntimeProvider widgetType={widgetType(sectorTiming)}>
          <SectorTimingUpdater />
        </WidgetRuntimeProvider>
      )}
      {widgets.some((widget) => widgetUpdaterNeeds(widget).pushToPass) && (
        <PushToPassUpdater />
      )}
      {widgets.some((widget) => widgetUpdaterNeeds(widget).pitLap) && (
        <PitLapUpdater />
      )}
    </>
  );
};

interface PanelContentProps {
  widget: DashboardWidget;
  slot: PitWallSlot;
  running: boolean;
  hostedDashboard: DashboardLayout | undefined;
}

/**
 * One panel's widget, drawn to fit: at its own size where the panel is wide
 * enough, scaled down where it is not, and scrolling inside the panel where
 * it is taller than the panel. A slot with an aspect keeps its widget in a
 * box of that shape at the top of the panel.
 */
const PanelContent = memo(
  ({ widget, slot, running, hostedDashboard }: PanelContentProps) => {
    const box = useRef<HTMLDivElement>(null);
    const { width } = useElementSize(box);
    // The page's own scale, which the fit is applied on top of.
    const pageScale = useWidgetScale();
    const scale = Math.round(pageScale * panelFit(width, slot.minWidth) * 100);

    const content = (
      <div
        ref={box}
        className={slot.aspect ? 'mx-auto' : 'h-full w-full'}
        // As wide as the panel, or as wide as its height allows.
        style={
          slot.aspect
            ? {
                width: `min(100cqw, calc(100cqh * ${slot.aspect}))`,
                aspectRatio: slot.aspect,
              }
            : undefined
        }
      >
        {/* The widget reads its settings with the overlay's hide rules
            lifted, and is given no way to save a dashboard. */}
        <HostedDashboardProvider dashboard={hostedDashboard}>
          <HostedWidget
            widget={widget}
            running={running}
            host="pitwall"
            waitingMessage="Waiting for the simulator."
            scale={scale}
            scroll={{ emptyMessage: 'Nothing to show right now.' }}
          />
        </HostedDashboardProvider>
      </div>
    );

    return slot.aspect ? (
      // The box is sized against the panel, so the panel is its container.
      <div className="h-full w-full [container-type:size]">{content}</div>
    ) : (
      content
    );
  }
);
PanelContent.displayName = 'PanelContent';

/**
 * The Pit Wall with its panels filled: it finds the dashboard widget behind
 * each panel and draws it through the widget registry. A host, like
 * GantryDockHost, so the Pit Wall page itself only receives what it renders.
 */
export const PitWallHost = memo(() => {
  const { currentDashboard } = useDashboard();
  const { running } = useRunningState();
  const page = usePitWallPage();

  const widgets = useMemo(
    () =>
      page.panels.flatMap((panel) =>
        panel.status === 'ready' ? [panel.widget] : []
      ),
    [page]
  );
  const hostedDashboard = useMemo(
    () =>
      pitWallHostedDashboard(
        currentDashboard,
        new Set(widgets.map((widget) => widget.id))
      ),
    [currentDashboard, widgets]
  );

  const renderPanel = useCallback(
    (panel: ResolvedPitWallPanel) =>
      panel.status === 'ready' ? (
        <PanelContent
          widget={panel.widget}
          slot={panel.slot}
          running={running}
          hostedDashboard={hostedDashboard}
        />
      ) : null,
    [running, hostedDashboard]
  );

  return (
    <>
      {/* Session data comes from the window's own provider. */}
      <RendererDataProviders widgets={widgets} sessionAlreadyMounted />
      <PanelUpdaters widgets={widgets} />
      <PitWall renderPanel={renderPanel} />
    </>
  );
});
PitWallHost.displayName = 'PitWallHost';
