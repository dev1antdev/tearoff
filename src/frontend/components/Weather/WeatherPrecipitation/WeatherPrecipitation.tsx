import { memo } from 'react';
import { CloudRainIcon } from '@phosphor-icons/react';

interface Props {
  precipitation: number | undefined | null;
  variant?: 'default' | 'compact' | 'inline';
}

export const WeatherPrecipitation = memo(
  ({ precipitation, variant = 'default' }: Props) => {
    const hasPrecipitation =
      precipitation !== undefined && precipitation !== null;
    // iRacing provides precipitation as 0.0 to 1.0 decimal
    const precipitationPercent = hasPrecipitation
      ? Math.round(precipitation * 100)
      : 0;
    const value = hasPrecipitation ? `${precipitationPercent}%` : '- %';

    if (variant === 'compact') {
      return (
        <div className="px-2 py-1 min-w-0" title="Precipitation">
          <div className="flex items-center gap-x-1.5">
            <CloudRainIcon size={12} className="flex-none text-slate-400" />
            <div className="text-sm font-medium truncate">{value}</div>
          </div>
        </div>
      );
    }

    if (variant === 'inline') {
      return (
        <div className="px-2 py-1 min-w-0">
          <div className="flex items-center gap-x-1.5 text-sm">
            <CloudRainIcon size={12} className="flex-none text-slate-400" />
            <span className="overlay-label truncate min-w-0">
              Precipitation
            </span>
            <div className="flex-none whitespace-nowrap text-right font-medium">
              {value}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="p-2 w-full min-w-0">
        <div className="flex flex-row gap-x-2 items-center text-sm">
          <CloudRainIcon className="flex-none text-slate-400" />
          <span className="overlay-label truncate min-w-0 flex-1 @max-[120px]:hidden">
            Precipitation
          </span>
          <div className="flex-none whitespace-nowrap text-right font-semibold">
            {value}
          </div>
        </div>
      </div>
    );
  }
);
WeatherPrecipitation.displayName = 'WeatherPrecipitation';
