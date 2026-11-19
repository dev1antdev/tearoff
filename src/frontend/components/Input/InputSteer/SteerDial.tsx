import { InputGear, InputGearProps } from '../InputGear/InputGear';

export interface SteerDialProps {
  /** Steering wheel angle in radians (raw `SteeringWheelAngle` value). */
  angleRad?: number;
  gear?: number;
  /** Speed in m/s (raw `Speed` value). */
  speedMs?: number;
  /** `DisplayUnits` value (0 = imperial, 1 = metric). */
  unit?: number;
  /** Light/dark colour scheme, matching the icon wheels. */
  wheelColor?: 'dark' | 'light';
  /** Gear/speed display config, reused from the standalone Gear section. */
  gearSettings?: InputGearProps['settings'];
  /** The wheel angle in the centre instead of the gear and speed. */
  angleInside?: boolean;
  flashColor?: InputGearProps['flashColor'];
}

// --- Geometry (SVG user units, viewBox 0 0 100 100) ----------------------
const CENTER = 50;
const RING_RADIUS = 46; // centreline of the ring (thin ring => large clear centre)
const RING_WIDTH = 5; // ring thickness (spans r43.5–48.5, inner clear Ø87%)
/** Half the length of the position mark, in degrees round the ring. */
const MARK_HALF_DEG = 10;
const MARK_X = RING_RADIUS * Math.sin((MARK_HALF_DEG * Math.PI) / 180);
const MARK_Y = CENTER - RING_RADIUS * Math.cos((MARK_HALF_DEG * Math.PI) / 180);
/** A short arc of the ring at 12 o'clock, turned with the wheel. */
const MARK_PATH = `M ${(CENTER - MARK_X).toFixed(2)} ${MARK_Y.toFixed(2)} A ${RING_RADIUS} ${RING_RADIUS} 0 0 1 ${(CENTER + MARK_X).toFixed(2)} ${MARK_Y.toFixed(2)}`;

/**
 * Compact "ring" steering display: a faint ring with a short arc on it that
 * turns with the wheel to show its position. The centre holds the gear and
 * speed, or the wheel angle in degrees. The arc uses the same rotation sign
 * as the icon wheels, so direction matches exactly.
 */
export function SteerDial({
  angleRad = 0,
  gear,
  speedMs,
  unit,
  wheelColor = 'light',
  gearSettings,
  angleInside = false,
  flashColor,
}: SteerDialProps) {
  const steerDeg = angleRad * -1 * (180 / Math.PI);
  // A wheel a fraction of a degree to the left is at 0, not at -0.
  const wholeDeg = Math.round(steerDeg);

  // 'light' draws on a dark scene, 'dark' on a bright one.
  const trackClass =
    wheelColor === 'dark' ? 'stroke-black/30' : 'stroke-white/10';
  const markClass = wheelColor === 'dark' ? 'stroke-black' : 'stroke-white';

  return (
    <div className="@container-[size] w-full h-full flex items-center justify-center">
      {/* Square sized by the smaller dimension so the dial is always as large
          as possible and stays square — fixes the wheel shrinking / distorting
          when the widget is stretched vertically. */}
      <div
        className="relative aspect-square"
        style={{ width: 'min(100cqw, 100cqh)' }}
      >
        <svg viewBox="0 0 100 100" className="w-full h-full fill-none">
          {/* the ring; the centre stays transparent so the widget bg shows */}
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RING_RADIUS}
            strokeWidth={RING_WIDTH}
            className={trackClass}
          />
          {/* the position mark, turned with the wheel */}
          <g
            transform={`rotate(${steerDeg} ${CENTER} ${CENTER})`}
            style={{ willChange: 'transform' }}
          >
            <path
              d={MARK_PATH}
              strokeWidth={RING_WIDTH}
              strokeLinecap="round"
              className={markClass}
            />
          </g>
        </svg>

        {/* gear + speed in the centre — inset so the square content box stays
            inside the ring's clear inner circle (Ø80%) and never overlaps it */}
        {angleInside ? (
          <div
            data-testid="input-steer-dial-angle"
            className="absolute inset-0 flex items-center justify-center font-semibold tabular-nums text-slate-200"
            style={{ fontSize: 'min(18cqw, 18cqh)' }}
          >
            {wholeDeg === 0 ? 0 : wholeDeg}°
          </div>
        ) : (
          gearSettings && (
            <div className="absolute inset-[12%]">
              <InputGear
                gear={gear}
                speedMs={speedMs}
                unit={unit}
                settings={gearSettings}
                flashColor={flashColor}
              />
            </div>
          )
        )}
      </div>
    </div>
  );
}
