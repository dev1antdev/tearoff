/**
 * The fuel saver's table, for the renderer. The arithmetic is beside the
 * fuel projection's in `src/shared/fuel/`, where a spec can run it on what
 * the main process publishes from a recording.
 */
export {
  computeSaverTable,
  LITRES_PER_GALLON,
  saverPerLap,
  savingTone,
  STOP_TARGET_MAX_SHARE,
  type SaverBasis,
  type SaverColumn,
  type SaverInput,
  type SaverResult,
  type SavingTone,
} from '@irdashies/shared';
