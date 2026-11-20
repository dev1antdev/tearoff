import { memo } from 'react';
import { DropHalfIcon, DropIcon } from '@phosphor-icons/react';

interface Props {
  humidity: number | undefined | null;
  variant?: 'default' | 'compact' | 'inline';
}

export const WeatherHumidity = memo(
  ({ humidity, variant = 'default' }: Props) => {
    const hasHumidity = humidity !== undefined && humidity !== null;
    const humidityValue = hasHumidity ? Number(humidity.toFixed(2)) : 0;
    const humidityPercent = humidityValue * 100;
    const Icon = humidityPercent <= 50 ? DropIcon : DropHalfIcon;
    const value = hasHumidity ? `${Math.round(humidityPercent)}%` : '- %';

    if (variant === 'compact') {
      return (
        <div className="px-2 py-1 min-w-0" title="Humidity">
          <div className="flex items-center gap-x-1.5">
            <Icon size={12} className="flex-none text-slate-400" />
            <div className="text-sm font-medium truncate">{value}</div>
          </div>
        </div>
      );
    }

    if (variant === 'inline') {
      return (
        <div className="px-2 py-1 min-w-0">
          <div className="flex items-center gap-x-1.5 text-sm">
            <Icon size={12} className="flex-none text-slate-400" />
            <span className="truncate min-w-0 text-slate-400">Humidity</span>
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
          <Icon className="flex-none" />
          <span className="truncate min-w-0 flex-1 text-slate-400 @max-[120px]:hidden">
            Humidity
          </span>
          <div className="flex-none whitespace-nowrap text-right font-semibold">
            {value}
          </div>
        </div>
      </div>
    );
  }
);
WeatherHumidity.displayName = 'WeatherHumidity';
