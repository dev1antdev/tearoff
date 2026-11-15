import { memo } from 'react';
import { WarningIcon } from '@phosphor-icons/react';
import type { LastTimeState } from '@irdashies/domain';

interface LastTimeCellProps {
  lastTimeString: string;
  lastTimeState?: LastTimeState;
  /**
   * The sim gave the lap no time: it did not count, and the time shown is the
   * lap as measured from its start. In a race that is a lap voided for track
   * limits or a cut; in practice and qualifying an out-lap is untimed too.
   */
  invalid?: boolean;
  compactMode?: string;
}

const getLastTimeColorClass = (state?: LastTimeState): string => {
  if (state === 'session-fastest') return 'text-purple-400';
  if (state === 'personal-best') return 'text-green-400';
  return '';
};

/**
 * A car's last lap time, as the standings, the relative and the battle rows
 * print it: purple for the session's fastest lap, green for the driver's own
 * best, and dimmed behind a warning mark for a lap that did not count.
 *
 * A lap that did not count never takes a best's colour, even when its time
 * equals the best: it is not that lap.
 */
export const LastTimeCell = memo(
  ({
    lastTimeString,
    lastTimeState,
    invalid = false,
    compactMode,
  }: LastTimeCellProps) => {
    const pxClass =
      compactMode === 'ultra'
        ? ''
        : compactMode === 'compact'
          ? 'px-1'
          : 'px-2';
    // Nothing to mark where there is no time: an empty cell stays empty.
    const marked = invalid && lastTimeString !== '';
    return (
      <td
        data-column="lastTime"
        data-invalid={marked ? 'true' : undefined}
        className={`w-auto ${pxClass} whitespace-nowrap ${
          marked ? 'text-white/60' : getLastTimeColorClass(lastTimeState)
        }`}
      >
        {marked ? (
          <span className="inline-flex items-center gap-1">
            {lastTimeString}
            <WarningIcon
              aria-label="Did not count"
              size={10}
              weight="fill"
              className="shrink-0 text-amber-300"
            />
          </span>
        ) : (
          lastTimeString
        )}
      </td>
    );
  }
);

LastTimeCell.displayName = 'LastTimeCell';
