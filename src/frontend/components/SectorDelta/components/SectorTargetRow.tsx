import { memo } from 'react';
import { TargetIcon } from '@phosphor-icons/react';
import { trackStateSelectors, useTrackStateSelector } from '@irdashies/context';
import {
  formatLapTime,
  type LapTimeDecimals,
} from '@irdashies/domain/lapTiming/deltaDisplay';
import {
  sectorEndReading,
  sectorSum,
  targetFreezeSeconds,
  type SectorTargetLabel,
} from '@irdashies/domain/sectors/sectorTargets';

/** A gap that is not there. */
const NO_GAP = '--';

const GAP_TONE = {
  ahead: 'text-green-400',
  behind: 'text-red-400',
  level: 'text-white',
  none: 'text-slate-500',
} as const;

const formatGap = (gap: number | null, decimals: LapTimeDecimals): string => {
  if (gap === null || !Number.isFinite(gap)) return NO_GAP;
  const text = Math.abs(gap).toFixed(decimals);
  if (Number(text) === 0) return text;
  return `${gap < 0 ? '-' : '+'}${text}`;
};

const gapTone = (
  gap: number | null,
  decimals: LapTimeDecimals
): keyof typeof GAP_TONE => {
  if (gap === null || !Number.isFinite(gap)) return 'none';
  if (Number(Math.abs(gap).toFixed(decimals)) === 0) return 'level';
  return gap < 0 ? 'ahead' : 'behind';
};

export interface SectorTargetViewProps {
  /** TB for best sectors, PB for a best lap, REF for the ghost. */
  label: SectorTargetLabel;
  /**
   * What the left figure shows: the target's time as far as the sector
   * being driven, or the gap to it at the end of the sector just finished.
   */
  target: number | null;
  /** Set while the gap is held: the left figure is then the gap. */
  gap?: number | null;
  frozen: boolean;
  /**
   * The right figure: the running lap time, or while the gap is held the
   * lap time at the end of the sector just finished.
   */
  lapTime: number | null;
  /** Decimal places of the widget's time format. */
  decimals: LapTimeDecimals;
}

/**
 * The target row as drawn, from its figures. Separate from the clock that
 * feeds it so a story or a spec can show any moment of a lap.
 */
export const SectorTargetView = memo(
  ({
    label,
    target,
    gap = null,
    frozen,
    lapTime,
    decimals,
  }: SectorTargetViewProps) => (
    <div
      data-testid="sector-target"
      className="flex items-center justify-between gap-2 px-2 py-0.5 leading-tight text-white tabular-nums"
    >
      <span className="inline-flex min-w-0 items-center gap-1">
        <TargetIcon size={12} className="shrink-0 text-slate-400" />
        <span className="overlay-label">{label}</span>
        <span
          data-testid="sector-target-value"
          className={`text-sm font-bold ${
            frozen
              ? GAP_TONE[gapTone(gap, decimals)]
              : target === null
                ? 'text-purple-300/40'
                : 'text-purple-300'
          }`}
        >
          {frozen ? formatGap(gap, decimals) : formatLapTime(target, decimals)}
        </span>
      </span>
      <span
        data-testid="sector-target-lap"
        className={`text-sm ${
          lapTime === null ? 'text-slate-500' : 'text-slate-300'
        }`}
      >
        {formatLapTime(lapTime, frozen ? decimals : 1)}
      </span>
    </div>
  )
);
SectorTargetView.displayName = 'SectorTargetView';

/** Tenths, cut: a clock does not show a tenth before it has passed. */
const selectClock = (snapshot: { sessionTime: number }): number =>
  Math.floor(snapshot.sessionTime * 10) / 10;

export interface SectorTargetRowProps {
  label: SectorTargetLabel;
  /** What the lap is held against now, per sector. */
  targetTimes: readonly (number | null)[];
  /** The same as it stood while the sector that last ended was driven. */
  targetTimesBefore: readonly (number | null)[];
  currentSectorIdx: number;
  /** SessionTime at which the lap under way began; null when not known. */
  lapStartTime: number | null;
  /** The sector that last ended: which, when, and the lap up to there. */
  sectorEnd: {
    sectorIdx: number;
    at: number;
    lapSectorTimes: readonly (number | null)[];
  } | null;
  /** The time of the sector being driven the last time round, s. */
  previousTimeOfCurrentSector: number | null;
  /** The setting: how long a gap is held, at most. */
  freezeSeconds: number;
  decimals: LapTimeDecimals;
}

/**
 * The target row on the session clock.
 *
 * It shows the target's time as far as the sector being driven, and beside
 * it the lap's own clock. For a few seconds after each sector it shows how
 * the lap stands against the target so far instead, and the lap time at that
 * point. Out of the car there is no lap being driven: the target stays and
 * the clock is dashes.
 */
export const SectorTargetRow = ({
  label,
  targetTimes,
  targetTimesBefore,
  currentSectorIdx,
  lapStartTime,
  sectorEnd,
  previousTimeOfCurrentSector,
  freezeSeconds,
  decimals,
}: SectorTargetRowProps) => {
  const clock = useTrackStateSelector(selectClock);
  const isOnTrack = useTrackStateSelector(trackStateSelectors.isOnTrack);
  const driving = isOnTrack === true && clock !== undefined;

  const sinceSectorEnd = driving && sectorEnd ? clock - sectorEnd.at : null;
  const frozen =
    sectorEnd !== null &&
    sinceSectorEnd !== null &&
    // A tenth of slack: the clock is cut to tenths and the entry is not.
    sinceSectorEnd >= -0.1 &&
    sinceSectorEnd <
      targetFreezeSeconds(freezeSeconds, previousTimeOfCurrentSector);

  if (frozen) {
    const ended = sectorEndReading(
      sectorEnd.lapSectorTimes,
      targetTimesBefore,
      sectorEnd.sectorIdx
    );
    return (
      <SectorTargetView
        label={label}
        target={null}
        gap={ended.gap}
        frozen
        lapTime={ended.time}
        decimals={decimals}
      />
    );
  }

  const running =
    driving && lapStartTime !== null && clock >= lapStartTime
      ? clock - lapStartTime
      : null;
  return (
    <SectorTargetView
      label={label}
      target={sectorSum(targetTimes, currentSectorIdx)}
      frozen={false}
      lapTime={running}
      decimals={decimals}
    />
  );
};
