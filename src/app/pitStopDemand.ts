import type {
  ActiveSimulator,
  DashboardLayout,
  SimWidgetSupportConfig,
} from '@irdashies/types';
import { isWidgetDisabledForSim } from '@irdashies/types';

/** Ends a subscription, where the source hands one back. */
type Unsubscribe = (() => unknown) | undefined;

/** The one widget that shows pit stops. A spec checks it still is. */
export const PIT_STOP_WIDGET = 'gantry';

/**
 * True when the Gantry is enabled and the running simulator can show it.
 *
 * The enabled flag alone is not enough: a widget the running sim cannot
 * support keeps the user's own setting and is only hidden, so a Gantry
 * switched on for iRacing stays "enabled" through a Le Mans Ultimate race
 * that has no window to show a pit stop in.
 */
export const needsPitStops = (
  layout: DashboardLayout | undefined,
  simulator: ActiveSimulator | null | undefined,
  support: SimWidgetSupportConfig
): boolean =>
  (layout?.widgets.some(
    (widget) => widget.id === PIT_STOP_WIDGET && widget.enabled
  ) ??
    false) &&
  !isWidgetDisabledForSim(support, PIT_STOP_WIDGET, simulator);

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
