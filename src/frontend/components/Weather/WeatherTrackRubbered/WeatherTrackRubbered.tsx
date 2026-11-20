import { memo } from 'react';
import { PathIcon } from '@phosphor-icons/react';

interface Props {
  trackRubbered: string | undefined;
  variant?: 'default' | 'compact' | 'inline';
}

export const WeatherTrackRubbered = memo(
  ({ trackRubbered, variant = 'default' }: Props) => {
    if (variant === 'compact') {
      return (
        <div className="px-2 py-1 min-w-0">
          <div className="flex items-center gap-x-1.5">
            <PathIcon size={12} className="flex-none text-slate-400" />
            <div
              className="text-sm font-medium capitalize truncate"
              title={trackRubbered ?? 'N/A'}
            >
              {trackRubbered ?? 'N/A'}
            </div>
          </div>
        </div>
      );
    }

    if (variant === 'inline') {
      return (
        <div className="px-2 py-1 min-w-0">
          <div className="flex items-center gap-x-1.5 text-sm">
            <PathIcon size={12} className="flex-none text-slate-400" />
            <span className="truncate min-w-0 text-slate-400">Rubber</span>
            <div
              className="flex-none whitespace-nowrap text-right font-medium capitalize"
              title={trackRubbered ?? 'N/A'}
            >
              {trackRubbered ?? 'N/A'}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="p-2 w-full min-w-0">
        <div className="flex flex-row gap-x-2 items-center text-sm">
          <PathIcon className="flex-none text-slate-400" />
          <span className="flex-none text-slate-400 @max-[160px]:hidden">
            Rubber
          </span>
          <div
            className="flex-1 min-w-0 truncate text-right capitalize"
            title={trackRubbered ?? 'N/A'}
          >
            {trackRubbered ?? 'N/A'}
          </div>
        </div>
      </div>
    );
  }
);
WeatherTrackRubbered.displayName = 'WeatherTrackRubbered';
