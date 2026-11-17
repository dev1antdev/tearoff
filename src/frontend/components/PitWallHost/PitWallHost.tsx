import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
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
  channelRegistry,
  pitWallHostedDashboard,
  type ChannelName,
  type DashboardLayout,
  type DashboardWidget,
  type PitWallSlot,
  type ResolvedPitWallPanel,
} from '@irdashies/types';
import {
  WidgetRuntimeProvider,
  getWidgetRuntimeDefinition,
} from '../../widgetRuntime';
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

/**
 * How often a channel kept for a tab that is not in front is asked for:
 * once in five seconds, which is enough to stay a reader of it.
 */
export const KEPT_CHANNEL_RATE_HZ = 0.2;

/** Every channel the runtime definitions of these widgets name, each once. */
export const channelsOf = (
  widgets: readonly DashboardWidget[]
): ChannelName[] =>
  [
    ...new Set(
      widgets.flatMap(
        (widget) =>
          getWidgetRuntimeDefinition(widgetType(widget)).channels ?? []
      )
    ),
  ].sort();

const keep = () => undefined;

/**
 * Stays a reader of everything the panels of a layout's tabs read, in front
 * or not, for as long as the page is open.
 *
 * A channel is worked out in the main process only while somebody reads it,
 * and most of what these panels show is counted over the race: the laps
 * since a stop, what a lap costs, the place forecast some laps ago. On a
 * page of tabs the panels of one tab are the only readers, so without this
 * turning to the Log and back would start those counts again, and a browser
 * on the Map tab would be no reason to record the race. The panel in front
 * reads at its own rate; this asks seldom, and draws nothing.
 */
const TabChannelsKept = ({
  widgets,
}: {
  widgets: readonly DashboardWidget[];
}) => {
  // A string, so the effect runs when the channels change and not whenever
  // the dashboard is handed over again.
  const channels = channelsOf(widgets).join(' ');
  useEffect(() => {
    const bridge = window.channelBridge;
    if (!channels || !bridge) return;
    const stops = (channels.split(' ') as ChannelName[]).map((channel) =>
      bridge.subscribe(
        channel,
        keep,
        // An event channel is sent as it happens and takes no rate.
        channelRegistry[channel].kind === 'snapshot'
          ? KEPT_CHANNEL_RATE_HZ
          : undefined
      )
    );
    return () => stops.forEach((stop) => stop());
  }, [channels]);
  return null;
};

interface PanelContentProps {
  widget: DashboardWidget;
  slot: PitWallSlot;
  running: boolean;
  hostedDashboard: DashboardLayout | undefined;
  /**
   * False where the panel is the page's whole width, as on a phone: the
   * widget is drawn at its own size whatever the width, and what does not
   * fit scrolls sideways inside the panel.
   */
  fit?: boolean;
}

/**
 * One panel's widget, drawn to fit: at its own size where the panel is wide
 * enough, scaled down where it is not, and scrolling inside the panel where
 * it is taller than the panel. A slot with an aspect keeps its widget in a
 * box of that shape at the top of the panel.
 *
 * Exported for the stories that show one widget in a panel of a given size.
 */
export const PanelContent = memo(
  ({
    widget,
    slot,
    running,
    hostedDashboard,
    fit = true,
  }: PanelContentProps) => {
    const box = useRef<HTMLDivElement>(null);
    const { width } = useElementSize(box);
    // The page's own scale, which the fit is applied on top of.
    const pageScale = useWidgetScale();
    const scale = Math.round(
      pageScale * (fit ? panelFit(width, slot.minWidth) : 1) * 100
    );

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

  // A stack of panels as wide as the page has no narrower panel to fit.
  const fit = page.stack === undefined;
  const renderPanel = useCallback(
    (panel: ResolvedPitWallPanel) =>
      panel.status === 'ready' ? (
        <PanelContent
          widget={panel.widget}
          slot={panel.slot}
          running={running}
          hostedDashboard={hostedDashboard}
          fit={fit}
        />
      ) : null,
    [running, hostedDashboard, fit]
  );

  return (
    <>
      {/* Session data comes from the window's own provider. */}
      <RendererDataProviders widgets={widgets} sessionAlreadyMounted />
      <PanelUpdaters widgets={widgets} />
      {/* A page of one tab has every panel in front already. */}
      {page.tabs.length > 1 && <TabChannelsKept widgets={page.hosted} />}
      <PitWall renderPanel={renderPanel} />
    </>
  );
});
PitWallHost.displayName = 'PitWallHost';
