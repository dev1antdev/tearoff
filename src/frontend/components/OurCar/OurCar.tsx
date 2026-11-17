import { useCallback, useMemo, type ReactNode } from 'react';
import { shallow } from 'zustand/shallow';
import {
  trackStateSelectors,
  useChannelSelector,
  useDamageSnapshot,
  useDrivingState,
  useRaceForecastSnapshot,
  useSessionDrivers,
  useSessionVisibility,
  useTrackStateSelector,
  useWearSnapshot,
} from '@irdashies/context';
import {
  NO_FIGURE,
  budgetFigure,
  forecastNeighbours,
  closingRate,
  damageLine,
  forecastReasonText,
  formatGap,
  formatLapCount,
  formatLapTime,
  formatLapWindow,
  formatSeconds,
  paceDelta,
  placeFigure,
  rejoinFigure,
  stintEnd,
  stintEndText,
  stintMinutes,
  tyreLapsLeft,
  tyresLine,
} from '@irdashies/domain/raceForecast';
import type { RaceHistorySummarySnapshot } from '@irdashies/types';
import { Compound } from '../shared/Compound/Compound';
import { DriverName, extractDriverName } from '../shared/DriverName/DriverName';
import { OurCarTile } from './components/OurCarTile';
import { useOurCarSettings } from './hooks/useOurCarSettings';

/** A grid that holds two tiles across a narrow panel and four across a wide one. */
const TILES = 'grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2';

const NO_PREVIOUS_STINT = [-1, ''] as const;

/** Under these shares of a full budget the bar turns amber, then red. */
const BUDGET_LOW = 0.3;
const BUDGET_CRITICAL = 0.15;

const budgetBarClass = (fill: number): string =>
  fill < BUDGET_CRITICAL
    ? 'bg-red-400'
    : fill < BUDGET_LOW
      ? 'bg-amber-300'
      : 'bg-green-400';

/**
 * Our Car: what the own entry has aboard and how long it lasts, its pit
 * window, the stops it still owes and what the next costs, where it is
 * forecast to finish and where its stop puts it, and its tyres and damage
 * in a line each. During a team-mate's stint it leads with the gaps to the
 * class cars either side, the last lap and the mean of five.
 *
 * Every figure of the race is `race-forecast.snapshot`'s; the tyres are
 * `wear.snapshot`'s and the damage `damage.snapshot`'s, as their own widgets
 * show them. What a channel does not carry reads `--`: the sim stops
 * sending the car's litres, its tyre wear and its damage while somebody
 * else drives it, and the panel says so once, at its foot.
 *
 * It is about the user's own entry. With the camera on another car there is
 * no forecast, and it says that instead of going blank.
 */
export const OurCar = () => {
  const settings = useOurCarSettings();
  const forecast = useRaceForecastSnapshot();
  const { isDriving, isWatchingOwnCar } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);
  // The sim's own word on it, whatever the General setting for widgets
  // while watching says: what is at stake here is which figures exist.
  const teamMateDriving =
    useTrackStateSelector(trackStateSelectors.watchingOwnCar) ?? false;
  const drivers = useSessionDrivers();
  // Read whether or not the tyres line is shown: the tyres are also one of
  // the three things that can end the stint.
  const wear = useWearSnapshot();
  const damage = useDamageSnapshot(settings.showDamage);

  const showPace =
    settings.showPace === 'always' ||
    (settings.showPace === 'watching' && teamMateDriving);
  const ownCarIdx = forecast?.ownCarIdx ?? -1;
  const selectPreviousStint = useCallback(
    (summary: RaceHistorySummarySnapshot) =>
      [
        summary.previousStintAvgLap[ownCarIdx] ?? -1,
        summary.previousStintDriver[ownCarIdx] ?? '',
      ] as const,
    [ownCarIdx]
  );
  // The stint before this one, for the mean of five to be read against.
  // Only asked for while the pace tiles are up: the summary is what keeps
  // the race history recording.
  const [previousAvgS, previousDriver] =
    useChannelSelector('race-history.summary', selectPreviousStint, {
      enabled: showPace && ownCarIdx >= 0,
      equality: shallow,
    }) ?? NO_PREVIOUS_STINT;

  const numberOf = useCallback(
    (carIdx: number): string =>
      String(
        drivers?.find((driver) => driver.CarIdx === carIdx)?.CarNumber ?? carIdx
      ),
    [drivers]
  );

  const view = useMemo(() => {
    if (!forecast?.valid) return null;
    const own = forecast.cars.find((car) => car.own) ?? null;
    const { stint } = forecast;
    const tyreLaps = tyreLapsLeft(wear);
    return {
      own,
      stint,
      budget: stint ? budgetFigure(stint, settings.fuelUnits) : null,
      end: stint ? stintEnd(stint, tyreLaps) : null,
      place: placeFigure(forecast.place),
      rejoin: rejoinFigure(forecast.rejoin, numberOf),
      neighbours: forecastNeighbours(forecast.cars),
    };
  }, [forecast, wear, settings.fuelUnits, numberOf]);

  if (!isSessionVisible) return <></>;
  if (settings.showOnlyWhenOnTrack && !(isDriving || isWatchingOwnCar)) {
    return <></>;
  }

  const shell = (children: ReactNode) => (
    <div
      data-testid="our-car"
      data-valid={view !== null}
      className="flex h-full w-full flex-col gap-3 overflow-y-auto rounded bg-slate-800/(--bg-opacity) p-3 text-sm text-slate-200 tabular-nums"
      style={{
        ['--bg-opacity' as string]: `${settings.background.opacity}%`,
      }}
    >
      {children}
    </div>
  );

  if (!view || !forecast) {
    return shell(
      <p
        data-testid="our-car-reason"
        className="flex min-h-0 flex-1 items-center justify-center text-center text-xs text-slate-400"
      >
        {forecastReasonText(forecast?.reason)}
      </p>
    );
  }

  const { own, stint, budget, end, place, rejoin, neighbours } = view;
  const minutes = end ? stintMinutes(end.laps, own?.paceS) : null;
  const stopsOwed = own?.stopsOwed ?? null;
  const tyres = settings.showTyres ? tyresLine(wear) : null;
  const harm = settings.showDamage ? damageLine(damage) : null;

  const neighbourTile = (side: 'ahead' | 'behind') => {
    const car = neighbours[side];
    const rate = closingRate(side, car?.avg5S, own?.avg5S);
    return (
      <OurCarTile
        id={side}
        large
        label={
          car
            ? `Car ${side}, #${numberOf(car.carIdx)}`
            : side === 'ahead'
              ? 'Car ahead'
              : 'Car behind'
        }
        value={car ? `${formatGap(car.gapS)} s` : NO_FIGURE}
        note={
          car
            ? rate.text
            : side === 'ahead'
              ? 'leading the class'
              : 'last of the class'
        }
        noteTone={car ? rate.tone : 'quiet'}
      />
    );
  };
  const against = previousAvgS > 0 ? paceDelta(own?.avg5S, previousAvgS) : null;

  return shell(
    <>
      {showPace && (
        <div data-testid="our-car-pace" className={TILES}>
          {neighbourTile('ahead')}
          {neighbourTile('behind')}
          <OurCarTile
            id="last-lap"
            large
            label="Last lap"
            value={formatLapTime(forecast.ownLastLapS)}
            note={
              forecast.ownBestLapS === null
                ? ''
                : `best ${formatLapTime(forecast.ownBestLapS)}`
            }
          />
          <OurCarTile
            id="avg5"
            large
            label="Average of 5"
            value={formatLapTime(own?.avg5S)}
            note={
              against && against.text !== NO_FIGURE
                ? `${against.text} vs ${
                    previousDriver
                      ? `${DriverName(extractDriverName(previousDriver), 'n.-surname')}’s stint`
                      : 'the stint before'
                  }`
                : 'clean laps'
            }
            // Slower than the stint before is a positive figure here.
            noteTone={
              against?.tone === 'good'
                ? 'bad'
                : against?.tone === 'bad'
                  ? 'good'
                  : 'quiet'
            }
          />
        </div>
      )}

      <div data-testid="our-car-budget" className="flex flex-none flex-col">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-slate-400">{budget?.label ?? 'Aboard'}</span>
          <span
            data-testid="our-car-budget-value"
            className="text-2xl font-black leading-none text-white"
          >
            {budget ? `${budget.value} ${budget.unit}` : NO_FIGURE}
          </span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded bg-slate-600/60">
          {budget?.fill !== null && budget?.fill !== undefined && (
            <div
              className={`h-full ${budgetBarClass(budget.fill)}`}
              style={{ width: `${budget.fill * 100}%` }}
            />
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs leading-none">
          <span data-testid="our-car-stint">
            {end ? (
              <>
                <span className="font-bold text-white">
                  {formatLapCount(Math.floor(end.laps))}
                </span>
                {minutes !== null && ` · ${minutes} min`} left in the stint
              </>
            ) : (
              `${NO_FIGURE} laps left in the stint`
            )}
          </span>
          {end && budget && (
            <span data-testid="our-car-stint-end" className="text-slate-400">
              {stintEndText(end.by)} {'·'} {budget.perLap}
            </span>
          )}
        </div>
      </div>

      <div className={TILES}>
        {settings.showStops && (
          <>
            <OurCarTile
              id="window"
              label="Pit window"
              value={
                stopsOwed === 0
                  ? 'no stop needed'
                  : formatLapWindow(stint?.window)
              }
              note={
                forecast.ownLap === null ? '' : `now lap ${forecast.ownLap}`
              }
            />
            <OurCarTile
              id="stops"
              label="Stops to the flag"
              value={
                stopsOwed === null
                  ? NO_FIGURE
                  : stopsOwed === 0
                    ? 'none'
                    : `${stopsOwed} more`
              }
              note={
                stopsOwed === null
                  ? 'what is aboard is not read'
                  : stopsOwed === 0
                    ? 'enough aboard to finish'
                    : own?.stopLossS === null || own?.stopLossS === undefined
                      ? 'the stop is not costed yet'
                      : // The Pit Stop widget's loss for the same stop is
                        // higher by its Extra Time setting.
                        `next ${formatSeconds(own.stopLossS)}, no extra time`
              }
            />
          </>
        )}
        {settings.showForecast && (
          <OurCarTile
            id="forecast"
            label="Finish forecast"
            value={place?.text ?? NO_FIGURE}
            tone={place?.tone ?? 'quiet'}
            uncertain={place?.uncertain ?? false}
            note={place ? place.note : 'what is aboard is not read'}
          />
        )}
        {settings.showRejoin && (
          <OurCarTile
            id="rejoin"
            label="After the stop"
            value={rejoin?.text ?? NO_FIGURE}
            uncertain={rejoin?.closeCall ?? false}
            note={rejoin?.note ?? ''}
          />
        )}
      </div>

      {(settings.showTyres || settings.showDamage) && (
        <div className="flex flex-none flex-wrap justify-between gap-x-6 gap-y-2 border-t border-slate-600/60 pt-2.5">
          {settings.showTyres && (
            <div data-testid="our-car-tyres" className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 text-[0.6875rem] font-medium uppercase leading-none tracking-wide text-slate-400">
                Tyres
                {tyres && tyres.compound >= 0 && (
                  <Compound tireCompound={tyres.compound} />
                )}
              </span>
              <span className="font-bold leading-tight text-white">
                {tyres?.tread ?? NO_FIGURE}
              </span>
              <span className="min-h-[1em] text-xs leading-none text-slate-400">
                {tyres?.note ?? ''}
              </span>
            </div>
          )}
          {settings.showDamage && (
            <div data-testid="our-car-damage" className="flex flex-col gap-1">
              <span className="text-[0.6875rem] font-medium uppercase leading-none tracking-wide text-slate-400">
                Damage
              </span>
              <span
                className={`font-bold leading-tight ${
                  !harm
                    ? 'text-white'
                    : harm.damaged
                      ? 'text-amber-300'
                      : 'text-green-400'
                }`}
              >
                {harm?.text ?? NO_FIGURE}
              </span>
              <span className="min-h-[1em] text-xs leading-none text-slate-400">
                {harm?.note ?? ''}
              </span>
            </div>
          )}
        </div>
      )}

      {teamMateDriving && (
        <p
          data-testid="our-car-not-sent"
          className="flex-none rounded-md border border-dashed border-slate-500 px-2.5 py-2 text-xs leading-snug text-slate-300"
        >
          The game does not send the car’s fuel in litres, its tyre wear or its
          damage while a team-mate drives. They return when you take the wheel.
        </p>
      )}
    </>
  );
};
