import { memo } from 'react';
import { ThermometerHotIcon } from '@phosphor-icons/react';
import type {
  IntegrityTone,
  WheelState,
} from '@irdashies/domain/damage/damageDisplay';

/**
 * The car from above, nose up, in a 62 by 80 picture: eight body zones that
 * read as its outline, and a wheel inside each corner.
 *
 * The zones run clockwise from the nose, as the snapshot has them: front,
 * front right, right, rear right, rear, rear left, left, front left. A corner
 * is the piece of outline that wraps it; the front ones are rounder, which is
 * what says which end is the nose.
 */
const ZONE_PATHS = [
  'M21.8 2H40.2V8H21.8Z',
  'M41.8 2H50A10 10 0 0 1 60 12V26.2H54V12A4 4 0 0 0 50 8H41.8Z',
  'M54 27.8H60V52.2H54Z',
  'M41.8 78H54A6 6 0 0 0 60 72V53.8H54V70.5A1.5 1.5 0 0 1 52.5 72H41.8Z',
  'M21.8 72H40.2V78H21.8Z',
  'M20.2 78H8A6 6 0 0 1 2 72V53.8H8V70.5A1.5 1.5 0 0 0 9.5 72H20.2Z',
  'M2 27.8H8V52.2H2Z',
  'M20.2 2H12A10 10 0 0 0 2 12V26.2H8V12A4 4 0 0 1 12 8H20.2Z',
] as const;

/** Top-left corner of each wheel: LF, RF, LR, RR. */
const WHEEL_ORIGINS = [
  [10, 10.5],
  [42, 10.5],
  [10, 53.5],
  [42, 53.5],
] as const;
const WHEEL_WIDTH = 10;
const WHEEL_HEIGHT = 16;

const CENTRE_X = 31;
const CENTRE_Y = 40;

/**
 * A wedge 15 degrees wide from the middle of the car to past its nose; the
 * picture's edge trims it, and a rotation points it at the impact. It starts
 * 14 units out, clear of the figure in the middle.
 */
const IMPACT_WEDGE = 'M29.17 26.12L24.2 -11.6H37.8L32.83 26.12Z';

/** The cabin: where the figure sits, and what makes the outline a car. */
const CABIN = { x: 15.5, y: 27.5, width: 31, height: 25, radius: 6 } as const;

/** Side of the overheating icon, which sits under the figure. */
const WARNING_SIZE = 10;

/** Without a car the outline is drawn, and nothing is said about it. */
const NO_CAR_CLASS = 'fill-slate-600';

/** A part that has come off: black, outlined in red. */
const DETACHED_CLASS = 'fill-slate-950 stroke-red-500 stroke-[1.5]';

const ZONE_CLASS: Record<string, string> = {
  '0': 'fill-slate-500',
  '1': 'fill-amber-400',
  '2': 'fill-red-500',
  '3': DETACHED_CLASS,
};

const WHEEL_CLASS: Record<WheelState, string> = {
  unknown: 'fill-slate-600',
  healthy: 'fill-green-500',
  light: 'fill-amber-300',
  medium: 'fill-orange-500',
  heavy: 'fill-red-500',
  destroyed: 'fill-red-800',
  detached: DETACHED_CLASS,
  // The rim of a tyre with no air in it, and nothing inside.
  punctured: 'fill-none stroke-red-500 stroke-2',
};

const READING_CLASS: Record<IntegrityTone, string> = {
  none: 'fill-slate-400',
  normal: 'fill-white',
  warn: 'fill-red-400',
};

export interface CarDiagramProps {
  /** False draws the bare outline, for a widget with no car to describe. */
  available: boolean;
  /** The eight zone levels, clockwise from the nose, one digit each. */
  zones: string;
  leftFront: WheelState;
  rightFront: WheelState;
  leftRear: WheelState;
  rightRear: WheelState;
  /** Degrees clockwise from the nose to the last impact; null for none. */
  impactDegrees: number | null;
  /** The figure in the middle; null leaves the middle empty. */
  readingValue: string | null;
  /** What the figure is, for a reader that cannot see where it sits. */
  readingLabel: string;
  readingTone: IntegrityTone;
  /** The sim's overheating warning, drawn under the figure. */
  overheating: boolean;
  /** Pulse what has come off. */
  flash: boolean;
}

/**
 * Takes strings and numbers rather than the snapshot, so that a snapshot
 * whose picture did not change re-renders nothing.
 */
export const CarDiagram = memo(
  ({
    available,
    zones,
    leftFront,
    rightFront,
    leftRear,
    rightRear,
    impactDegrees,
    readingValue,
    readingLabel,
    readingTone,
    overheating,
    flash,
  }: CarDiagramProps) => {
    const wheels = [leftFront, rightFront, leftRear, rightRear];
    const pulse = flash ? ' animate-pulse' : '';
    const warning = available && overheating;
    // The figure and the warning share the middle: each is centred alone,
    // and they stack when both are there.
    const stacked = warning && readingValue !== null;
    const readingY = stacked ? CENTRE_Y - 5 : CENTRE_Y;
    const warningY = stacked ? CENTRE_Y + 1 : CENTRE_Y - WARNING_SIZE / 2;

    return (
      <svg
        viewBox="0 0 62 80"
        className="h-full w-auto"
        role="img"
        aria-label="Car damage diagram"
        data-testid="damage-diagram"
      >
        <rect
          x={CABIN.x}
          y={CABIN.y}
          width={CABIN.width}
          height={CABIN.height}
          rx={CABIN.radius}
          className="fill-slate-900/50"
        />

        {ZONE_PATHS.map((path, zone) => {
          const level = available ? (zones[zone] ?? '0') : '0';
          const tone = available
            ? (ZONE_CLASS[level] ?? ZONE_CLASS['0'])
            : NO_CAR_CLASS;
          return (
            <path
              key={path}
              d={path}
              data-testid={`damage-zone-${zone}`}
              data-level={level}
              className={`${tone}${level === '3' ? pulse : ''}`}
            />
          );
        })}

        {/* Over the outline, so the zone that was hit shows through it, and
            under the wheels and the figure, which stay readable. */}
        {available && impactDegrees !== null && (
          <path
            d={IMPACT_WEDGE}
            transform={`rotate(${impactDegrees} ${CENTRE_X} ${CENTRE_Y})`}
            data-testid="damage-impact"
            // The dark edge keeps it apart from a zone that is red itself.
            className="fill-red-500/85 stroke-slate-950/80 stroke-[0.75]"
          />
        )}

        {WHEEL_ORIGINS.map(([x, y], wheel) => {
          const state = available ? wheels[wheel] : 'unknown';
          return (
            <rect
              key={`${x}-${y}`}
              x={x}
              y={y}
              width={WHEEL_WIDTH}
              height={WHEEL_HEIGHT}
              rx={2.5}
              data-testid={`damage-wheel-${wheel}`}
              data-state={state}
              className={`${WHEEL_CLASS[state]}${
                state === 'detached' ? pulse : ''
              }`}
            />
          );
        })}

        {readingValue !== null && (
          <text
            x={CENTRE_X}
            y={readingY}
            textAnchor="middle"
            dominantBaseline="central"
            aria-label={`${readingLabel} ${readingValue}`}
            data-testid="damage-reading"
            data-tone={readingTone}
            className={`text-[10px] font-bold tabular-nums ${READING_CLASS[readingTone]}`}
          >
            {readingValue}
          </text>
        )}

        {warning && (
          <ThermometerHotIcon
            x={CENTRE_X - WARNING_SIZE / 2}
            y={warningY}
            size={WARNING_SIZE}
            weight="fill"
            role="img"
            aria-label="Overheating"
            data-testid="damage-overheating"
            className="text-red-400"
          />
        )}
      </svg>
    );
  }
);
CarDiagram.displayName = 'CarDiagram';
