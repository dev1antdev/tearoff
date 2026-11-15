import type { FlagDetail, FlagKind, FlagPanelConfig } from '@irdashies/types';

/** How a state tints the whole card. */
export interface FlagPanelTint {
  /** Background of the tint layer; its opacity is `--tint-opacity`. */
  background: string;
  /** Opacity of the tint before the card's own background opacity. */
  opacity: number;
  /** The inset outline of a tinted card. */
  ring: string;
}

const tint = (
  background: string,
  opacity: number,
  ring: string
): FlagPanelTint => ({ background, opacity, ring });

// The flag's own colour family at a dark shade, so the bright colour block
// still reads against it. Purple is not used: it means a best lap elsewhere.
const DISQUALIFIED = tint('bg-black/(--tint-opacity)', 0.7, 'ring-red-500/40');
const RED = tint('bg-red-900/(--tint-opacity)', 0.7, 'ring-red-400/40');
const CHEQUERED = tint('bg-slate-100/(--tint-opacity)', 0.15, 'ring-white/40');
const YELLOW = tint(
  'bg-yellow-700/(--tint-opacity)',
  0.5,
  'ring-yellow-400/40'
);
const YELLOW_ELSEWHERE = tint(
  'bg-yellow-700/(--tint-opacity)',
  0.3,
  'ring-yellow-400/40'
);
const BLUE = tint('bg-blue-900/(--tint-opacity)', 0.7, 'ring-blue-400/40');
const PENALTY = tint('bg-black/(--tint-opacity)', 0.65, 'ring-white/40');
const MEATBALL = tint(
  'bg-orange-900/(--tint-opacity)',
  0.6,
  'ring-orange-400/40'
);
const LAST_LAP = tint('bg-slate-100/(--tint-opacity)', 0.12, 'ring-white/40');
const GREEN_ANNOUNCED = tint(
  'bg-green-800/(--tint-opacity)',
  0.5,
  'ring-green-400/40'
);
const GREEN_CLEAR = tint(
  'bg-green-900/(--tint-opacity)',
  0.4,
  'ring-green-400/40'
);

/**
 * The tint of the card for a state, or null where it stays dark.
 *
 * `active` tints the states that need attention and leaves the calm ones
 * dark: a clear track, and a yellow somewhere else on the circuit. `always`
 * tints those two as well. The start is never tinted: its block and its
 * lights carry it.
 */
export const flagPanelTint = (
  kind: FlagKind,
  detail: FlagDetail,
  mode: FlagPanelConfig['tintCard']
): FlagPanelTint | null => {
  if (mode === 'off') return null;
  const always = mode === 'always';
  switch (kind) {
    case 'disqualified':
      return DISQUALIFIED;
    case 'red':
      return RED;
    case 'chequered':
      return CHEQUERED;
    case 'fullCourseYellow':
    case 'debris':
      return YELLOW;
    case 'yellow':
      if (detail !== 'yellowElsewhere') return YELLOW;
      return always ? YELLOW_ELSEWHERE : null;
    case 'blue':
      return BLUE;
    case 'penalty':
      return PENALTY;
    case 'meatball':
      return MEATBALL;
    case 'white':
      return LAST_LAP;
    case 'green':
      if (detail !== 'trackClear') return GREEN_ANNOUNCED;
      return always ? GREEN_CLEAR : null;
    case 'start':
    case 'none':
      return null;
  }
};
