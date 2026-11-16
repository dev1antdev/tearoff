import { useEffect, useMemo, useRef } from 'react';
import {
  useClassTyresSnapshot,
  useDrivingState,
  useRaceForecastSnapshot,
  useSessionDrivers,
  useSessionVisibility,
  useWeekendInfoNumCarClasses,
} from '@irdashies/context';
import {
  TYRE_SET_AT_LEAST_MARK,
  TYRE_SET_LIKELY_MARK,
  hasTreadFigures,
  tyreSetDisplay,
  wheelCompoundsByCar,
} from '@irdashies/domain/classTyres';
import {
  ESTIMATE,
  NO_FIGURE,
  classRivalRows,
  forecastReasonText,
} from '@irdashies/domain/raceForecast';
import { useHighlightColor } from '@irdashies/domain/standings/useHighlightColor';
import { DriverName, extractDriverName } from '../shared/DriverName/DriverName';
import {
  ClassRivalCaptions,
  ClassRivalRow,
  classRivalMinWidth,
  type ClassRivalColumns,
} from './components/ClassRivalRow';
import { useClassRivalsSettings } from './hooks/useClassRivalsSettings';

/**
 * Class Rivals: the running cars of the own entry's class in the order of
 * their places, the own car among them in amber, with the stops each has
 * made, when its last was and its next is due, the tyres it is on and how
 * long it has run on them, the gap once both cars have made the stops they
 * owe, and its mean of five clean laps against ours.
 *
 * Every figure is `race-forecast.snapshot`'s but the tyres, which are
 * `class-tyres.snapshot`'s. The captions stay put and the cars scroll under
 * them, with the own car brought into view when the list first fills.
 */
export const ClassRivals = () => {
  const settings = useClassRivalsSettings();
  const forecast = useRaceForecastSnapshot();
  // Reading it has the race recorded, so it is read only while it shows.
  const classTyres = useClassTyresSnapshot(settings.showTyres);
  const { isDriving, isWatchingOwnCar } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);
  const drivers = useSessionDrivers();
  const isMultiClass = (useWeekendInfoNumCarClasses() ?? 0) > 1;
  const highlightColor = useHighlightColor();
  const list = useRef<HTMLDivElement>(null);
  const ownRow = useRef<HTMLDivElement>(null);

  const rows = useMemo(
    () =>
      forecast?.valid
        ? classRivalRows(forecast, {
            carsAhead: settings.carsAhead,
            carsBehind: settings.carsBehind,
          })
        : [],
    [forecast, settings.carsAhead, settings.carsBehind]
  );
  // The tread is left out where no car has one, which is where the sim
  // reads no tread to work one out from: under iRacing, always.
  const showTread = hasTreadFigures(classTyres);
  const compounds = useMemo(
    () => wheelCompoundsByCar(classTyres),
    [classTyres]
  );
  const columns = useMemo<ClassRivalColumns>(
    () => ({
      stops: settings.showStops,
      tyres: settings.showTyres,
      tread: showTread,
      nextStop: settings.showNextStop,
      netGap: settings.showNetGap,
      pace: settings.showPace,
    }),
    [
      settings.showStops,
      settings.showTyres,
      showTread,
      settings.showNextStop,
      settings.showNetGap,
      settings.showPace,
    ]
  );

  // Once, when the list first has the own car in it: after that the list is
  // the user's to scroll. Only the list itself is moved, and only as far as
  // it takes to show the own car with the car behind it under it; a class
  // that fits is left where it is.
  const hasRows = rows.length > 0;
  useEffect(() => {
    const box = list.current;
    const row = ownRow.current;
    if (!hasRows || !box || !row) return;
    const below = row.offsetTop + row.offsetHeight * 2 - box.clientHeight;
    if (below > box.scrollTop) box.scrollTop = below;
  }, [hasRows]);

  if (!isSessionVisible) return <></>;
  if (settings.showOnlyWhenOnTrack && !(isDriving || isWatchingOwnCar)) {
    return <></>;
  }

  return (
    <div
      data-testid="class-rivals"
      data-valid={hasRows}
      className="flex h-full w-full flex-col overflow-hidden rounded bg-slate-800/(--bg-opacity) text-[0.8125rem] text-slate-200 tabular-nums"
      style={{
        ['--bg-opacity' as string]: `${settings.background.opacity}%`,
      }}
    >
      {hasRows ? (
        <>
          <div
            ref={list}
            data-testid="class-rivals-rows"
            // Positioned, so a row's offset is measured from the list.
            className="relative min-h-0 flex-1 overflow-auto"
          >
            <div style={{ minWidth: classRivalMinWidth(columns) }}>
              <ClassRivalCaptions columns={columns} />
              {rows.map((row) => {
                const { car } = row;
                const driver = drivers?.find(
                  (entry) => entry.CarIdx === car.carIdx
                );
                const tyres = tyreSetDisplay(classTyres, car.carIdx);
                const wheels = compounds[car.carIdx];
                return (
                  <ClassRivalRow
                    key={car.carIdx}
                    rowRef={car.own ? ownRow : undefined}
                    carIdx={car.carIdx}
                    own={car.own}
                    classPosition={car.classPosition}
                    number={String(driver?.CarNumber ?? '')}
                    name={
                      driver?.UserName
                        ? DriverName(
                            extractDriverName(driver.UserName),
                            'n.-surname'
                          )
                        : ''
                    }
                    classColor={driver?.CarClassColor}
                    highlightColor={highlightColor}
                    isMultiClass={isMultiClass}
                    gap={row.gap}
                    stops={row.stops}
                    lastStop={row.lastStop}
                    since={row.since}
                    nextStop={row.nextStop}
                    assumed={row.assumed}
                    netGap={
                      // A gap made from assumed stops is an estimate too.
                      row.assumed && row.netGap.text !== NO_FIGURE
                        ? `${ESTIMATE}${row.netGap.text}`
                        : row.netGap.text
                    }
                    netGapTone={row.netGap.tone}
                    pace={row.pace.text}
                    paceTone={row.pace.tone}
                    tyreCompounds={
                      wheels?.some((wheel) => wheel >= 0)
                        ? wheels.join(',')
                        : ''
                    }
                    tyreLaps={tyres.laps}
                    tyreTread={tyres.tread}
                    tyreTitle={tyres.title}
                    showStops={settings.showStops}
                    showTyres={settings.showTyres}
                    showTread={showTread}
                    showNextStop={settings.showNextStop}
                    showNetGap={settings.showNetGap}
                    showPace={settings.showPace}
                  />
                );
              })}
            </div>
          </div>
          {settings.showLegend && (
            <p
              data-testid="class-rivals-legend"
              className="flex-none px-3 py-1.5 text-[0.6875rem] leading-snug text-slate-400"
            >
              {[
                settings.showNetGap &&
                  'Net gap: the gap once both cars have made the stops they still owe.',
                settings.showPace &&
                  'Pace 5: their mean of five clean laps against ours; green means we are faster.',
                settings.showTyres &&
                  `Tyres: laps on the set, with ${TYRE_SET_LIKELY_MARK} when told from the length of a stop and ${TYRE_SET_AT_LEAST_MARK} when it is at least that many${
                    showTread
                      ? '; the tread is our own wear applied to their laps.'
                      : '.'
                  }`,
                `${ESTIMATE} marks an estimate.`,
              ]
                .filter(Boolean)
                .join(' ')}
            </p>
          )}
        </>
      ) : (
        <p
          data-testid="class-rivals-reason"
          className="flex min-h-0 flex-1 items-center justify-center p-3 text-center text-xs text-slate-400"
        >
          {forecast?.valid
            ? 'No other car of the class is running.'
            : forecastReasonText(forecast?.reason)}
        </p>
      )}
    </div>
  );
};
