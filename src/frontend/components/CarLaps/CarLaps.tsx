import { useMemo, useState } from 'react';
import { useDrivingState, useSessionVisibility } from '@irdashies/context';
import {
  carLapsView,
  carRecordNotice,
  formatLapTime,
  formatSectorTime,
  formatShare,
  missingLapsText,
  raceHistoryReadable,
  useCarChoice,
  useCarHistoryState,
  useCarRaceRead,
  useClassBestLap,
  type CarLapRow as CarLapRowData,
} from '@irdashies/domain/raceHistory';
import type { CarLapsConfig } from '@irdashies/types';
import { CarPanelHeader } from '../shared/CarChoice/CarPanelHeader';
import {
  CarLapCaptions,
  CarLapRow,
  MissingLapsLine,
  carLapMinWidth,
} from './components/CarLapRow';
import { useCarLapsSettings } from './hooks/useCarLapsSettings';

/**
 * Rows drawn until more are asked for. A 24-hour race is four hundred laps
 * at Le Mans and nine hundred at Daytona, and the newest are the ones read.
 */
export const CAR_LAPS_SHOWN = 150;

const count = (many: number, one: string): string =>
  `${many} ${one}${many === 1 ? '' : 's'}`;

const energyText = (row: CarLapRowData): string =>
  row.refilled ? 'refilled' : formatShare(row.energyUsed);

/**
 * The panel itself, with everything it reads. Apart from the shell below so
 * that a panel hidden by its session or by "only on track" reads nothing:
 * reading the race history's summary is what has a race recorded.
 */
const CarLapsPanel = ({ settings }: { settings: CarLapsConfig }) => {
  const { choices, car, choose } = useCarChoice();
  const readable = raceHistoryReadable();
  const carIdx = readable && car ? car.carIdx : null;
  const { record, failed } = useCarRaceRead(carIdx);
  const history = useCarHistoryState(carIdx);
  const classBest = useClassBestLap(carIdx);
  // The car whose every lap was asked for: another car starts short again.
  const [allOf, setAllOf] = useState<number | null>(null);

  const view = useMemo(
    () => (record ? carLapsView(record, classBest) : null),
    [record, classBest]
  );

  // No session, or one with no cars in it yet: nobody to be about.
  if (!car) return <></>;

  const notice =
    carRecordNotice({
      readable,
      recording: history.recording,
      read: view !== null,
      failed,
    }) ??
    (view && view.rows.length === 0
      ? `No lap of #${car.number} has been recorded yet.`
      : null);

  const all = view?.rows ?? [];
  const rows =
    allOf === car.carIdx || all.length <= CAR_LAPS_SHOWN
      ? all
      : all.slice(0, CAR_LAPS_SHOWN);
  const lapsHeld = record?.laps.length ?? 0;
  const columns = {
    sectors: settings.showSectors && view?.hasSectors === true,
    energy: settings.showEnergy && view?.hasEnergy === true,
  };

  return (
    <div
      data-testid="car-laps"
      data-car={car.carIdx}
      className="flex h-full w-full flex-col overflow-hidden rounded bg-slate-800/(--bg-opacity) text-base text-slate-200 tabular-nums"
      style={{
        ['--bg-opacity' as string]: `${settings.background.opacity}%`,
      }}
    >
      <CarPanelHeader choices={choices} carIdx={car.carIdx} onChoose={choose}>
        {view && !notice && (
          <span data-testid="car-laps-count">{count(lapsHeld, 'lap')}</span>
        )}
        {history.missingLaps > 0 && (
          <span data-testid="car-laps-missing-count" className="text-amber-200">
            {view && !notice ? ' · ' : ''}
            {history.missingLaps} not recorded
          </span>
        )}
      </CarPanelHeader>

      {notice || !view ? (
        <p
          data-testid="car-laps-notice"
          className="flex min-h-0 flex-1 items-center justify-center p-3 text-center text-xs text-slate-400"
        >
          {notice}
        </p>
      ) : (
        <div
          data-testid="car-laps-rows"
          className="min-h-0 flex-1 overflow-auto [scrollbar-color:var(--color-slate-600)_transparent] [scrollbar-width:thin]"
        >
          <div style={{ minWidth: carLapMinWidth(columns) }}>
            <CarLapCaptions
              sectors={columns.sectors}
              energy={columns.energy}
              energyCaption={view.energyIsVirtual === false ? 'Fuel' : 'Energy'}
            />
            {rows.map((row) =>
              row.kind === 'missing' ? (
                <MissingLapsLine
                  key={`missing-${row.from}`}
                  text={missingLapsText(row)}
                />
              ) : (
                <CarLapRow
                  key={row.lap}
                  sectors={columns.sectors}
                  energy={columns.energy}
                  lap={row.lap}
                  time={formatLapTime(row.lapTime)}
                  tone={row.tone}
                  sector1={formatSectorTime(row.sectors[0])}
                  sector2={formatSectorTime(row.sectors[1])}
                  sector3={formatSectorTime(row.sectors[2])}
                  sector1Best={row.sectorBest[0] === true}
                  sector2Best={row.sectorBest[1] === true}
                  sector3Best={row.sectorBest[2] === true}
                  energyUsed={energyText(row)}
                  note={row.note}
                />
              )
            )}
            {rows.length < all.length && (
              <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm text-slate-400">
                <span data-testid="car-laps-older">
                  The {count(all.length - rows.length, 'older row')} are not
                  drawn.
                </span>
                <button
                  type="button"
                  data-testid="car-laps-show-all"
                  onClick={() => setAllOf(car.carIdx)}
                  className="rounded-sm border border-slate-600 bg-slate-900 px-2 py-0.5 text-slate-200 hover:bg-slate-700"
                >
                  Show all
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Car Laps: the laps of one car, newest first, with the sectors, what each
 * lap used and a note on what happened on it. About our own car until
 * another is chosen in its header.
 *
 * Made for a panel of the Pit Wall, where it fills the panel and scrolls
 * inside it under captions that stay; on the overlay it is a window like
 * any other widget.
 *
 * Everything is the race history's: the laps and stints of the one car,
 * read through its bridge when the car's records change. A lap driven while
 * nothing was recording is a quiet line where it would have been.
 */
export const CarLaps = () => {
  const settings = useCarLapsSettings();
  const { isDriving, isWatching } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);

  // On track is driving, or watching a car that is out of its garage.
  if (
    !isSessionVisible ||
    (settings.showOnlyWhenOnTrack && !(isDriving || isWatching))
  ) {
    return <></>;
  }
  return <CarLapsPanel settings={settings} />;
};
