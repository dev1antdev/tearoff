import { useMemo, useRef, useEffect } from 'react';
import {
  DefaultB,
  DefaultW,
  FormulaB,
  FormulaW,
  LmpB,
  LmpW,
  NascarB,
  NascarW,
  UshapeB,
  UshapeW,
} from './wheels';
import { RotationArc } from './RotationArc';
import { RotationIndicator } from './RotationIndicator';
import type { AngleReadout } from './RotationIndicator';
import { SteerDial } from './SteerDial';
import type { SteerDialProps } from './SteerDial';

export type WheelStyle =
  'formula' | 'lmp' | 'nascar' | 'ushape' | 'default' | 'ring';

const wheelComponentMap = {
  default: {
    dark: DefaultB,
    light: DefaultW,
  },
  formula: {
    dark: FormulaB,
    light: FormulaW,
  },
  lmp: {
    dark: LmpB,
    light: LmpW,
  },
  nascar: {
    dark: NascarB,
    light: NascarW,
  },
  ushape: {
    dark: UshapeB,
    light: UshapeW,
  },
};

export interface InputSteerProps {
  angleRad?: number;
  wheelStyle?: WheelStyle;
  wheelColor?: 'dark' | 'light';
  /** Used by the `ring` style to render gear + speed inside the dial. */
  gear?: number;
  speedMs?: number;
  unit?: number;
  gearSettings?: SteerDialProps['gearSettings'];
  flashColor?: SteerDialProps['flashColor'];
  /** When the wheel shows its angle in degrees; past 270 by default. */
  angleReadout?: AngleReadout;
  /**
   * The arc from 12 o'clock by the steering angle: never, always, or only
   * while `stationary`.
   */
  rotationArc?: 'never' | 'stationary' | 'always';
  stationary?: boolean;
  /**
   * The mean front road-wheel angle in degrees, signed like the steering
   * angle. With it the wheel angle and the steering ratio are drawn under
   * the wheel; a sim without it draws neither.
   */
  frontWheelAngleDeg?: number;
}

/** Below this the road wheels are too near straight for a ratio to mean much. */
const MIN_RATIO_WHEEL_ANGLE_DEG = 1;

/** Steering wheel degrees per degree at the road wheels, as `13.8:1`. */
const steeringRatio = (angleRad: number, wheelAngleDeg: number): string => {
  const wheel = Math.abs(wheelAngleDeg);
  if (wheel < MIN_RATIO_WHEEL_ANGLE_DEG) return '–';
  const steering = Math.abs((angleRad * 180) / Math.PI);
  return `${(steering / wheel).toFixed(1)}:1`;
};

export function InputSteer({
  angleRad = 0,
  wheelStyle = 'default',
  wheelColor = 'light',
  gear,
  speedMs,
  unit,
  gearSettings,
  flashColor,
  angleReadout = 'beyond270',
  rotationArc = 'never',
  stationary = false,
  frontWheelAngleDeg,
}: InputSteerProps) {
  const wheelRef = useRef<HTMLDivElement>(null);

  // Memoize the wheel component selection (only changes when style/color change)
  const WheelComponent = useMemo(() => {
    const entry =
      wheelComponentMap[wheelStyle as keyof typeof wheelComponentMap];
    return (entry ?? wheelComponentMap.default)[wheelColor];
  }, [wheelStyle, wheelColor]);

  // Use CSS custom properties for smooth updates without React re-renders
  useEffect(() => {
    if (wheelRef.current) {
      wheelRef.current.style.setProperty(
        '--wheel-rotation',
        `${angleRad * -1}rad`
      );
    }
  }, [angleRad]);

  if (wheelStyle === 'ring') {
    return (
      <SteerDial
        angleRad={angleRad}
        gear={gear}
        speedMs={speedMs}
        unit={unit}
        wheelColor={wheelColor}
        gearSettings={gearSettings}
        flashColor={flashColor}
      />
    );
  }

  const arcVisible =
    rotationArc === 'always' || (rotationArc === 'stationary' && stationary);

  return (
    <div className="w-full h-full flex flex-col fill-white">
      {/* The arc runs just outside the wheel, so a wheel that can show one is
          drawn a little smaller whether the arc is on screen or not. */}
      <div
        className={`relative flex-1 min-h-0 flex ${
          rotationArc === 'never' ? '' : 'p-1.5'
        }`}
      >
        <div
          ref={wheelRef}
          className="w-full h-full flex justify-center"
          style={{
            transform: 'rotate(var(--wheel-rotation, 0rad))',
            transformBox: 'fill-box',
            transformOrigin: 'center',
            willChange: 'transform',
          }}
        >
          <WheelComponent />
        </div>
        {arcVisible && <RotationArc angleRad={angleRad} />}
        <RotationIndicator currentAngleRad={angleRad} readout={angleReadout} />
      </div>
      {frontWheelAngleDeg !== undefined && (
        <div
          data-testid="input-steer-wheel-angle"
          className="flex-none flex justify-center gap-1 whitespace-nowrap text-[10px] leading-3 tabular-nums text-white/70"
        >
          <span>{Math.abs(frontWheelAngleDeg).toFixed(1)}°</span>
          <span>{steeringRatio(angleRad, frontWheelAngleDeg)}</span>
        </div>
      )}
    </div>
  );
}
