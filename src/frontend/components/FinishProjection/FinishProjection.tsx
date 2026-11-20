import { useMemo } from 'react';
import { FlagCheckeredIcon, IconContext } from '@phosphor-icons/react';
import { OVERLAY_ICONS } from '@irdashies/utils/overlayIcons';
import {
  useDrivingState,
  useFinishProjectionSnapshot,
  useSessionDrivers,
  useSessionVisibility,
  useWeekendInfoNumCarClasses,
} from '@irdashies/context';
import {
  finishReasonText,
  finishRivalRows,
  formatRivalGap,
  projectFinish,
  raceLengthText,
  refuelUnit,
  type FinishRivalRow as RivalRow,
} from '@irdashies/domain/finishProjection';
import { useHighlightColor } from '@irdashies/domain/standings/useHighlightColor';
import { DriverName, extractDriverName } from '../shared/DriverName/DriverName';
import { FinishRivalRow, FinishRivalsCaption } from './components/FinishRivals';
import { FinishTable } from './components/FinishTable';
import { useFinishProjectionSettings } from './hooks/useFinishProjectionSettings';

/**
 * Where the race ends, and what that asks of the car: for no stop and for
 * a set of stop lengths, how long after the clock the leader takes the
 * flag, the laps the player still has to cover and what has to go in for
 * them; and under it the class cars around the player, with the gap to
 * each once everyone has made the stops they still owe.
 *
 * Every figure comes from `finish-projection.snapshot`; the columns are a
 * setting, so they are worked out here by `@irdashies/domain/finishProjection`.
 * A finish that hangs on a few seconds is drawn in amber with an arrow for
 * which way it would go.
 *
 * It is about the user's own entry, so it stays up while a team-mate
 * drives the car and goes when the camera is on another one.
 */
export const FinishProjection = () => {
  const settings = useFinishProjectionSettings();
  const snapshot = useFinishProjectionSnapshot();
  const { isDriving, isWatchingOwnCar, isWatchingOtherCar } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);
  const drivers = useSessionDrivers();
  const isMultiClass = (useWeekendInfoNumCarClasses() ?? 0) > 1;
  const highlightColor = useHighlightColor();

  const projection = useMemo(
    () =>
      projectFinish(snapshot, {
        scenarios: settings.scenarios,
        leaderStops: settings.leaderStops,
        showPlanned: settings.showPlanned,
        showToFinish: settings.showToFinish,
        showLast: settings.showLast,
        extraTimeS: settings.extraTime,
        nearRangeS: settings.nearRange,
        extraLaps: settings.extraLaps,
      }),
    [
      snapshot,
      settings.scenarios,
      settings.leaderStops,
      settings.showPlanned,
      settings.showToFinish,
      settings.showLast,
      settings.extraTime,
      settings.nearRange,
      settings.extraLaps,
    ]
  );
  const rivals = useMemo(
    () =>
      finishRivalRows(snapshot, {
        rivalsAhead: settings.rivalsAhead,
        rivalsBehind: settings.rivalsBehind,
        extraTimeS: settings.extraTime,
        includePace: settings.includePace,
      }),
    [
      snapshot,
      settings.rivalsAhead,
      settings.rivalsBehind,
      settings.extraTime,
      settings.includePace,
    ]
  );

  if (!isSessionVisible) return <></>;
  // The figures are the own entry's whatever the camera is on, and with the
  // camera on a rival they are not what is on screen.
  if (isWatchingOtherCar) return <></>;
  if (settings.showOnlyWhenOnTrack && !(isDriving || isWatchingOwnCar)) {
    return <></>;
  }

  const hasTable = snapshot?.valid === true && projection.columns.length > 0;
  const length = hasTable ? raceLengthText(snapshot) : null;
  const hasRivals =
    hasTable &&
    settings.showRivals &&
    rivals.ahead.length + rivals.behind.length > 0;

  const rivalRow = ({ rival, projectedS, outcome }: RivalRow) => {
    const driver = drivers?.find((entry) => entry.CarIdx === rival.carIdx);
    return (
      <FinishRivalRow
        key={rival.carIdx}
        carIdx={rival.carIdx}
        classPosition={rival.classPosition}
        number={String(driver?.CarNumber ?? '')}
        name={
          driver?.UserName
            ? DriverName(extractDriverName(driver.UserName), 'n.-surname')
            : ''
        }
        classColor={driver?.CarClassColor}
        highlightColor={highlightColor}
        isMultiClass={isMultiClass}
        inPit={rival.inPit}
        gap={formatRivalGap(rival.gapS)}
        rivalStops={rival.stopsOwed}
        playerStops={snapshot?.playerStopsOwed ?? null}
        projected={formatRivalGap(projectedS)}
        outcome={outcome}
        assumed={rival.basis === 'assumed'}
      />
    );
  };

  return (
    <IconContext.Provider value={OVERLAY_ICONS}>
      <div
        data-testid="finish-projection"
        data-valid={hasTable}
        className="flex h-full w-full flex-col gap-1.5 overflow-hidden overlay-panel p-2 leading-none text-white tabular-nums"
        style={{
          ['--bg-opacity' as string]: `${settings.background.opacity}%`,
        }}
      >
        <div className="flex flex-none items-center justify-between gap-2 text-xs">
          <div className="flex min-w-0 items-center gap-1 overlay-label text-xs">
            <FlagCheckeredIcon size="1.2em" aria-hidden />
            <span className="truncate">{length ? length.label : 'Finish'}</span>
            {length && (
              <span
                data-testid="finish-projection-length"
                className="font-bold normal-case tracking-normal text-slate-200"
              >
                {length.value}
              </span>
            )}
          </div>
          {hasTable && projection.lapLostPerLap !== null && (
            <div
              data-testid="finish-projection-lap-lost"
              className="flex-none text-slate-400"
            >
              Loses{' '}
              <span className="font-bold text-slate-200">
                {projection.lapLostPerLap.toFixed(2)}
              </span>{' '}
              lap/lap
            </div>
          )}
        </div>

        {hasTable ? (
          <FinishTable
            columns={projection.columns}
            unit={
              snapshot.energy
                ? refuelUnit(
                    snapshot.energy.isVirtualEnergy,
                    settings.fuelUnits
                  )
                : null
            }
            refuelDisplay={settings.refuelDisplay}
            showExtraRefuel={settings.showExtraRefuel}
            extraLaps={settings.extraLaps}
            showLapFractions={settings.showLapFractions}
          />
        ) : (
          <div
            data-testid="finish-projection-reason"
            className="flex min-h-0 flex-1 items-center justify-center text-xs text-slate-400 opacity-60"
          >
            {finishReasonText(snapshot?.reason)}
          </div>
        )}

        {hasRivals && (
          <div
            data-testid="finish-rivals"
            // A hairline between the rows, none either side of the player's
            // place, which is its own line.
            className="flex flex-none flex-col gap-0.5 border-t overlay-divider pt-1.5 overlay-rules-y [--rule-gap:0.125rem] [&>[data-testid=finish-rivals-player]]:before:hidden [&>[data-testid=finish-rivals-player]+*]:before:hidden"
          >
            <FinishRivalsCaption />
            {rivals.ahead.map(rivalRow)}
            {rivals.ahead.length > 0 && rivals.behind.length > 0 && (
              // Where the player is in the class order.
              <div
                data-testid="finish-rivals-player"
                className="h-px bg-amber-300/50"
              />
            )}
            {rivals.behind.map(rivalRow)}
          </div>
        )}
      </div>
    </IconContext.Provider>
  );
};
