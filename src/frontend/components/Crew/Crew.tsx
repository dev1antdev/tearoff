import { useMemo } from 'react';
import { useDrivingState, useSessionVisibility } from '@irdashies/context';
import { stintPaceDisplay } from '@irdashies/domain/lapTiming/stintPaceDisplay';
import {
  carRecordNotice,
  crewView,
  driveTime,
  formatDriven,
  formatLapTime,
  formatOwed,
  formatShare,
  raceHistoryReadable,
  stintEndText,
  useCarChoice,
  useCarHistoryState,
  useCarRaceRecord,
  useSessionClockMinute,
  type CrewDriver,
  type DriveTimeLimits,
} from '@irdashies/domain/raceHistory';
import type { CrewConfig } from '@irdashies/types';
import { CarPanelHeader } from '../shared/CarChoice/CarPanelHeader';
import { DriverName, extractDriverName } from '../shared/DriverName/DriverName';
import {
  CrewDriverCaptions,
  CrewDriverRow,
  type DriveTimeTone,
} from './components/CrewDriverRow';
import {
  CrewStintCaptions,
  CrewStintRow,
  crewStintMinWidth,
} from './components/CrewStintRow';
import { driverColour } from '../shared/DriverColour/driverColours';
import { useCrewSettings } from './hooks/useCrewSettings';

/** A driver as the panel names them: an initial and the surname. */
const shortName = (name: string): string =>
  name ? DriverName(extractDriverName(name), 'n.-surname') : 'Not named';

const count = (many: number, one: string): string =>
  `${many} ${one}${many === 1 ? '' : 's'}`;

/** What a driver still owes of the limits, or has left of them. */
const limitStatus = (
  driver: CrewDriver,
  limits: DriveTimeLimits
): {
  fill: number;
  minAt: number | null;
  status: string;
  tone: DriveTimeTone;
} => {
  const { fill, minAt, owedS, leftS, overS } = driveTime(
    driver.seconds,
    limits
  );
  if (overS > 0) {
    return {
      fill,
      minAt,
      status: `over by ${formatOwed(overS)}`,
      tone: 'over',
    };
  }
  if (owedS > 0) {
    return { fill, minAt, status: `needs ${formatOwed(owedS)}`, tone: 'owed' };
  }
  return {
    fill,
    minAt,
    status: `${formatDriven(leftS)} to the maximum`,
    tone: 'quiet',
  };
};

/**
 * The panel itself, with everything it reads. Apart from the shell below so
 * that a panel hidden by its session or by "only on track" reads nothing:
 * reading the race history's summary is what has a race recorded.
 */
const CrewPanel = ({ settings }: { settings: CrewConfig }) => {
  const { choices, car, choose } = useCarChoice();
  const readable = raceHistoryReadable();
  const carIdx = readable && car ? car.carIdx : null;
  const record = useCarRaceRecord(carIdx);
  const history = useCarHistoryState(carIdx);
  // For the stint under way, which has no end to be measured to.
  const nowS = useSessionClockMinute();

  const view = useMemo(
    () => (record ? crewView(record, nowS) : null),
    [record, nowS]
  );
  const { enabled: limited, maxMinutes, minMinutes } = settings.driveTime;
  const limits = useMemo<DriveTimeLimits | null>(
    () => (limited ? { maxS: maxMinutes * 60, minS: minMinutes * 60 } : null),
    [limited, maxMinutes, minMinutes]
  );

  // No session, or one with no cars in it yet: nobody to be about.
  if (!car) return <></>;

  const notice =
    carRecordNotice({
      readable,
      recording: history.recording,
      read: view !== null,
    }) ??
    (view && view.stints.length === 0
      ? `No stint of #${car.number} has been recorded yet.`
      : null);

  // The stint under way against the last one somebody else drove.
  const pace = stintPaceDisplay(history.paceDelta);
  const paceText =
    pace.tone === 'none'
      ? ''
      : `${pace.text} vs ${
          history.paceAgainst
            ? shortName(history.paceAgainst)
            : 'the driver before'
        }`;
  const ownCar = car.group === 'own';
  const energyCaption =
    view?.energyIsVirtual === true
      ? 'VE/lap'
      : view?.energyIsVirtual === false
        ? 'Fuel/lap'
        : undefined;

  return (
    <div
      data-testid="crew"
      data-car={car.carIdx}
      className="flex h-full w-full flex-col overflow-hidden rounded bg-slate-800/(--bg-opacity) text-[0.8125rem] text-slate-200 tabular-nums"
      style={{
        ['--bg-opacity' as string]: `${settings.background.opacity}%`,
      }}
    >
      <CarPanelHeader choices={choices} carIdx={car.carIdx} onChoose={choose}>
        {view && !notice && (
          <span data-testid="crew-count">
            {count(view.drivers.length, 'driver')}
            {' · '}
            {count(view.stints.length, 'stint')}
          </span>
        )}
        {history.missingLaps > 0 && (
          <span data-testid="crew-missing" className="text-amber-200">
            {view && !notice ? ' · ' : ''}
            {count(history.missingLaps, 'lap')} not recorded
          </span>
        )}
      </CarPanelHeader>

      {notice || !view ? (
        <p
          data-testid="crew-notice"
          className="flex min-h-0 flex-1 items-center justify-center p-3 text-center text-xs text-slate-400"
        >
          {notice}
        </p>
      ) : (
        <div
          data-testid="crew-body"
          className="min-h-0 flex-1 overflow-y-auto [scrollbar-color:var(--color-slate-600)_transparent] [scrollbar-width:thin]"
        >
          {settings.showDrivers && (
            <div data-testid="crew-drivers" className="pb-1">
              <CrewDriverCaptions />
              {view.drivers.map((driver) => {
                const limit = limits ? limitStatus(driver, limits) : null;
                return (
                  <CrewDriverRow
                    key={driver.name}
                    name={shortName(driver.name)}
                    colour={driverColour(driver.index, ownCar)}
                    driving={driver.driving}
                    stints={driver.stints}
                    drive={formatDriven(driver.seconds)}
                    avg={formatLapTime(driver.avgLap, 2)}
                    best={formatLapTime(driver.bestLap)}
                    fill={limit?.fill}
                    minAt={limit?.minAt}
                    status={limit?.status}
                    statusTone={limit?.tone}
                  />
                );
              })}
              {limits && (
                <p
                  data-testid="crew-limits"
                  className="px-3 pt-1 text-[0.6875rem] leading-snug text-slate-400"
                >
                  Bar: time driven against the maximum of{' '}
                  {formatDriven(limits.maxS)}.
                  {limits.minS > 0 &&
                    ` Mark: the minimum of ${formatDriven(limits.minS)}.`}{' '}
                  The limits are the ones entered in this panel’s settings.
                </p>
              )}
            </div>
          )}

          {settings.showStints && (
            <div
              data-testid="crew-stints"
              className={`overflow-x-auto pb-1 ${
                settings.showDrivers ? 'border-t border-slate-700' : ''
              }`}
            >
              <div
                style={{
                  minWidth: crewStintMinWidth(energyCaption !== undefined),
                }}
              >
                <CrewStintCaptions energyCaption={energyCaption} />
                {view.stints.map((stint) => {
                  const underWay = stint.end.kind === 'underWay';
                  return (
                    <CrewStintRow
                      key={stint.ordinal}
                      ordinal={stint.ordinal}
                      name={shortName(stint.driver)}
                      colour={driverColour(stint.driverIndex, ownCar)}
                      laps={stint.laps}
                      time={formatDriven(stint.seconds)}
                      avg={formatLapTime(stint.avgLap, 2)}
                      best={formatLapTime(stint.bestLap)}
                      energy={
                        energyCaption === undefined
                          ? undefined
                          : formatShare(stint.energy?.perLap)
                      }
                      underWay={underWay}
                      end={stintEndText(stint.end)}
                      pace={underWay ? paceText : ''}
                      paceTone={pace.tone}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Crew and Stints: who has driven a car for how long and how fast, and
 * every stint it has run with the stop that ended it. About our own car
 * until another is chosen in its header.
 *
 * Made for a panel of the Pit Wall, where it fills the panel and scrolls
 * inside it; on the overlay it is a window like any other widget.
 *
 * Everything is the race history's: the laps and stints of the one car,
 * read through its bridge when the car's records change. What was driven
 * while nothing was recording is not in it, and the panel says how many
 * laps that is.
 */
export const Crew = () => {
  const settings = useCrewSettings();
  const { isDriving, isWatching } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);

  // On track is driving, or watching a car that is out of its garage.
  if (
    !isSessionVisible ||
    (settings.showOnlyWhenOnTrack && !(isDriving || isWatching))
  ) {
    return <></>;
  }
  return <CrewPanel settings={settings} />;
};
