import { memo } from 'react';
import {
  CaretDoubleUpIcon,
  CaretDownIcon,
  CaretUpIcon,
  MinusIcon,
} from '@phosphor-icons/react';
import type { TrafficRelation } from '@irdashies/types';
import type { ClosingLevel } from '@irdashies/domain/traffic/trafficText';
import { CarNumber } from '../../shared/CarNumberCell/CarNumberCell';

/** The car number by its class colour, as every block of the widget draws it. */
export const CarChip = memo(
  ({
    number,
    classColor,
    highlightColor,
    isMultiClass,
    outlined = false,
  }: {
    number: string;
    classColor: number | undefined;
    highlightColor: number;
    isMultiClass: boolean;
    /** The blue of a blue flag round it: this car is coming to lap you. */
    outlined?: boolean;
  }) => (
    // As the standings draw a number: grey, after a bar in its class colour.
    <CarNumber
      carNumber={number}
      color={classColor}
      highlightColor={highlightColor}
      isMultiClass={isMultiClass}
      className={`flex-none py-0.5 text-xs leading-none tabular-nums ${
        outlined
          ? 'rounded-sm pr-1 outline-2 outline-offset-1 outline-blue-500'
          : ''
      }`}
    />
  )
);
CarChip.displayName = 'CarChip';

const RELATION_TAG: Partial<
  Record<TrafficRelation, { text: string; className: string }>
> = {
  position: {
    text: 'Rival',
    className: 'bg-amber-500/20 text-amber-300',
  },
  lapped: { text: 'Lapped', className: 'bg-white/10 text-slate-300' },
};

const ClosingArrow = ({ level }: { level: ClosingLevel | null }) => {
  if (level === 'fast') {
    return (
      <CaretDoubleUpIcon
        data-testid="traffic-closing"
        data-level="fast"
        weight="bold"
        aria-label="Closing fast"
      />
    );
  }
  if (level === 'closing') {
    return (
      <CaretUpIcon
        data-testid="traffic-closing"
        data-level="closing"
        weight="bold"
        aria-label="Closing"
      />
    );
  }
  if (level === 'dropping') {
    return (
      <CaretDownIcon
        data-testid="traffic-closing"
        data-level="dropping"
        weight="bold"
        className="text-slate-500"
        aria-label="Dropping back"
      />
    );
  }
  if (level === 'steady') {
    return (
      <MinusIcon
        data-testid="traffic-closing"
        data-level="steady"
        weight="bold"
        className="text-slate-500"
        aria-label="Holding station"
      />
    );
  }
  return null;
};

export interface MirrorRowProps {
  number: string;
  label: string;
  classColor: number | undefined;
  highlightColor: number;
  isMultiClass: boolean;
  relation: TrafficRelation;
  /** The gap as text: one decimal, or a dash. */
  gap: string;
  /** Under a second: it is on you. */
  urgent: boolean;
  level: ClosingLevel | null;
  /** Seconds a lap it is gaining, as text; null to leave it out. */
  perLap: string | null;
  lapsAhead: number;
  /** The first row is the car right behind and is drawn larger. */
  isHead: boolean;
  /** Cars of traffic queued behind the last row; 0 for none. */
  more: number;
}

/**
 * One car in the mirror: its number by its class colour, who it is, an
 * arrow for how fast it is closing, and the gap. A car coming to lap the
 * player carries the blue of a blue flag; a rival for position is muted.
 */
export const MirrorRow = memo(
  ({
    number,
    label,
    classColor,
    highlightColor,
    isMultiClass,
    relation,
    gap,
    urgent,
    level,
    perLap,
    lapsAhead,
    isHead,
    more,
  }: MirrorRowProps) => {
    const isTraffic =
      relation === 'lapping' ||
      relation === 'fasterClass' ||
      relation === 'closing';
    const tag = RELATION_TAG[relation];
    return (
      <div
        data-testid="traffic-row"
        data-relation={relation}
        className={`flex min-w-0 items-center gap-2 rounded px-1.5 ${
          isHead ? 'py-1' : 'py-0.5'
        } ${relation === 'lapping' ? 'ring-1 ring-inset ring-blue-500/70' : ''} ${
          isTraffic ? '' : 'text-slate-300'
        }`}
      >
        <CarChip
          number={number}
          classColor={classColor}
          highlightColor={highlightColor}
          isMultiClass={isMultiClass}
        />
        <span className="min-w-0 flex-1 truncate text-sm" title={label}>
          {label}
        </span>
        {relation === 'lapping' && (
          <span
            data-testid="traffic-laps"
            className="flex-none rounded bg-blue-500/20 px-1 py-0.5 text-2xs leading-none font-bold text-blue-300 uppercase"
          >
            +{Math.max(1, lapsAhead)} lap{lapsAhead > 1 ? 's' : ''}
          </span>
        )}
        {tag && (
          <span
            data-testid="traffic-tag"
            className={`flex-none rounded px-1 py-0.5 text-2xs leading-none font-bold uppercase ${tag.className}`}
          >
            {tag.text}
          </span>
        )}
        {more > 0 && (
          <span
            data-testid="traffic-more"
            className="flex-none rounded bg-white/15 px-1 py-0.5 text-2xs leading-none font-bold"
          >
            +{more}
          </span>
        )}
        <span className="flex flex-none items-center gap-0.5 text-xs tabular-nums">
          <ClosingArrow level={level} />
          {perLap && (
            <span data-testid="traffic-per-lap">
              {perLap}
              <span className="text-slate-400">/lap</span>
            </span>
          )}
        </span>
        {/* An urgent gap keeps a dark scrim of its own whatever the panel's
            opacity, so the red reads over a bright scene. Drawn as an outline
            past the figure, so it takes no room. */}
        <span
          data-testid="traffic-gap"
          className={`min-w-[3.2ch] flex-none text-right leading-none font-bold tabular-nums ${
            isHead ? 'text-xl' : 'text-base'
          } ${
            urgent
              ? 'rounded-sm bg-slate-950/70 text-red-400 outline-2 outline-slate-950/70'
              : ''
          }`}
        >
          {gap}
          <span className="text-[0.6em] font-semibold text-slate-400"> s</span>
        </span>
      </div>
    );
  }
);
MirrorRow.displayName = 'MirrorRow';

export interface ContactTileProps {
  caption: string;
  /** Empty when there is no car to name: the tile shows a dash. */
  number: string;
  classColor: number | undefined;
  highlightColor: number;
  isMultiClass: boolean;
  /** Laps until the two meet, as text; a dash for none. */
  laps: string;
  /** The gap now, as text. */
  gap: string;
  /** The meeting falls inside the lap under way. */
  thisLap: boolean;
  /** That meeting is a car coming to lap the player: outline it in blue. */
  blue: boolean;
}

/**
 * One column of the table of contacts: a caption, the car, the laps until
 * the two meet and the gap now.
 */
export const ContactTile = memo(
  ({
    caption,
    number,
    classColor,
    highlightColor,
    isMultiClass,
    laps,
    gap,
    thisLap,
    blue,
  }: ContactTileProps) => (
    <div
      data-testid="traffic-contact"
      className="flex min-w-0 flex-col gap-1 px-1.5 py-1"
    >
      {/* Wraps rather than cutting the caption short when a large font
          size leaves the tile too narrow for both on one line. */}
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-1 gap-y-0.5 text-2xs leading-none">
        <span className="truncate tracking-wide text-slate-400 uppercase">
          {caption}
        </span>
        {number && (
          <span
            data-testid="traffic-contact-gap"
            className="flex-none text-slate-300 tabular-nums"
          >
            {gap}
            <span className="text-slate-400"> s</span>
          </span>
        )}
      </div>
      {number ? (
        <div className="flex min-w-0 items-center justify-between gap-1.5">
          <CarChip
            number={number}
            classColor={classColor}
            highlightColor={highlightColor}
            isMultiClass={isMultiClass}
            outlined={blue && thisLap}
          />
          <span
            data-testid="traffic-contact-laps"
            className={`flex-none text-lg leading-none font-semibold tabular-nums ${
              thisLap ? 'text-amber-400' : ''
            }`}
          >
            {laps}
            <span className="text-[0.6em] text-slate-400"> L</span>
          </span>
        </div>
      ) : (
        <span className="text-lg leading-none font-semibold opacity-40">
          --
        </span>
      )}
    </div>
  )
);
ContactTile.displayName = 'ContactTile';
