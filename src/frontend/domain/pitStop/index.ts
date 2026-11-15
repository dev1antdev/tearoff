/**
 * The pit stop as the renderer works with it: the arithmetic of a stop,
 * which lives in `src/shared/pitStop/` so that the main process costs a
 * stop the same way, and how the widget draws it.
 */
export {
  isPitDriveMeasured,
  laneTimerS,
  pitDriveTimeS,
  pitLossS,
  plannedStandingS,
  projectRejoin,
  REJOIN_MARGIN_MEASURED_S,
  REJOIN_MARGIN_RECKONED_S,
  remainingPitLossS,
  standingSoFarS,
  standingToGoS,
  timeInPitsS,
  type RejoinCar,
  type RejoinProjection,
} from '@irdashies/shared';
export * from './pitStopDisplay';
