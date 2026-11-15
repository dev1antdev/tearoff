import { memo, useMemo } from 'react';

export interface InputSteerMeterProps {
  /** Steering wheel angle in radians, positive to the left. */
  angleRad?: number;
  /**
   * The wheel's rotation lock to lock, in degrees. Without one the meter is
   * full at half a turn either way, the scale the trace draws steering at.
   */
  rangeDeg?: number;
  /** Degrees of wheel angle between the scale marks. */
  markDeg?: number;
  /** Whole degrees above the steered end. */
  showAngle?: boolean;
}

/** Lock to lock when the sim states no range: half a turn either way. */
const FALLBACK_RANGE_DEG = 360;
const DEFAULT_MARK_DEG = 90;
// Bounds for values that come from stored settings and from the sim.
const MIN_MARK_DEG = 10;
const MAX_MARKS_PER_SIDE = 36;
const MARK_SIDES = ['left', 'right'] as const;

/**
 * How far out each scale mark sits, as fractions of one half of the meter:
 * a mark every `markDeg` of wheel angle, short of the lock itself, which the
 * edge of the meter already marks.
 */
export const steerMeterMarks = (
  rangeDeg: number,
  markDeg: number
): number[] => {
  const half = rangeDeg / 2;
  const spacing = Math.max(MIN_MARK_DEG, markDeg);
  const marks: number[] = [];
  for (
    let mark = 1;
    mark * spacing < half && mark <= MAX_MARKS_PER_SIDE;
    mark += 1
  ) {
    marks.push((mark * spacing) / half);
  }
  return marks;
};

/**
 * A linear steering meter: a bar that fills from its centre toward the side
 * the wheel is turned to, in proportion to the lock used.
 */
export const InputSteerMeter = memo(
  ({
    angleRad = 0,
    rangeDeg,
    markDeg = DEFAULT_MARK_DEG,
    showAngle = true,
  }: InputSteerMeterProps) => {
    const range =
      rangeDeg !== undefined && Number.isFinite(rangeDeg) && rangeDeg > 0
        ? rangeDeg
        : FALLBACK_RANGE_DEG;
    const marks = useMemo(
      () =>
        steerMeterMarks(
          range,
          Number.isFinite(markDeg) ? markDeg : DEFAULT_MARK_DEG
        ),
      [range, markDeg]
    );
    const degrees = (angleRad * 180) / Math.PI;
    const fraction = Math.min(1, Math.abs(degrees) / (range / 2));
    const whole = Math.round(Math.abs(degrees));
    // Where the number sits: over the steered end, or the centre at zero.
    const side = whole === 0 ? 'center' : degrees > 0 ? 'left' : 'right';

    return (
      <div className="w-full h-full min-w-0 flex flex-col justify-center gap-0.5">
        {showAngle && (
          <div
            data-testid="input-steer-meter-angle"
            data-side={side}
            className={`h-4 text-xs leading-4 tabular-nums text-white ${
              side === 'left'
                ? 'text-left'
                : side === 'right'
                  ? 'text-right'
                  : 'text-center'
            }`}
          >
            {whole}
          </div>
        )}
        <div
          data-testid="input-steer-meter"
          className="relative h-4 flex-none rounded bg-slate-900/60 overflow-hidden"
        >
          <div
            data-testid="input-steer-meter-fill"
            data-side={degrees > 0 ? 'left' : 'right'}
            className="absolute inset-y-0 bg-slate-300"
            style={{
              width: `${(fraction * 50).toFixed(2)}%`,
              [degrees > 0 ? 'right' : 'left']: '50%',
            }}
          />
          {MARK_SIDES.flatMap((markSide) =>
            marks.map((position) => (
              <div
                key={`${markSide}-${position}`}
                data-testid="input-steer-meter-mark"
                // A mark the fill has reached is drawn dark, to stay visible.
                className={`absolute inset-y-0 w-px ${
                  markSide === side && position <= fraction
                    ? 'bg-slate-900/40'
                    : 'bg-white/15'
                }`}
                style={{ [markSide]: `${(50 - position * 50).toFixed(2)}%` }}
              />
            ))
          )}
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/40" />
          <div className="absolute inset-y-0 left-0 w-px bg-white/40" />
          <div className="absolute inset-y-0 right-0 w-px bg-white/40" />
        </div>
      </div>
    );
  }
);

InputSteerMeter.displayName = 'InputSteerMeter';
