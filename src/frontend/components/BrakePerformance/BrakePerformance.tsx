import { memo } from 'react';
import { ArrowRightIcon, LockSimpleIcon } from '@phosphor-icons/react';
import {
  trackStateSelectors,
  useBrakingSnapshot,
  useDrivingState,
  useSessionVisibility,
  useTrackStateSelector,
} from '@irdashies/context';
import { resolveDistanceUnit, resolveSpeedUnit } from '@irdashies/utils/units';
import { useBrakePerformanceSettings } from './hooks/useBrakePerformanceSettings';
import {
  NO_READING,
  bestFor,
  formatDelta,
  formatDistance,
  formatG,
  formatSeconds,
  formatSpeed,
  lockTone,
  zoneAgainstBest,
  type DeltaTone,
  type LockTone,
} from './brakePerformanceDisplay';

const DELTA_CLASS: Record<DeltaTone, string> = {
  gained: 'bg-green-500/20 text-green-400',
  lost: 'bg-amber-500/20 text-amber-300',
  level: 'bg-slate-500/20 text-slate-300',
};

const LOCK_CLASS: Record<LockTone, string> = {
  none: 'text-slate-400',
  some: 'text-amber-300',
  long: 'text-red-400',
};

interface PeakLineProps {
  peak: string;
  /** Empty while a zone is live and before the first one. */
  delta: string;
  deltaClass: string;
  best: string;
}

/** The peak, large; how it compares with the best; and the best itself. */
const PeakLine = memo(({ peak, delta, deltaClass, best }: PeakLineProps) => (
  <div className="flex items-center gap-2">
    <div className="flex items-baseline gap-1 leading-none">
      <span className="text-2xl font-bold">{peak}</span>
      <span className="text-sm font-semibold text-slate-300">g</span>
    </div>
    {delta && (
      <span
        className={`rounded px-1.5 py-0.5 text-xs font-semibold leading-none ${deltaClass}`}
      >
        {delta}
      </span>
    )}
    <div className="ml-auto flex items-baseline gap-1 text-xs leading-none text-purple-400">
      <span className="text-[0.85em] uppercase">Best</span>
      <span className="font-semibold">{best}</span>
      <span>g</span>
    </div>
  </div>
));
PeakLine.displayName = 'PeakLine';

interface DetailLineProps {
  entry: string;
  /** Empty while the zone is live: it has no exit speed yet. */
  exit: string;
  speedUnit: string;
  distance: string;
  distanceUnit: string;
  time: string;
  /** Empty while the zone is live. */
  average: string;
  /** Empty when the ABS did not work in the zone. */
  abs: string;
}

/** Where the stop began and ended, and how far and how long it ran. */
const DetailLine = memo(
  ({
    entry,
    exit,
    speedUnit,
    distance,
    distanceUnit,
    time,
    average,
    abs,
  }: DetailLineProps) => (
    <div className="flex items-center gap-x-2 whitespace-nowrap text-xs leading-none text-slate-300">
      <span className="flex items-center gap-1">
        <span className="font-semibold text-white">{entry}</span>
        {exit && (
          <>
            <ArrowRightIcon size="0.9em" weight="bold" aria-hidden="true" />
            <span className="font-semibold text-white">{exit}</span>
          </>
        )}
        <span>{speedUnit}</span>
      </span>
      <span>
        <span className="font-semibold text-white">{distance}</span>{' '}
        {distanceUnit}
      </span>
      <span>
        <span className="font-semibold text-white">{time}</span> s
      </span>
      {average && (
        <span>
          avg <span className="font-semibold text-white">{average}</span> g
        </span>
      )}
      {abs && (
        <span>
          ABS <span className="font-semibold text-white">{abs}</span> s
        </span>
      )}
    </div>
  )
);
DetailLine.displayName = 'DetailLine';

interface LockLineProps {
  front: string;
  frontClass: string;
  rear: string;
  rearClass: string;
}

/** How long a wheel of each axle was locked under braking on this lap. */
const LockLine = memo(
  ({ front, frontClass, rear, rearClass }: LockLineProps) => (
    <div className="flex items-center gap-x-2 whitespace-nowrap text-xs leading-none text-slate-300">
      <span className="flex items-center gap-1">
        <LockSimpleIcon size="1em" weight="bold" aria-hidden="true" />
        Lock
      </span>
      <span className={frontClass}>
        F <span className="font-semibold">{front}</span> s
      </span>
      <span className={rearClass}>
        R <span className="font-semibold">{rear}</span> s
      </span>
    </div>
  )
);
LockLine.displayName = 'LockLine';

/**
 * Brake performance: the peak deceleration of the braking zone in progress or
 * the last one completed, how it compares with the best, the zone's speeds,
 * distance and time, and how long the wheels were locked on this lap.
 *
 * Both sims; the lock times under Le Mans Ultimate only. Before the first
 * zone, and out of the car, the widget keeps its shape with placeholders so
 * that it can still be placed in edit mode.
 */
export const BrakePerformance = () => {
  const settings = useBrakePerformanceSettings();
  const snapshot = useBrakingSnapshot();
  const displayUnits = useTrackStateSelector(trackStateSelectors.displayUnits);
  const { isDriving } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);

  if (!isSessionVisible) return <></>;
  // The driver's own braking: nothing to show for a car being watched.
  if (settings.showOnlyWhenOnTrack && !isDriving) return <></>;

  // Out of the car the last zone is not a reading of anything.
  const reading = snapshot?.available ? snapshot : undefined;
  const live = reading?.live ?? null;
  const last = live ? null : (reading?.last ?? null);

  const speedUnit = resolveSpeedUnit(settings.speedUnit, displayUnits);
  // The distance goes with the speed: metres with km/h, feet with mph.
  const distanceUnit = resolveDistanceUnit(
    settings.speedUnit === 'km/h'
      ? 'm'
      : settings.speedUnit === 'mph'
        ? 'ft'
        : 'auto',
    displayUnits
  );

  const best = reading ? bestFor(reading, settings.reference) : 0;
  const delta =
    last && reading
      ? (() => {
          const { deltaG, bestG } = zoneAgainstBest(
            last,
            reading,
            settings.reference
          );
          return formatDelta(deltaG, bestG, settings.deltaUnit);
        })()
      : null;

  const lockS = reading?.lockS ?? null;

  return (
    <div
      className="flex h-full w-full flex-col justify-center gap-1.5 overflow-hidden rounded bg-slate-800/(--bg-opacity) p-2 font-medium tabular-nums text-white"
      style={{
        ['--bg-opacity' as string]: `${settings.background.opacity}%`,
      }}
    >
      <PeakLine
        peak={formatG(live?.peakG ?? last?.peakG)}
        delta={delta?.text ?? ''}
        deltaClass={DELTA_CLASS[delta?.tone ?? 'level']}
        best={best > 0 ? formatG(best) : NO_READING}
      />
      {settings.showZoneDetail && (
        <DetailLine
          entry={formatSpeed(live?.entrySpeed ?? last?.entrySpeed, speedUnit)}
          exit={live ? '' : formatSpeed(last?.exitSpeed, speedUnit)}
          speedUnit={speedUnit}
          distance={formatDistance(
            live?.distanceM ?? last?.distanceM,
            distanceUnit
          )}
          distanceUnit={distanceUnit}
          time={
            live
              ? formatSeconds(live.durationS, 1)
              : formatSeconds(last?.durationS, 2)
          }
          average={live ? '' : formatG(last?.averageG)}
          abs={last && last.absS > 0 ? formatSeconds(last.absS, 1) : ''}
        />
      )}
      {settings.showLockTime && lockS && (
        <LockLine
          front={formatSeconds(lockS[0], 1)}
          frontClass={LOCK_CLASS[lockTone(lockS[0])]}
          rear={formatSeconds(lockS[1], 1)}
          rearClass={LOCK_CLASS[lockTone(lockS[1])]}
        />
      )}
    </div>
  );
};
