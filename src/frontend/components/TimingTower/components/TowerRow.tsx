import { memo, useMemo } from 'react';
import type { LastTimeState } from '@irdashies/domain';
import type { SectorMarkTone } from '@irdashies/domain/sectors/sectorMarks';
import type { NameFormat } from '@irdashies/types';
import { getTailwindStyle } from '@irdashies/utils/colors';
import { formatTime } from '@irdashies/utils/time';
import { AvgLapTimeCell } from '../../shared/AvgLapTimeCell/AvgLapTimeCell';
import { CarNumberCell } from '../../shared/CarNumberCell/CarNumberCell';
import { Compound } from '../../shared/Compound/Compound';
import { DeltaCell } from '../../shared/DeltaCell/DeltaCell';
import {
  DriverName,
  extractDriverName,
} from '../../shared/DriverName/DriverName';
import { FastestTimeCell } from '../../shared/FastestTimeCell/FastestTimeCell';
import { LastTimeCell } from '../../shared/LastTimeCell/LastTimeCell';
import { SectorMarksCell } from '../../shared/SectorMarksCell/SectorMarksCell';
import { StintPaceCell } from '../../shared/StintPaceCell/StintPaceCell';
import { VirtualEnergyCell } from '../../shared/VirtualEnergyCell/VirtualEnergyCell';
import type { TowerColumnId } from '../towerColumns';
import { TOWER_TAG_TITLES, type TowerTag } from '../towerRows';

/** The padding the shared cells take: the tower's rows are dense. */
const DENSE = 'compact';
/** What a figure reads while it cannot be known. */
const UNKNOWN = '--';

const TAG_CLASS: Readonly<Record<TowerTag, string>> = {
  PIT: 'bg-orange-900 text-orange-200',
  OUT: 'bg-green-900 text-green-200',
  GAR: 'bg-slate-700 text-slate-300',
  AWAY: 'bg-slate-700 text-slate-300',
  DNF: 'bg-red-900 text-red-200',
  DQ: 'bg-red-900 text-red-200',
};

export interface TowerRowProps {
  carIdx: number;
  /** The columns to draw, in order. The same list for every row. */
  columns: readonly TowerColumnId[];
  /** In class, or overall on the tab of the whole field. */
  position?: number;
  carNumber: string;
  classColor: number;
  highlightColor: number;
  isMultiClass: boolean;
  name: string;
  nameFormat: NameFormat;
  /** Left out, the row is one line high. */
  team?: string;
  tag: TowerTag | null;
  /** Our own car. */
  isOwn: boolean;
  /** In the pits or not in the world: written quieter. */
  dimmed: boolean;
  /** The first of the list, which has no gap to anybody. */
  isLeader: boolean;
  gapValue?: number;
  gapLaps: number;
  intervalValue?: number;
  intervalLaps: number;
  /** Seconds; not above zero where the car has no such lap. */
  lastTime: number;
  lastTimeState?: LastTimeState;
  /** The sim gave the last lap no time: it did not count. */
  lastLapInvalid: boolean;
  bestTime: number;
  /** The best lap of the class is this car's. */
  hasClassBest: boolean;
  avgLast5?: number | null;
  avgLast10?: number | null;
  stintPace?: number | null;
  sector1: SectorMarkTone;
  sector2: SectorMarkTone;
  sector3: SectorMarkTone;
  /** Null where it is not known. */
  pitStops: number | null;
  stintLaps: number | null;
  /** 0..1; left out where the sim gives the car none. */
  energy?: number;
  energyIsVirtual?: boolean;
  /** Left out where the car has no compound to show. */
  tireCompound?: number;
  wheelCompounds?: readonly number[];
  /**
   * The laps on the set, as written: "17", "17?" or "17+". Left out, or
   * empty, where nothing is said of the car, as for one of another class.
   */
  tyreLaps?: string;
  /** The tread left, as written: "86%", "~86%", "<86%" or "--". */
  tyreTread?: string;
  /** Both in a sentence, for whoever points at the cell. */
  tyreTitle?: string;
}

const sameList = (a: readonly unknown[], b: readonly unknown[]) =>
  a === b || (a.length === b.length && a.every((item, i) => item === b[i]));

/** Every prop is a figure or a short list of them: compared by value. */
const propsAreEqual = (prev: TowerRowProps, next: TowerRowProps): boolean => {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]) as Set<
    keyof TowerRowProps
  >;
  for (const key of keys) {
    const before = prev[key];
    const after = next[key];
    if (before === after) continue;
    if (Array.isArray(before) && Array.isArray(after)) {
      if (!sameList(before, after)) return false;
      continue;
    }
    return false;
  }
  return true;
};

const lapTime = (seconds: number): string =>
  seconds > 0 ? formatTime(seconds, 'full') : UNKNOWN;

/**
 * One car of the tower. Drawn again only when one of its own figures
 * moves: the table is read a few times a second and most rows have not
 * changed between two readings.
 */
export const TowerRow = memo((props: TowerRowProps) => {
  const {
    carIdx,
    columns,
    position,
    carNumber,
    classColor,
    highlightColor,
    isMultiClass,
    name,
    nameFormat,
    team,
    tag,
    isOwn,
    dimmed,
    isLeader,
    gapValue,
    gapLaps,
    intervalValue,
    intervalLaps,
    lastTime,
    lastTimeState,
    lastLapInvalid,
    bestTime,
    hasClassBest,
    avgLast5,
    avgLast10,
    stintPace,
    sector1,
    sector2,
    sector3,
    pitStops,
    stintLaps,
    energy,
    energyIsVirtual,
    tireCompound,
    wheelCompounds,
    tyreLaps,
    tyreTread,
    tyreTitle,
  } = props;

  const tailwindStyles = useMemo(
    () => getTailwindStyle(classColor, highlightColor, isMultiClass),
    [classColor, highlightColor, isMultiClass]
  );
  const displayName = useMemo(
    () => DriverName(extractDriverName(name), nameFormat),
    [name, nameFormat]
  );
  // The shared gap cell takes the pair as one object.
  const gap = useMemo(
    () => ({ value: gapValue, laps: gapLaps }),
    [gapValue, gapLaps]
  );
  const interval = useMemo(
    () => ({ value: intervalValue, laps: intervalLaps }),
    [intervalValue, intervalLaps]
  );

  const cell = (id: TowerColumnId) => {
    switch (id) {
      case 'position':
        return (
          <td
            key={id}
            data-column="position"
            className="px-1 text-center font-bold whitespace-nowrap"
          >
            {position !== undefined && Number.isFinite(position)
              ? position
              : ''}
          </td>
        );
      case 'carNumber':
        return (
          <CarNumberCell
            key={id}
            carNumber={carNumber}
            tailwindStyles={tailwindStyles}
            compactMode={DENSE}
          />
        );
      case 'driver':
        return (
          <td key={id} data-column="driver" className="px-1.5">
            <div className="flex min-w-0 flex-col justify-center">
              <span className="flex min-w-0 items-center gap-1.5">
                <span data-testid="tower-name" className="truncate font-bold">
                  {displayName}
                </span>
                {tag && (
                  <span
                    data-testid="tower-tag"
                    title={TOWER_TAG_TITLES[tag]}
                    className={`shrink-0 rounded-sm px-1 text-[10px] leading-4 font-bold tracking-wider ${TAG_CLASS[tag]}`}
                  >
                    {tag}
                  </span>
                )}
              </span>
              {team !== undefined && (
                <span
                  data-testid="tower-team"
                  className={`truncate text-[11px] leading-tight ${isOwn ? 'text-amber-300/70' : 'text-slate-400'}`}
                >
                  {team}
                </span>
              )}
            </div>
          </td>
        );
      case 'gap':
        return (
          <DeltaCell
            key={id}
            column="gap"
            delta={gap}
            showForUndefined={isLeader ? 'Leader' : undefined}
            decimalPlaces={1}
            compactMode={DENSE}
          />
        );
      case 'interval':
        return (
          <DeltaCell
            key={id}
            column="interval"
            delta={interval}
            decimalPlaces={1}
            compactMode={DENSE}
          />
        );
      case 'lastTime':
        return (
          <LastTimeCell
            key={id}
            lastTimeString={lapTime(lastTime)}
            lastTimeState={lastTimeState}
            invalid={lastLapInvalid && lastTime > 0}
            compactMode={DENSE}
          />
        );
      case 'bestTime':
        return (
          <FastestTimeCell
            key={id}
            fastestTimeString={lapTime(bestTime)}
            hasFastestTime={hasClassBest && bestTime > 0}
            compactMode={DENSE}
          />
        );
      case 'avgLast5':
        return (
          <AvgLapTimeCell
            key={id}
            column="avgLast5"
            avgLapTime={avgLast5}
            timeFormat="full"
            compactMode={DENSE}
          />
        );
      case 'avgLast10':
        return (
          <AvgLapTimeCell
            key={id}
            column="avgLast10"
            avgLapTime={avgLast10}
            timeFormat="full"
            compactMode={DENSE}
          />
        );
      case 'stintPace':
        return <StintPaceCell key={id} delta={stintPace} compactMode={DENSE} />;
      case 'sectors':
        return (
          <SectorMarksCell
            key={id}
            s1={sector1}
            s2={sector2}
            s3={sector3}
            compactMode={DENSE}
          />
        );
      case 'pitStops':
        return (
          <td
            key={id}
            data-column="pitStops"
            className="px-1 text-right whitespace-nowrap"
          >
            {pitStops ?? UNKNOWN}
          </td>
        );
      case 'stintLaps':
        return (
          <td
            key={id}
            data-column="stintLaps"
            className="px-1 text-right whitespace-nowrap"
          >
            {stintLaps ?? UNKNOWN}
          </td>
        );
      case 'energy':
        return (
          <VirtualEnergyCell
            key={id}
            remaining={energy}
            isVirtual={energyIsVirtual}
            compactMode={DENSE}
          />
        );
      case 'tyres':
        return (
          <td
            key={id}
            data-column="tyres"
            title={tyreTitle || undefined}
            className="px-1.5 whitespace-nowrap"
          >
            {/* From the left edge: what is known of the set goes after the
                compound, each figure in a place of its own so that they
                line up down the column. */}
            <div className="flex items-center gap-1.5">
              <span className="flex w-[1.2em] shrink-0 items-center">
                {tireCompound !== undefined && (
                  <Compound
                    tireCompound={tireCompound}
                    wheelCompounds={wheelCompounds}
                  />
                )}
              </span>
              {tyreLaps && (
                <span
                  data-testid="tower-tyre-laps"
                  className="w-[26px] shrink-0 text-right"
                >
                  {tyreLaps}
                </span>
              )}
              {tyreLaps && tyreTread && (
                <span
                  data-testid="tower-tyre-tread"
                  className={`w-[38px] shrink-0 text-right ${isOwn ? 'text-amber-300/70' : 'text-slate-400'}`}
                >
                  {tyreTread}
                </span>
              )}
            </div>
          </td>
        );
    }
  };

  return (
    <tr
      data-car={carIdx}
      data-own={isOwn ? 'true' : undefined}
      className={[
        // Two lines with the team under the name, one without.
        team !== undefined ? 'h-[34px]' : 'h-[26px]',
        'border-b border-slate-800/80',
        isOwn
          ? 'bg-amber-400/15 text-amber-300'
          : 'odd:bg-slate-800/50 even:bg-slate-900/50',
        dimmed && !isOwn ? 'text-white/60' : '',
      ].join(' ')}
    >
      {columns.map(cell)}
    </tr>
  );
}, propsAreEqual);
TowerRow.displayName = 'TowerRow';
