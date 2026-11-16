import { memo } from 'react';
import { useSessionTimeTiming } from '@irdashies/context';
import { sessionClock } from '@irdashies/domain/sessionClock/sessionClock';
import { formatTotalTime } from '../../formatTotalTime';
import { sessionBarItemWrapperClass } from '../../sessionBarItemWrapperClass';
import type { SessionBarItemProps } from '../../sessionBarItemTypes';

export const SessionTimeItem = memo(
  ({ settings, standalone }: SessionBarItemProps) => {
    const timing = useSessionTimeTiming();
    const { sessionType: session, state, isFixedLapRace } = timing;
    const {
      elapsed: elapsedTime,
      remaining: remainingTime,
      total: totalTime,
    } = sessionClock(timing);

    const sessionTimeSettings = settings?.sessionTime;
    const totalFormat = sessionTimeSettings?.totalFormat ?? 'minimal';
    const labelStyle = sessionTimeSettings?.labelStyle ?? 'minimal';

    const elapsedStr =
      elapsedTime >= 0
        ? formatTotalTime(elapsedTime, totalFormat, false, labelStyle)
        : '-';
    const remainingStr =
      remainingTime >= 0
        ? formatTotalTime(remainingTime, totalFormat, false, labelStyle)
        : '-';
    let totalStr =
      totalTime >= 0
        ? formatTotalTime(totalTime, totalFormat, true, labelStyle)
        : '-';

    if (session === 'Race' && state >= 2 && isFixedLapRace) {
      totalStr = '~' + totalStr;
    }

    const mode = sessionTimeSettings?.mode ?? 'Remaining';

    return (
      <div className={sessionBarItemWrapperClass(standalone)}>
        <div className="flex justify-center tabular-nums">
          {mode === 'Remaining'
            ? `${remainingStr} / ${totalStr}`
            : `${elapsedStr} / ${totalStr}`}
        </div>
      </div>
    );
  }
);
SessionTimeItem.displayName = 'SessionTimeItem';
