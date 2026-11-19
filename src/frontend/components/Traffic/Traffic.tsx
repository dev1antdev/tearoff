import { useMemo } from 'react';
import {
  CheckCircleIcon,
  TimerIcon,
  TrafficConeIcon,
} from '@phosphor-icons/react';
import {
  useCurrentSessionType,
  useDrivingState,
  useLovelyTrackData,
  usePitLaneStore,
  useSessionDrivers,
  useSessionStore,
  useSessionVisibility,
  useTrackLength,
  useTrackStateSelector,
  useTrafficSnapshot,
  useWeekendInfoNumCarClasses,
} from '@irdashies/context';
import { useHighlightColor } from '@irdashies/domain/standings/useHighlightColor';
import { trackCornersFrom } from '@irdashies/domain/corners/trackCorners';
import {
  parsePitLimitMs,
  selectRejoinTraffic,
  type RejoinRow,
  type RejoinState,
} from '@irdashies/domain/traffic/pitExitTraffic';
import {
  closingLevel,
  closingPerLapText,
  contactLapsText,
  forecastPlaceText,
  forecastTimeText,
  gapText,
} from '@irdashies/domain/traffic/trafficText';
import {
  EMPTY_TRAFFIC,
  isTrafficRelation,
  type Driver,
  type TrackStateSnapshot,
  type TrafficConfig,
  type TrafficPick,
} from '@irdashies/types';
import type { LapPlace } from '@irdashies/shared';
import { DriverName, extractDriverName } from '../shared/DriverName/DriverName';
import { CarChip, ContactTile, MirrorRow } from './components/TrafficRows';
import { useTrafficSettings } from './hooks/useTrafficSettings';

/** A car this close behind is on you. */
const URGENT_GAP_S = 1;
/** An arrival this near is said in the caution colour. */
const IMMINENT_S = 10;

/** The session clock in whole seconds: what the holds are counted on. */
const selectWholeSecond = (snapshot: TrackStateSnapshot): number =>
  Math.floor(snapshot.sessionTime);
/**
 * The player's place and speed, while in the pit lane only: out of it they
 * are not read, and a selector that keeps returning the same value does
 * not wake the widget.
 */
const selectLanePct = (snapshot: TrackStateSnapshot): number =>
  snapshot.onPitRoad ? Math.round(snapshot.lapDistPct * 1000) / 1000 : -1;
const selectLaneSpeed = (snapshot: TrackStateSnapshot): number =>
  snapshot.onPitRoad ? Math.round(snapshot.speed) : 0;

const REJOIN_BACKGROUND: Record<RejoinState, string> = {
  clear: 'bg-green-700',
  caution: 'bg-amber-600',
  danger: 'bg-red-700',
};

const REJOIN_WORD: Record<RejoinState, string> = {
  clear: 'Clear',
  caution: 'Caution',
  danger: 'Wait',
};

interface CarFacts {
  number: string;
  label: string;
  classColor: number | undefined;
}

const NO_CAR: CarFacts = { number: '', label: '', classColor: undefined };

/** The number of a car and what the settings write beside it. */
const carFacts = (
  drivers: readonly Driver[] | undefined,
  carIdx: number,
  label: TrafficConfig['label']
): CarFacts => {
  const driver = drivers?.find((entry) => entry.CarIdx === carIdx);
  if (!driver) return NO_CAR;
  return {
    number: String(driver.CarNumber ?? ''),
    label:
      label === 'driver'
        ? DriverName(extractDriverName(driver.UserName), 'n.-surname')
        : label === 'class'
          ? String(driver.CarClassShortName ?? '')
          : '',
    classColor: driver.CarClassColor,
  };
};

/**
 * A corner the track data only numbers is listed as "T6", which is how a
 * list reads and not how a sentence does: "at Turn 6".
 */
const spokenCorner = (label: string): string =>
  label.replace(/^T(\d+[A-Za-z]?)$/, 'Turn $1');

const signedSeconds = (offsetS: number): string =>
  `${offsetS < 0 ? '−' : '+'}${Math.abs(offsetS).toFixed(1)}`;

/**
 * Who is coming, and when.
 *
 * On track in a race it is the mirror: the cars closing from behind, each
 * with its number on the class colour, the gap, and an arrow for how fast
 * it is closing; under them a line that says when and where the one that
 * is catching the player arrives; and a table of laps until the player
 * meets the car ahead, the leader and the car behind.
 *
 * In the pit lane, for a few seconds after it, and when slow or off the
 * road, it is instead the cars the player comes out among: who goes by
 * before they reach the pit exit and who arrives after, on green, amber or
 * red by how close the next one is.
 *
 * It is advice to a driver. While a team-mate drives the user's own car it
 * is shown for that car, which everything in it is measured for; with the
 * camera on any other car it is hidden.
 */
export const Traffic = () => {
  const settings = useTrafficSettings();
  const snapshot = useTrafficSnapshot() ?? EMPTY_TRAFFIC;
  const { isDriving, isWatchingOwnCar, isWatchingOtherCar } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);
  const isRace = useCurrentSessionType() === 'Race';
  const drivers = useSessionDrivers();
  const isMultiClass = (useWeekendInfoNumCarClasses() ?? 0) > 1;
  const highlightColor = useHighlightColor();
  const now = useTrackStateSelector(selectWholeSecond) ?? 0;
  const lanePct = useTrackStateSelector(selectLanePct) ?? -1;
  const laneSpeed = useTrackStateSelector(selectLaneSpeed) ?? 0;
  const trackLength = useTrackLength();
  const pitLimit = useSessionStore(
    (state) => state.session?.WeekendInfo?.TrackPitSpeedLimit
  );
  const pitEntryPct = usePitLaneStore((state) => state.pitEntryPct);
  const pitExitPct = usePitLaneStore((state) => state.pitExitPct);
  const { sections } = useLovelyTrackData();
  const corners = useMemo<LapPlace[]>(
    () =>
      trackCornersFrom(sections, settings.cornerLabel).map((corner) => ({
        startPct: corner.start_pct,
        endPct: corner.end_pct,
        label:
          settings.cornerLabel === 'name'
            ? spokenCorner(corner.label)
            : corner.label,
      })),
    [sections, settings.cornerLabel]
  );

  if (!isSessionVisible) return <></>;
  // The figures are the user's own car's: not what is on screen while the
  // camera is on another one.
  if (isWatchingOtherCar) return <></>;
  if (settings.showOnlyWhenOnTrack && !(isDriving || isWatchingOwnCar)) {
    return <></>;
  }

  const held = (stamp: number | null): boolean =>
    stamp !== null && now - stamp <= settings.exitHold;
  const rejoinMode = !settings.showPitExit
    ? null
    : snapshot.inPitLane || held(snapshot.exitedAt)
      ? 'exit'
      : settings.showWhenSlow && held(snapshot.slowAt)
        ? 'rejoin'
        : null;

  const chip = (carIdx: number) => carFacts(drivers, carIdx, settings.label);
  const opacity = settings.background.opacity;

  if (rejoinMode) {
    const rejoin = selectRejoinTraffic({
      mode: rejoinMode,
      arriving: snapshot.arriving,
      inPitLane: snapshot.inPitLane,
      playerPct: lanePct,
      playerSpeedMs: laneSpeed,
      pitEntryPct,
      pitExitPct,
      trackLengthM: Number.isFinite(trackLength) ? (trackLength ?? 0) : 0,
      pitLimitMs: parsePitLimitMs(pitLimit),
      aheadWindow: settings.aheadWindow,
      behindWindow: settings.behindWindow,
      behindCount: settings.behindCount,
      careGap: settings.careGap,
      dangerGap: settings.dangerGap,
    });
    const rows: { row: RejoinRow; ahead: boolean }[] = [
      ...(rejoin.ahead ? [{ row: rejoin.ahead, ahead: true }] : []),
      ...rejoin.behind.map((row) => ({ row, ahead: false })),
    ];
    return (
      <div
        data-testid="traffic"
        data-block={rejoin.mode}
        data-state={rejoin.state}
        className={`flex h-full w-full flex-col gap-1.5 rounded p-2 font-medium text-white ${REJOIN_BACKGROUND[rejoin.state]}`}
      >
        <div className="flex items-center gap-1.5 leading-none">
          <TrafficConeIcon weight="fill" size="1.1em" aria-hidden="true" />
          <span className="text-sm font-extrabold tracking-wide uppercase">
            {rejoin.mode === 'exit' ? 'Pit exit' : 'Rejoin'}
          </span>
          <span
            data-testid="traffic-rejoin-state"
            className="rounded bg-slate-950/25 px-1.5 py-0.5 text-xs font-bold uppercase"
          >
            {REJOIN_WORD[rejoin.state]}
          </span>
          {rejoin.toExitS !== null && (
            <span
              data-testid="traffic-to-exit"
              className="ml-auto text-xs tabular-nums"
            >
              exit line in {rejoin.toExitS.toFixed(0)} s
            </span>
          )}
          {!rejoin.atExit && snapshot.inPitLane && (
            <span className="ml-auto text-xs text-white/80">
              exit not measured yet
            </span>
          )}
        </div>
        {rows.length === 0 ? (
          <div
            data-testid="traffic-rejoin-clear"
            className="flex flex-1 items-center gap-1.5 text-lg font-bold"
          >
            <CheckCircleIcon weight="fill" aria-hidden="true" />
            Nobody within {settings.behindWindow} s
          </div>
        ) : (
          rows.map(({ row, ahead }) => {
            const car = chip(row.carIdx);
            return (
              <div
                key={row.carIdx}
                data-testid="traffic-rejoin-row"
                data-side={ahead ? 'ahead' : 'behind'}
                className={`flex min-w-0 items-center gap-2 rounded bg-slate-950/25 px-1.5 py-0.5 ${
                  ahead ? 'text-white/75' : ''
                }`}
              >
                <CarChip
                  number={car.number}
                  classColor={car.classColor}
                  highlightColor={highlightColor}
                  isMultiClass={isMultiClass}
                  ringed
                />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {car.label}
                </span>
                <span className="flex-none text-2xs font-bold uppercase">
                  {ahead ? 'goes by first' : 'arrives behind'}
                </span>
                <span className="min-w-[4.5ch] flex-none text-right text-lg leading-none font-bold tabular-nums">
                  {signedSeconds(row.offsetS)}
                  <span className="text-[0.6em] font-semibold"> s</span>
                </span>
              </div>
            );
          })
        )}
      </div>
    );
  }

  // The mirror and the table are for racing, unless the settings say more.
  if (!isRace && !settings.showOutsideRace) return <></>;

  const listed = settings.showMirror
    ? snapshot.behind.filter(
        (car) => settings.showRival || isTrafficRelation(car.relation)
      )
    : [];
  const rows = listed.slice(0, Math.max(1, settings.mirrorRows));
  const hiddenTraffic =
    snapshot.moreBehind +
    listed.slice(rows.length).filter((car) => isTrafficRelation(car.relation))
      .length;

  const forecast = settings.showForecast ? snapshot.forecast : null;
  const forecastCar = forecast ? chip(forecast.carIdx) : NO_CAR;
  const place = forecast ? forecastPlaceText(forecast, corners) : null;

  const columns: {
    key: string;
    caption: string;
    pick: TrafficPick | null;
    blue: boolean;
  }[] = [];
  if (settings.showSlowerAhead) {
    columns.push({
      key: 'ahead',
      caption: 'Catching',
      pick: snapshot.slowerAhead,
      blue: false,
    });
  }
  if (settings.showLeader) {
    columns.push({
      key: 'leader',
      caption: 'Leader',
      pick: snapshot.leader,
      blue: true,
    });
  }
  if (settings.showFasterBehind) {
    columns.push({
      key: 'behind',
      caption: 'Caught by',
      pick: snapshot.fasterBehind,
      blue: true,
    });
  }

  return (
    <div
      data-testid="traffic"
      data-block="closing"
      className="flex h-full w-full flex-col gap-1.5 overlay-panel p-2 font-medium text-white"
      style={{ ['--bg-opacity' as string]: `${opacity}%` }}
    >
      {settings.showMirror &&
        (rows.length === 0 ? (
          <div
            data-testid="traffic-clear"
            className="flex items-center gap-1.5 rounded bg-slate-900/70 px-1.5 py-1.5 text-sm leading-none text-slate-400"
          >
            <CheckCircleIcon
              weight="fill"
              className="text-green-500"
              aria-hidden="true"
            />
            Clear behind
          </div>
        ) : (
          rows.map((car, index) => {
            const facts = chip(car.carIdx);
            return (
              <MirrorRow
                key={car.carIdx}
                number={facts.number}
                label={facts.label}
                classColor={facts.classColor}
                highlightColor={highlightColor}
                isMultiClass={isMultiClass}
                relation={car.relation}
                gap={gapText(car.gapS)}
                urgent={
                  isTrafficRelation(car.relation) &&
                  car.gapS !== null &&
                  car.gapS < URGENT_GAP_S
                }
                level={closingLevel(car.closingS)}
                perLap={
                  settings.showClosingRate
                    ? closingPerLapText(car.closingS, snapshot.lapS)
                    : null
                }
                lapsAhead={car.lapsAhead}
                isHead={index === 0}
                more={index === rows.length - 1 ? hiddenTraffic : 0}
              />
            );
          })
        ))}

      {forecast && (
        <div
          data-testid="traffic-forecast"
          className="flex min-w-0 items-center gap-1.5 px-1 text-sm leading-tight"
        >
          <TimerIcon
            weight="bold"
            className={`flex-none ${
              forecast.etaS <= IMMINENT_S ? 'text-amber-300' : 'text-slate-400'
            }`}
            aria-hidden="true"
          />
          {/* Named where it is not the car in the first row. */}
          {forecast.carIdx !== rows[0]?.carIdx && forecastCar.number && (
            <CarChip
              number={forecastCar.number}
              classColor={forecastCar.classColor}
              highlightColor={highlightColor}
              isMultiClass={isMultiClass}
            />
          )}
          <span className="min-w-0 truncate">
            <span
              data-testid="traffic-forecast-time"
              className={`font-semibold ${
                forecast.etaS <= IMMINENT_S ? 'text-amber-300' : ''
              }`}
            >
              {forecastTimeText(forecast, snapshot.lapS)}
            </span>
            {place && (
              <span
                data-testid="traffic-forecast-place"
                className="text-slate-300"
              >
                , {place}
              </span>
            )}
          </span>
        </div>
      )}

      {columns.length > 0 && (
        <div
          className="mt-auto grid gap-1.5"
          style={{
            gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`,
          }}
        >
          {columns.map(({ key, caption, pick, blue }) => {
            const facts = pick ? chip(pick.carIdx) : NO_CAR;
            const laps = contactLapsText(pick?.laps ?? null, settings.maxLaps);
            return (
              <ContactTile
                key={key}
                caption={caption}
                number={pick ? facts.number || String(pick.carIdx) : ''}
                classColor={facts.classColor}
                highlightColor={highlightColor}
                isMultiClass={isMultiClass}
                laps={laps}
                gap={gapText(pick?.gapS ?? null)}
                thisLap={
                  settings.highlightThisLap &&
                  laps !== '--' &&
                  pick?.thisLap === true
                }
                blue={blue}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};
