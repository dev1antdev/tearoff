import { memo, useMemo } from 'react';
import {
  ArrowsClockwiseIcon,
  ArrowsCounterClockwiseIcon,
} from '@phosphor-icons/react';
import type { IconWeight } from '@phosphor-icons/react';

/** Past this, either way, the wheel is far enough round to need unwinding. */
const UNWIND_THRESHOLD_DEG = 270;

export type AngleReadout = 'beyond270' | 'always' | 'never';

export type UnwindDirection = 'left' | 'right';

/**
 * Which way to turn the wheel back to centre once it is past 270 degrees
 * (angle in degrees, left negative), or undefined within them.
 */
export const unwindDirection = (
  angleDeg: number
): UnwindDirection | undefined =>
  Math.abs(angleDeg) <= UNWIND_THRESHOLD_DEG
    ? undefined
    : angleDeg > 0
      ? 'left'
      : 'right';

interface UnwindArrowProps {
  direction: UnwindDirection;
  size: number | string;
  weight: IconWeight;
  className: string;
}

/** The unwind arrow; it renders again only when the direction changes. */
export const UnwindArrow = memo(
  ({ direction, size, weight, className }: UnwindArrowProps) => {
    const Arrow =
      direction === 'left' ? ArrowsCounterClockwiseIcon : ArrowsClockwiseIcon;
    return <Arrow size={size} weight={weight} className={className} />;
  }
);
UnwindArrow.displayName = 'UnwindArrow';

/** The wheel angle in whole degrees, left negative: `-119°`. */
export const formatSteerAngle = (angleDeg: number): string => {
  const whole = Math.round(angleDeg);
  // A wheel a fraction of a degree to the left is at 0, not at -0.
  return `${whole === 0 ? 0 : whole}°`;
};

interface RotationIndicatorProps {
  currentAngleRad: number;
  /** When the angle is shown in degrees. The arrow is not affected. */
  readout?: AngleReadout;
}

export function RotationIndicator({
  currentAngleRad,
  readout = 'beyond270',
}: RotationIndicatorProps) {
  // Memoize calculations to avoid recalculating on every render
  const { direction, angleText } = useMemo(() => {
    // Convert radians to degrees
    const angleDegrees = (currentAngleRad * -1 * 180) / Math.PI;
    return {
      // The direction arrow only shows beyond ±270 degrees
      direction: unwindDirection(angleDegrees),
      angleText: formatSteerAngle(angleDegrees),
    };
  }, [currentAngleRad]);
  const beyond = direction !== undefined;

  const showReadout =
    readout === 'always' || (readout === 'beyond270' && beyond);

  // Don't render anything if not showing
  if (!beyond && !showReadout) {
    return null;
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {direction && (
        <div className="relative flex items-center justify-center">
          {/* Background indicator */}
          <div
            className="absolute w-8 h-8 rounded-full bg-red-500/40 backdrop-blur-sm border-2 border-red-500"
            style={{
              animation: 'pulse 1s ease-in-out infinite',
              animationDelay: '0.5s',
            }}
          />

          {/* Direction arrow */}
          <div className="absolute w-6 h-6 flex items-center justify-center">
            <UnwindArrow
              direction={direction}
              size={20}
              weight="bold"
              className="text-white"
            />
          </div>
        </div>
      )}

      {showReadout && (
        <div className="absolute top-1/8 text-xs text-white min-w-[2.5rem] text-center font-medium tabular-nums bg-slate-950/40 rounded-md">
          {angleText}
        </div>
      )}
    </div>
  );
}
