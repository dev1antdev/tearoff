/**
 * Whether telemetry comes from a tape: somebody's recorded session played
 * back in place of a simulator, for development and for the app smoke run.
 *
 * A tape drives every widget, and none of it is the player's to keep. The
 * stores that hold the player's own laps keep a tape's in memory, so the
 * widgets work as they do live, and write nothing to disk.
 */
export const isTapeReplaySource = (
  env: NodeJS.ProcessEnv = process.env
): boolean =>
  Boolean(env.IRDASHIES_TELEMETRY_REPLAY || env.IRDASHIES_LMU_REPLAY);
