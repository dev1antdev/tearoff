import { memo } from 'react';
import { ClockIcon } from '@phosphor-icons/react';
import { shallow } from 'zustand/shallow';
import { useSessionBarSelector } from '@irdashies/context';
import type { SessionBarSnapshot } from '@irdashies/types';
import {
  formatTrackClock,
  timeScaleLabel,
} from '@irdashies/domain/trackClock/trackClock';
import { sessionBarItemWrapperClass } from '../../sessionBarItemWrapperClass';
import type { SessionBarItemProps } from '../../sessionBarItemTypes';
import { SunPhaseCountdown } from './SunPhaseCountdown';

/**
 * The clock to the minute, not to the second: the snapshot moves five times
 * a second and the item only needs to draw again when the minute turns.
 */
const selectClock = (snapshot: SessionBarSnapshot) =>
  [
    snapshot.sessionTimeOfDay === undefined
      ? undefined
      : Math.floor(snapshot.sessionTimeOfDay / 60) * 60,
    snapshot.timeScale,
  ] as const;

const NO_CLOCK = [undefined, undefined] as const;

/**
 * The in-game clock, and beside it how fast the in-game day runs when that
 * is not real time: "x2" in amber, "x0" for a time of day that stands still.
 * Then, where it is switched on, the countdown to the next of sunrise,
 * midday, sunset and midnight.
 */
export const SessionClockTimeItem = memo(
  ({ settings, standalone }: SessionBarItemProps) => {
    const [seconds, timeScale] =
      useSessionBarSelector(selectClock, { equality: shallow }) ?? NO_CLOCK;
    const options = settings?.sessionClockTime;
    const scale = timeScaleLabel(timeScale, options?.timeScale);

    return (
      <div className={sessionBarItemWrapperClass(standalone)}>
        <div className="flex justify-center gap-1 items-center">
          <ClockIcon />
          <span className="tabular-nums">
            {formatTrackClock(seconds, options?.format)}
          </span>
          {scale && (
            <span
              className={`text-xs tabular-nums ${
                scale.scaled ? 'text-amber-300' : 'text-white/60'
              }`}
              title="In-game time against real time"
            >
              {scale.text}
            </span>
          )}
          {options?.sunPhase && (
            <SunPhaseCountdown
              inGameTime={options.sunPhaseInGameTime ?? false}
            />
          )}
        </div>
      </div>
    );
  }
);
SessionClockTimeItem.displayName = 'SessionClockTimeItem';
