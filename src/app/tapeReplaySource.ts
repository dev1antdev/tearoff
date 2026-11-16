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

/**
 * Whether telemetry comes from a recording of any kind: a tape, or a
 * capture played through the isolated SDK addon, which looks like iRacing
 * to the bridge and is no more a race being driven than a tape is.
 *
 * Wider than the tape test above, which the stores of the player's own
 * laps go by. This is for a record of a whole race that outlives the app:
 * one made from any recording would sit in the file as a race the player
 * was in.
 */
export const isRecordedSource = (
  env: NodeJS.ProcessEnv = process.env
): boolean => isTapeReplaySource(env) || env.IRDASHIES_IRSDK_REPLAY === '1';
