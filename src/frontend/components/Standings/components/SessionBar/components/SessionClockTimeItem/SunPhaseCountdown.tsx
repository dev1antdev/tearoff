import { memo } from 'react';
import { MoonIcon, SunHorizonIcon, SunIcon } from '@phosphor-icons/react';
import { shallow } from 'zustand/shallow';
import {
  useSessionBarSelector,
  useTrackProfileSelector,
} from '@irdashies/context';
import type {
  SessionBarSnapshot,
  TrackProfileSnapshot,
} from '@irdashies/types';
import {
  formatSunCountdown,
  nextSunPhase,
  type SunPhase,
} from '@irdashies/domain/trackClock/trackClock';

/** The clock to the second, which is as fine as the countdown is written. */
const selectClock = (snapshot: SessionBarSnapshot) =>
  [
    snapshot.sessionTimeOfDay === undefined
      ? undefined
      : Math.floor(snapshot.sessionTimeOfDay),
    snapshot.timeScale,
  ] as const;

/** The two times of the track's profile, and nothing else of it. */
const selectSunTimes = (snapshot: TrackProfileSnapshot) =>
  [snapshot.sunriseMinutes, snapshot.sunsetMinutes] as const;

const NOTHING = [undefined, undefined] as const;

/**
 * How each moment is drawn: the sun on the horizon towards sunrise and
 * sunset, the sun and the moon towards midday and midnight; amber where the
 * day is still to come or to end, blue through the night.
 */
const PHASES: Record<
  SunPhase,
  { Icon: typeof SunIcon; name: string; tone: string }
> = {
  sunrise: { Icon: SunHorizonIcon, name: 'sunrise', tone: 'text-sky-300' },
  midday: { Icon: SunIcon, name: 'midday', tone: 'text-amber-300' },
  sunset: { Icon: SunHorizonIcon, name: 'sunset', tone: 'text-amber-300' },
  midnight: { Icon: MoonIcon, name: 'midnight', tone: 'text-sky-300' },
};

interface SunPhaseCountdownProps {
  /** Count in in-game time instead of real time. */
  inGameTime: boolean;
}

/**
 * The time to the next of sunrise, midday, sunset and midnight, beside the
 * in-game clock: "4:47:40" behind the icon of what is coming.
 *
 * From the sunrise and sunset kept for the track, which the driver enters;
 * with either missing there is nothing to count down to and nothing is
 * drawn. Mounted only while the countdown is switched on, so a bar without
 * it asks nothing of the track's profile.
 */
export const SunPhaseCountdown = memo(
  ({ inGameTime }: SunPhaseCountdownProps) => {
    const [timeOfDay, timeScale] =
      useSessionBarSelector(selectClock, { equality: shallow }) ?? NOTHING;
    const [sunriseMinutes, sunsetMinutes] =
      useTrackProfileSelector(selectSunTimes, { equality: shallow }) ?? NOTHING;
    const next = nextSunPhase({
      timeOfDay,
      timeScale,
      sunriseMinutes,
      sunsetMinutes,
      inGameTime,
    });
    if (!next) return null;

    const { Icon, name, tone } = PHASES[next.phase];
    return (
      <span
        className={`flex items-center gap-1 tabular-nums ${tone}`}
        title={`Time to ${name}${inGameTime ? ', in in-game time' : ''}`}
      >
        <Icon />
        {formatSunCountdown(next.seconds)}
      </span>
    );
  }
);
SunPhaseCountdown.displayName = 'SunPhaseCountdown';
