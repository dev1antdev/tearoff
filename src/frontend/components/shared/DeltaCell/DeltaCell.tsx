import { memo } from 'react';
import type { Gap } from '@irdashies/domain';
import { formatGap } from '@irdashies/utils/time';
import { buildDeltaPlaceholder } from './deltaPlaceholder';

interface DeltaCellProps {
  delta?: number | Gap;
  showForUndefined?: string;
  decimalPlaces?: number;
  compactMode?: string;
  showSign?: boolean;
  /**
   * The column this cell belongs to. One cell draws the delta, the gap and
   * the interval of the standings, which all carry 'delta'; a table that
   * has to tell its gap from its interval names them.
   */
  column?: string;
}

/**
 * A gap between two cars, as the standings, the relative and the timing
 * tower print it: seconds, or whole laps once more than a lap separates
 * them, and a placeholder of the same width where there is none.
 */
export const DeltaCell = memo(
  ({
    delta,
    showForUndefined,
    decimalPlaces = 2,
    compactMode,
    showSign = false,
    column = 'delta',
  }: DeltaCellProps) => {
    const pxClass =
      compactMode === 'ultra'
        ? ''
        : compactMode === 'compact'
          ? 'px-1'
          : 'px-2';
    // Helper function to check if delta is a Gap object
    const isGapObject = (val: number | Gap | undefined): val is Gap => {
      return typeof val === 'object' && val !== undefined && 'laps' in val;
    };

    const undefinedPlaceholder =
      showForUndefined ?? buildDeltaPlaceholder(decimalPlaces);

    // Determine what to display
    let displayValue: string = undefinedPlaceholder;

    if (delta !== undefined) {
      if (isGapObject(delta)) {
        // It's a Gap object
        if (delta.laps !== 0) {
          // Show lap difference
          displayValue = `${showSign && delta.laps > 0 ? '+' : ''}${delta.laps}L`;
        } else if (delta.value !== undefined) {
          // Show time difference from Gap.value
          displayValue = `${showSign && delta.value > 0 ? '+' : ''}${formatGap(delta.value, decimalPlaces)}`;
        }
      } else {
        // It's a plain number - show time difference
        displayValue = formatGap(delta, decimalPlaces);
      }
    }

    return (
      <td
        data-column={column}
        className={`w-auto ${pxClass} whitespace-nowrap text-center tabular-nums`}
      >
        {displayValue}
      </td>
    );
  }
);

DeltaCell.displayName = 'DeltaCell';
