import { memo } from 'react';
import { ArrowsClockwiseIcon, WarningIcon } from '@phosphor-icons/react';
import type { RacePlanClashLevel } from '@irdashies/domain';
import type { RacePlanStintStatus } from '@irdashies/types';

const STATUS_LABEL: Record<RacePlanStintStatus, string> = {
  done: 'Done',
  current: 'In car',
  upcoming: 'Upcoming',
  unassigned: 'Unassigned',
  dropped: 'Dropped',
};

// Status pills: tinted, the stint in the car the one bright neutral.
const STATUS_CHIP: Record<RacePlanStintStatus, string> = {
  done: 'bg-white/8 text-slate-400',
  current: 'bg-slate-200 text-slate-950',
  upcoming: 'bg-white/8 text-slate-200',
  unassigned: 'bg-amber-500/20 text-amber-400',
  dropped: 'bg-red-500/20 text-red-300',
};

const rowClass = (status: RacePlanStintStatus, mine: boolean) =>
  [
    'border-t overlay-divider first:border-t-0',
    status === 'current' ? 'overlay-selected font-semibold' : '',
    status === 'done' ? 'text-white/50' : '',
    status === 'dropped' ? 'text-white/40' : '',
    mine && status !== 'done' && status !== 'dropped' ? 'text-amber-300' : '',
  ].join(' ');

interface StintRowProps {
  number: number;
  driverName: string;
  mine: boolean;
  status: RacePlanStintStatus;
  plannedStart: string | null;
  projectedStart: string;
  rebuilt: boolean;
  clashLevel: RacePlanClashLevel | null;
  clashText: string | null;
}

export const StintRow = memo(
  ({
    number,
    driverName,
    mine,
    status,
    plannedStart,
    projectedStart,
    rebuilt,
    clashLevel,
    clashText,
  }: StintRowProps) => (
    <tr className={rowClass(status, mine)} aria-current={status === 'current'}>
      <td className="px-1 py-0.5 text-right tabular-nums text-slate-400">
        {number}
      </td>
      <td className="w-full max-w-0 px-1 py-0.5">
        <div className="flex items-center gap-1">
          <span
            className={[
              'truncate',
              status === 'dropped' ? 'line-through' : '',
              status === 'unassigned' ? 'italic' : '',
            ].join(' ')}
          >
            {driverName}
          </span>
          {rebuilt && (
            <span
              title="Rebuilt after a stop"
              aria-label="Rebuilt after a stop"
              role="img"
              className="flex-none text-slate-400"
            >
              <ArrowsClockwiseIcon size={12} />
            </span>
          )}
          {clashLevel && clashText && (
            <span
              title={clashText}
              aria-label={clashText}
              role="img"
              className={`flex-none ${clashLevel === 'clash' ? 'text-red-400' : 'text-amber-400'}`}
            >
              <WarningIcon size={14} weight="fill" />
            </span>
          )}
        </div>
      </td>
      <td className="hidden whitespace-nowrap px-1 py-0.5 tabular-nums text-slate-400 @sm:table-cell">
        {plannedStart ?? '--'}
      </td>
      <td className="whitespace-nowrap px-1 py-0.5 tabular-nums">
        {projectedStart}
      </td>
      <td className="hidden px-1 py-0.5 @2xs:table-cell">
        <span
          className={`whitespace-nowrap rounded-full px-1 text-xs font-normal ${STATUS_CHIP[status]}`}
        >
          {STATUS_LABEL[status]}
        </span>
      </td>
    </tr>
  )
);
StintRow.displayName = 'StintRow';
