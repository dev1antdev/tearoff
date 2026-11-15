/**
 * The fastest lap of the session among the cars a driver compares with:
 * their own class, or everyone.
 */

export type SessionBestScope = 'class' | 'overall';

export interface SessionBestInput {
  /** Every car's best lap of the session by car index; 0 or less is none. */
  carIdxBestLapTime: readonly number[] | undefined;
  /** Each car's class id by car index, from the session's driver list. */
  carIdxClass: readonly (number | undefined)[];
  playerCarIdx: number | undefined;
  scope: SessionBestScope;
}

/**
 * The session best in scope, in seconds, or null when no car in scope has a
 * lap yet.
 *
 * In class scope with the player's class unknown there is nothing to compare
 * with, and the answer is null rather than the overall best under another
 * name.
 */
export const sessionBestLapTime = ({
  carIdxBestLapTime,
  carIdxClass,
  playerCarIdx,
  scope,
}: SessionBestInput): number | null => {
  if (!carIdxBestLapTime) return null;
  const playerClass =
    playerCarIdx === undefined ? undefined : carIdxClass[playerCarIdx];
  if (scope === 'class' && playerClass === undefined) return null;

  let best: number | null = null;
  for (let carIdx = 0; carIdx < carIdxBestLapTime.length; carIdx += 1) {
    const lapTime = carIdxBestLapTime[carIdx];
    if (!(lapTime > 0)) continue;
    if (scope === 'class' && carIdxClass[carIdx] !== playerClass) continue;
    if (best === null || lapTime < best) best = lapTime;
  }
  return best;
};
