import { memo } from 'react';
import { trackLimitsTone } from '../trackLimitsTone';

interface TrackLimitsCellProps {
  /** Points, not the sim's infringement steps. Undefined when unknown. */
  points?: number;
  /** Points at which a drive-through is served. 0 or undefined when unknown. */
  max?: number;
  compactMode?: string;
}

/** A clean car is dimmed, not coloured: nothing to warn about. */
const toneFor = (points: number, max: number | undefined): string =>
  points <= 0 ? 'text-white/50' : trackLimitsTone(points, max);

/**
 * LMU's track-limits penalty points for one car.
 *
 * Two decimals, matching the sim's own display and TinyPedal's: the steps are
 * fractions of a point -- quarters on a four-step scale -- so a rounded
 * integer would show a car one infringement from a drive-through as clean.
 *
 * A car with no reading renders nothing rather than 0.00, which would be an
 * assertion that it is clean when the sim has not said so.
 */
export const TrackLimitsCell = memo(
  ({ points, max, compactMode }: TrackLimitsCellProps) => {
    const pxClass = compactMode === 'ultra' ? '' : 'px-1';

    return (
      <td
        data-column="trackLimits"
        className={`w-[2.5rem] ${pxClass} text-right align-middle whitespace-nowrap tabular-nums`}
      >
        {points === undefined ? null : (
          <span className={toneFor(points, max)}>{points.toFixed(2)}</span>
        )}
      </td>
    );
  }
);

TrackLimitsCell.displayName = 'TrackLimitsCell';
