import { useCallback, useMemo, useState } from 'react';
import {
  useDrivingState,
  useSessionDrivers,
  useSessionVisibility,
} from '@irdashies/context';
import { useOwnCar } from '@irdashies/domain/ownCar/useOwnCar';
import {
  NO_VALUE,
  RACE_LOG_KIND_GROUPS,
  isKindListed,
  isScopeListed,
  raceEventFigure,
  raceEventMark,
  raceEventText,
  raceEventTime,
  type RaceLogKindGroup,
} from '@irdashies/domain/raceLog';
import type { RaceLogKinds, RaceLogScope } from '@irdashies/types';
import { getTailwindStyle } from '@irdashies/utils/colors';
import { RaceLogFilters } from './components/RaceLogFilters';
import { RaceLogRow, type RaceLogRowProps } from './components/RaceLogRow';
import { useKeepScroll } from './hooks/useKeepScroll';
import { useRaceLogEvents } from './hooks/useRaceLogEvents';
import { useRaceLogSettings } from './hooks/useRaceLogSettings';

interface GridCar {
  carNumber: string;
  classId: number;
  /** The bar before its number, in its class colour. */
  badgeClass: string;
}

/** A car the session no longer names: a number that is not known. */
const UNKNOWN_BADGE = 'border-slate-500';

/** The switches as one word: what tells one setting of them from another. */
const kindsKey = (kinds: RaceLogKinds): string =>
  RACE_LOG_KIND_GROUPS.map(({ id }) => (kinds[id] ? '1' : '0')).join('');

/**
 * Race Log: what happened in the race, one line an event, newest first. A
 * car into the pits and from which place, out again after how long and with
 * whom at the wheel, a class's fastest lap, a full-course yellow and how
 * long it lasted, a car that has gone, a penalty, our own place.
 *
 * The events are made and kept in the main process for the whole race,
 * whether or not this is on screen; the list here is the most recent of
 * them, and earlier ones a page at a time when asked for. Our own car's
 * lines are amber.
 *
 * Which cars and which kinds are listed starts from the widget's settings
 * and is changed by the switches over the list, for as long as it is on
 * screen: a copy in a Pit Wall panel saves nothing.
 */
export const RaceLog = () => {
  const settings = useRaceLogSettings();
  const { raceToken, events, hasEarlier, loading, loadEarlier } =
    useRaceLogEvents();
  const own = useOwnCar();
  const drivers = useSessionDrivers();
  const { isDriving, isWatchingOwnCar } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);

  // What the switches show starts from the settings, and goes back to them
  // when they are changed on the settings page. Compared as words: the
  // settings are a new object whenever the dashboard is read again.
  const saved = `${settings.scope}:${kindsKey(settings.kinds)}`;
  const [view, setView] = useState({
    saved,
    scope: settings.scope,
    kinds: settings.kinds,
  });
  if (view.saved !== saved) {
    setView({ saved, scope: settings.scope, kinds: settings.kinds });
  }
  const { scope, kinds } = view;

  const onScope = useCallback(
    (next: RaceLogScope) => setView((now) => ({ ...now, scope: next })),
    []
  );
  const onKind = useCallback(
    (kind: RaceLogKindGroup) =>
      setView((now) => ({
        ...now,
        kinds: { ...now.kinds, [kind]: !now.kinds[kind] },
      })),
    []
  );

  const grid = useMemo(() => {
    const cars = new Map<number, GridCar>();
    for (const driver of drivers ?? []) {
      cars.set(driver.CarIdx, {
        carNumber: driver.CarNumber,
        classId: driver.CarClassID,
        // The class colour as the Standings takes it from the session.
        badgeClass: getTailwindStyle(driver.CarClassColor, undefined, true)
          .borderColor,
      });
    }
    return cars;
  }, [drivers]);

  const rows = useMemo(() => {
    const classOf = (carIdx: number) => grid.get(carIdx)?.classId;
    const out: RaceLogRowProps[] = [];
    // Newest first.
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (!isKindListed(event, kinds)) continue;
      if (!isScopeListed(event, scope, own, classOf)) continue;
      const car = event.carIdx === null ? undefined : grid.get(event.carIdx);
      const figure = raceEventFigure(event);
      const text = raceEventText(event);
      out.push({
        seq: event.seq,
        time: raceEventTime(event, settings.time),
        mark: raceEventMark(event),
        carNumber: event.carIdx === null ? '' : (car?.carNumber ?? NO_VALUE),
        badgeClass: car?.badgeClass ?? UNKNOWN_BADGE,
        text: figure ? text.slice(0, text.length - figure.length) : text,
        figure,
        own: event.carIdx !== null && event.carIdx === own.carIdx,
      });
    }
    return out;
  }, [events, kinds, scope, own, grid, settings.time]);

  const seqs = useMemo(() => rows.map((row) => row.seq), [rows]);
  const scroll = useKeepScroll(
    seqs,
    `${raceToken}:${scope}:${kindsKey(kinds)}`
  );

  if (!isSessionVisible) return <></>;
  if (settings.showOnlyWhenOnTrack && !(isDriving || isWatchingOwnCar)) {
    return <></>;
  }

  // With no kind switched on an earlier page would add nothing to the list.
  const offerEarlier =
    hasEarlier && RACE_LOG_KIND_GROUPS.some(({ id }) => kinds[id]);
  const empty =
    raceToken === ''
      ? 'Waiting for a session.'
      : events.length === 0
        ? 'Nothing to report yet.'
        : 'Nothing of the kinds and cars switched on.';

  return (
    <div
      data-testid="race-log"
      className="flex h-full w-full flex-col overflow-hidden overlay-panel text-sm text-slate-200 tabular-nums"
      style={{
        ['--bg-opacity' as string]: `${settings.background.opacity}%`,
      }}
    >
      {settings.showFilters && (
        <RaceLogFilters
          scope={scope}
          {...kinds}
          unseen={scroll.unseen}
          onScope={onScope}
          onKind={onKind}
          onToTop={scroll.toTop}
        />
      )}
      <div
        ref={scroll.ref}
        onScroll={scroll.onScroll}
        data-testid="race-log-list"
        className="min-h-0 flex-1 overflow-y-auto [overflow-anchor:none] [scrollbar-color:rgb(255_255_255/0.2)_transparent] [scrollbar-width:thin]"
      >
        {rows.length === 0 ? (
          <p
            data-testid="race-log-empty"
            className={`flex items-center justify-center p-3 text-center text-xs text-slate-400 ${
              offerEarlier ? '' : 'h-full'
            }`}
          >
            {empty}
          </p>
        ) : (
          <ol className="grid grid-cols-[max-content_max-content_minmax(0,1fr)] gap-x-2 py-1">
            {rows.map((row) => (
              <RaceLogRow key={row.seq} {...row} />
            ))}
          </ol>
        )}
        {offerEarlier && (
          <div className="flex justify-center px-2 pb-2 pt-1">
            <button
              type="button"
              data-testid="race-log-earlier"
              disabled={loading}
              onClick={loadEarlier}
              className="rounded-md border border-slate-600 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-700/70 disabled:opacity-50"
            >
              {loading ? 'Reading earlier events' : 'Earlier events'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
