import { useCallback, useMemo, useRef, useState } from 'react';
import {
  useDrivingState,
  useElementSize,
  useSessionVisibility,
} from '@irdashies/context';
import {
  carRecordNotice,
  raceHistoryReadable,
  usageBudget,
  useCarHistoryState,
  useCarRaceRecords,
  type CarRaceRecord,
} from '@irdashies/domain/raceHistory';
import type {
  RaceChartsConfig,
  RaceChartsLaps,
  RaceChartsTab,
} from '@irdashies/types';
import { buildChart } from './chartModel';
import { ChartControls } from './components/ChartControls';
import { ChartLegend } from './components/ChartLegend';
import { ChartPlot } from './components/ChartPlot';
import {
  useChartCars,
  type ChartCar,
  type ChartRivalCar,
} from './hooks/useChartCars';
import { useRaceChartsSettings } from './hooks/useRaceChartsSettings';

/** The box a chart is laid out in before its own has been measured. */
const FALLBACK_BOX = { width: 640, height: 200 };
/** The height of plot one gridline of the scale is given, CSS pixels. */
const GRIDLINE_ROOM_PX = 26;
/** What of a chart's box is not plot: the lap numbers and the room above. */
const BOX_MARGIN_PX = 30;

const NO_CARS: readonly number[] = [];
const WITHOUT_USAGE: readonly RaceChartsTab[] = ['pace', 'gap'];
const WITH_USAGE: readonly RaceChartsTab[] = ['pace', 'gap', 'usage'];

const count = (many: number, one: string): string =>
  `${many} ${one}${many === 1 ? '' : 's'}`;

// Sized in pixels: the page's own type scale is not the overlay's.
const NOTICE =
  'flex h-full items-center justify-center p-3 text-center text-[12px] text-slate-400';

interface ChartAreaProps {
  tab: RaceChartsTab;
  laps: RaceChartsLaps;
  own: ChartCar;
  ownRecord: CarRaceRecord;
  rivals: readonly ChartRivalCar[];
  /** What has been read of each car so far. */
  records: ReadonlyMap<number, CarRaceRecord>;
  /** The other cars are named by number in the settings. */
  chosen: boolean;
  /** Laps of our car that are not held, over the whole race. */
  missingLaps: number;
}

/**
 * The chart for the tab and the laps chosen, in the room under the bar: a
 * line saying what the scale counts, the plot at whatever size is left, and
 * the legend. Where there is nothing to draw the plot's box says why.
 */
const ChartArea = ({
  tab,
  laps,
  own,
  ownRecord,
  rivals,
  records,
  chosen,
  missingLaps,
}: ChartAreaProps) => {
  const box = useRef<HTMLDivElement>(null);
  const measured = useElementSize(box);
  const isMeasured = measured.width > 0 && measured.height > 0;
  const { width, height } = isMeasured ? measured : FALLBACK_BOX;
  const maxLines = Math.min(
    6,
    Math.max(2, Math.floor((height - BOX_MARGIN_PX) / GRIDLINE_ROOM_PX))
  );

  const chart = useMemo(
    () =>
      buildChart({
        tab,
        laps,
        own: { ...own, record: ownRecord },
        rivals: rivals.map((rival) => ({
          ...rival,
          record: records.get(rival.carIdx),
        })),
        chosen,
        maxLines,
      }),
    [tab, laps, own, ownRecord, rivals, records, chosen, maxLines]
  );
  const [model, notice] =
    typeof chart === 'string' ? [null, chart] : [chart, null];

  return (
    <>
      {model && (
        <div className="flex flex-none items-baseline justify-between gap-3 px-2 pt-1 text-[11px] leading-4 text-slate-400">
          <span data-testid="race-charts-caption">{model.caption}</span>
          {missingLaps > 0 && (
            <span
              data-testid="race-charts-missing"
              className="whitespace-nowrap text-amber-200"
            >
              {count(missingLaps, 'lap')} not recorded
            </span>
          )}
        </div>
      )}
      {/* Not clipped: the readout of a lap may reach down over the legend. */}
      <div ref={box} className="min-h-0 flex-1">
        {model ? (
          // Drawn once its box is known: a frame at another size would
          // show as a jump.
          <div className={isMeasured ? 'h-full' : 'invisible h-full'}>
            <ChartPlot model={model} width={width} height={height} />
          </div>
        ) : (
          <p data-testid="race-charts-notice" className={NOTICE}>
            {notice}
          </p>
        )}
      </div>
      {model && <ChartLegend entries={model.legend} />}
    </>
  );
};

/**
 * The panel itself, with everything it reads. Apart from the shell below so
 * that a panel hidden by its session or by "only on track" reads nothing:
 * reading the race history's summary is what has a race recorded.
 */
const RaceChartsPanel = ({ settings }: { settings: RaceChartsConfig }) => {
  const readable = raceHistoryReadable();
  const cars = useChartCars(settings.others, settings.carNumbers);
  const records = useCarRaceRecords(readable ? cars.carIdxs : NO_CARS);
  const own = cars.own;
  const history = useCarHistoryState(readable && own ? own.carIdx : null);

  // The chart and its laps start from the settings, and go back to them
  // when they are changed on the settings page.
  const saved = `${settings.tab}:${settings.laps}`;
  const [view, setView] = useState({
    saved,
    tab: settings.tab,
    laps: settings.laps,
  });
  if (view.saved !== saved) {
    setView({ saved, tab: settings.tab, laps: settings.laps });
  }
  const onTab = useCallback(
    (tab: RaceChartsTab) => setView((now) => ({ ...now, tab })),
    []
  );
  const onLaps = useCallback(
    (laps: RaceChartsLaps) => setView((now) => ({ ...now, laps })),
    []
  );

  // A session we have no car in: there is nobody for the charts to be about.
  if (!own) return <></>;

  const ownRecord = records.get(own.carIdx);
  // Nothing is published of what a car has left under iRacing, and the
  // chart of it is then not offered.
  const hasUsage = usageBudget(ownRecord) !== null;
  const tab = view.tab === 'usage' && !hasUsage ? 'pace' : view.tab;
  const notice = carRecordNotice({
    readable,
    recording: history.recording,
    read: ownRecord !== undefined,
  });

  return (
    <div
      data-testid="race-charts"
      data-car={own.carIdx}
      data-tab={tab}
      className="flex h-full w-full flex-col overflow-hidden rounded bg-slate-800/(--bg-opacity) text-slate-200 tabular-nums"
      style={{
        ['--bg-opacity' as string]: `${settings.background.opacity}%`,
      }}
    >
      <ChartControls
        tabs={hasUsage ? WITH_USAGE : WITHOUT_USAGE}
        tab={tab}
        laps={view.laps}
        onTab={onTab}
        onLaps={onLaps}
      />

      {notice || !ownRecord ? (
        <div className="min-h-0 flex-1">
          <p data-testid="race-charts-notice" className={NOTICE}>
            {notice}
          </p>
        </div>
      ) : (
        <ChartArea
          tab={tab}
          laps={view.laps}
          own={own}
          ownRecord={ownRecord}
          rivals={cars.rivals}
          records={records}
          chosen={settings.others === 'chosen'}
          missingLaps={history.missingLaps}
        />
      )}
    </div>
  );
};

/**
 * Race Charts: our car's race lap by lap, one chart at a time. Pace is its
 * lap times, the line in the colour of whoever drove, with up to three
 * other cars as thinner lines. Gap is those cars against ours at the line.
 * Usage is what each lap of ours took of what the car runs on, where the
 * sim publishes that.
 *
 * Made for a panel of the Pit Wall, where it fills the panel; on the
 * overlay it is a window like any other widget.
 *
 * Everything drawn is the race history's: the laps and stints of each car
 * shown, read through its bridge when that car's records change. A lap
 * driven while nothing was recording is a break in the line over a hatched
 * band, never a guess.
 */
export const RaceCharts = () => {
  const settings = useRaceChartsSettings();
  const { isDriving, isWatchingOwnCar } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);

  // The charts are about our own car: on track is driving it, or watching
  // it while a team-mate does.
  if (
    !isSessionVisible ||
    (settings.showOnlyWhenOnTrack && !(isDriving || isWatchingOwnCar))
  ) {
    return <></>;
  }
  return <RaceChartsPanel settings={settings} />;
};
