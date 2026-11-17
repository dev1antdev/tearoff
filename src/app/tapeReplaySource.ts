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
 * Wider than the tape test above, which the smaller stores go by (fuel
 * use, personal bests, lap traces). This is for the records that outlive
 * the app with the player's name on them, the lap library and the history
 * of races: a lap or a race taken from any recording would sit there as
 * one the player drove.
 */
export const isRecordedSource = (
  env: NodeJS.ProcessEnv = process.env
): boolean => isTapeReplaySource(env) || env.IRDASHIES_IRSDK_REPLAY === '1';

/**
 * Whether what is being measured is the player's own, to be written to the
 * lap library and the history of races: not a recording of any kind, not a
 * replay source the bridge announced on entering the session, and not demo
 * mode. Both go by this one rule, so a session one of them leaves out is
 * left out by the other.
 */
export const keepsPlayerRecords = (
  source: { replaySource: boolean; demoMode: boolean },
  env: NodeJS.ProcessEnv = process.env
): boolean =>
  !isRecordedSource(env) && !source.replaySource && !source.demoMode;
