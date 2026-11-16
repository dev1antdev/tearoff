import type {
  ActiveSimulator,
  DashboardLayout,
  SimWidgetSupportConfig,
} from '@irdashies/types';
import { isWidgetDisabledForSim, PIT_WALL_WIDGET_ID } from '@irdashies/types';

/** Ends a subscription, where the source hands one back. */
type Unsubscribe = (() => unknown) | undefined;

/** The one widget that reads the pit stops itself. */
export const PIT_STOP_READER = 'gantry';

/**
 * The widgets pit stops are recorded for: the Gantry, which shows them, and
 * the Pit Wall, a page for whole races. The Pit Wall reads none itself; it
 * is here so that, while it is switched on, the stops of a race are kept
 * from the start of it, for whichever of its panels comes to show them. A
 * spec holds the list to what the widgets declare.
 */
export const PIT_STOP_WIDGETS: readonly string[] = [
  PIT_STOP_READER,
  PIT_WALL_WIDGET_ID,
];

/**
 * True when one of those widgets is enabled and the running simulator can
 * show it.
 *
 * The enabled flag alone is not enough: a widget the running sim cannot
 * support keeps the user's own setting and is only hidden, so a Gantry
 * switched on for iRacing stays "enabled" through a Le Mans Ultimate race
 * that has no window to show a pit stop in. The Pit Wall is shown under
 * both simulators, so with it switched on the stops are recorded under
 * both.
 */
export const needsPitStops = (
  layout: DashboardLayout | undefined,
  simulator: ActiveSimulator | null | undefined,
  support: SimWidgetSupportConfig
): boolean =>
  PIT_STOP_WIDGETS.some(
    (id) =>
      (layout?.widgets.some((widget) => widget.id === id && widget.enabled) ??
        false) &&
      !isWidgetDisabledForSim(support, id, simulator)
  );

export interface PitStopDemandOptions {
  initialLayout: DashboardLayout | undefined;
  onDashboardUpdated: (
    listener: (layout: DashboardLayout) => void
  ) => Unsubscribe;
  getSimulator: () => ActiveSimulator | null | undefined;
  /** Called when the running simulator becomes known, changes or is lost. */
  onSimulatorChanged: (listener: () => void) => Unsubscribe;
  getSupport: () => SimWidgetSupportConfig;
  onChange: (needed: boolean) => void;
}

/**
 * Calls `onChange` with whether pit stops should be recorded, now and on
 * every change.
 *
 * The simulator is watched as well as the dashboard: left on auto-detect it
 * is named only when a game is found, after the dashboard has been read, and
 * a profile can pin another one at any time.
 */
export const watchPitStopDemand = ({
  initialLayout,
  onDashboardUpdated,
  getSimulator,
  onSimulatorChanged,
  getSupport,
  onChange,
}: PitStopDemandOptions): (() => void) => {
  let layout = initialLayout;
  let needed: boolean | undefined;
  const update = () => {
    const next = needsPitStops(layout, getSimulator(), getSupport());
    if (next === needed) return;
    needed = next;
    onChange(next);
  };

  const unsubscribeDashboard = onDashboardUpdated((next) => {
    layout = next;
    update();
  });
  const unsubscribeSimulator = onSimulatorChanged(update);
  update();

  return () => {
    unsubscribeDashboard?.();
    unsubscribeSimulator?.();
  };
};
