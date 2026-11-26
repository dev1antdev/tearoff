import type { LapTimeLogConfig } from '@irdashies/types';
import { formatTime, formatDelta } from '@irdashies/utils/time';
import { useGeneralSettings } from '@irdashies/context';
import {
  DropIcon,
  FlagIcon,
  GarageIcon,
  TrophyIcon,
  XCircleIcon,
} from '@phosphor-icons/react';
import { memo } from 'react';

/**
 * The widths of the cells of a row that carries what the lap cost, shared
 * with the header line. Such a row is a table row: every cell but the label
 * has a set width, so the figures line up down the list whatever marks a
 * lap has. A row without those cells keeps the three equal cells it always
 * had.
 */
export const FUEL_CELL_CLASS = 'w-[2.5em] flex-none text-right';
export const WEAR_CELL_CLASS = 'w-[2.5em] flex-none text-right';
export const DELTA_CELL_CLASS = 'w-[3.6em] flex-none text-right';
export const TIME_CELL_CLASS = 'w-[4.7em] flex-none text-right';

interface LapTimeRowProps {
  label: string;
  time: number | undefined;
  delta?: number | undefined;
  dirty?: boolean;
  best?: number | undefined;
  overall?: number | undefined;
  alltime?: number | undefined;
  settings?: LapTimeLogConfig;
  /** The lap under way: its time is still running, and is drawn muted. */
  live?: boolean;
  /** The list has cost cells: the delta and the time take set widths. */
  tabular?: boolean;
  /** The lap's number within its stint, as `S5`; empty when not shown. */
  stintLap?: string;
  /** Fuel or energy the lap used, as printed; undefined without the cell. */
  fuel?: string;
  /** Tread the lap wore, as printed; undefined without the cell. */
  wear?: string;
  /** Well above what the rows shown usually wear. */
  wearHigh?: boolean;
  /** An in-lap or an out-lap. */
  pitted?: boolean;
  /** The sim voided the lap, or it had an incident. */
  voided?: boolean;
  /** A local yellow was shown during the lap. */
  yellow?: boolean;
  /** A full-course caution was. */
  caution?: boolean;
  wet?: boolean;
  /** The first lap of a race, timed from the green flag. */
  fromStart?: boolean;
  /**
   * The side of the row a stint ends at: the row beside it there belongs to
   * another stint.
   */
  stintEdge?: 'top' | 'bottom';
}

const EDGE_CLASS = {
  top: 'border-t border-slate-400/60',
  bottom: 'border-b border-slate-400/60',
} as const;

export const LapTimeRow = memo(
  ({
    label,
    time,
    delta,
    dirty,
    best,
    overall,
    alltime,
    settings,
    live,
    tabular,
    stintLap,
    fuel,
    wear,
    wearHigh,
    pitted,
    voided,
    yellow,
    caution,
    wet,
    fromStart,
    stintEdge,
  }: LapTimeRowProps) => {
    const generalSettings = useGeneralSettings();
    const isCompact =
      generalSettings?.compactMode === 'compact' ||
      generalSettings?.compactMode === 'ultra';
    const isUltra = generalSettings?.compactMode === 'ultra';

    const isSameLapTime = (left?: number, right?: number) =>
      left !== undefined &&
      right !== undefined &&
      left > 0 &&
      Math.abs(left - right) < 0.001;

    const isOwnBest = isSameLapTime(time, best);
    const isPurple = isSameLapTime(time, overall);
    // Your best of all time: the same green as any best of yours, and a
    // trophy, since the list has no label to say which it is.
    const isRecord = isSameLapTime(time, alltime);

    const isDirty = dirty ?? false;

    const deltaIsGreen =
      time !== undefined && time > 0 && delta !== undefined && delta < 0;

    const deltaIsRed =
      time !== undefined && time > 0 && delta !== undefined && delta > 0;

    // Records by their shared meanings: the session's overall best is
    // purple, your own best green. Yellow is a flag, not a record.
    const getLapColor = () => {
      if (live) return 'text-slate-300';
      if (isDirty) return 'text-slate-400';
      if (isPurple) return 'text-purple-400';
      if (isOwnBest || isRecord) return 'text-green-400';
      return 'text-white';
    };

    const hasMarks =
      pitted || voided || yellow || caution || wet || fromStart || isRecord;

    return (
      <div
        className={`${!isCompact ? 'p-1' : ''} ${stintEdge ? EDGE_CLASS[stintEdge] : 'border-t overlay-divider first:border-t-0'}`}
      >
        <div
          className={`flex w-full items-center text-[1em] ${isUltra ? 'py-px px-1' : 'py-0.5 px-2'}`}
        >
          <span
            className={`flex flex-1 items-center gap-[0.3em] whitespace-nowrap ${tabular ? 'min-w-0 overflow-hidden' : ''}`}
          >
            <span className="tabular-nums uppercase">{label}</span>
            {stintLap && (
              <span
                data-testid="lap-stint"
                className="text-[0.85em] tabular-nums text-slate-400"
              >
                {stintLap}
              </span>
            )}
            {hasMarks && (
              <span
                data-testid="lap-marks"
                className="flex items-center gap-[0.2em] text-[0.9em]"
              >
                {isRecord && (
                  <TrophyIcon
                    data-mark="record"
                    weight="fill"
                    className="text-green-400"
                  />
                )}
                {fromStart && (
                  <FlagIcon
                    data-mark="start"
                    weight="fill"
                    className="text-green-400"
                  />
                )}
                {pitted && (
                  <GarageIcon data-mark="pit" className="text-slate-300" />
                )}
                {voided && (
                  <XCircleIcon data-mark="void" className="text-slate-400" />
                )}
                {(yellow || caution) && (
                  <FlagIcon
                    data-mark={caution ? 'caution' : 'yellow'}
                    weight="fill"
                    className="text-yellow-400"
                  />
                )}
                {caution && (
                  <span className="text-[0.7em] font-bold leading-none text-yellow-400">
                    FCY
                  </span>
                )}
                {wet && <DropIcon data-mark="wet" className="text-sky-400" />}
              </span>
            )}
          </span>
          {fuel !== undefined && (
            <span data-testid="lap-fuel" className={FUEL_CELL_CLASS}>
              <span className="text-[0.85em] tabular-nums">{fuel}</span>
            </span>
          )}
          {wear !== undefined && (
            <span data-testid="lap-wear" className={WEAR_CELL_CLASS}>
              <span
                className={`text-[0.85em] tabular-nums ${wearHigh ? 'text-amber-400' : ''}`}
              >
                {wear}
              </span>
            </span>
          )}
          {settings?.delta?.enabled && (
            <span
              className={`${tabular ? DELTA_CELL_CLASS : 'flex-1 text-center'} tabular-nums ${
                deltaIsGreen
                  ? 'text-green-400'
                  : deltaIsRed
                    ? 'text-red-400'
                    : 'text-slate-500'
              }`}
            >
              {formatDelta(time !== undefined && time > 0 ? delta : 0)}
            </span>
          )}
          <span
            className={`${tabular ? TIME_CELL_CLASS : 'flex-1 text-right'} tabular-nums ${getLapColor()}`}
          >
            {formatTime(time)}
          </span>
        </div>
      </div>
    );
  }
);

LapTimeRow.displayName = 'LapTimeRow';
