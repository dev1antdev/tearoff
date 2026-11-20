import { memo } from 'react';
import type { ForecastTone } from '@irdashies/domain/raceForecast';

const TONE_CLASS: Record<ForecastTone, string> = {
  good: 'text-green-400',
  bad: 'text-red-400',
  plain: 'text-white',
  quiet: 'text-slate-400',
};

export interface OurCarTileProps {
  /** Names the tile for a test: `our-car-<id>`. */
  id: string;
  label: string;
  value: string;
  /** How the value is coloured. */
  tone?: ForecastTone;
  /** The value rests on less than a reading: it is drawn quieter. */
  uncertain?: boolean;
  note?: string;
  noteTone?: ForecastTone;
  /** The larger figure of the gaps and lap times of a team-mate's stint. */
  large?: boolean;
}

/**
 * One tile of Our Car: a caption, a figure and a line under it. Every prop
 * is a string or a flag, so a tile whose figure has not moved is not drawn
 * again when the forecast is.
 */
export const OurCarTile = memo(
  ({
    id,
    label,
    value,
    tone = 'plain',
    uncertain = false,
    note = '',
    noteTone = 'quiet',
    large = false,
  }: OurCarTileProps) => (
    <div
      data-testid={`our-car-${id}`}
      data-tone={tone}
      data-uncertain={uncertain}
      className="flex min-w-0 flex-col gap-1 py-2"
    >
      <span className="overlay-label truncate leading-none">{label}</span>
      <span
        data-testid={`our-car-${id}-value`}
        className={`truncate font-bold leading-tight ${
          large ? 'text-xl' : 'text-base'
        } ${TONE_CLASS[tone]} ${uncertain ? 'opacity-70' : ''}`}
      >
        {value}
      </span>
      <span
        data-testid={`our-car-${id}-note`}
        className={`min-h-[1em] truncate text-xs leading-none ${TONE_CLASS[noteTone]}`}
      >
        {note}
      </span>
    </div>
  )
);
OurCarTile.displayName = 'OurCarTile';
