import { memo } from 'react';
import {
  trackStateSelectors,
  useDashboard,
  useDrivingState,
  useSessionVisibility,
  useTrackStateSelector,
} from '@irdashies/context';
import {
  NO_CORNER_READING,
  type CornerResult,
} from '@irdashies/domain/cornerDelta/cornerReadings';
import type { CornerDeltaConfig } from '@irdashies/types';
import { resolveSpeedUnit, type SpeedUnit } from '@irdashies/utils/units';
import { useCornerDeltaSettings } from './hooks/useCornerDeltaSettings';
import { useCornerResults } from './hooks/useCornerResults';
import {
  REFERENCE_LABELS,
  formatSpeed,
  formatSpeedDelta,
  formatTimeDelta,
  speedTone,
  timeTone,
  type DeltaTone,
} from './cornerDeltaDisplay';

const TONE_CLASS: Record<DeltaTone, string> = {
  faster: 'text-green-400',
  slower: 'text-red-400',
  level: 'text-white',
  none: 'text-slate-500',
};

const NO_LABELS: ReadonlyMap<string, string> = new Map();

interface SpeedCellProps {
  label: string;
  unit: SpeedUnit;
  /** The speed driven, as drawn. */
  speed: string;
  /** False before any corner has been driven, when the speed is dashes. */
  driven: boolean;
  /** How it compares with the reference, as drawn. */
  delta: string;
  tone: DeltaTone;
}

/** The speed at one end of the corner, and how it compares. */
const SpeedCell = memo(
  ({ label, unit, speed, driven, delta, tone }: SpeedCellProps) => (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-sm bg-slate-900/50 px-2 py-1 leading-tight">
      <span className="text-[10px] uppercase tracking-wide text-slate-400">
        {label} <span className="normal-case text-slate-500">{unit}</span>
      </span>
      <div className="flex items-baseline justify-between gap-1 tabular-nums">
        <span
          className={`text-lg font-bold leading-none ${driven ? '' : 'text-slate-500'}`}
        >
          {speed}
        </span>
        <span className={`text-sm font-semibold ${TONE_CLASS[tone]}`}>
          {delta}
        </span>
      </div>
    </div>
  )
);
SpeedCell.displayName = 'SpeedCell';

interface HistoryRowProps {
  label: string;
  time: string;
  timeTone: DeltaTone;
  /** Null where the column is switched off. */
  entry: string | null;
  entryTone: DeltaTone;
  exit: string | null;
  exitTone: DeltaTone;
}

/** One line of the list of earlier corners; the header row uses it too. */
const HistoryRow = memo(
  ({
    label,
    time,
    timeTone: timeToneName,
    entry,
    entryTone,
    exit,
    exitTone,
  }: HistoryRowProps) => (
    <div className="flex items-baseline gap-2">
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span
        className={`w-14 flex-none text-right font-semibold ${TONE_CLASS[timeToneName]}`}
      >
        {time}
      </span>
      {entry !== null && (
        <span className={`w-10 flex-none text-right ${TONE_CLASS[entryTone]}`}>
          {entry}
        </span>
      )}
      {exit !== null && (
        <span className={`w-10 flex-none text-right ${TONE_CLASS[exitTone]}`}>
          {exit}
        </span>
      )}
    </div>
  )
);
HistoryRow.displayName = 'HistoryRow';

export interface CornerDeltaViewProps {
  settings: CornerDeltaConfig;
  /** The unit speeds are drawn in, already resolved from the setting. */
  unit: SpeedUnit;
  /** The corners completed, newest first. */
  results: readonly CornerResult[];
  /** The label of each corner by section id; a result's own is the fallback. */
  labels?: ReadonlyMap<string, string>;
  /** False when the track is known to have no corner data. */
  hasCorners?: boolean;
}

/**
 * The widget as drawn, from the corners completed. Separate from the data
 * hooks so a story or a spec can show any state without a running session.
 */
export const CornerDeltaView = ({
  settings,
  unit,
  results,
  labels = NO_LABELS,
  hasCorners,
}: CornerDeltaViewProps) => {
  const { reference, decimals, showEntrySpeed, showExitSpeed } = settings;
  const frame = (children: React.ReactNode) => (
    <div
      className="flex h-full w-full flex-col gap-1.5 rounded bg-slate-800/(--bg-opacity) px-3 py-2 font-medium text-white"
      style={{
        ['--bg-opacity' as string]: `${settings.background.opacity}%`,
      }}
    >
      {children}
    </div>
  );

  if (hasCorners === false) {
    return frame(
      <div className="flex flex-1 items-center justify-center text-center text-xs text-slate-400">
        No corner data for this track
      </div>
    );
  }

  const last = results[0];
  const reading = last?.readings[reference] ?? NO_CORNER_READING;
  const earlier = results.slice(1, 1 + settings.historyCount);
  const labelOf = (result: CornerResult) =>
    labels.get(result.sectionId) ?? result.label;

  return frame(
    <>
      <div className="flex items-baseline justify-between gap-2 leading-tight">
        <span
          data-testid="corner-delta-label"
          className={`min-w-0 truncate text-sm font-bold ${last ? '' : 'text-slate-500'}`}
        >
          {last ? labelOf(last) : 'No corner yet'}
        </span>
        <span className="flex-none text-[10px] uppercase tracking-wide text-slate-400">
          {REFERENCE_LABELS[reference]}
        </span>
      </div>
      <div
        data-testid="corner-delta-value"
        className={`text-center text-4xl font-bold leading-none tabular-nums ${TONE_CLASS[timeTone(reading.timeDeltaSec, decimals)]}`}
      >
        {formatTimeDelta(reading.timeDeltaSec, decimals)}
      </div>
      {(showEntrySpeed || showExitSpeed) && (
        <div className="flex gap-1.5">
          {showEntrySpeed && (
            <SpeedCell
              label="Entry"
              unit={unit}
              speed={formatSpeed(last?.entrySpeedKph ?? null, unit)}
              driven={!!last}
              delta={formatSpeedDelta(reading.entrySpeedDeltaKph, unit)}
              tone={speedTone(reading.entrySpeedDeltaKph, unit)}
            />
          )}
          {showExitSpeed && (
            <SpeedCell
              label="Exit"
              unit={unit}
              speed={formatSpeed(last?.exitSpeedKph ?? null, unit)}
              driven={!!last}
              delta={formatSpeedDelta(reading.exitSpeedDeltaKph, unit)}
              tone={speedTone(reading.exitSpeedDeltaKph, unit)}
            />
          )}
        </div>
      )}
      {earlier.length > 0 && (
        <div
          data-testid="corner-delta-history"
          className="flex flex-col gap-0.5 border-t border-slate-600/60 pt-1 text-xs leading-tight tabular-nums text-slate-300"
        >
          <div className="text-[10px] uppercase tracking-wide text-slate-500">
            <HistoryRow
              label="Earlier"
              time="Time"
              timeTone="none"
              entry={showEntrySpeed ? 'In' : null}
              entryTone="none"
              exit={showExitSpeed ? 'Out' : null}
              exitTone="none"
            />
          </div>
          {earlier.map((result) => {
            const row = result.readings[reference];
            return (
              <HistoryRow
                key={result.serial}
                label={labelOf(result)}
                time={formatTimeDelta(row.timeDeltaSec, decimals)}
                timeTone={timeTone(row.timeDeltaSec, decimals)}
                entry={
                  showEntrySpeed
                    ? formatSpeedDelta(row.entrySpeedDeltaKph, unit)
                    : null
                }
                entryTone={speedTone(row.entrySpeedDeltaKph, unit)}
                exit={
                  showExitSpeed
                    ? formatSpeedDelta(row.exitSpeedDeltaKph, unit)
                    : null
                }
                exitTone={speedTone(row.exitSpeedDeltaKph, unit)}
              />
            );
          })}
        </div>
      )}
    </>
  );
};

const demoResult = (
  serial: number,
  label: string,
  entrySpeedKph: number,
  exitSpeedKph: number,
  timeDeltaSec: number,
  entrySpeedDeltaKph: number,
  exitSpeedDeltaKph: number
): CornerResult => {
  const reading = { timeDeltaSec, entrySpeedDeltaKph, exitSpeedDeltaKph };
  return {
    serial,
    sectionId: `demo-${serial}`,
    label,
    timeSec: 4,
    entrySpeedKph,
    exitSpeedKph,
    readings: { allTime: reading, sessionBest: reading, lastLap: reading },
  };
};

/** What demo mode shows: a corner gained on, after two that were not. */
const DEMO_RESULTS: readonly CornerResult[] = [
  demoResult(3, 'Variante Alta', 171, 142, -0.084, 3.2, 1.6),
  demoResult(2, 'Acque Minerali', 204, 118, 0.031, -1.4, -2.1),
  demoResult(1, 'Piratella', 213, 189, 0.012, 0.8, -0.6),
];

/**
 * The corner just driven against the same corner on one of the player's own
 * laps: the time gained or lost through it, and the speed in and out.
 *
 * The reference is the one the settings choose and only that one. Where it
 * does not exist yet the speeds driven are still shown and the deltas are
 * dashes.
 */
export const CornerDelta = () => {
  const settings = useCornerDeltaSettings();
  const { isDemoMode } = useDashboard();
  const { isDriving } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);
  const displayUnits = useTrackStateSelector(trackStateSelectors.displayUnits);
  const unit = resolveSpeedUnit(settings.speedUnit, displayUnits);
  const { hasCorners, results, labels } = useCornerResults(
    !isDemoMode && isSessionVisible,
    settings.cornerLabel
  );

  if (isDemoMode) {
    return (
      <CornerDeltaView settings={settings} unit={unit} results={DEMO_RESULTS} />
    );
  }
  if (!isSessionVisible) return <></>;
  if (settings.showOnlyWhenOnTrack && !isDriving) return <></>;

  return (
    <CornerDeltaView
      settings={settings}
      unit={unit}
      results={results}
      labels={labels}
      hasCorners={hasCorners}
    />
  );
};
