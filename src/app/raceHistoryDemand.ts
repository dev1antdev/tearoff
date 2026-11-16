import type {
  ActiveSimulator,
  DashboardLayout,
  SimWidgetSupportConfig,
} from '@irdashies/types';
import { isWidgetDisabledForSim, PIT_WALL_WIDGET_ID } from '@irdashies/types';
import type { ChannelBus } from './bridge/channelBus';

/**
 * The channels made from the record: the summary of every car and the
 * race's log, which the race history's runtime publishes, and the laps
 * each class car has run on its tyres, which are counted from the stints
 * and stops it holds. A reader of any of them is a reason to record.
 */
const CHANNELS: readonly string[] = [
  'race-history.summary',
  'race-log.snapshot',
  'class-tyres.snapshot',
];

/** Ends a subscription, where the source hands one back. */
type Unsubscribe = (() => unknown) | undefined;

/**
 * True when the Pit Wall is enabled and the running simulator can show it.
 *
 * The enabled flag alone is not enough, for the reason the pit stops give:
 * a widget the running sim cannot support keeps the user's own setting and
 * is only hidden.
 */
export const needsRaceHistory = (
  layout: DashboardLayout | undefined,
  simulator: ActiveSimulator | null | undefined,
  support: SimWidgetSupportConfig
): boolean =>
  (layout?.widgets.some(
    (widget) => widget.id === PIT_WALL_WIDGET_ID && widget.enabled
  ) ??
    false) &&
  !isWidgetDisabledForSim(support, PIT_WALL_WIDGET_ID, simulator);

type DemandBus = Pick<
  ChannelBus,
  'subscriberCount' | 'onSubscriberCountChanged'
>;

export interface RaceHistoryDemandOptions {
  bus: DemandBus;
  initialLayout: DashboardLayout | undefined;
  onDashboardUpdated: (
    listener: (layout: DashboardLayout) => void
  ) => Unsubscribe;
  getSimulator: () => ActiveSimulator | null | undefined;
  /** Called when the running simulator becomes known, changes or is lost. */
  onSimulatorChanged: (listener: () => void) => Unsubscribe;
  getSupport: () => SimWidgetSupportConfig;
  onChange: (needed: boolean) => void;
  /** The dashboard as a perf run would have it; the stored one without. */
  resolveLayout?: (layout: DashboardLayout) => DashboardLayout;
}

/**
 * Calls `onChange` with whether the race is to be recorded, now and on
 * every change.
 *
 * The Pit Wall needs it for as long as it is switched on, its window open
 * or not: a race is recorded from its start, not from when somebody looks.
 * So does any subscriber to the summary, to the race's log or to a channel
 * made from the record, which is how a page served to a browser asks while
 * the Pit Wall is off on the desktop, and how a widget on the overlay does.
 * With neither, no frame is read at all.
 *
 * The simulator is watched as well as the dashboard: left on auto-detect
 * it is named only when a game is found, after the dashboard has been read.
 */
export const watchRaceHistoryDemand = ({
  bus,
  initialLayout,
  onDashboardUpdated,
  getSimulator,
  onSimulatorChanged,
  getSupport,
  onChange,
  resolveLayout,
}: RaceHistoryDemandOptions): (() => void) => {
  let layout = initialLayout;
  const readers = new Map(
    CHANNELS.map((channel) => [channel, bus.subscriberCount(channel)])
  );
  let subscribed = [...readers.values()].some((count) => count > 0);
  let needed: boolean | undefined;
  const update = () => {
    const shown = layout && resolveLayout ? resolveLayout(layout) : layout;
    const next =
      subscribed || needsRaceHistory(shown, getSimulator(), getSupport());
    if (next === needed) return;
    needed = next;
    onChange(next);
  };

  const unsubscribeDashboard = onDashboardUpdated((next) => {
    layout = next;
    update();
  });
  const unsubscribeSimulator = onSimulatorChanged(update);
  const unsubscribeBus = bus.onSubscriberCountChanged((channel, count) => {
    if (!readers.has(channel)) return;
    readers.set(channel, count);
    subscribed = false;
    for (const held of readers.values()) subscribed ||= held > 0;
    update();
  });
  update();

  return () => {
    unsubscribeDashboard?.();
    unsubscribeSimulator?.();
    unsubscribeBus();
  };
};
