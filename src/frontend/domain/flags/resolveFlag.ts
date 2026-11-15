import {
  flagDetailFor,
  rankFlagKind,
  type FlagDetail,
  type FlagKind,
  type FlagStateSnapshot,
} from '@irdashies/types';

/** The kinds a widget can switch off. Unset shows the kind. */
export interface FlagSwitches {
  /** The states before the start: the grid, the formation lap, the lights. */
  showStart?: boolean;
  showPenalty?: boolean;
  showLastLap?: boolean;
  /** False while a race-only blue is out of a race. */
  showBlue?: boolean;
  /** False while race-only local yellows are out of a race. */
  showYellow?: boolean;
}

export interface ResolvedFlag {
  kind: FlagKind;
  detail: FlagDetail;
}

const isSwitchedOff = (kind: FlagKind, switches: FlagSwitches): boolean => {
  switch (kind) {
    case 'start':
      return switches.showStart === false;
    case 'penalty':
      return switches.showPenalty === false;
    case 'white':
      return switches.showLastLap === false;
    case 'blue':
      return switches.showBlue === false;
    case 'yellow':
      return switches.showYellow === false;
    default:
      return false;
  }
};

/**
 * The flag a widget shows: the one the processor ranked first, or, when the
 * widget has that kind switched off, whatever ranks next among the conditions
 * that hold.
 *
 * The processor publishes facts and ranks them without knowing any widget's
 * settings. Switching a kind off must not leave the card blank while another
 * flag is out, so the ranking runs again here over `active` with that kind
 * left out.
 */
export const resolveFlagState = (
  snapshot: FlagStateSnapshot,
  switches: FlagSwitches = {}
): ResolvedFlag => {
  if (!isSwitchedOff(snapshot.kind, switches)) {
    return { kind: snapshot.kind, detail: snapshot.detail };
  }
  const kind = rankFlagKind(snapshot.active, (candidate) =>
    isSwitchedOff(candidate, switches)
  );
  return { kind, detail: flagDetailFor(kind, snapshot, snapshot.detail) };
};
