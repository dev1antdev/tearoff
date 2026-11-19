import { memo } from 'react';
import {
  useDashboard,
  useDrivingState,
  useLapDeltaSnapshot,
  useSessionVisibility,
} from '@irdashies/context';
import {
  deltaTone,
  formatDelta,
  formatLapTime,
  type DeltaTone,
} from '@irdashies/domain/lapTiming/deltaDisplay';
import type { LapDeltaConfig, LapDeltaReference } from '@irdashies/types';
import { useLapDeltaSettings } from './hooks/useLapDeltaSettings';
import { useLapFinalHold } from './hooks/useLapFinalHold';
import {
  lapDeltaFigures,
  trendFill,
  type LapDeltaReadings,
  type TrendFill,
} from './lapDeltaDisplay';

const TONE_CLASS: Record<DeltaTone, string> = {
  faster: 'text-green-400',
  slower: 'text-red-400',
  level: 'text-white',
  none: 'text-slate-500',
};

const NO_READING: LapDeltaReference = {
  lapTime: null,
  delta: null,
  trend: null,
};

const NO_READINGS: LapDeltaReadings = {
  sessionBest: NO_READING,
  allTime: NO_READING,
  stintBest: NO_READING,
  lastLap: NO_READING,
  lastLapFinal: null,
};

/**
 * What demo mode shows: a lap a third of a second up on the session best and
 * still gaining, a few laps into a stint.
 */
const DEMO_READINGS: LapDeltaReadings = {
  sessionBest: { lapTime: 98.556, delta: -0.342, trend: -0.11 },
  allTime: { lapTime: 97.91, delta: 0.304, trend: -0.11 },
  stintBest: { lapTime: 98.802, delta: -0.588, trend: -0.11 },
  lastLap: { lapTime: 99.137, delta: -0.923, trend: -0.11 },
  lastLapFinal: null,
};

/** The readings with nothing live in them: the laps named, no delta. */
const withoutDeltas = (readings: LapDeltaReadings): LapDeltaReadings => ({
  sessionBest: { ...readings.sessionBest, delta: null, trend: null },
  allTime: { ...readings.allTime, delta: null, trend: null },
  stintBest: { ...readings.stintBest, delta: null, trend: null },
  lastLap: { ...readings.lastLap, delta: null, trend: null },
  lastLapFinal: null,
});

interface TrendBarProps {
  side: TrendFill['side'];
  /** How much of its half the bar fills, in whole percent. */
  percent: number;
}

/**
 * Whether time is being gained or lost right now, and how fast.
 *
 * Fills from the middle: left and green while gaining on the reference, right
 * and red while losing to it, the same way round as the sign on the delta.
 * Whole percent in, so a trend that has not visibly moved redraws nothing.
 */
const TrendBar = memo(({ side, percent }: TrendBarProps) => (
  <div
    role="img"
    aria-label={
      side === 'faster'
        ? 'Gaining time'
        : side === 'slower'
          ? 'Losing time'
          : 'Holding the gap'
    }
    className="relative h-2 w-full flex-none overflow-hidden rounded-full bg-slate-900/70"
  >
    <div
      data-testid="trend-faster"
      className="absolute inset-y-0 right-1/2 rounded-l-full bg-green-500 transition-[width] duration-150 ease-linear"
      style={{ width: side === 'faster' ? `${percent / 2}%` : 0 }}
    />
    <div
      data-testid="trend-slower"
      className="absolute inset-y-0 left-1/2 rounded-r-full bg-red-500 transition-[width] duration-150 ease-linear"
      style={{ width: side === 'slower' ? `${percent / 2}%` : 0 }}
    />
    <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-300" />
  </div>
));
TrendBar.displayName = 'TrendBar';

interface DeltaCellProps {
  /** S, A, T or L: which reference the delta is to. */
  letter: string;
  /** The delta as text, and its tone. */
  text: string;
  tone: DeltaTone;
  testId: string;
}

/** One of the other references, in the strip under the trend bar. */
const DeltaCell = memo(({ letter, text, tone, testId }: DeltaCellProps) => (
  <span data-testid={testId} className="inline-flex items-baseline gap-1">
    <span className="text-slate-400">{letter}</span>
    <span className={`font-semibold ${TONE_CLASS[tone]}`}>{text}</span>
  </span>
));
DeltaCell.displayName = 'DeltaCell';

interface TimeRowProps {
  label: string;
  value: string;
}

const TimeRow = memo(({ label, value }: TimeRowProps) => (
  <div className="flex items-baseline justify-between gap-2">
    <span className="text-slate-400">{label}</span>
    <span className="font-semibold">{value}</span>
  </div>
));
TimeRow.displayName = 'TimeRow';

interface LapDeltaViewProps {
  settings: LapDeltaConfig;
  /** The lap against each reference, and the last lap's result. */
  readings: LapDeltaReadings;
  /**
   * The result of the lap just finished is being held: the large figure and
   * the strip show it rather than the live delta.
   */
  held?: boolean;
}

/**
 * The widget as drawn, from one set of readings. Separate from the data hooks
 * so a story or a spec can show any state without a running session.
 */
export const LapDeltaView = ({
  settings,
  readings,
  held = false,
}: LapDeltaViewProps) => {
  const { decimals } = settings;
  const figures = lapDeltaFigures(readings, settings, held);
  const fill = trendFill(figures.trend, settings.trendRange);

  return (
    <div
      className="flex h-full w-full flex-col justify-center gap-1.5 overlay-panel px-3 py-2 font-medium text-white"
      style={{
        ['--bg-opacity' as string]: `${settings.background.opacity}%`,
      }}
    >
      <div
        data-testid="lap-delta-value"
        className={`text-center text-4xl font-bold leading-none tabular-nums ${TONE_CLASS[deltaTone(figures.delta, decimals)]}`}
      >
        {formatDelta(figures.delta, decimals)}
      </div>
      {settings.showTrend && (
        <TrendBar side={fill.side} percent={Math.round(fill.fraction * 100)} />
      )}
      {figures.cells.length > 0 && (
        <div
          data-testid="lap-delta-strip"
          className="flex justify-around gap-2 text-xs leading-tight tabular-nums"
        >
          {figures.cells.map((cell) => (
            <DeltaCell
              key={cell.key}
              testId={`lap-delta-cell-${cell.key}`}
              letter={cell.letter}
              text={formatDelta(cell.delta, decimals)}
              tone={deltaTone(cell.delta, decimals)}
            />
          ))}
        </div>
      )}
      {(settings.showPredictedLap || settings.showReferenceLap) && (
        <div className="flex flex-col gap-0.5 text-xs leading-tight tabular-nums">
          {settings.showPredictedLap && (
            <TimeRow
              label="Predicted"
              value={formatLapTime(figures.predictedLapTime)}
            />
          )}
          {settings.showReferenceLap && (
            <TimeRow
              label={figures.lapLabel}
              value={formatLapTime(figures.lapTime)}
            />
          )}
        </div>
      )}
    </div>
  );
};

/**
 * The lap being driven against one of the player's own laps: how far up or
 * down it is, whether that is getting better or worse, and the lap time it is
 * heading for.
 *
 * The reference is the one the settings choose and only that one: the best
 * lap of the session, of all time or of the stint, or the lap before this
 * one. Before it exists, and on a lap that was not seen from its start, the
 * figures are dashes. The other references can be shown beside it in a
 * strip, and for a few seconds after the line the result of the lap just
 * finished takes the place of the live delta.
 *
 * Through a team-mate's stint the lap is theirs, in the user's own car,
 * against the user's references: none of a team-mate's laps becomes one.
 * With the camera on another car there is no delta: the figure would still
 * be the team car's.
 */
export const LapDelta = () => {
  const settings = useLapDeltaSettings();
  const snapshot = useLapDeltaSnapshot();
  const { isDemoMode } = useDashboard();
  const { isDriving, isWatchingOwnCar, isWatchingOtherCar } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);
  // Followed whether or not the widget is drawn, so a lap that ends while
  // it is hidden is not taken for news when it comes back.
  const held = useLapFinalHold(
    snapshot === undefined
      ? undefined
      : (snapshot.lastLapFinal?.completedAt ?? null),
    settings.freezeSeconds
  );

  if (isDemoMode) {
    return <LapDeltaView settings={settings} readings={DEMO_READINGS} />;
  }
  if (!isSessionVisible) return <></>;
  if (settings.showOnlyWhenOnTrack && !(isDriving || isWatchingOwnCar)) {
    return <></>;
  }

  const readings = snapshot ?? NO_READINGS;
  // With the camera on another car the lap being timed is still the team
  // car's: the laps are named, and nothing live is shown over that picture.
  return isWatchingOtherCar ? (
    <LapDeltaView settings={settings} readings={withoutDeltas(readings)} />
  ) : (
    <LapDeltaView settings={settings} readings={readings} held={held} />
  );
};
