import {
  useDashboard,
  useDrivingState,
  useSessionVisibility,
  type SectorColor,
} from '@irdashies/context';
import {
  deltaTone,
  formatDelta,
  formatLapTime,
  formatSectorTime,
  predictedLapTime,
  type DeltaTone,
} from '@irdashies/domain/lapTiming/deltaDisplay';
import {
  lapTimeTone,
  type LapTimeTone,
} from '@irdashies/domain/lapTiming/lapTimeTone';
import type {
  SectorTile,
  SectorTileState,
} from '@irdashies/domain/lapTiming/sectorTiles';
import type { TimingConfig } from '@irdashies/types';
import { TimingTile } from './components/TimingTile';
import { useTimingReadings } from './hooks/useTimingReadings';
import { useTimingSettings } from './hooks/useTimingSettings';
import { DEMO_TIMING_READINGS, type TimingReadings } from './timingReadings';

/** The text size every `em` in the panel is measured from, at 100 % scale. */
const BASE_FONT_PX = 14;

/** The first row carries the two largest figures and takes a larger share. */
const ROW_LARGE = 'flex min-h-0 flex-[5] gap-1.5';
const ROW_NORMAL = 'flex min-h-0 flex-[4] gap-1.5';
/** More than four sector tiles sit closer together, to leave them width. */
const ROW_DENSE = 'flex min-h-0 flex-[4] gap-1';

const TILE = 'bg-slate-900/70 px-2.5 py-1';
const LAP_TILE = 'bg-sky-500/20 px-2.5 py-1 ring-1 ring-inset ring-sky-400/30';
const BEST_TILE =
  'bg-purple-500/20 px-2.5 py-1 ring-1 ring-inset ring-purple-400/30';
/** The player's best is the session's as well: the tint deepens. */
const BEST_TILE_SESSION =
  'bg-purple-500/30 px-2.5 py-1 ring-1 ring-inset ring-purple-400';

const LARGE = 'text-[1.9em]';
const MEDIUM = 'text-[1.4em]';
/**
 * Sector times shrink with their tile, so a row of six or eight on a track
 * with that many sectors still shows whole figures.
 */
const SMALL = 'text-[length:min(1.1em,29cqw)]';
/** From this many sector tiles the row is drawn closer together. */
const DENSE_SECTOR_TILES = 5;

/** A figure that is not there. */
const PLACEHOLDER = 'text-slate-500';
/** Labels on the two tinted tiles are a step lighter, to hold their own. */
const TINTED_LABEL = 'text-slate-300';

const DELTA_TONE_CLASS: Record<DeltaTone, string> = {
  faster: 'text-green-400',
  slower: 'text-red-400',
  level: 'text-white',
  none: PLACEHOLDER,
};

const LAP_TONE_CLASS: Record<LapTimeTone, string> = {
  invalid: 'text-slate-400',
  sessionBest: 'text-purple-400',
  personalBest: 'text-green-400',
  slower: 'text-white',
  none: PLACEHOLDER,
};

const SECTOR_ACCENT: Record<SectorColor, string> = {
  purple: 'border-purple-400',
  green: 'border-green-400',
  yellow: 'border-yellow-400',
  red: 'border-red-500',
  default: 'border-slate-700',
};

const sectorValueClass = (state: SectorTileState, color: SectorColor) => {
  if (state === 'none') return PLACEHOLDER;
  // The previous lap's time, standing in: the accent keeps its colour and
  // the figure steps back, so a fresh time can be told from an old one.
  if (state === 'stale') return 'text-slate-400';
  return color === 'purple' ? 'text-purple-300' : 'text-white';
};

/** Sector tiles lose their side padding as the row fills up. */
const sectorBoxClass = (dense: boolean, color: SectorColor) =>
  `@container flex-1 border-b-[3px] bg-slate-900/70 py-1 ${
    dense ? 'px-1' : 'px-2.5'
  } ${SECTOR_ACCENT[color]}`;

export interface TimingViewProps {
  settings: TimingConfig;
  readings: TimingReadings;
}

/**
 * The panel as drawn, from one set of readings. Separate from the data hooks
 * so a story or a spec can show any state without a running session.
 */
export const TimingView = ({ settings, readings }: TimingViewProps) => {
  const { tiles, deltaDecimals, lapTimeDecimals, sectorDecimals } = settings;
  const {
    lap,
    delta,
    referenceLapTime,
    lapVoid,
    lastLapTime,
    lastLapInvalid,
    bestLapTime,
    sessionBestLapTime,
    allTimeBestLapTime,
    stintBestLapTime,
    paceLapTime,
    currentLapTime,
    sectors,
    dimmed,
    sectorsHeld,
  } = readings;
  // Figures held from the last time the car was driven step back.
  const dim = dimmed ? ' opacity-60' : '';
  // And the sector times alone while a team-mate drives: they are the
  // user's own, from their last lap at the wheel.
  const sectorDim = dimmed || sectorsHeld ? ' opacity-60' : '';

  /** A lap time tile's figure, coloured by the one rule for lap times. */
  const lapTime = (time: number | null, invalid = false) => {
    const tone = lapTimeTone({
      time,
      invalid,
      sessionBest: sessionBestLapTime,
      personalBest: bestLapTime,
    });
    return {
      value: formatLapTime(time, lapTimeDecimals),
      valueClassName: `${MEDIUM} ${LAP_TONE_CLASS[tone]}${dim}`,
      valueIcon: tone === 'invalid' ? ('warning' as const) : undefined,
    };
  };

  const bestIsSessionBest =
    lapTimeTone({ time: bestLapTime, sessionBest: sessionBestLapTime }) ===
    'sessionBest';
  const predicted = predictedLapTime(referenceLapTime, delta);
  const denseSectors = sectors.length >= DENSE_SECTOR_TILES;

  return (
    <div
      data-testid="timing"
      className="flex h-full w-full flex-col gap-1.5 rounded bg-slate-800/(--bg-opacity) p-2 font-medium text-white"
      style={{
        ['--bg-opacity' as string]: `${settings.background.opacity}%`,
        fontSize: `${(BASE_FONT_PX * settings.scale) / 100}px`,
      }}
    >
      {(tiles.lap || tiles.delta) && (
        <div className={ROW_LARGE}>
          {tiles.lap && (
            <TimingTile
              testId="timing-lap"
              label="Lap"
              value={lap === null ? '--' : String(lap)}
              boxClassName={`flex-[2] ${LAP_TILE}`}
              labelClassName={TINTED_LABEL}
              valueClassName={`${LARGE} ${lap === null ? PLACEHOLDER : 'text-white'}${dim}`}
            />
          )}
          {tiles.delta && (
            <TimingTile
              testId="timing-delta"
              label={lapVoid ? 'Delta · Invalid' : 'Delta'}
              value={formatDelta(delta, deltaDecimals)}
              boxClassName={`flex-[3] ${TILE}`}
              labelClassName={lapVoid ? 'text-amber-300' : undefined}
              valueClassName={`${LARGE} ${
                lapVoid && delta !== null
                  ? 'text-slate-400'
                  : DELTA_TONE_CLASS[deltaTone(delta, deltaDecimals)]
              }`}
            />
          )}
        </div>
      )}
      {(tiles.lastLap || tiles.bestLap) && (
        <div className={ROW_NORMAL}>
          {tiles.lastLap && (
            <TimingTile
              testId="timing-last-lap"
              label="Last Lap"
              boxClassName={`flex-1 ${TILE}`}
              {...lapTime(lastLapTime, lastLapInvalid)}
            />
          )}
          {tiles.bestLap && (
            <TimingTile
              testId="timing-best-lap"
              label="Best Lap"
              value={formatLapTime(bestLapTime, lapTimeDecimals)}
              boxClassName={`flex-1 ${
                bestIsSessionBest ? BEST_TILE_SESSION : BEST_TILE
              }`}
              labelClassName={TINTED_LABEL}
              valueClassName={`${MEDIUM} ${
                bestLapTime === null ? 'text-purple-300/40' : 'text-purple-300'
              }${dim}`}
              labelIcon={bestIsSessionBest ? 'crown' : undefined}
            />
          )}
        </div>
      )}
      {tiles.sectors && (
        <div
          data-testid="timing-sectors"
          className={denseSectors ? ROW_DENSE : ROW_NORMAL}
        >
          {sectors.map((sector: SectorTile) => (
            <TimingTile
              key={sector.index}
              testId={`timing-sector-${sector.index + 1}`}
              label={sector.label}
              value={formatSectorTime(sector.time, sectorDecimals)}
              boxClassName={sectorBoxClass(denseSectors, sector.color)}
              valueClassName={`${SMALL} ${sectorValueClass(sector.state, sector.color)}${sectorDim}`}
              // The mark sits by the figure, as on the last lap, and moves
              // up to the label where the figure fills its tile.
              valueIcon={
                sector.unclean && !denseSectors ? 'warning' : undefined
              }
              labelIcon={sector.unclean && denseSectors ? 'warning' : undefined}
            />
          ))}
        </div>
      )}
      {(tiles.currentLap || tiles.predictedLap) && (
        <div className={ROW_NORMAL}>
          {tiles.currentLap && (
            <TimingTile
              testId="timing-current-lap"
              label="Current"
              value={formatLapTime(currentLapTime, 1)}
              boxClassName={`flex-1 ${TILE}`}
              valueClassName={`${MEDIUM} ${
                currentLapTime === null ? PLACEHOLDER : 'text-white'
              }`}
            />
          )}
          {tiles.predictedLap && (
            <TimingTile
              testId="timing-predicted-lap"
              label="Predicted"
              value={formatLapTime(predicted, lapTimeDecimals)}
              boxClassName={`flex-1 ${TILE}`}
              valueClassName={`${MEDIUM} ${
                predicted === null
                  ? PLACEHOLDER
                  : lapVoid
                    ? 'text-slate-400'
                    : 'text-white'
              }`}
            />
          )}
        </div>
      )}
      {(tiles.sessionBest || tiles.allTimeBest) && (
        <div className={ROW_NORMAL}>
          {tiles.sessionBest && (
            <TimingTile
              testId="timing-session-best"
              label="Session Best"
              boxClassName={`flex-1 ${TILE}`}
              {...lapTime(sessionBestLapTime)}
            />
          )}
          {tiles.allTimeBest && (
            <TimingTile
              testId="timing-all-time-best"
              label="All-Time"
              boxClassName={`flex-1 ${TILE}`}
              {...lapTime(allTimeBestLapTime)}
            />
          )}
        </div>
      )}
      {(tiles.stintBest || tiles.pace) && (
        <div className={ROW_NORMAL}>
          {tiles.stintBest && (
            <TimingTile
              testId="timing-stint-best"
              label="Stint Best"
              boxClassName={`flex-1 ${TILE}`}
              {...lapTime(stintBestLapTime)}
            />
          )}
          {tiles.pace && (
            <TimingTile
              testId="timing-pace"
              label="Pace"
              boxClassName={`flex-1 ${TILE}`}
              {...lapTime(paceLapTime)}
            />
          )}
        </div>
      )}
    </div>
  );
};

interface LiveTimingProps {
  settings: TimingConfig;
  isDriving: boolean;
  /** The user is driving, or watching their own car being driven. */
  isLapLive: boolean;
}

/** The panel on its channels; mounted only while it is on screen. */
const LiveTiming = ({ settings, isDriving, isLapLive }: LiveTimingProps) => {
  const readings = useTimingReadings(settings, isDriving, isLapLive);
  return <TimingView settings={settings} readings={readings} />;
};

/**
 * A block of tiles for the lap in one glance: the lap being driven, the delta
 * to a reference lap, the last and best laps and the sector times, with the
 * current, predicted, session-best, all-time and pace figures as optional
 * rows.
 *
 * It adds no data of its own: every figure is one a channel already carries.
 * The reference is the one the settings choose and only that one; before it
 * exists, and on a lap that was not seen from its start, the delta is dashes.
 *
 * Through a team-mate's stint the lap, the delta and the lap times are the
 * team car's, live; the sector times are held from the user's own last lap.
 * With the camera on another car the panel holds its last figures, as it
 * does out of the car.
 */
export const Timing = () => {
  const settings = useTimingSettings();
  const { isDemoMode } = useDashboard();
  const { isDriving, isWatchingOwnCar } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);
  const isLapLive = isDriving || isWatchingOwnCar;

  if (isDemoMode) {
    return <TimingView settings={settings} readings={DEMO_TIMING_READINGS} />;
  }
  if (!isSessionVisible) return <></>;
  if (settings.showOnlyWhenOnTrack && !isLapLive) return <></>;

  return (
    <LiveTiming
      settings={settings}
      isDriving={isDriving}
      isLapLive={isLapLive}
    />
  );
};
