import { memo } from 'react';
import { ThermometerHotIcon } from '@phosphor-icons/react';
import type {
  IntegrityTone,
  WheelState,
} from '@irdashies/domain/damage/damageDisplay';

/**
 * The car from above, nose up, in a 46 by 100 picture, about a real car's
 * proportions: Tearoff's own drawing of eight body panels with a gap between
 * each, a wheel inside each corner and the cockpit in the middle.
 *
 * The panels run clockwise from the nose, as the snapshot has its zones:
 * front, front right, right, rear right, rear, rear left, left, front left.
 * The wings bulge over the wheels and the doors pull in at the waist. Each
 * path is the middle line of its panel; the panel is drawn as a band along it.
 */
const ZONE_PATHS = [
  'M15.5 5Q23 2 30.5 5',
  'M36.5 6.6C40.5 8.2 43.2 12.5 43.5 18.5C43.7 23.5 43.2 27 42.2 29.8',
  'M41.2 35.5C39.8 43 39.8 55 41.2 62.5',
  'M42.2 68.2C43.4 71.5 43.8 78 43.7 85.5C43.6 91.5 41 95.5 36.5 96.6',
  'M30 97.2L16 97.2',
  'M9.5 96.6C5 95.5 2.4 91.5 2.3 85.5C2.2 78 2.6 71.5 3.8 68.2',
  'M4.8 62.5C6.2 55 6.2 43 4.8 35.5',
  'M3.8 29.8C2.8 27 2.3 23.5 2.5 18.5C2.8 12.5 5.5 8.2 9.5 6.6',
] as const;

/** The panels joined into one shape, for the body's faint fill. */
const BODY_PATH = `${ZONE_PATHS.map((path, index) =>
  index === 0 ? path : path.replace(/^M/, 'L')
).join('')}Z`;

/** Top-left corner of each wheel: LF, RF, LR, RR. */
const WHEEL_ORIGINS = [
  [7, 14],
  [33.5, 14],
  [7, 70],
  [33.5, 70],
] as const;
const WHEEL_WIDTH = 5.5;
const WHEEL_HEIGHT = 14;

const CENTRE_X = 23;
const CENTRE_Y = 50;

/**
 * A wedge 15 degrees wide from the middle of the car to past its nose; the
 * picture's edge trims it, and a rotation points it at the impact. It starts
 * 14 units out, clear of the figure in the middle.
 */
const IMPACT_WEDGE = 'M21.16 36L14.84 -12H31.16L24.84 36Z';

/**
 * The cockpit, narrower at the windscreen: where the figure sits, and what
 * makes the outline a car.
 */
const CABIN_PATH = 'M14.5 36.5Q23 32 31.5 36.5L33 62Q23 65.5 13 62Z';

/** Side of the overheating icon, which sits under the figure. */
const WARNING_SIZE = 8;

/** A panel is a band: an outline 4.4 wide, its inside 3 wide over it. */
const EDGE = 'stroke-[4.4] [stroke-linecap:round]';
const INSIDE = 'stroke-[3] [stroke-linecap:round]';

interface PanelStyle {
  /** The panel's edge; none for a panel that has come off. */
  edge: string | null;
  inside: string;
}

/**
 * The levels the sim gives a zone: whole, dented, badly damaged, gone. A whole
 * panel is dark with a thin grey edge; a damaged one is filled with its
 * level's colour; one that has come off is a dashed red line, square-ended so
 * the gaps stay open.
 */
const PANEL: Record<string, PanelStyle> = {
  '0': {
    edge: `stroke-slate-600 ${EDGE}`,
    inside: `stroke-slate-900 ${INSIDE}`,
  },
  '1': {
    edge: `stroke-amber-400 ${EDGE}`,
    inside: `stroke-amber-400 ${INSIDE}`,
  },
  '2': { edge: `stroke-red-500 ${EDGE}`, inside: `stroke-red-500 ${INSIDE}` },
  '3': {
    edge: null,
    inside: 'stroke-red-500 stroke-[3] [stroke-dasharray:2_2]',
  },
};

/** Without a car the panels are drawn dimmer, and nothing is said. */
const NO_CAR: PanelStyle = {
  edge: `stroke-slate-700 ${EDGE}`,
  inside: `stroke-slate-800 ${INSIDE}`,
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
    const readingY = stacked ? CENTRE_Y - 4.5 : CENTRE_Y;
    const warningY = stacked ? CENTRE_Y + 1 : CENTRE_Y - WARNING_SIZE / 2;

    return (
      <svg
        viewBox="0 0 46 100"
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
          const panel = available ? (PANEL[level] ?? PANEL['0']) : NO_CAR;
          return (
            <g key={path} className="fill-none">
              {panel.edge && <path d={path} className={panel.edge} />}
              <path
                d={path}
                data-testid={`damage-zone-${zone}`}
                data-level={level}
                className={`${panel.inside}${level === '3' ? pulse : ''}`}
              />
            </g>
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
              rx={2}
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
            // The overlay's smallest step, but never wider than the cockpit.
            className={`text-[length:min(var(--text-2xs),9px)] font-bold tabular-nums ${READING_CLASS[readingTone]}`}
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
