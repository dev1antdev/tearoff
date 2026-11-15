import type { ActiveSimulator, SimWidgetSupportConfig } from '@irdashies/types';
import { isAnyWidgetAvailableForSim } from '@irdashies/types';

/** The widgets that show a race plan. A spec checks the list is complete. */
export const RACE_PLAN_WIDGETS: readonly string[] = [
  'stintplan',
  'strategytimeline',
];

/**
 * Whether the running simulator has a widget to show a race plan in.
 *
 * A plan comes from iRacePlan and names its drivers, team and track by
 * iRacing ids, so under Le Mans Ultimate both widgets are hidden and a plan
 * fetched every few minutes would be fetched for nobody. True while no
 * simulator is known: the app may be waiting for iRacing to start.
 */
export const canSimulatorShowRacePlan = (
  simulator: ActiveSimulator | null | undefined,
  support: SimWidgetSupportConfig
): boolean => isAnyWidgetAvailableForSim(support, RACE_PLAN_WIDGETS, simulator);
