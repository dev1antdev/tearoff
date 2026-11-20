/**
 * Main Lap Time Log Component
 * Displays a widget showing the current lap, last lap, and best lap times
 */
import React, { useMemo } from 'react';
import {
  useFocusCarIdx,
  useDrivingState,
  useSessionVisibility,
  useDashboard,
  useGeneralSettings,
} from '@irdashies/context';
import { useLapTimeLog } from './hooks/useLapTimeLog';
import { getDemoLapTimeLogData, LapEntry } from './demoData';
import {
  TimerIcon,
  TargetIcon,
  UserSwitchIcon,
  XIcon,
} from '@phosphor-icons/react';
import {
  DELTA_CELL_CLASS,
  FUEL_CELL_CLASS,
  LapTimeRow,
  TIME_CELL_CLASS,
  WEAR_CELL_CLASS,
} from './components/LapTimeRow';
import { LapHistoryChart } from './components/LapHistoryChart';
import type { LapTimeLogConfig } from '@irdashies/types';
import { formatTime, formatDelta } from '@irdashies/utils/time';
import { LapTimeCell } from './components/LapTimeCell';
import { visibleLapEntries, type LiveLapEntry } from '@irdashies/domain/ledger';
import {
  formatFigure,
  formatShare,
  fuelInUnits,
} from '@irdashies/domain/ledger/ledgerFigures';

const FREEZE_TIME = 5;
/** A lap wore this many times the usual of the rows shown: drawn amber. */
const HIGH_WEAR_RATIO = 1.5;

interface LapTimeLogProps {
  /** A copy hosted in another window: it never writes a personal best. */
  embedded?: boolean;
}

export const LapTimeLog = ({ embedded = false }: LapTimeLogProps) => {
  const { isDemoMode } = useDashboard();
  const { isDriving, isWatchingOwnCar } = useDrivingState();
  // The lap being timed is live for the user's own car, whoever drives it:
  // the user, or a team-mate while the user watches that car.
  const isLapLive = isDriving || isWatchingOwnCar;
  const playerIndex = useFocusCarIdx();
  const data = useLapTimeLog({ recordPersonalBest: !embedded });
  const isSessionVisible = useSessionVisibility(
    data.settings?.sessionVisibility
  );

  // session visible?
  if (!data.settings || playerIndex === undefined || !isSessionVisible) {
    return null;
  }

  // Show only when on track setting
  if (data.settings?.showOnlyWhenOnTrack && !isLapLive) {
    return null;
  }

  // demo mode
  if (isDemoMode) {
    const demoData = getDemoLapTimeLogData();
    return (
      <LapTimeLogDisplay
        settings={data.settings}
        current={demoData.current}
        lastlap={demoData.lastlap}
        bestlap={demoData.bestlap}
        alltimelap={demoData.alltimelap}
        reference={demoData.reference}
        delta={demoData.delta}
        overall={demoData.overall}
        dirty={demoData.dirty}
        history={demoData.history}
        currentRow={demoData.currentRow}
      />
    );
  }

  return (
    <LapTimeLogDisplay
      settings={data.settings}
      current={isLapLive ? data.current : undefined}
      lastlap={data.lastlap}
      bestlap={data.bestlap}
      alltimelap={data.alltimelap}
      reference={data.reference}
      delta={data.delta}
      overall={data.overall}
      dirty={data.dirty}
      history={data.history}
      // The history is the laps the user drove. The lap a team-mate is on is
      // timed above and is no row of it, so the list stands still meanwhile.
      currentRow={isDriving ? data.currentRow : undefined}
      teamMateDriving={isWatchingOwnCar}
    />
  );
};

/** One number for the rows shown: half of them wore more, half less. */
const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

export const LapTimeLogDisplay = ({
  settings,
  current,
  lastlap,
  bestlap,
  alltimelap,
  reference,
  delta,
  overall,
  dirty,
  history,
  currentRow,
  teamMateDriving,
}: {
  settings: LapTimeLogConfig;
  current?: number;
  lastlap?: number;
  bestlap?: number;
  alltimelap?: number;
  reference?: number;
  delta?: number;
  overall?: number;
  dirty?: boolean;
  history?: LapEntry[];
  /** The lap under way, for the row that leads the list. */
  currentRow?: LiveLapEntry;
  /** A team-mate has the car: the history is the user's laps so far. */
  teamMateDriving?: boolean;
}) => {
  // sort laps
  const sortedHistory = useMemo(() => {
    if (!history) return [];
    // Filtered before the slice, so hiding laps still shows the configured
    // number of laps rather than silently shortening the list.
    return visibleLapEntries(history, settings.history);
  }, [history, settings.history]);

  // predicted lap time
  const predicted =
    reference !== undefined && delta !== undefined
      ? reference + delta
      : undefined;

  // predicted delta
  const hasPredictedDelta =
    current !== undefined &&
    current > FREEZE_TIME &&
    predicted !== undefined &&
    predicted > 0 &&
    delta !== undefined;
  const deltaIsGreen = hasPredictedDelta && delta < 0;
  const deltaIsRed = hasPredictedDelta && delta > 0;

  // for the flash
  let bgColor = 'bg-slate-900/[var(--fg-alpha)]';
  if (current !== undefined && current <= FREEZE_TIME) {
    const isMatchingLap = (value?: number) =>
      lastlap !== undefined &&
      lastlap > 0 &&
      value !== undefined &&
      value > 0 &&
      Math.abs(lastlap - value) < 0.001;
    const isSessionBest = isMatchingLap(bestlap);
    const isOverallBest = isMatchingLap(overall);
    const isPersonalBest = isMatchingLap(alltimelap);
    bgColor = 'bg-slate-900';
    if (isSessionBest) bgColor = 'bg-green-700';
    if (isOverallBest) bgColor = 'bg-purple-800';
    if (isPersonalBest) bgColor = 'bg-yellow-600';
  }

  const generalSettings = useGeneralSettings();
  const isCompact =
    generalSettings?.compactMode === 'compact' ||
    generalSettings?.compactMode === 'ultra';
  const isUltra = generalSettings?.compactMode === 'ultra';

  // wdiget alignment
  const alignment =
    settings.alignment === 'bottom' ? 'items-end' : 'items-start';
  const reverse = settings.reverse ? 'flex-col-reverse' : 'flex-col';

  // The optional cells of a history row. Marks are on unless switched off,
  // so a config saved before they existed gets them.
  const {
    showStintLap = false,
    showFuel = false,
    showWear = false,
    showFlags = true,
    showCurrentRow = false,
  } = settings.history;
  const fuelUnits = settings.fuelUnits ?? 'L';
  // With what a lap cost beside it, the list is a table of set columns.
  const tabular = showFuel || showWear;
  // The lap under way leads the list, and is a row of it like any other.
  const liveRow = showCurrentRow ? currentRow : undefined;
  const rows: (LapEntry | LiveLapEntry)[] = liveRow
    ? [liveRow, ...sortedHistory]
    : sortedHistory;
  // A car on virtual energy is counted in percent of it, any other in fuel.
  const onEnergy = rows.some((row) => typeof row.energyUsed === 'number');
  const fuelText = (row: LapEntry | LiveLapEntry) =>
    typeof row.energyUsed === 'number'
      ? formatShare(row.energyUsed, 2)
      : formatFigure(
          typeof row.fuelUsed === 'number'
            ? fuelInUnits(row.fuelUsed, fuelUnits)
            : null,
          2
        );
  const usualWear = median(
    sortedHistory
      .map((entry) => entry.wear)
      .filter((wear): wear is number => typeof wear === 'number')
  );
  // In reverse order the older lap is drawn above the newer one.
  const olderSide = settings.reverse ? 'top' : 'bottom';

  return (
    <div className={`h-full flex ${alignment}`}>
      <div
        className={`w-full text-sm overlay-panel text-white ${!isCompact ? 'p-2' : 'p-0.5'}`}
        style={
          {
            '--bg-opacity': `${settings.background.opacity}%`,
          } as React.CSSProperties
        }
      >
        <div
          className={`w-full flex gap-0.5 ${reverse}`}
          style={{ fontSize: `${settings.scale}%` } as React.CSSProperties}
        >
          {/* Current Lap Timer (The Big One) */}
          {settings.showCurrentLap && (
            <div
              id="current-lap"
              className={`text-[1.8em] min-h-[2em] w-full p-1 ${bgColor} flex relative items-center justify-center rounded-md transition-colors duration-500 ease-in-out`}
              style={
                {
                  '--fg-alpha': `${settings.foreground.opacity}%`,
                } as React.CSSProperties
              }
            >
              <div className="absolute left-2">
                <TimerIcon weight="bold" />
              </div>
              <div className="w-full text-center tabular-nums">
                {formatTime(
                  current === undefined
                    ? undefined
                    : current > FREEZE_TIME || (current > 0 && !lastlap)
                      ? current
                      : lastlap
                )}
              </div>
            </div>
          )}

          {/* Predicted (With Delta) */}
          {settings.showPredictedLap && (
            <div
              id="predicted-lap"
              className={`text-[1.3em] min-h-[2em] w-full p-1 ${dirty ? 'text-slate-400' : 'text-white'} bg-slate-900/[var(--fg-alpha)] flex relative items-center justify-center rounded-md`}
              style={
                {
                  '--fg-alpha': `${settings.foreground.opacity / 2}%`,
                } as React.CSSProperties
              }
            >
              <div className="absolute left-3">
                {dirty ? (
                  <XIcon weight="regular" />
                ) : (
                  <TargetIcon weight="regular" />
                )}
              </div>
              <div className="w-full text-center tabular-nums">
                {formatTime(
                  current === undefined
                    ? undefined
                    : current > FREEZE_TIME
                      ? predicted
                      : lastlap
                )}
              </div>
              {settings.delta.enabled && (
                <div
                  className={`absolute right-2 text-[0.8em] text-center tabular-nums ${
                    !dirty && delta && deltaIsGreen
                      ? 'text-green-400'
                      : !dirty && delta && deltaIsRed
                        ? 'text-red-400'
                        : 'text-slate-400'
                  }`}
                >
                  {formatDelta(hasPredictedDelta ? delta : 0)}
                </div>
              )}
            </div>
          )}

          {/* Main Stats */}
          <div className="flex w-full gap-1">
            {settings.showAllTimeLap && (
              <LapTimeCell
                label="PERSONAL"
                time={alltimelap}
                alltime={alltimelap}
                settings={settings}
              />
            )}
            {settings.showBestLap && (
              <LapTimeCell
                label="SESSION"
                time={bestlap}
                best={bestlap}
                overall={overall}
                alltime={alltimelap}
                settings={settings}
              />
            )}
            {settings.showLastLap && (
              <LapTimeCell
                label="LAST LAP"
                time={lastlap}
                best={bestlap}
                overall={overall}
                alltime={alltimelap}
                settings={settings}
              />
            )}
          </div>

          {/* The list stands still while a team-mate drives: say so. */}
          {settings.history.enabled && teamMateDriving && (
            <div
              data-testid="lap-history-note"
              className="flex w-full items-center justify-center gap-[0.4em] py-0.5 text-[0.7em] uppercase leading-none text-slate-400"
            >
              <UserSwitchIcon />
              <span>Team-mate driving · your laps</span>
            </div>
          )}

          {/* History List / Chart */}
          {settings.history.enabled &&
            (settings.history.style === 'chart' ? (
              <LapHistoryChart
                history={sortedHistory}
                best={bestlap}
                overall={overall}
                alltime={alltimelap}
                foregroundOpacity={settings.foreground.opacity}
              />
            ) : (
              <>
                {/* What the extra cells count, once for the whole list. */}
                {(showStintLap || showFuel || showWear) && (
                  <div
                    data-testid="lap-history-header"
                    className={`flex w-full items-center uppercase leading-none text-slate-400 ${!isCompact ? 'px-1' : ''}`}
                  >
                    <div
                      className={`flex w-full items-center ${isUltra ? 'px-1' : 'px-2'}`}
                    >
                      <span className="flex-1 whitespace-nowrap text-[0.6em]">
                        {showStintLap ? 'Lap · Stint' : 'Lap'}
                      </span>
                      {showFuel && (
                        <span className={FUEL_CELL_CLASS}>
                          <span className="whitespace-nowrap text-[0.6em]">
                            {onEnergy ? 'NRG %' : `Fuel ${fuelUnits}`}
                          </span>
                        </span>
                      )}
                      {showWear && (
                        <span className={WEAR_CELL_CLASS}>
                          <span className="whitespace-nowrap text-[0.6em]">
                            Wear
                          </span>
                        </span>
                      )}
                      {settings.delta.enabled && (
                        <span
                          className={
                            tabular ? DELTA_CELL_CLASS : 'flex-1 text-center'
                          }
                        >
                          <span className="text-[0.6em]">Delta</span>
                        </span>
                      )}
                      <span
                        className={
                          tabular ? TIME_CELL_CLASS : 'flex-1 text-right'
                        }
                      >
                        <span className="text-[0.6em]">Time</span>
                      </span>
                    </div>
                  </div>
                )}
                {rows.map((row, index) => {
                  const live = row === liveRow;
                  const older = rows[index + 1];
                  const time = 'time' in row ? row.time : current;
                  return (
                    <LapTimeRow
                      key={live ? 'live' : row.lap} // Critical for React performance
                      label={`LAP ${row.lap ?? '--'}`}
                      time={time}
                      delta={
                        'time' in row
                          ? row.delta
                          : hasPredictedDelta
                            ? delta
                            : 0
                      }
                      dirty={row.dirty}
                      best={live ? undefined : bestlap}
                      overall={live ? undefined : overall}
                      alltime={live ? undefined : alltimelap}
                      settings={settings}
                      live={live}
                      tabular={tabular}
                      stintLap={
                        showStintLap && row.stintLap ? `S${row.stintLap}` : ''
                      }
                      fuel={showFuel ? fuelText(row) : undefined}
                      wear={showWear ? formatShare(row.wear, 1) : undefined}
                      wearHigh={
                        !live &&
                        typeof row.wear === 'number' &&
                        usualWear !== null &&
                        row.wear > usualWear * HIGH_WEAR_RATIO
                      }
                      pitted={showFlags && row.pitted}
                      voided={showFlags && row.dirty}
                      yellow={showFlags && row.yellow}
                      caution={showFlags && row.caution}
                      wet={showFlags && row.wet}
                      fromStart={showFlags && row.fromStart}
                      stintEdge={
                        older !== undefined &&
                        row.stintId !== undefined &&
                        older.stintId !== undefined &&
                        row.stintId !== older.stintId
                          ? olderSide
                          : undefined
                      }
                    />
                  );
                })}
              </>
            ))}
        </div>
      </div>
    </div>
  );
};
