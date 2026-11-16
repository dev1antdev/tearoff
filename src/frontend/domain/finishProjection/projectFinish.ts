/**
 * The finish table's arithmetic, for the renderer. It lives in
 * `src/shared/finishProjection/`, because the main process counts a rival's
 * laps to its finish by the same rule, and a spec there runs it on what a
 * recorded race publishes.
 */
export {
  projectFinish,
  rivalProjectedGapS,
  type FinishColumn,
  type FinishColumnKind,
  type FinishMarginSide,
  type FinishProjection,
  type FinishProjectionOptions,
} from '@irdashies/shared';
