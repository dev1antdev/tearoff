import { GhostIcon, WarningIcon } from '@phosphor-icons/react';
import {
  trackStateSelectors,
  useSectorDeltas,
  useSessionVisibility,
  useTrackStateSelector,
} from '@irdashies/context';
import { useReferenceLapSectorTimes } from '@irdashies/context';
import type { SectorDeltaConfig } from '@irdashies/types';
import type { TimeFormat } from '@irdashies/types';
import type { SectorColor } from '@irdashies/context';
import type { LapTimeDecimals } from '@irdashies/domain/lapTiming/deltaDisplay';
import {
  sectorCardReading,
  sectorReference,
  sectorSum,
} from '@irdashies/domain/sectors/sectorTargets';
import { useCarouselWindow } from './hooks/useCarouselWindow';
import { LiveDelta } from './components/LiveDelta';
import { SectorProgressIndicator } from './components/SectorProgressIndicator';
import {
  SectorTargetRow,
  SectorTargetView,
} from './components/SectorTargetRow';
import { computeGhostSectorColor } from './sectorColorUtils';

type SectorDeltaProps = SectorDeltaConfig;

const SECTOR_CARD: Record<
  SectorColor,
  { bg: string; accent: string; text: string }
> = {
  purple: {
    bg: 'bg-slate-800/80',
    accent: 'border-b-[5px] border-purple-400',
    text: 'text-white',
  },
  green: {
    bg: 'bg-slate-800/80',
    accent: 'border-b-[5px] border-green-400',
    text: 'text-white',
  },
  yellow: {
    bg: 'bg-slate-800/80',
    accent: 'border-b-[5px] border-yellow-400',
    text: 'text-white',
  },
  red: {
    bg: 'bg-slate-800/80',
    accent: 'border-b-[5px] border-red-500',
    text: 'text-white',
  },
  default: {
    bg: 'bg-slate-800/40',
    accent: 'border-b-[5px] border-slate-700',
    text: 'text-slate-400',
  },
};

function timeFormatToDecimalPlaces(timeFormat: TimeFormat): number {
  if (timeFormat === 'seconds-full' || timeFormat === 'full') return 3;
  if (timeFormat === 'seconds-2') return 2;
  if (timeFormat === 'seconds-mixed' || timeFormat === 'mixed') return 1;
  return 0;
}

function formatDelta(
  lapTime: number | null,
  bestTime: number | null,
  timeFormat: TimeFormat
): string {
  if (lapTime === null) return '--';
  const dp = timeFormatToDecimalPlaces(timeFormat);
  if (bestTime === null) return lapTime.toFixed(dp);
  const delta = lapTime - bestTime;
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${delta.toFixed(dp)}`;
}

export type SectorDeltaData = ReturnType<typeof useSectorDeltas>;

export const SectorDeltaDisplay = ({
  background,
  showOnlyWhenOnTrack,
  sessionVisibility,
  timeFormat = 'seconds-full',
  ghostComparison = 'prefer-ghost',
  showTargetLap = false,
  targetFreezeSeconds = 5,
  thresholds,
  maxSectorsShown,
  alwaysScroll = false,
  data,
  demo = false,
}: SectorDeltaProps & { data: SectorDeltaData; demo?: boolean }) => {
  const {
    sectors,
    sectorColors,
    currentLapSectorTimes,
    currentLapSectorUnclean,
    previousLapSectorTimes,
    previousLapSectorUnclean,
    sessionBestSectorTimes,
    previousSessionBestSectorTimes,
    sessionBestLapSectorTimes,
    allTime,
    lapStartTime,
    sectorEvent,
    currentSectorIdx,
  } = data;
  const isOnTrack = useTrackStateSelector(trackStateSelectors.isOnTrack);
  const { refSectorTimes, hasReferenceLap } = useReferenceLapSectorTimes();

  const useGhost =
    !demo && ghostComparison === 'prefer-ghost' && hasReferenceLap;
  // What the sectors are held against. The sample data of demo mode has
  // session bests and nothing else.
  const comparison = demo ? 'session-best-only' : ghostComparison;
  const ghost = useGhost ? refSectorTimes : null;
  const reference = sectorReference(comparison, {
    ghost,
    sessionBestSectorTimes,
    previousSessionBestSectorTimes,
    sessionBestLapSectorTimes,
    allTime,
  });
  // The session's best sectors are coloured by the store, with the
  // thresholds every widget that shows sectors shares. Any other reference
  // is coloured here, from its own times.
  const againstSessionBests = reference.times === sessionBestSectorTimes;

  const currentSectorStart = sectors[currentSectorIdx]?.SectorStartPct ?? 0;
  const currentSectorEnd = sectors[currentSectorIdx + 1]?.SectorStartPct ?? 1;

  const {
    isWindowed,
    extendedIndices,
    slotWidth,
    containerRef,
    stripRef,
    centerSlot,
  } = useCarouselWindow(
    currentSectorIdx,
    currentSectorStart,
    currentSectorEnd,
    sectors.length,
    maxSectorsShown,
    alwaysScroll
  );

  if (!useSessionVisibility(sessionVisibility)) return null;
  if (showOnlyWhenOnTrack && !isOnTrack) return null;
  if (sectors.length === 0) return null;

  const opacity = (background?.opacity ?? 80) / 100;
  const dp = timeFormatToDecimalPlaces(timeFormat);

  /** Renders a sector card. */
  const renderCard = (
    i: number,
    cardKey: string | number,
    isCurrent: boolean
  ) => {
    const sector = sectors[i];
    if (!sector) return null;

    const displayTime = isCurrent
      ? (previousLapSectorTimes[i] ?? null)
      : (currentLapSectorTimes[i] ?? previousLapSectorTimes[i] ?? null);
    const isUnclean = isCurrent
      ? previousLapSectorUnclean[i]
      : currentLapSectorTimes[i] != null
        ? currentLapSectorUnclean[i]
        : previousLapSectorUnclean[i];

    const colorKey: SectorColor = againstSessionBests
      ? (sectorColors[i] ?? 'default')
      : computeGhostSectorColor(
          displayTime,
          reference.times[i] ?? null,
          thresholds
        );

    // A sector that has just set a best is shown against the best before.
    const refTime = againstSessionBests
      ? colorKey === 'purple'
        ? (previousSessionBestSectorTimes[i] ?? null)
        : (sessionBestSectorTimes[i] ?? null)
      : sectorCardReading(displayTime, reference, i).referenceTime;

    const fallback = formatDelta(displayTime, refTime, timeFormat);
    const cardStyle = SECTOR_CARD[colorKey];

    return (
      <div
        key={cardKey}
        className={[
          'relative flex flex-col items-center justify-center rounded-sm px-2 py-1 overflow-hidden',
          isWindowed ? 'flex-none' : 'flex-1 min-w-0',
          cardStyle.bg,
          cardStyle.accent,
        ].join(' ')}
        style={isWindowed ? { width: slotWidth } : undefined}
      >
        <span className="text-xs font-semibold text-slate-400 leading-none mb-0.5">
          S{sector.SectorNum + 1}
        </span>
        <span
          className={[
            'inline-flex items-center gap-1 text-sm font-bold leading-none tabular-nums',
            cardStyle.text,
            isCurrent ? 'opacity-70' : '',
          ].join(' ')}
        >
          <span>
            {isCurrent && !demo ? (
              <LiveDelta dp={dp} fallback={fallback} />
            ) : (
              fallback
            )}
          </span>
          {isUnclean && (
            <WarningIcon
              size={10}
              weight="fill"
              className="text-amber-300 shrink-0"
            />
          )}
        </span>
        {isCurrent && (
          <SectorProgressIndicator
            sectorStart={currentSectorStart}
            sectorEnd={currentSectorEnd}
            isWindowed={isWindowed}
          />
        )}
      </div>
    );
  };

  /** The row above the cards: what the comparison adds up to, and the lap. */
  const renderTarget = () => {
    const decimals = Math.max(1, dp) as LapTimeDecimals;
    if (demo) {
      // A still from the middle of the sector being driven.
      const sectorTime = previousLapSectorTimes[currentSectorIdx] ?? 0;
      const before =
        currentSectorIdx === 0
          ? 0
          : sectorSum(previousLapSectorTimes, currentSectorIdx - 1);
      return (
        <SectorTargetView
          label={reference.label}
          target={sectorSum(reference.times, currentSectorIdx)}
          frozen={false}
          lapTime={before === null ? null : before + sectorTime * 0.4}
          decimals={decimals}
        />
      );
    }
    // The comparison as it stood while the sector that last ended was being
    // driven: a new best is measured against the one it replaced.
    const before = sectorEvent
      ? sectorReference(comparison, {
          ghost,
          sessionBestSectorTimes: sectorEvent.before.sessionBestSectorTimes,
          previousSessionBestSectorTimes: null,
          sessionBestLapSectorTimes:
            sectorEvent.before.sessionBestLapSectorTimes,
          allTime: sectorEvent.before.allTime,
        }).times
      : reference.times;
    return (
      <SectorTargetRow
        label={reference.label}
        targetTimes={reference.times}
        targetTimesBefore={before}
        currentSectorIdx={currentSectorIdx}
        lapStartTime={lapStartTime}
        sectorEnd={sectorEvent}
        previousTimeOfCurrentSector={
          previousLapSectorTimes[currentSectorIdx] ?? null
        }
        freezeSeconds={targetFreezeSeconds}
        decimals={decimals}
      />
    );
  };

  return (
    <div
      className="flex flex-col gap-1 p-1 overlay-panel"
      style={{ ['--bg-opacity' as string]: `${opacity * 100}%` }}
    >
      {showTargetLap && renderTarget()}
      <div className="flex flex-row items-center gap-1">
        {useGhost && (
          <div className="flex items-center justify-center px-1 text-slate-400 flex-shrink-0">
            <GhostIcon size={14} weight="fill" />
          </div>
        )}

        {isWindowed ? (
          <div ref={containerRef} className="flex-1 overflow-hidden relative">
            <div ref={stripRef} className="flex flex-row gap-1">
              {extendedIndices.map((sectorIdx, slotPosition) =>
                renderCard(sectorIdx, slotPosition, slotPosition === centerSlot)
              )}
            </div>
            <div className="absolute inset-y-0 left-1/2 w-px bg-sky-400/60 pointer-events-none" />
          </div>
        ) : (
          sectors.map((sector, i) =>
            renderCard(i, sector.SectorNum, i === currentSectorIdx)
          )
        )}
      </div>
    </div>
  );
};
