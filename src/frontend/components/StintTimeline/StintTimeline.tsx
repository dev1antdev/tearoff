import { useMemo } from 'react';
import {
  useDrivingState,
  useRaceForecastSnapshot,
  useSessionDrivers,
  useSessionVisibility,
} from '@irdashies/context';
import {
  forecastReasonText,
  timelineCars,
  timelineModel,
} from '@irdashies/domain/raceForecast';
import { useRaceStints } from '@irdashies/domain/raceHistory';
import {
  TIMELINE_BAR_PX,
  TIMELINE_ROW_GAP_PX,
  TimelineChart,
} from './components/TimelineChart';
import { useStintTimelineSettings } from './hooks/useStintTimelineSettings';

const NO_CARS: number[] = [];

/**
 * Stint Timeline: the own car and a few class rivals as bars from the start
 * of the race to the flag. The stints each has driven are filled, from the
 * race history's records; the stints to come are dashed, laid out from the
 * forecast's next stop, stint length and stops owed; a white line is now.
 * The own car's bars are coloured and named by driver, a stint to come in
 * no driver's colour; a rival's change shade at each driver change.
 *
 * The scale is the session clock for a race with one, and laps for a race
 * run to a lap count alone.
 */
export const StintTimeline = () => {
  const settings = useStintTimelineSettings();
  const forecast = useRaceForecastSnapshot();
  const { isDriving, isWatchingOwnCar } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);
  const drivers = useSessionDrivers();

  // The cars drawn, as a string: the forecast is a new object every second
  // and almost always names the same cars.
  const carKey = forecast?.valid
    ? timelineCars(forecast.cars, settings.rivals)
        .map((car) => car.carIdx)
        .join(',')
    : '';
  const carIdxs = useMemo(
    () => (carKey ? carKey.split(',').map(Number) : NO_CARS),
    [carKey]
  );
  const stints = useRaceStints(carIdxs);
  const model = useMemo(
    () => timelineModel(forecast, stints, settings.rivals),
    [forecast, stints, settings.rivals]
  );

  if (!isSessionVisible) return <></>;
  if (settings.showOnlyWhenOnTrack && !(isDriving || isWatchingOwnCar)) {
    return <></>;
  }

  return (
    <div
      data-testid="stint-timeline"
      data-valid={model !== null}
      className="flex h-full w-full flex-col overflow-y-auto overlay-panel p-3 text-sm text-slate-200 tabular-nums"
      style={{
        ['--bg-opacity' as string]: `${settings.background.opacity}%`,
      }}
    >
      {model ? (
        <>
          <div className="grid flex-none grid-cols-[2.75rem_minmax(0,1fr)] gap-x-2">
            <div
              className="flex flex-col pt-1"
              style={{ rowGap: TIMELINE_ROW_GAP_PX }}
            >
              {model.rows.map((row) => (
                <span
                  key={row.carIdx}
                  data-testid="stint-timeline-car"
                  data-own={row.own}
                  className={`flex items-center font-bold leading-none ${
                    row.own ? 'text-amber-300' : 'text-white'
                  }`}
                  style={{ height: TIMELINE_BAR_PX }}
                >
                  #
                  {drivers?.find((driver) => driver.CarIdx === row.carIdx)
                    ?.CarNumber ?? row.carIdx}
                </span>
              ))}
            </div>
            <TimelineChart
              axis={model.axis}
              rows={model.rows}
              showDrivers={settings.showDrivers}
            />
          </div>
          {settings.showLegend && (
            <p
              data-testid="stint-timeline-legend"
              className="mt-2 flex-none text-xs leading-snug text-slate-400"
            >
              Filled: driven. Dashed: forecast from each car’s next stop and
              stint length; none where that is not known. White line: now.
              Rivals change shade at each driver change.
            </p>
          )}
        </>
      ) : (
        <p
          data-testid="stint-timeline-reason"
          className="flex min-h-0 flex-1 items-center justify-center text-center text-sm text-slate-400"
        >
          {forecast?.valid
            ? 'Waiting for the end of the race to be known.'
            : forecastReasonText(forecast?.reason)}
        </p>
      )}
    </div>
  );
};
