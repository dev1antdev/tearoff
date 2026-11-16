import { memo } from 'react';
import { formatTime, type TimeFormat } from '@irdashies/utils/time';

interface AvgLapTimeCellProps {
  /** Seconds. Nothing, or not above zero, where there is no average yet. */
  avgLapTime?: number | null;
  timeFormat?: TimeFormat;
  compactMode?: string;
  /**
   * The column this cell belongs to. One cell draws every average column
   * (the rolling AVG, Avg 5 and Avg 10) so that they read alike.
   */
  column?: string;
}

export const AvgLapTimeCell = memo(
  ({
    avgLapTime,
    timeFormat = 'mixed',
    compactMode,
    column = 'avgLapTime',
  }: AvgLapTimeCellProps) => {
    const pxClass =
      compactMode === 'ultra'
        ? ''
        : compactMode === 'compact'
          ? 'px-1'
          : 'px-2';

    const display =
      avgLapTime && avgLapTime > 0 ? formatTime(avgLapTime, timeFormat) : '--';

    return (
      <td
        data-column={column}
        className={`w-auto ${pxClass} whitespace-nowrap`}
      >
        {display}
      </td>
    );
  }
);

AvgLapTimeCell.displayName = 'AvgLapTimeCell';
