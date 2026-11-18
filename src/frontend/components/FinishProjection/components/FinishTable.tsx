import {
  ArrowDownIcon,
  ArrowUpIcon,
  GasPumpIcon,
  LightningIcon,
} from '@phosphor-icons/react';
import {
  finishColumnKey,
  finishColumnLabel,
  formatLapFraction,
  formatLapsToGo,
  formatLeaderMargin,
  refuelCell,
  type FinishColumn,
  type RefuelCell,
  type RefuelTone,
  type RefuelUnit,
} from '@irdashies/domain/finishProjection';

/**
 * The height of each row, so that the captions on the left and every
 * column beside them line up without a grid.
 */
const ROW = {
  caption: 'flex h-3 items-center',
  leader: 'flex h-3.5 items-center',
  laps: 'flex h-5 items-center',
  refuel: 'flex h-3.5 items-center',
} as const;

const REFUEL_TONE_CLASS: Record<RefuelTone, string> = {
  none: 'text-slate-500',
  enough: 'text-green-400',
  needed: 'text-slate-100',
  over: 'text-red-400',
};

interface RefuelFigureProps {
  testId: string;
  cell: RefuelCell;
}

const RefuelFigure = ({ testId, cell }: RefuelFigureProps) => (
  <span
    data-testid={testId}
    data-tone={cell.tone}
    className={`${ROW.refuel} text-xs font-semibold ${REFUEL_TONE_CLASS[cell.tone]}`}
  >
    {cell.text}
  </span>
);

interface FinishColumnCellProps {
  column: FinishColumn;
  /** What an amount is written in; null before there is one to write. */
  unit: RefuelUnit | null;
  refuelDisplay: 'toAdd' | 'total';
  showExtraRefuel: boolean;
  showLapFractions: boolean;
}

/**
 * One stop length: its caption and every row of the table under it. Not
 * memoised: the columns are made anew with each snapshot, once a second.
 */
const FinishColumnCell = ({
  column,
  unit,
  refuelDisplay,
  showExtraRefuel,
  showLapFractions,
}: FinishColumnCellProps) => {
  // Only the stop that is meant to finish the race is held to what the
  // car can take in one go.
  const holds = column.kind === 'toFinish';
  const NearArrow =
    column.near === 'more'
      ? ArrowUpIcon
      : column.near === 'fewer'
        ? ArrowDownIcon
        : null;
  return (
    <div
      data-testid="finish-column"
      data-kind={column.kind}
      className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded py-0.5 ${
        column.kind === 'now' ? 'bg-slate-900/70' : ''
      }`}
    >
      <span
        data-testid="finish-column-label"
        className={`${ROW.caption} text-2xs font-medium tracking-wide text-slate-400`}
      >
        {finishColumnLabel(column)}
      </span>
      <span
        data-testid="finish-leader"
        data-near={column.leaderNear}
        className={`${ROW.leader} text-xs ${
          column.leaderMarginS === null
            ? 'text-slate-500'
            : column.leaderNear
              ? 'text-amber-300'
              : 'text-slate-300'
        }`}
      >
        {formatLeaderMargin(column.leaderMarginS)}
      </span>
      <span
        data-testid="finish-laps"
        data-near={column.near ?? 'none'}
        className={`${ROW.laps} relative text-lg font-semibold ${
          column.near ? 'text-amber-300' : ''
        }`}
      >
        {formatLapsToGo(column.lapsToGo)}
        {NearArrow && (
          <NearArrow
            size="0.6em"
            weight="bold"
            className="absolute left-full top-0"
            aria-label={
              column.near === 'more'
                ? 'A few seconds quicker is one lap more'
                : 'A few seconds slower is one lap fewer'
            }
          />
        )}
      </span>
      <RefuelFigure
        testId="finish-refuel"
        cell={refuelCell(
          column.needed,
          column.toAdd,
          refuelDisplay,
          unit ?? 'L',
          holds && column.overCapacity
        )}
      />
      {showExtraRefuel && (
        <RefuelFigure
          testId="finish-refuel-extra"
          cell={refuelCell(
            column.neededExtra,
            column.toAddExtra,
            refuelDisplay,
            unit ?? 'L',
            holds && column.overCapacityExtra
          )}
        />
      )}
      {showLapFractions && (
        <>
          <span
            data-testid="finish-leader-fraction"
            className={`${ROW.leader} text-xs text-slate-300`}
          >
            {formatLapFraction(column.leaderFraction)}
          </span>
          <span
            data-testid="finish-player-fraction"
            className={`${ROW.leader} text-xs text-slate-300`}
          >
            {formatLapFraction(column.playerFraction)}
          </span>
        </>
      )}
    </div>
  );
};

export interface FinishTableProps {
  columns: readonly FinishColumn[];
  /**
   * What an amount is written in. Null before a lap has been measured,
   * when every amount is a dash and which budget the car runs on is not
   * known yet.
   */
  unit: RefuelUnit | null;
  refuelDisplay: 'toAdd' | 'total';
  showExtraRefuel: boolean;
  extraLaps: number;
  showLapFractions: boolean;
}

/**
 * The finish table: a column for each stop length, and under its caption
 * how long after the clock the leader takes the flag, the laps the player
 * still has to cover, and what has to go in for them.
 */
export const FinishTable = ({
  columns,
  unit,
  refuelDisplay,
  showExtraRefuel,
  extraLaps,
  showLapFractions,
}: FinishTableProps) => {
  const BudgetIcon = unit === '%' ? LightningIcon : GasPumpIcon;
  return (
    <div
      data-testid="finish-table"
      className="flex flex-none items-start gap-1"
    >
      <div className="flex flex-none flex-col gap-0.5 py-0.5 pr-1 text-2xs font-medium uppercase tracking-wide text-slate-400">
        <span className={ROW.caption} />
        <span className={ROW.leader}>Leader</span>
        <span className={ROW.laps}>Laps</span>
        <span className={`${ROW.refuel} gap-1`}>
          <BudgetIcon
            size="1.2em"
            weight="fill"
            aria-label={unit === '%' ? 'Virtual energy' : 'Fuel'}
          />
          {refuelDisplay === 'total' ? 'Needs' : 'Refuel'}
          {unit && (
            <span data-testid="finish-refuel-unit" className="normal-case">
              {unit}
            </span>
          )}
        </span>
        {showExtraRefuel && (
          <span className={ROW.refuel}>
            +{extraLaps} {extraLaps === 1 ? 'lap' : 'laps'}
          </span>
        )}
        {showLapFractions && (
          <>
            <span className={ROW.leader}>Ldr lap</span>
            <span className={ROW.leader}>Own lap</span>
          </>
        )}
      </div>
      {columns.map((column, index) => (
        <FinishColumnCell
          key={finishColumnKey(column, index)}
          column={column}
          unit={unit}
          refuelDisplay={refuelDisplay}
          showExtraRefuel={showExtraRefuel}
          showLapFractions={showLapFractions}
        />
      ))}
    </div>
  );
};
