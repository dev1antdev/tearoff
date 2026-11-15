import { memo, useMemo } from 'react';
import { SteeringWheelIcon } from '@phosphor-icons/react';
import { getColor } from '@irdashies/utils/colors';

const INPUT_CONFIG = [
  { key: 'clutch', color: getColor('blue') },
  { key: 'brake', color: getColor('red') },
  { key: 'throttle', color: getColor('green') },
] as const;

/** Pedal travel at or above this counts as flat, allowing for sensor noise. */
const FULL_TRAVEL = 0.999;

const clamp = (value: number) => Math.max(0, Math.min(1, value));

export interface InputBarProps {
  /** The pedals of the chosen input source. */
  brake?: number;
  throttle?: number;
  clutch?: number;
  /**
   * Pedal travel whatever the source: the narrow strip of a side-by-side bar
   * and what the full-travel marker lights on. Without it the marker goes by
   * the value shown.
   */
  brakePedal?: number;
  throttlePedal?: number;
  clutchPedal?: number;
  /** What the car received: the wide strip of a side-by-side bar. */
  brakeCar?: number;
  throttleCar?: number;
  clutchCar?: number;
  /** Signed force feedback as a fraction of full force; absent hides its bar. */
  ffb?: number;
  brakeAbsActive?: boolean;
  tcActive?: boolean;
  settings: {
    includeClutch: boolean;
    includeBrake: boolean;
    includeThrottle: boolean;
    includeAbs: boolean;
    includeTc?: boolean;
    dual?: boolean;
    showMaxMarker?: boolean;
    includeFfb?: boolean;
  };
}

export const InputBar = memo(
  ({
    brake,
    throttle,
    clutch,
    brakePedal,
    throttlePedal,
    clutchPedal,
    brakeCar,
    throttleCar,
    clutchCar,
    ffb,
    brakeAbsActive,
    tcActive,
    settings,
  }: InputBarProps) => {
    const { includeAbs, includeClutch, includeBrake, includeThrottle } =
      settings;
    const includeTc = settings.includeTc ?? true;
    const dual = settings.dual ?? false;
    const showMaxMarker = settings.showMaxMarker ?? true;
    const includeFfb = settings.includeFfb ?? false;

    const activeInputs = useMemo(() => {
      return INPUT_CONFIG.filter(({ key }) => {
        if (key === 'clutch') return includeClutch;
        if (key === 'throttle') return includeThrottle;
        if (key === 'brake') return includeBrake;
        return false;
      }).map(({ key, color }) => {
        const shown =
          key === 'clutch' ? clutch : key === 'brake' ? brake : throttle;
        const pedal =
          key === 'clutch'
            ? clutchPedal
            : key === 'brake'
              ? brakePedal
              : throttlePedal;
        const car =
          key === 'clutch'
            ? clutchCar
            : key === 'brake'
              ? brakeCar
              : throttleCar;
        // Two strips only with both readings; otherwise the bar it always was.
        const split = dual && pedal !== undefined && car !== undefined;
        const value = split ? Math.max(pedal, car) : (shown ?? 0);
        // The assist that is working on this pedal right now, if any.
        const mark =
          key === 'brake' && brakeAbsActive && includeAbs
            ? 'ABS'
            : key === 'throttle' && tcActive && includeTc
              ? 'TC'
              : undefined;
        return {
          key,
          value,
          pedal: split ? pedal : undefined,
          car: split ? car : undefined,
          baseColor: color,
          color: mark ? getColor('yellow', 500) : color,
          mark,
          flat: (pedal ?? shown ?? 0) >= FULL_TRAVEL,
        };
      });
    }, [
      brake,
      throttle,
      clutch,
      brakePedal,
      throttlePedal,
      clutchPedal,
      brakeCar,
      throttleCar,
      clutchCar,
      brakeAbsActive,
      tcActive,
      includeClutch,
      includeBrake,
      includeThrottle,
      includeAbs,
      includeTc,
      dual,
    ]);

    const force = includeFfb && ffb !== undefined ? Math.abs(ffb) : undefined;

    return (
      <div className="flex gap-1 w-full h-full relative justify-center">
        {activeInputs.map(
          ({ key, value, pedal, car, baseColor, color, mark, flat }) => (
            <div
              key={key}
              data-testid={`input-bar-${key}`}
              className="flex flex-col relative min-w-0 h-full"
              style={{ aspectRatio: '1 / 4', width: 'auto' }}
            >
              <div
                className={`text-xs text-center flex justify-center ${value === 0 ? 'text-gray-400' : 'text-white'}`}
              >
                {(value * 100).toFixed(0)}
              </div>
              {showMaxMarker && (
                <div
                  data-testid={`input-cap-${key}`}
                  data-lit={flat}
                  className="h-[3px] mb-px flex-none bg-white/15"
                  style={flat ? { backgroundColor: baseColor } : undefined}
                />
              )}
              <div className="flex-1 flex gap-px relative min-h-0">
                {pedal !== undefined && (
                  <div
                    data-testid={`input-bar-fill-${key}-pedal`}
                    className="h-full w-1/4 flex-none origin-bottom opacity-60 transition-transform duration-50 ease-out"
                    style={{
                      transform: `scaleY(${clamp(pedal)})`,
                      backgroundColor: baseColor,
                    }}
                  />
                )}
                <div
                  data-testid={`input-bar-fill-${key}`}
                  className="h-full flex-1 min-w-0 origin-bottom transition-transform duration-50 ease-out"
                  style={{
                    transform: `scaleY(${clamp(car ?? value)})`,
                    backgroundColor: color,
                  }}
                />
                {mark && (
                  <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[11px] font-bold text-white text-shadow-md pointer-events-none">
                    {mark}
                  </div>
                )}
              </div>
            </div>
          )
        )}
        {force !== undefined && (
          <div
            data-testid="input-bar-ffb"
            className="flex flex-col relative min-w-0 h-full"
            style={{ aspectRatio: '1 / 4', width: 'auto' }}
          >
            {/* Where the pedals have their number, so it is not read as a
                fourth pedal. */}
            <div className="h-4 flex items-center justify-center text-slate-300">
              <SteeringWheelIcon size={12} />
            </div>
            {showMaxMarker && <div className="h-[3px] mb-px flex-none" />}
            <div className="flex-1 flex relative min-h-0">
              <div
                data-testid="input-bar-fill-ffb"
                data-clipping={force >= 1}
                className={`h-full flex-1 min-w-0 origin-bottom transition-transform duration-50 ease-out ${
                  force >= 1 ? 'bg-amber-400' : 'bg-slate-400'
                }`}
                style={{ transform: `scaleY(${clamp(force)})` }}
              />
            </div>
          </div>
        )}
      </div>
    );
  }
);

InputBar.displayName = 'InputBar';
