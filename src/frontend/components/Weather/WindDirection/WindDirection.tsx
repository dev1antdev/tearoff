import { WindIcon } from '@phosphor-icons/react';
import { memo } from 'react';
import { getWindIntensityClass } from '../../../domain/weather/wind';
import { speedFromMs } from '@irdashies/utils/units';
import { WindCompass } from '../../shared/WindCompass';

export interface WindDirectionProps {
  speedMs?: number;
  direction?: number;
  metric?: boolean;
  variant?: 'default' | 'compact' | 'inline';
}

export const WindDirection = memo(
  ({
    speedMs,
    direction,
    metric = true,
    variant = 'default',
  }: WindDirectionProps) => {
    // Convert m/s to user's preferred unit
    const speed =
      speedMs !== undefined
        ? speedFromMs(speedMs, metric ? 'km/h' : 'mph')
        : undefined;

    const windIntensityClass = getWindIntensityClass(speed);
    const displaySpeed = speed !== undefined ? Math.round(speed) : '-';

    if (variant === 'compact') {
      return (
        <div
          className={`px-2 py-1 min-w-0 transition-colors duration-300 ${windIntensityClass}`}
          title="Wind"
        >
          <div className="flex items-center gap-x-1.5">
            <WindCompass
              direction={direction}
              className="flex-none size-5"
              strokeWidth="stroke-[3]"
            />
            <div className="text-sm font-medium truncate tabular-nums text-right min-w-[3ch]">
              {displaySpeed}
            </div>
          </div>
        </div>
      );
    }

    if (variant === 'inline') {
      return (
        <div
          className={`px-2 py-1 min-w-0 transition-colors duration-300 ${windIntensityClass}`}
        >
          <div className="flex items-center gap-x-1.5 text-sm">
            <span className="truncate min-w-0 text-slate-400">Wind</span>
            <WindCompass
              direction={direction}
              className="flex-none size-5"
              strokeWidth="stroke-[3]"
            />
            <div className="flex-none whitespace-nowrap text-right font-medium tabular-nums min-w-[3ch]">
              {displaySpeed}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="p-2 w-full min-w-0">
        <div className="flex flex-row gap-x-2 items-center text-sm mb-3">
          <WindIcon className="flex-none text-slate-400" />
          <span className="overlay-label truncate min-w-0 flex-1 @max-[120px]:hidden">
            Wind
          </span>
        </div>
        <div className="flex justify-center">
          <div
            id="wind"
            className={`flex aspect-square relative w-full max-w-[120px] mx-auto items-center justify-center transition-colors duration-300 ${windIntensityClass}`}
          >
            <WindCompass
              direction={direction}
              className="absolute w-full h-full"
            />

            {/* An overlay step, so it follows the Font size setting. */}
            <div className="absolute w-full h-full flex justify-center items-center text-display-sm">
              {displaySpeed}
            </div>
          </div>
        </div>
      </div>
    );
  }
);
WindDirection.displayName = 'WindDirection';
