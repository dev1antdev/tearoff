import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useCarIdxLapAverage,
  useCarIdxStintPace,
  useCarPitSnapshot,
  useCarSectorsSnapshot,
  useDriverCarIdx,
  useDrivingState,
  useElementSize,
  useLapTimesStoreUpdater,
  usePitLaneStore,
  useSessionDrivers,
  useSessionVisibility,
  useWeekendInfoNumCarClasses,
} from '@irdashies/context';
import type { Gap, Standings } from '@irdashies/domain';
import { carSectorMarks } from '@irdashies/domain/sectors/sectorMarks';
import { useFieldStandings } from '@irdashies/domain/standings/overallStandings';
import { useCarClassStats } from '@irdashies/domain/standings/useCarClassStats';
import { useHighlightColor } from '@irdashies/domain/standings/useHighlightColor';
import type {
  LapAverageLaps,
  StintPaceReference,
  TimingTowerConfig,
} from '@irdashies/types';
import { TowerHeader } from './components/TowerHeader';
import { TowerRow } from './components/TowerRow';
import { useTimingTowerSettings } from './hooks/useTimingTowerSettings';
import { useViewSetting } from './hooks/useViewSetting';
import {
  enabledTowerColumns,
  fitTowerColumns,
  towerColumn,
} from './towerColumns';
import { ALL_TAB, resolveTowerTab, towerTabs, towerTag } from './towerRows';
import { showOwnRow } from './towerScroll';

const NO_ROWS: Standings[] = [];

const ALIGN_CLASS = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
} as const;

/** A count the pit tracker publishes, or null where it has none. */
const countAt = (
  values: readonly number[] | undefined,
  carIdx: number
): number | null => {
  const value = values?.[carIdx];
  return typeof value === 'number' && value >= 0 ? value : null;
};

const isGap = (value: number | Gap | undefined): value is Gap =>
  typeof value === 'object' && value !== null;

/**
 * The table itself, with everything it reads. Apart from the shell below
 * so that a tower hidden by its session or by "only on track" reads
 * nothing: reading the race history's summary is what has a race recorded.
 */
const TowerTable = ({ settings }: { settings: TimingTowerConfig }) => {
  // What is chosen in the header lives here: a tower hosted on the Pit Wall
  // has no way to save, and one on the overlay is not asked to.
  const [chosenTab, setChosenTab] = useState<string | null>(null);
  // Anything but a stored "all", or a stored "driver", is the default: a
  // saved dashboard is not trusted to hold one of the two values.
  const [averagesOver, setAveragesOver] = useViewSetting<LapAverageLaps>(
    settings.averagesOver === 'all' ? 'all' : 'clean'
  );
  const [paceAgainst, setPaceAgainst] = useViewSetting<StintPaceReference>(
    settings.paceAgainst === 'driver' ? 'driver' : 'stint'
  );

  const field = useFieldStandings(chosenTab === ALL_TAB);
  const classStats = useCarClassStats();
  const drivers = useSessionDrivers();
  // Our own entry, which stays ours while a team-mate drives it and while
  // the camera is on another car: the one the Pit Wall's header is about.
  const ownCarIdx = useDriverCarIdx();
  const ownClassId = useMemo(() => {
    const own = drivers?.find((driver) => driver.CarIdx === ownCarIdx);
    return own ? String(own.CarClassID) : undefined;
  }, [drivers, ownCarIdx]);
  const isMultiClass = (useWeekendInfoNumCarClasses() ?? 0) > 1;
  const highlightColor = useHighlightColor();
  const pitExitPct = usePitLaneStore((state) => state.pitExitPct);
  const pitExitAfterSF = pitExitPct !== null && pitExitPct > 0.85;

  const avgLast5On = settings.avgLast5.enabled;
  const avgLast10On = settings.avgLast10.enabled;
  const stintPaceOn = settings.stintPace.enabled;
  useLapTimesStoreUpdater(avgLast5On || avgLast10On);
  const avgLast5 = useCarIdxLapAverage(5, averagesOver, avgLast5On);
  const avgLast10 = useCarIdxLapAverage(10, averagesOver, avgLast10On);
  const stintPace = useCarIdxStintPace(paceAgainst, stintPaceOn);
  const sectors = useCarSectorsSnapshot(settings.sectors.enabled);
  const carPit = useCarPitSnapshot(
    settings.pitStops.enabled || settings.stintLaps.enabled
  );

  const tabs = useMemo(
    () => towerTabs(field.classes, classStats),
    [field.classes, classStats]
  );
  const activeTab = resolveTowerTab(chosenTab, tabs, ownClassId, field.classes);
  const isOverall = activeTab === ALL_TAB;
  const rows = isOverall
    ? field.overall
    : (field.classes.find(([classId]) => classId === activeTab)?.[1] ??
      NO_ROWS);

  // Decided over the whole field, so that the columns are the same on
  // every tab.
  const { hasEnergy, hasTeams } = useMemo(() => {
    let energy = false;
    let teams = false;
    for (const [, classRows] of field.classes) {
      for (const row of classRows) {
        if (row.energyRemaining !== undefined) energy = true;
        // iRacing names a solo driver's team after the driver.
        const team = row.driver.teamName;
        if (team && team !== row.driver.name) teams = true;
      }
    }
    return { hasEnergy: energy, hasTeams: teams };
  }, [field.classes]);
  const showTeam = settings.driver.team && hasTeams;

  const scroller = useRef<HTMLDivElement>(null);
  const { width } = useElementSize(scroller);
  const sectorsAvailable = sectors?.available === true;
  const columns = useMemo(
    () =>
      fitTowerColumns(
        enabledTowerColumns(settings, {
          sectors: sectorsAvailable,
          energy: hasEnergy,
        }),
        width
      ),
    [settings, sectorsAvailable, hasEnergy, width]
  );

  // Our car's row is kept where it can be read: brought into view when the
  // list changes to another tab, and again whenever its place in the list
  // moves, as it does when the order first arrives and at every stop. Only
  // until somebody scrolls the list themselves: from then on it is theirs
  // to place, until they change tab.
  const following = useRef(true);
  const stopFollowing = useCallback(() => {
    following.current = false;
  }, []);
  const ownIndex = rows.findIndex((row) => row.carIdx === ownCarIdx);
  useEffect(() => {
    following.current = true;
  }, [activeTab]);
  useEffect(() => {
    if (following.current && scroller.current) showOwnRow(scroller.current);
  }, [activeTab, ownIndex, showTeam]);

  const onTabChange = useCallback((tab: string) => setChosenTab(tab), []);

  // No session, or one with no cars in it yet: nothing to list.
  if (rows.length === 0) return <></>;

  return (
    <div
      data-testid="timing-tower"
      className="flex h-full w-full flex-col overflow-hidden rounded-sm bg-slate-800/(--bg-opacity) text-white tabular-nums"
      style={{
        ['--bg-opacity' as string]: `${settings.background.opacity}%`,
      }}
    >
      <TowerHeader
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={onTabChange}
        averagesOver={avgLast5On || avgLast10On ? averagesOver : undefined}
        onAveragesOverChange={setAveragesOver}
        paceAgainst={stintPaceOn ? paceAgainst : undefined}
        onPaceAgainstChange={setPaceAgainst}
        cars={rows.length}
      />
      <div
        ref={scroller}
        data-testid="tower-scroller"
        // Every way of scrolling it by hand: the wheel, a finger, the
        // scrollbar, the keys.
        onWheel={stopFollowing}
        onTouchMove={stopFollowing}
        onPointerDown={stopFollowing}
        onKeyDown={stopFollowing}
        // A slim scrollbar whose place is kept while there is nothing to
        // scroll, so that the columns do not move when the list grows.
        className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto [scrollbar-color:var(--color-slate-600)_transparent] [scrollbar-gutter:stable] [scrollbar-width:thin]"
      >
        <table className="w-full table-fixed border-collapse text-[13px] leading-tight">
          <colgroup>
            {columns.map((id) => {
              const { width: columnWidth } = towerColumn(id);
              return (
                <col
                  key={id}
                  style={
                    columnWidth === null
                      ? undefined
                      : { width: `${columnWidth}px` }
                  }
                />
              );
            })}
          </colgroup>
          <thead>
            <tr>
              {columns.map((id) => {
                const column = towerColumn(id);
                return (
                  <th
                    key={id}
                    scope="col"
                    data-column={id}
                    title={column.title}
                    className={`sticky top-0 z-10 bg-slate-900 px-1 py-1.5 text-[11px] font-normal tracking-wider whitespace-nowrap text-slate-400 uppercase ${ALIGN_CLASS[column.align]}`}
                  >
                    {column.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const marks = carSectorMarks(
                sectors,
                row.carIdx,
                row.carClass.id
              );
              const interval = row.interval;
              return (
                <TowerRow
                  key={row.carIdx}
                  carIdx={row.carIdx}
                  columns={columns}
                  position={isOverall ? row.position : row.classPosition}
                  carNumber={row.driver.carNum}
                  classColor={row.carClass.color}
                  highlightColor={highlightColor}
                  isMultiClass={isMultiClass}
                  name={row.driver.name}
                  nameFormat={settings.driver.nameFormat}
                  team={showTeam ? (row.driver.teamName ?? '') : undefined}
                  tag={
                    settings.driver.status
                      ? towerTag(
                          row,
                          field.inGarage[row.carIdx] === true,
                          pitExitAfterSF
                        )
                      : null
                  }
                  isOwn={row.carIdx === ownCarIdx}
                  dimmed={!row.onTrack || row.onPitRoad}
                  isLeader={index === 0}
                  gapValue={row.gap?.value}
                  gapLaps={row.gap?.laps ?? 0}
                  intervalValue={isGap(interval) ? interval.value : interval}
                  intervalLaps={isGap(interval) ? interval.laps : 0}
                  lastTime={row.lastTime}
                  lastTimeState={row.lastTimeState}
                  lastLapInvalid={row.lastLapInvalid === true}
                  bestTime={row.fastestTime}
                  hasClassBest={row.hasFastestTime}
                  avgLast5={avgLast5[row.carIdx]}
                  avgLast10={avgLast10[row.carIdx]}
                  stintPace={stintPace[row.carIdx]}
                  sector1={marks[0]}
                  sector2={marks[1]}
                  sector3={marks[2]}
                  pitStops={countAt(carPit?.stops, row.carIdx)}
                  stintLaps={countAt(carPit?.stintLaps, row.carIdx)}
                  energy={row.energyRemaining}
                  energyIsVirtual={row.energyIsVirtual}
                  tireCompound={row.tireCompound}
                  wheelCompounds={row.wheelCompounds}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/**
 * The timing tower: the whole field in one dense table, a row a car, a tab
 * for each class and one for all of them.
 *
 * Made for a panel of the Pit Wall, where it fills the panel and scrolls
 * inside it under a header row that stays; on the overlay it is a window
 * like any other widget.
 *
 * It works nothing out itself. The rows, places and gaps are the
 * Standings' (`useFieldStandings`), the averages the shared rule's, the
 * pace of a stint the race history's, the sectors, stops and stints their
 * channels'. It keeps only what is chosen in its header.
 */
export const TimingTower = () => {
  const settings = useTimingTowerSettings();
  const { isDriving, isWatching } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);

  // On track is driving, or watching a car that is out of its garage.
  if (
    !isSessionVisible ||
    (settings.showOnlyWhenOnTrack && !(isDriving || isWatching))
  ) {
    return <></>;
  }
  return <TowerTable settings={settings} />;
};
