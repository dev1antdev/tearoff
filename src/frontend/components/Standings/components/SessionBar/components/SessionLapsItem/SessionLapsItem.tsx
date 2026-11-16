import { memo } from 'react';
import {
  useSessionLapsProgress,
  useSessionLapsTiming,
} from '@irdashies/context';
import { SessionState } from '@irdashies/types';
import { formatLapTotal } from '../../formatLapTotal';
import { sessionBarItemWrapperClass } from '../../sessionBarItemWrapperClass';
import { sessionLapsProgressDisplay } from '../../sessionLapsProgress';
import type { SessionBarItemProps } from '../../sessionBarItemTypes';

/** The lap the focus car is on against the race distance: "L3 / 11.6". */
const SessionLapsLap = memo(({ settings, standalone }: SessionBarItemProps) => {
  const {
    sessionType: session,
    currentLap,
    totalLaps,
    state,
    totalRaceLaps,
    isFixedLapRace,
  } = useSessionLapsTiming();

  const lapDisplay = Math.max(currentLap, 0);
  const lapsTotal = totalRaceLaps > 0 ? totalRaceLaps : totalLaps;
  const lapsMode = settings?.sessionLaps?.mode ?? 'Elapsed';
  // Round up the total if the current lap has exceeded it
  const overrun = lapDisplay > lapsTotal && session === 'Race';
  const effectiveTotal = overrun ? lapDisplay : lapsTotal;
  const lapValue =
    lapsMode === 'Remaining'
      ? Math.min(
          Math.max(Math.ceil(effectiveTotal) - lapDisplay + 1, 0),
          Math.ceil(effectiveTotal)
        )
      : lapDisplay;

  let content: React.ReactNode;
  if (state >= SessionState.Checkered && effectiveTotal > 0) {
    content = (
      <>
        L{lapValue} / {Math.ceil(effectiveTotal).toFixed(0)}
      </>
    );
  } else if (lapsTotal > 0) {
    content = isFixedLapRace ? (
      <>
        L{lapValue} / {lapsTotal.toFixed(0)}
      </>
    ) : (
      <>
        L{lapValue} /{' '}
        {overrun ? effectiveTotal.toFixed(0) : formatLapTotal(lapsTotal)}
      </>
    );
  } else {
    content = <>L{lapDisplay}</>;
  }

  return (
    <div className={sessionBarItemWrapperClass(standalone)}>
      <div className="flex justify-center">{content}</div>
    </div>
  );
});
SessionLapsLap.displayName = 'SessionLapsLap';

/**
 * The laps done with the share of the lap under way, against the focus
 * car's own distance at the flag: "2.72 / ~10.3 +1". Amber on the last lap.
 */
const SessionLapsProgress = memo(
  ({ settings, standalone }: SessionBarItemProps) => {
    const progress = useSessionLapsProgress();
    const display = sessionLapsProgressDisplay(
      progress,
      settings?.sessionLaps?.showExtraLaps ?? true
    );

    return (
      <div className={sessionBarItemWrapperClass(standalone)}>
        <div
          data-item="sessionLapsProgress"
          data-final-lap={display.finalLap ? 'true' : undefined}
          className={`flex justify-center gap-1 tabular-nums ${display.finalLap ? 'text-amber-300' : ''}`}
        >
          <span data-part="done">{display.done}</span>
          {display.total !== undefined && (
            <span
              data-part="total"
              className={display.finalLap ? '' : 'text-white/60'}
            >
              / {display.total}
            </span>
          )}
          {display.extra !== undefined && (
            <span
              data-part="extra"
              className="text-amber-300"
              title="Laps added or taken at the flag: the leader's last lap, a last pit stop"
            >
              {display.extra}
            </span>
          )}
        </div>
      </div>
    );
  }
);
SessionLapsProgress.displayName = 'SessionLapsProgress';

/**
 * The laps item, in the format its settings choose. Two components and not
 * one branch: the progress format follows the share of the lap, which moves
 * a hundred times a lap, and the lap format must not render with it.
 */
export const SessionLapsItem = memo((props: SessionBarItemProps) =>
  props.settings?.sessionLaps?.format === 'progress' ? (
    <SessionLapsProgress {...props} />
  ) : (
    <SessionLapsLap {...props} />
  )
);
SessionLapsItem.displayName = 'SessionLapsItem';
