import { useMemo, type ReactNode } from 'react';
import {
  DiscIcon,
  FlagCheckeredIcon,
  GarageIcon,
  GasPumpIcon,
  LightningIcon,
  TireIcon,
  UserSwitchIcon,
} from '@phosphor-icons/react';
import {
  useDashboard,
  useDrivingState,
  usePlayerLedgerSnapshot,
  usePlayerStintSnapshot,
  useSessionVisibility,
} from '@irdashies/context';
import type { FuelBudget, StintHistoryConfig } from '@irdashies/types';
import { stintRows, type StintRow } from '@irdashies/domain/ledger';
import { NO_READING } from '@irdashies/domain/ledger/ledgerFigures';
import { Compound } from '../shared/Compound/Compound';
import { useStintHistorySettings } from './hooks/useStintHistorySettings';
import { DEMO_STINT_HISTORY } from './demoData';

const WEAR_TONE_CLASS: Record<StintRow['wearTone'], string> = {
  none: '',
  caution: 'text-amber-300',
  bad: 'text-red-400',
};

/** A column of the table: its caption, and what it draws of a stint. */
interface Column {
  id: string;
  caption: ReactNode;
  /** How the cell sits in its column. */
  align: 'text-left' | 'text-right' | 'justify-self-center';
  cell: (row: StintRow) => ReactNode;
}

/** The second line of a cell: a figure that explains the one above it. */
const Below = ({ children }: { children: ReactNode }) => (
  <div className="text-[0.75em] font-normal leading-none text-slate-400">
    {children}
  </div>
);

/** The stop that ended a stint, or how else it ended. */
const StopCell = ({ row }: { row: StintRow }) => {
  if (row.end === 'garage') {
    return <GarageIcon data-end="garage" className="text-slate-300" />;
  }
  if (row.end === 'session') {
    return <FlagCheckeredIcon data-end="session" className="text-slate-300" />;
  }
  if (row.end === 'driver') {
    return <UserSwitchIcon data-end="driver" className="text-slate-300" />;
  }
  if (row.end !== 'service') return <>{row.current ? '' : NO_READING}</>;
  const Refill = row.budget === 'virtualEnergy' ? LightningIcon : GasPumpIcon;
  return (
    <span className="flex items-center gap-[0.35em]">
      <span>{row.stopTime}</span>
      <span className="flex items-center gap-[0.25em] text-[0.9em] font-normal text-slate-300">
        {row.added && (
          <span className="flex items-center gap-[0.1em]">
            <Refill data-did="refill" />
            <span className="text-[0.85em]">{row.added}</span>
          </span>
        )}
        {row.tyresChanged && <TireIcon data-did="tyres" />}
        {row.brakesChanged && <DiscIcon data-did="brakes" />}
        {row.driverChanged && <UserSwitchIcon data-did="driver" />}
      </span>
    </span>
  );
};

/** The columns switched on, in the order they are drawn. */
const columnsOf = (
  settings: StintHistoryConfig,
  budget: FuelBudget
): Column[] => {
  const energy = budget === 'virtualEnergy';
  const Budget = energy ? LightningIcon : GasPumpIcon;
  const columns: (Column | false)[] = [
    {
      id: 'ordinal',
      caption: '#',
      align: 'text-left',
      cell: (row) => (
        <span className="whitespace-nowrap">
          {row.ordinal}
          {settings.showDriver && row.driver && (
            <span className="ml-[0.4em] text-[0.85em] font-normal text-slate-400">
              {row.driver}
            </span>
          )}
        </span>
      ),
    },
    settings.showLaps && {
      id: 'laps',
      caption: 'Laps',
      align: 'text-right',
      cell: (row) => row.laps,
    },
    settings.showTime && {
      id: 'time',
      caption: 'Time',
      align: 'text-right',
      cell: (row) => row.time,
    },
    settings.showFuel && {
      id: 'fuel',
      caption: (
        <span className="inline-flex items-center gap-[0.2em]">
          <Budget />
          {energy ? 'NRG' : 'Fuel'}
        </span>
      ),
      align: 'text-right',
      cell: (row) => (
        <>
          <div>{row.used}</div>
          {settings.showFuelPerLap && <Below>{row.usedPerLap}</Below>}
        </>
      ),
    },
    settings.showTyres && {
      id: 'tyres',
      caption: 'Tyre',
      align: 'justify-self-center',
      cell: (row) =>
        row.compounds.some((name) => name !== null) ? (
          <span className="flex items-center">
            <Compound tireCompound={-1} compoundNames={row.compounds} />
          </span>
        ) : (
          NO_READING
        ),
    },
    settings.showWear && {
      id: 'wear',
      caption: 'Wear',
      align: 'text-right',
      cell: (row) => (
        <span className={WEAR_TONE_CLASS[row.wearTone]}>{row.wear}</span>
      ),
    },
    settings.showBrakes && {
      id: 'brakes',
      caption: 'Brk',
      align: 'text-right',
      cell: (row) => row.brakes,
    },
    settings.showPace && {
      id: 'best',
      caption: 'Best',
      align: 'text-right',
      cell: (row) => (
        <>
          <div className={row.sessionBest ? 'text-purple-400' : ''}>
            {row.best}
          </div>
          {settings.showConsistency && (
            <Below>
              {row.consistency === NO_READING
                ? NO_READING
                : `${row.consistency}%`}
            </Below>
          )}
        </>
      ),
    },
    settings.showStop && {
      id: 'stop',
      caption: 'Stop',
      align: 'text-left',
      cell: (row) => <StopCell row={row} />,
    },
  ];
  return columns.filter((column): column is Column => column !== false);
};

interface StintHistoryDisplayProps {
  settings: StintHistoryConfig;
  /** The stints, in the order they are drawn. */
  rows: readonly StintRow[];
  /** What the car runs on, for the caption while there is no stint. */
  budget?: FuelBudget;
  /** A team-mate has the car: the rows are the user's stints so far. */
  teamMateDriving?: boolean;
}

/**
 * The table: a header of captions, the stint under way, and the finished
 * ones. One grid for all of it, so a column is as wide as its widest cell
 * in any row.
 */
export const StintHistoryDisplay = ({
  settings,
  rows,
  budget,
  teamMateDriving = false,
}: StintHistoryDisplayProps) => {
  const columns = columnsOf(settings, rows[0]?.budget ?? budget ?? 'fuel');
  // Finished stints alternate between two shades, wherever the stint under
  // way sits among them.
  const finished = rows.filter((row) => !row.current);

  return (
    <div
      className="h-full w-full overflow-hidden rounded bg-slate-800/(--bg-opacity) p-2 text-sm text-white"
      style={{
        ['--bg-opacity' as string]: `${settings.background.opacity}%`,
      }}
    >
      <div
        className="grid w-full justify-between gap-x-[0.7em] whitespace-nowrap tabular-nums leading-tight"
        style={{ gridTemplateColumns: `repeat(${columns.length}, auto)` }}
      >
        <div
          data-testid="stint-header"
          className="col-span-full grid grid-cols-subgrid items-end px-1 pb-0.5 text-[0.75em] uppercase leading-none text-slate-400"
        >
          {columns.map((column) => (
            <div key={column.id} className={column.align}>
              {column.caption}
            </div>
          ))}
        </div>
        {teamMateDriving && (
          <div
            data-testid="stint-note"
            className="col-span-full flex items-center gap-[0.4em] rounded-sm bg-slate-700/50 px-1 py-0.5 text-[0.8em] uppercase text-slate-300"
          >
            <UserSwitchIcon />
            <span>Team-mate driving · your stints</span>
          </div>
        )}
        {rows.map((row) => {
          const shade = row.current
            ? 'bg-slate-700/50 font-bold'
            : `text-slate-300 ${finished.indexOf(row) % 2 === 0 ? 'bg-slate-800/70' : 'bg-slate-900/70'}`;
          return (
            <div
              key={row.id}
              data-testid="stint-row"
              data-current={row.current}
              className={`col-span-full grid grid-cols-subgrid items-center rounded-sm px-1 py-0.5 ${shade}`}
            >
              {columns.map((column) => (
                <div key={column.id} className={column.align}>
                  {column.cell(row)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/**
 * Stint history: the stint the user is driving and the ones before it, one
 * row each, from the ledger the main process keeps of every lap and stint.
 *
 * The stints listed are the user's own. With a team-mate at the wheel the
 * widget stays up and says so: the rows are what the user drove, and none
 * of them grows. With the camera on another car it hides, as the figures
 * are not that car's.
 */
export const StintHistory = () => {
  const settings = useStintHistorySettings();
  const { isDemoMode } = useDashboard();
  const { isDriving, isWatchingOwnCar, isWatchingOtherCar } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);
  const visible =
    isSessionVisible &&
    !isWatchingOtherCar &&
    (!settings.showOnlyWhenOnTrack || isDriving || isWatchingOwnCar);
  // Demo mode draws its own sample; nothing is asked of the ledger then.
  const reads = visible && !isDemoMode;
  const ledger = usePlayerLedgerSnapshot(reads);
  const live = usePlayerStintSnapshot(reads);

  const rows = useMemo(
    () =>
      isDemoMode
        ? stintRows(
            DEMO_STINT_HISTORY.ledger,
            DEMO_STINT_HISTORY.live,
            settings
          )
        : stintRows(ledger, live, settings),
    [isDemoMode, ledger, live, settings]
  );

  if (!visible) return <></>;

  return (
    <StintHistoryDisplay
      settings={settings}
      rows={rows}
      budget={isDemoMode ? DEMO_STINT_HISTORY.live.budget : live?.budget}
      teamMateDriving={!isDemoMode && isWatchingOwnCar}
    />
  );
};
