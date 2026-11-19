import { memo } from 'react';
import type { TrackStateSnapshot } from '@irdashies/types';
import { useTrackStateSelector } from '@irdashies/context';
import { formatPitSeconds } from '@irdashies/domain/pitStop';
import { PitStopFigure } from './PitStopFigure';

/** The session clock in tenths: what a countdown is read to. */
const selectTenths = (snapshot: TrackStateSnapshot): number =>
  Math.floor(snapshot.sessionTime * 10) / 10;

interface PitStopCountdownProps {
  /** SessionTime the car crossed the entry line; null without an anchor. */
  enteredAt: number | null;
  /** SessionTime it last came to rest; null while it is moving. */
  stoppedAt: number | null;
  /** Seconds of the standing stretches of this visit that are over. */
  standingS: number;
  /** What the stop was planned to stand for; null without a plan. */
  plannedStandingS: number | null;
}

/**
 * The visit under way: the standing time still to go, counting down and on
 * past zero, a bar for how much of it is done, the time in the lane so far
 * and the plan it is counted against.
 *
 * The channel carries anchors on the session clock rather than counters, so
 * the countdown is this component subtracting them from that clock, ten
 * times a second, and nothing else is redrawn.
 */
export const PitStopCountdown = memo(
  ({
    enteredAt,
    stoppedAt,
    standingS,
    plannedStandingS,
  }: PitStopCountdownProps) => {
    const now = useTrackStateSelector(selectTenths) ?? 0;
    const anchored = enteredAt !== null;
    const stood =
      standingS + (stoppedAt === null ? 0 : Math.max(0, now - stoppedAt));
    const toGo =
      anchored && plannedStandingS !== null ? plannedStandingS - stood : null;
    const over = toGo !== null && toGo < 0;
    const done =
      plannedStandingS !== null && plannedStandingS > 0
        ? Math.min(Math.max(stood / plannedStandingS, 0), 1)
        : stood > 0
          ? 1
          : 0;

    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-end gap-4">
          {anchored && plannedStandingS === null ? (
            // Nothing to count against: the time at rest so far.
            <PitStopFigure
              name="main"
              label="Stood"
              value={formatPitSeconds(stood)}
              unit="s"
              large
            />
          ) : (
            <PitStopFigure
              name="main"
              label="To go"
              value={formatPitSeconds(toGo)}
              unit="s"
              tone={over ? 'bad' : 'normal'}
              large
            />
          )}
          <PitStopFigure
            name="lane-timer"
            label="In lane"
            value={formatPitSeconds(
              anchored ? Math.max(0, now - enteredAt) : null
            )}
          />
          <PitStopFigure
            name="planned"
            label="Plan"
            value={formatPitSeconds(plannedStandingS)}
          />
        </div>
        <div
          data-testid="pit-stop-progress"
          data-over={over}
          className="h-1 w-full overflow-hidden rounded-full bg-white/8"
        >
          <div
            className={`h-full rounded ${over ? 'bg-red-500' : 'bg-sky-500'}`}
            style={{ width: `${Math.round(done * 100)}%` }}
          />
        </div>
      </div>
    );
  }
);
PitStopCountdown.displayName = 'PitStopCountdown';
