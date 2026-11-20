import { memo } from 'react';

export interface WeatherTempProps {
  title: string;
  value: string;
  icon: React.ElementType;
  variant?: 'default' | 'compact' | 'inline';
}

export const WeatherTemp = memo(
  ({ title, value, icon: Icon, variant = 'default' }: WeatherTempProps) => {
    if (variant === 'compact') {
      return (
        <div className="px-2 py-1 min-w-0" title={title}>
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
            <span className="truncate min-w-0 text-slate-400">{title}</span>
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
          <Icon className="flex-none text-slate-400" />
          <span className="overlay-label truncate min-w-0 flex-1 @max-[120px]:hidden">
            {title}
          </span>
          <div className="flex-none whitespace-nowrap text-right font-semibold">
            {value}
          </div>
        </div>
      </div>
    );
  }
);
WeatherTemp.displayName = 'WeatherTemp';
