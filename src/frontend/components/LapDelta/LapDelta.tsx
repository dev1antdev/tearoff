import { memo } from 'react';
import {
  useDashboard,
  useDrivingState,
  useLapDeltaSnapshot,
  useSessionVisibility,
} from '@irdashies/context';
import type { LapDeltaConfig, LapDeltaReference } from '@irdashies/types';
import { useLapDeltaSettings } from './hooks/useLapDeltaSettings';
import {
  REFERENCE_LABELS,
  deltaTone,
  formatDelta,
  formatLapTime,
  predictedLapTime,
  trendFill,
  type DeltaTone,
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

/** What demo mode shows: a lap a third of a second up and still gaining. */
const DEMO_READING: LapDeltaReference = {
  lapTime: 98.556,
  delta: -0.342,
  trend: -0.11,
};

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
  /** The reading for the reference the settings choose. */
  reading: LapDeltaReference;
}

/**
 * The widget as drawn, from one reading. Separate from the data hooks so a
 * story or a spec can show any state without a running session.
 */
export const LapDeltaView = ({ settings, reading }: LapDeltaViewProps) => {
  const { lapTime, delta, trend } = reading;
  const fill = trendFill(trend, settings.trendRange);

  return (
    <div
      className="flex h-full w-full flex-col justify-center gap-1.5 rounded bg-slate-800/(--bg-opacity) px-3 py-2 font-medium text-white"
      style={{
        ['--bg-opacity' as string]: `${settings.background.opacity}%`,
      }}
    >
      <div
        data-testid="lap-delta-value"
        className={`text-center text-4xl font-bold leading-none tabular-nums ${TONE_CLASS[deltaTone(delta, settings.decimals)]}`}
      >
        {formatDelta(delta, settings.decimals)}
      </div>
      {settings.showTrend && (
        <TrendBar side={fill.side} percent={Math.round(fill.fraction * 100)} />
      )}
      {(settings.showPredictedLap || settings.showReferenceLap) && (
        <div className="flex flex-col gap-0.5 text-xs leading-tight tabular-nums">
          {settings.showPredictedLap && (
            <TimeRow
              label="Predicted"
              value={formatLapTime(predictedLapTime(lapTime, delta))}
            />
          )}
          {settings.showReferenceLap && (
            <TimeRow
              label={REFERENCE_LABELS[settings.reference]}
              value={formatLapTime(lapTime)}
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
 * The reference is the one the settings choose and only that one. Before it
 * exists, and on a lap that was not seen from its start, the figures are
 * dashes.
 */
export const LapDelta = () => {
  const settings = useLapDeltaSettings();
  const snapshot = useLapDeltaSnapshot();
  const { isDemoMode } = useDashboard();
  const { isDriving } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);

  if (isDemoMode) {
    return <LapDeltaView settings={settings} reading={DEMO_READING} />;
  }
  if (!isSessionVisible) return <></>;
  if (settings.showOnlyWhenOnTrack && !isDriving) return <></>;

  return (
    <LapDeltaView
      settings={settings}
      reading={snapshot?.[settings.reference] ?? NO_READING}
    />
  );
};
