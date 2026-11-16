import { memo } from 'react';
import {
  stintPaceDisplay,
  type StintPaceTone,
} from '@irdashies/domain/lapTiming/stintPaceDisplay';

interface StintPaceCellProps {
  /**
   * Seconds against the earlier stint, negative for quicker. Null or left
   * out while there is nothing to compare: fewer than three clean laps in
   * the stint, or no earlier stint.
   */
  delta?: number | null;
  compactMode?: string;
}

const TONE_CLASS: Record<StintPaceTone, string> = {
  faster: 'text-green-400',
  slower: 'text-red-400',
  level: '',
  none: 'text-white/50',
};

/**
 * A car's pace in the stint it is on against an earlier stint of its own,
 * as the timing tower, the standings and the relative print it: signed, to
 * the hundredth, green when quicker than before and red when slower.
 */
export const StintPaceCell = memo(
  ({ delta, compactMode }: StintPaceCellProps) => {
    const pxClass =
      compactMode === 'ultra'
        ? ''
        : compactMode === 'compact'
          ? 'px-1'
          : 'px-2';
    const { text, tone } = stintPaceDisplay(delta);

    return (
      <td
        data-column="stintPace"
        data-tone={tone}
        className={`w-auto ${pxClass} text-right whitespace-nowrap tabular-nums ${TONE_CLASS[tone]}`}
      >
        {text}
      </td>
    );
  }
);

StintPaceCell.displayName = 'StintPaceCell';
