import { useMemo } from 'react';
import {
  ArrowsClockwiseIcon,
  ArrowsCounterClockwiseIcon,
} from '@phosphor-icons/react';
import type { IconWeight } from '@phosphor-icons/react';

/** Past this, either way, the wheel is far enough round to need unwinding. */
const UNWIND_THRESHOLD_DEG = 270;

export type AngleReadout = 'beyond270' | 'always' | 'never';

interface UnwindArrowProps {
  /** The wheel angle in degrees, left negative. */
  angleDeg: number;
  size: number | string;
  weight: IconWeight;
  className: string;
}

/** Which way to turn the wheel back to centre, once it is past 270 degrees. */
export const UnwindArrow = ({
  angleDeg,
  size,
  weight,
  className,
}: UnwindArrowProps) => {
  if (Math.abs(angleDeg) <= UNWIND_THRESHOLD_DEG) return null;
  const Arrow = angleDeg > 0 ? ArrowsCounterClockwiseIcon : ArrowsClockwiseIcon;
  return <Arrow size={size} weight={weight} className={className} />;
};

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
  const { beyond, angleText, angleDegrees } = useMemo(() => {
    // Convert radians to degrees
    const angleDegrees = (currentAngleRad * -1 * 180) / Math.PI;
    return {
      // The direction arrow only shows beyond ±270 degrees
      beyond: Math.abs(angleDegrees) > UNWIND_THRESHOLD_DEG,
      angleText: formatSteerAngle(angleDegrees),
      angleDegrees,
    };
  }, [currentAngleRad]);

  const showReadout =
    readout === 'always' || (readout === 'beyond270' && beyond);

  // Don't render anything if not showing
  if (!beyond && !showReadout) {
    return null;
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {beyond && (
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
              angleDeg={angleDegrees}
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
