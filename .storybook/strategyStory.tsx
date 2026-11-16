import type { Decorator } from '@storybook/react-vite';
import { useEffect, useRef, type ComponentType } from 'react';
import {
  getWidgetManifest,
  pitWallHostedDashboard,
  type DashboardLayout,
  type RaceStint,
  type WidgetConfigMap,
} from '@irdashies/types';
import { defaultDashboard } from '../src/app/storage/defaultDashboard';
import {
  DashboardProvider,
  HostedDashboardProvider,
  useDashboard,
  useSessionStore,
} from '../src/frontend/context';
import { PitWallPanel } from '../src/frontend/components/PitWall/components/PitWallPanel/PitWallPanel';
import { HostedWidget } from '../src/frontend/components/WidgetPanelHost/HostedWidget';
import { ChannelSnapshotDecorator } from './channelSnapshotDecorator';
import { mockDashboardBridge } from './mockDashboardBridge';
import {
  strategyHistoryBridge,
  strategyStage,
  type StrategyStage,
} from './strategyStage';

/**
 * What a story of a strategy panel is wrapped in: the staged race of
 * `strategyStage.ts` on the channels, the race history's bridge answering
 * from its stints, and a dashboard with the widget's config.
 */

const RaceHistoryBridgeDecorator = (
  stints: ReadonlyMap<number, RaceStint[]>
): Decorator => {
  const bridge = strategyHistoryBridge(stints);
  const DecoratorComponent: Decorator = (Story) => {
    const previous = useRef(window.raceHistoryBridge);
    window.raceHistoryBridge = bridge;
    useEffect(
      () => () => {
        window.raceHistoryBridge = previous.current;
      },
      []
    );
    return <Story />;
  };
  return DecoratorComponent;
};

type StrategyWidgetId = 'ourcar' | 'classrivals' | 'stinttimeline';

/** The page's margin around a panel: `p-3`. */
const PAGE_MARGIN_PX = 12;

export interface StrategyStoryOptions<K extends StrategyWidgetId> {
  stage?: StrategyStage;
  config?: Partial<WidgetConfigMap[K]>;
  /** The box the widget is drawn in; its default overlay size without. */
  size?: { width: number; height: number };
  /**
   * Draw it in a panel of the Pit Wall of this size instead: through the
   * panel host, as the page does, with the overlay's hide rules lifted.
   */
  panel?: { width: number; height: number };
}

/** The widget's entry in a dashboard, switched on, with a config over its own. */
const stageDashboard = <K extends StrategyWidgetId>(
  widgetId: K,
  config: Partial<WidgetConfigMap[K]>
): DashboardLayout => ({
  ...defaultDashboard,
  widgets: defaultDashboard.widgets.map((widget) =>
    widget.id === widgetId
      ? {
          ...widget,
          enabled: true,
          config: { ...widget.config, ...config },
        }
      : widget
  ),
});

/** The widget in a panel of the Pit Wall, as the page's host draws it. */
const PanelHost = ({ widgetId }: { widgetId: StrategyWidgetId }) => {
  const { currentDashboard } = useDashboard();
  const widget = currentDashboard?.widgets.find(
    (entry) => entry.id === widgetId
  );
  if (!widget) return null;
  return (
    <PitWallPanel
      title={getWidgetManifest(widgetId)?.name ?? widgetId}
      onOpenSettings={() => undefined}
    >
      <HostedDashboardProvider
        dashboard={pitWallHostedDashboard(
          currentDashboard,
          new Set([widgetId])
        )}
      >
        <HostedWidget
          widget={widget}
          running
          host="pitwall"
          waitingMessage="Waiting for the simulator."
          scale={100}
          scroll={{ emptyMessage: 'Nothing to show right now.' }}
        />
      </HostedDashboardProvider>
    </PitWallPanel>
  );
};

/**
 * Everything a story of a strategy panel needs around it: the staged
 * session, its channels, the race history's bridge and a dashboard with the
 * widget's config. With `panel`, the story draws the widget inside a Pit
 * Wall panel and needs no component of its own.
 */
export const strategyStory = <K extends StrategyWidgetId>(
  widgetId: K,
  { stage = {}, config = {}, size, panel }: StrategyStoryOptions<K> = {}
) => {
  const { session, snapshots, stints } = strategyStage(stage);
  const dashboard = stageDashboard(widgetId, config);
  const bridge = {
    ...mockDashboardBridge,
    getActiveSimulator: async () =>
      stage.iracing ? ('iracing' as const) : ('lmu' as const),
    dashboardUpdated: (
      callback: Parameters<typeof mockDashboardBridge.dashboardUpdated>[0]
    ) => {
      callback(dashboard, undefined);
      return () => undefined;
    },
  };
  const layout = getWidgetManifest(widgetId)?.layout;
  const box = size ?? {
    width: layout?.width ?? 400,
    height: layout?.height ?? 300,
  };
  const decorators: Decorator[] = [
    (Story: ComponentType) => (
      <DashboardProvider bridge={bridge}>
        {panel ? (
          // A grid, as the page is: the panel takes the size of its cell,
          // inside the page's own margin.
          <div
            className="grid bg-settings-page p-3"
            style={{
              width: panel.width + PAGE_MARGIN_PX * 2,
              height: panel.height + PAGE_MARGIN_PX * 2,
            }}
          >
            <PanelHost widgetId={widgetId} />
          </div>
        ) : (
          // The widget fills its overlay window, so the story supplies one
          // with the overlay's own type scale.
          <div
            className="overlay-window overlay-theme-sm overlay-theme-font-face-lato overlay-theme-font-weight-normal"
            style={box}
          >
            <Story />
          </div>
        )}
      </DashboardProvider>
    ),
    RaceHistoryBridgeDecorator(stints),
    ChannelSnapshotDecorator(snapshots),
  ];
  return {
    loaders: [
      async () => {
        useSessionStore.setState({ session });
      },
    ],
    decorators,
  };
};
