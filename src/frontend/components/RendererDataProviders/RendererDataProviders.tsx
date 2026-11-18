import { useMemo } from 'react';
import { withWidgetGroupMembers, type DashboardWidget } from '@irdashies/types';
import {
  PitLaneProvider,
  ReferenceStoreProvider,
  SectorTimingUpdater,
  SessionProvider,
  TelemetryInspectorProvider,
  useDashboard,
  useWidgetsForThisDisplay,
} from '@irdashies/context';
import { widgetUpdaterNeeds } from '@irdashies/domain/widgetUpdaterNeeds';
import {
  WidgetRuntimeProvider,
  rendererNeedsChannel,
  rendererNeedsTelemetryInspector,
  rendererNeedsPitLaneData,
  rendererNeedsSessionData,
} from '../../widgetRuntime';

export const RendererDataProviders = ({
  browser = false,
  widgets: widgetsOverride,
  widgetId,
  sessionAlreadyMounted = false,
}: {
  browser?: boolean;
  /** Mount for these widgets instead of the ones on this display. */
  widgets?: readonly DashboardWidget[];
  /**
   * Scope the providers to a single widget, for a one-widget browser source.
   *
   * Without this, needs come from the *enabled* widgets. /widget/<id> renders
   * whether or not the widget is enabled, so the natural VR setup — desktop
   * overlays all switched off, each widget placed as its own source — leaves
   * that list empty and mounts no providers at all. Car Systems, Track Map,
   * Relative and Blind Spot Monitor all declare sessionData, so they would
   * render permanently empty with nothing to say why.
   */
  widgetId?: string;
  /** The window already mounts a SessionProvider of its own. */
  sessionAlreadyMounted?: boolean;
}) => {
  const displayWidgets = useWidgetsForThisDisplay(browser, {
    includeGroupMembers: true,
  });
  const widgets = widgetsOverride ?? displayWidgets;
  const { currentDashboard } = useDashboard();
  // Looked up in the whole profile, not the enabled list above, so a disabled
  // widget still resolves. Only the type is taken from it: a second instance
  // of a widget (id `fuel-2`, type `fuel`) is registered under its type.
  const scopedType = widgetId
    ? currentDashboard?.widgets.find((widget) => widget.id === widgetId)?.type
    : undefined;
  const runtimeNeeds = useMemo(() => {
    // The group's own page needs what the widgets inside it need.
    const scoped = widgetId
      ? withWidgetGroupMembers(
          [{ id: widgetId, type: scopedType }],
          currentDashboard
        )
      : widgets;
    return {
      telemetryInspector: rendererNeedsTelemetryInspector(scoped),
      referenceLaps: rendererNeedsChannel(scoped, 'reference-laps.snapshot'),
      sessionData: !sessionAlreadyMounted && rendererNeedsSessionData(scoped),
      pitLaneData: rendererNeedsPitLaneData(scoped),
      // An overlay window mounts this beside its widgets; a browser page,
      // which has nothing else to do it, mounts it here.
      sectorTimingFor: browser
        ? scoped.find((widget) => widgetUpdaterNeeds(widget).sectorTiming)
        : undefined,
    };
  }, [
    browser,
    widgets,
    widgetId,
    scopedType,
    currentDashboard,
    sessionAlreadyMounted,
  ]);

  if (
    !runtimeNeeds.telemetryInspector &&
    !runtimeNeeds.referenceLaps &&
    !runtimeNeeds.sessionData &&
    !runtimeNeeds.pitLaneData &&
    !runtimeNeeds.sectorTimingFor
  )
    return null;

  return (
    <>
      {runtimeNeeds.sessionData ? (
        <SessionProvider bridge={window.irsdkBridge} />
      ) : null}
      {runtimeNeeds.telemetryInspector ? (
        <TelemetryInspectorProvider bridge={window.telemetryInspectorBridge} />
      ) : null}
      {runtimeNeeds.pitLaneData && window.pitLaneBridge ? (
        <PitLaneProvider bridge={window.pitLaneBridge} />
      ) : null}
      {runtimeNeeds.referenceLaps ? (
        <ReferenceStoreProvider bridge={window.channelBridge} />
      ) : null}
      {runtimeNeeds.sectorTimingFor ? (
        <WidgetRuntimeProvider
          widgetType={
            runtimeNeeds.sectorTimingFor.type ||
            runtimeNeeds.sectorTimingFor.id
          }
        >
          <SectorTimingUpdater />
        </WidgetRuntimeProvider>
      ) : null}
    </>
  );
};
