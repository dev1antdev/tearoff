interface RotationArcProps {
  /** Steering wheel angle in radians, positive to the left. */
  angleRad: number;
}

// SVG user units, viewBox 0 0 100 100.
const CENTER = 50;
const RADIUS = 48;
/** Screen pixels: the stroke does not scale with the wheel. */
const STROKE_PX = 3;

/**
 * An arc around the wheel from 12 o'clock, as long as the wheel is turned
 * and on the side it is turned to, so that a driver at a standstill can see
 * how far and which way it is from centre. A full turn or more is a full
 * circle.
 */
export function RotationArc({ angleRad }: RotationArcProps) {
  // Clockwise positive, as the wheel image turns.
  const degrees = (angleRad * -1 * 180) / Math.PI;
  const sweep = Math.min(360, Math.abs(degrees));
  const clockwise = degrees >= 0;
  const end = (sweep * Math.PI) / 180;
  const x = CENTER + RADIUS * Math.sin(end) * (clockwise ? 1 : -1);
  const y = CENTER - RADIUS * Math.cos(end);

  return (
    <svg
      viewBox="0 0 100 100"
      data-testid="input-steer-arc"
      data-sweep={Math.round(clockwise ? sweep : -sweep)}
      className="absolute inset-0 w-full h-full overflow-visible pointer-events-none fill-none stroke-red-500"
    >
      {sweep >= 360 ? (
        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          strokeWidth={STROKE_PX}
          vectorEffect="non-scaling-stroke"
        />
      ) : (
        sweep > 0 && (
          <path
            d={`M ${CENTER} ${CENTER - RADIUS} A ${RADIUS} ${RADIUS} 0 ${
              sweep > 180 ? 1 : 0
            } ${clockwise ? 1 : 0} ${x.toFixed(2)} ${y.toFixed(2)}`}
            strokeWidth={STROKE_PX}
            vectorEffect="non-scaling-stroke"
          />
        )
      )}
    </svg>
  );
}
