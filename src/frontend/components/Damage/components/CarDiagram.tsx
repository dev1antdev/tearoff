import { memo } from 'react';
import { ThermometerHotIcon } from '@phosphor-icons/react';
import type {
  IntegrityTone,
  WheelState,
} from '@irdashies/domain/damage/damageDisplay';

/**
 * The car from above, nose up, in a 62 by 80 picture: a thin outline in eight
 * pieces, one per body zone, and a wheel inside each corner. Tearoff's own
 * drawing: a narrow nose, arches over the wheels, a waist at the cockpit and
 * a square tail.
 *
 * The zones run clockwise from the nose, as the snapshot has them: front,
 * front right, right, rear right, rear, rear left, left, front left. Each
 * piece starts where the one before it ends, so together they are the whole
 * outline; a damaged piece is drawn thicker, in its level's colour.
 */
const ZONE_PATHS = [
  'M24 3.5Q31 2 38 3.5',
  'M38 3.5C46 4.5 51 8 54 13Q57.5 19 56.5 27',
  'M56.5 27C52 33 52 46 56.5 52',
  'M56.5 52Q59.5 60 58.5 70Q57.5 77 50 77.5L44 77.5',
  'M44 77.5L18 77.5',
  'M18 77.5L12 77.5Q4.5 77 3.5 70Q2.5 60 5.5 52',
  'M5.5 52C10 46 10 33 5.5 27',
  'M5.5 27Q4.5 19 8 13C11 8 16 4.5 24 3.5',
] as const;

/** The whole outline as one shape, for the body's faint fill. */
const BODY_PATH = `${ZONE_PATHS[0]}${ZONE_PATHS.slice(1)
  .map((path) => path.replace(/^M[\d.]+ [\d.]+/, ''))
  .join('')}Z`;

/** Top-left corner of each wheel: LF, RF, LR, RR. */
const WHEEL_ORIGINS = [
  [11, 12],
  [41, 12],
  [11, 53],
  [41, 53],
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

/**
 * The cockpit, narrower at the windscreen: where the figure sits, and what
 * makes the outline a car.
 */
const CABIN_PATH = 'M19 29Q31 25 43 29L44.5 49Q31 52 17.5 49Z';

/** Side of the overheating icon, which sits under the figure. */
const WARNING_SIZE = 10;

/** Without a car the outline is drawn, and nothing is said about it. */
const NO_CAR_CLASS = 'stroke-slate-600 stroke-1';

/** A damaged piece of outline: thicker, its ends rounded. */
const HIT = 'stroke-[3] [stroke-linecap:round]';

/**
 * The levels the sim gives a zone: whole, dented, badly damaged, gone. An
 * intact piece is the thin neutral outline; a piece that has come off is
 * dashed, the outline broken.
 */
const ZONE_CLASS: Record<string, string> = {
  '0': 'stroke-slate-500 stroke-1',
  '1': `stroke-amber-400 ${HIT}`,
  '2': `stroke-red-500 ${HIT}`,
  // Square ends, or the round caps would close the gaps.
  '3': 'stroke-red-500 stroke-[3] [stroke-dasharray:3_3]',
};

/**
 * A wheel that has come off: a dark place with a dashed red outline, as a
 * body piece that has come off is dashed. Apart from a flat tyre, which is a
 * solid red rim; dark, so an impact wedge under it does not show through.
 */
const DETACHED_CLASS =
  'fill-slate-950 stroke-red-500 stroke-[1.5] [stroke-dasharray:2_1.5]';

/** A healthy wheel is neutral: colour is for damage. */
const WHEEL_CLASS: Record<WheelState, string> = {
  unknown: 'fill-slate-800',
  healthy: 'fill-slate-600',
  light: 'fill-amber-400',
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
        <path d={BODY_PATH} className="fill-slate-800/40" />
        <path
          d={CABIN_PATH}
          className="fill-none stroke-slate-600 stroke-1 [stroke-linejoin:round]"
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
              className={`fill-none ${tone}${level === '3' ? pulse : ''}`}
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
            className={`text-2xs font-bold tabular-nums ${READING_CLASS[readingTone]}`}
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
