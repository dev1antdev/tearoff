import { memo } from 'react';
import {
  CloudRainIcon,
  CloudSunIcon,
  FlagCheckeredIcon,
  FlagIcon,
  type Icon,
} from '@phosphor-icons/react';
import type { RaceEventMark } from '@irdashies/domain/raceLog';

/** What stands at the head of a line that is about the whole field. */
const MARKS: Record<
  Exclude<RaceEventMark, 'car'>,
  { icon: Icon; className: string; label: string }
> = {
  green: { icon: FlagIcon, className: 'text-green-400', label: 'Green flag' },
  caution: {
    icon: FlagIcon,
    className: 'text-yellow-400',
    label: 'Full-course yellow',
  },
  red: { icon: FlagIcon, className: 'text-red-500', label: 'Red flag' },
  chequered: {
    icon: FlagCheckeredIcon,
    className: 'text-white',
    label: 'Chequered flag',
  },
  rain: { icon: CloudRainIcon, className: 'text-sky-300', label: 'Forecast' },
  dry: { icon: CloudSunIcon, className: 'text-slate-300', label: 'Forecast' },
};

export interface RaceLogRowProps {
  /** The event's number in the race: what the line is known by. */
  seq: number;
  /** Already formatted. */
  time: string;
  mark: RaceEventMark;
  /** The car's number; empty for a line about the whole field. */
  carNumber: string;
  /** The classes of the number's badge, in the car's class colour. */
  badgeClass: string;
  /** What happened, up to the figure that ends it. */
  text: string;
  /** A figure that ends the line and is set apart; empty for none. */
  figure: string;
  /** About our own car. */
  own: boolean;
}

/**
 * One line of the log: when, who, and what happened.
 *
 * Takes strings and numbers rather than an event so that a snapshot whose
 * events did not change re-renders none of the lines. The three columns are
 * the list's own, through a subgrid, so the times and the numbers line up
 * down the list whatever their width.
 */
export const RaceLogRow = memo(
  ({
    seq,
    time,
    mark,
    carNumber,
    badgeClass,
    text,
    figure,
    own,
  }: RaceLogRowProps) => {
    const field = mark === 'car' ? null : MARKS[mark];
    const MarkIcon = field?.icon;
    return (
      <li
        data-testid="race-log-row"
        data-seq={seq}
        data-own={own}
        className="col-span-3 grid grid-cols-subgrid items-baseline px-2 py-0.5 border-t overlay-divider first:border-t-0"
      >
        <span className="text-right text-slate-400">{time}</span>
        {field && MarkIcon ? (
          <span className="flex justify-center self-center">
            <MarkIcon
              size={14}
              weight="fill"
              className={`flex-none ${field.className}`}
              aria-label={field.label}
            />
          </span>
        ) : (
          <span
            data-testid="race-log-car"
            className={`rounded-sm border-l-4 px-1 text-right font-bold leading-snug ${badgeClass} ${
              own ? 'text-amber-300' : 'text-white'
            }`}
          >
            #{carNumber}
          </span>
        )}
        <span
          data-testid="race-log-text"
          className={`min-w-0 ${own ? 'text-amber-300' : 'text-slate-200'}`}
        >
          {text}
          {figure && (
            <span className="font-semibold text-purple-400">{figure}</span>
          )}
        </span>
      </li>
    );
  }
);
RaceLogRow.displayName = 'RaceLogRow';
