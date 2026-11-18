import type { Decorator } from '@storybook/react-vite';
import {
  useEffect,
  useMemo,
  useRef,
  type ComponentType,
  type ReactNode,
} from 'react';
import {
  getWidgetManifest,
  pitWallHostedDashboard,
  type DashboardLayout,
  type PitWallSlot,
  type RaceHistoryBridge,
  type WidgetConfigMap,
} from '@irdashies/types';
import { defaultDashboard } from '../src/app/storage/defaultDashboard';
import {
  DashboardProvider,
  useDashboard,
  useSessionStore,
} from '../src/frontend/context';
import { PitWallPanel } from '../src/frontend/components/PitWall/components/PitWallPanel/PitWallPanel';
import { PanelContent } from '../src/frontend/components/PitWallHost/PitWallHost';
import { ChannelSnapshotDecorator } from './channelSnapshotDecorator';
import { mockDashboardBridge } from './mockDashboardBridge';
import {
  raceHistoryStage,
  raceHistoryStageBridge,
  type RaceHistoryStageOptions,
} from './raceHistoryStage';

/**
 * What a story of a panel about one car's records is wrapped in: the staged
 * race of `raceHistoryStage.ts` on the channels, the race history's bridge
 * answering from its records, and a dashboard with the widget's config.
 */

/** The widgets that read a car's records. */
type CarPanelWidgetId = 'crew' | 'carlaps' | 'racecharts';

/**
 * Puts a bridge to the race history on the window for a story, or takes it
 * away, to show what a panel says on a page that was given none.
 *
 * Exported for a story that stages a whole page of such panels.
 */
export const RaceHistoryBridgeDecorator = (
  bridge: RaceHistoryBridge | undefined
): Decorator => {
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

// About two seconds of frames: a widget that has not drawn its header by
// then is not going to.
const MAX_FRAMES = 120;

/**
 * Chooses a car in the panel's header once it is drawn, as a hand on the
 * box would: which car a panel is about is kept in the panel and nowhere a
 * story could set it.
 */
const ChooseCar = ({
  carIdx,
  children,
}: {
  carIdx: number | undefined;
  children: ReactNode;
}) => {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (carIdx === undefined) return;
    let frame = 0;
    let frames = 0;
    const seek = () => {
      const select = container.current?.querySelector('select');
      if (select) {
        // The way React hears of a change it did not make itself.
        Object.getOwnPropertyDescriptor(
          HTMLSelectElement.prototype,
          'value'
        )?.set?.call(select, String(carIdx));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      frames += 1;
      if (frames < MAX_FRAMES) frame = requestAnimationFrame(seek);
    };
    seek();
    return () => cancelAnimationFrame(frame);
  }, [carIdx]);
  return (
    // A grid of one cell, so that what is inside fills it as it would fill
    // the cell this stands in.
    <div ref={container} className="grid h-full min-h-0 w-full min-w-0">
      {children}
    </div>
  );
};

/** The page's margin around a panel: `p-3`. */
const PAGE_MARGIN_PX = 12;

export interface RaceHistoryStoryOptions<K extends CarPanelWidgetId> {
  stage?: RaceHistoryStageOptions;
  config?: Partial<WidgetConfigMap[K]>;
  /** The car the panel is pointed at, by number; our own left out. */
  car?: string;
  /** No bridge to the race history: a page that was given none. */
  noBridge?: boolean;
  /** The box the widget is drawn in; its default overlay size without. */
  size?: { width: number; height: number };
  /**
   * Draw it in a panel of the Pit Wall of this size instead: through the
   * page's own host, with the overlay's hide rules lifted.
   */
  panel?: { width: number; height: number };
}

/** The widget's entry in a dashboard, switched on, with a config over its own. */
const stageDashboard = <K extends CarPanelWidgetId>(
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
const PanelHost = ({ widgetId }: { widgetId: CarPanelWidgetId }) => {
  const { currentDashboard } = useDashboard();
  const widget = currentDashboard?.widgets.find(
    (entry) => entry.id === widgetId
  );
  const hosted = useMemo(
    () => pitWallHostedDashboard(currentDashboard, new Set([widgetId])),
    [currentDashboard, widgetId]
  );
  // The panels lay their own columns out and scroll what does not fit, so
  // the width below which the page scales a widget down is set low.
  const slot = useMemo<PitWallSlot>(
    () => ({ widget: widgetId, rows: 6, minWidth: 420 }),
    [widgetId]
  );
  if (!widget) return null;
  return (
    <PitWallPanel
      title={getWidgetManifest(widgetId)?.name ?? widgetId}
      onOpenSettings={() => undefined}
    >
      <PanelContent
        widget={widget}
        slot={slot}
        running
        hostedDashboard={hosted}
      />
    </PitWallPanel>
  );
};

/**
 * Everything a story of Crew and Stints, of Car Laps or of the Race Charts
 * needs around it: the staged session, its channels, the race history's
 * bridge and a dashboard with the widget's config. With `panel`, the story draws the widget inside
 * a Pit Wall panel and needs no component of its own.
 */
export const raceHistoryStory = <K extends CarPanelWidgetId>(
  widgetId: K,
  {
    stage = {},
    config = {},
    car,
    noBridge = false,
    size,
    panel,
  }: RaceHistoryStoryOptions<K> = {}
) => {
  const staged = raceHistoryStage(stage);
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
    width: layout?.width ?? 640,
    height: layout?.height ?? 420,
  };
  const chosen = car === undefined ? undefined : staged.slotOf(car);
  const decorators: Decorator[] = [
    (Story: ComponentType) => (
      <DashboardProvider bridge={bridge}>
        {panel ? (
          // A grid, as the page is: the panel takes the size of its cell,
          // inside the page's own margin.
          <div
            className="grid bg-settings-page p-3 overlay-window overlay-theme-sm overlay-theme-font-face-lato overlay-theme-font-weight-normal"
            style={{
              width: panel.width + PAGE_MARGIN_PX * 2,
              height: panel.height + PAGE_MARGIN_PX * 2,
            }}
          >
            <ChooseCar carIdx={chosen}>
              <PanelHost widgetId={widgetId} />
            </ChooseCar>
          </div>
        ) : (
          // The widget fills its overlay window, so the story supplies one
          // with the overlay's own type scale.
          <div
            className="overlay-window overlay-theme-sm overlay-theme-font-face-lato overlay-theme-font-weight-normal"
            style={box}
          >
            <ChooseCar carIdx={chosen}>
              <Story />
            </ChooseCar>
          </div>
        )}
      </DashboardProvider>
    ),
    RaceHistoryBridgeDecorator(
      noBridge ? undefined : raceHistoryStageBridge(staged.records)
    ),
    ChannelSnapshotDecorator(staged.snapshots),
  ];
  return {
    loaders: [
      async () => {
        useSessionStore.setState({ session: staged.session });
      },
    ],
    decorators,
  };
};
