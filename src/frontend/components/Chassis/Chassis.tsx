import { memo, type ReactNode } from 'react';
import {
  useDrivingState,
  useSessionVisibility,
  useWheelDynamicsSnapshot,
} from '@irdashies/context';
import { useChassisSettings } from './hooks/useChassisSettings';
import {
  NO_READING,
  axleToeFigure,
  camberFigure,
  formatMillimetres,
  rakeFigure,
  rideHeightCorners,
  rollFigure,
  rollShareFigure,
  rowState,
  wheelToeFigure,
} from './chassisDisplay';

interface RowProps {
  /** Names the row for the specs: "ride", "rake". */
  id: string;
  caption: string;
  /** Written once beside the caption, in its own case: "mm". */
  unit?: string;
  /** A row of two lines, front above rear, takes twice the height. */
  twoLines?: boolean;
  children: ReactNode;
}

/** One row: a small caption at the left, its figures at the right. */
const Row = ({ id, caption, unit, twoLines = false, children }: RowProps) => (
  <div
    data-testid={`chassis-${id}`}
    className={`flex min-h-0 items-center gap-2 ${twoLines ? 'flex-2' : 'flex-1'}`}
  >
    <div className="w-[4.9em] flex-none whitespace-nowrap text-[0.7em] font-semibold uppercase leading-none text-slate-300">
      {caption}
      {unit && (
        <span className="ml-[0.35em] font-medium normal-case text-slate-400">
          {unit}
        </span>
      )}
    </div>
    <div className="flex min-w-0 flex-1 flex-col justify-center gap-[0.35em]">
      {children}
    </div>
  </div>
);

interface BarProps {
  /** 0..1. */
  fill: number;
  warn: boolean;
  /** The side of the car the bar is on: it grows away from the centre. */
  side: 'left' | 'right';
}

/**
 * A thin bar growing outwards from the car's centreline. A warning turns the
 * whole track red, not just the fill: a corner that is bottoming has next to
 * no fill left to colour.
 */
const Bar = memo(({ fill, warn, side }: BarProps) => (
  <div
    className={`flex h-[0.4em] overflow-hidden rounded-sm ${warn ? 'bg-red-500' : 'bg-slate-900/70'} ${side === 'left' ? 'justify-end' : 'justify-start'}`}
  >
    <div
      className={`h-full ${warn ? 'bg-red-500' : 'bg-green-500'}`}
      style={{ width: `${Math.round(fill * 100)}%` }}
    />
  </div>
));
Bar.displayName = 'Bar';

interface RideHeightLineProps {
  leftText: string;
  leftFill: number;
  leftBottoming: boolean;
  rightText: string;
  rightFill: number;
  rightBottoming: boolean;
}

/**
 * One axle's ride heights: the left figure, a bar each side of the centre,
 * the right figure.
 *
 * Takes strings and numbers rather than the corners themselves so that a
 * snapshot whose rounded values did not move re-renders nothing.
 */
const RideHeightLine = memo(
  ({
    leftText,
    leftFill,
    leftBottoming,
    rightText,
    rightFill,
    rightBottoming,
  }: RideHeightLineProps) => (
    <div className="grid grid-cols-[2.2em_1fr_1fr_2.2em] items-center gap-x-[0.3em] font-bold leading-none tabular-nums">
      <span className={`text-right ${leftBottoming ? 'text-red-400' : ''}`}>
        {leftText}
      </span>
      <Bar fill={leftFill} warn={leftBottoming} side="left" />
      <Bar fill={rightFill} warn={rightBottoming} side="right" />
      <span className={rightBottoming ? 'text-red-400' : ''}>{rightText}</span>
    </div>
  )
);
RideHeightLine.displayName = 'RideHeightLine';

interface PairProps {
  left: string;
  right: string;
  leftClassName?: string;
  rightClassName?: string;
  /** A small letter in front of each figure: "F", "R". */
  leftLabel?: string;
  rightLabel?: string;
  /** A third, quieter figure after the two. */
  trailing?: string;
}

const AXLE_LABEL = 'mr-[0.35em] text-[0.75em] font-semibold text-slate-400';

/** Two figures side by side: the wheels of an axle, or the two axles. */
const Pair = memo(
  ({
    left,
    right,
    leftClassName = '',
    rightClassName = '',
    leftLabel,
    rightLabel,
    trailing,
  }: PairProps) => (
    <div
      className={`grid items-baseline gap-x-[0.5em] whitespace-nowrap leading-none tabular-nums ${trailing ? 'grid-cols-[1fr_1fr_auto]' : 'grid-cols-2'}`}
    >
      <span className={`text-center ${leftClassName}`}>
        {leftLabel && <span className={AXLE_LABEL}>{leftLabel}</span>}
        {left}
      </span>
      <span className={`text-center ${rightClassName}`}>
        {rightLabel && <span className={AXLE_LABEL}>{rightLabel}</span>}
        {right}
      </span>
      {trailing && <span className="text-slate-300">{trailing}</span>}
    </div>
  )
);
Pair.displayName = 'Pair';

/**
 * Ride height, rake, roll, camber, toe and suspension travel of the player's
 * car, a row each.
 *
 * Le Mans Ultimate only. Out of the car the sim publishes no wheel data and
 * every row keeps its place with placeholders, so the widget can still be
 * placed in edit mode; in the car, a row the sim gives nothing for is left
 * out.
 */
export const Chassis = () => {
  const settings = useChassisSettings();
  const { isDriving } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);
  // The figures are of the user's own car, so the widget hides while they
  // only watch one.
  const visible =
    isSessionVisible && (!settings.showOnlyWhenOnTrack || isDriving);
  // Not subscribed while hidden, so the processor behind it rests too.
  const snapshot = useWheelDynamicsSnapshot(visible);

  if (!visible) return <></>;

  const available = snapshot?.available === true;
  const live = available ? snapshot : undefined;

  const rideHeightRow = settings.showRideHeight
    ? rowState(available, live?.rideHeightMm)
    : 'hidden';
  const rakeRow = settings.showRake
    ? rowState(available, live?.rakeMm)
    : 'hidden';
  const rollRow = settings.showRoll
    ? rowState(available, live?.rollMm)
    : 'hidden';
  const camberRow = settings.showCamber
    ? rowState(available, live?.camberDeg)
    : 'hidden';
  const toeSource =
    settings.toeDisplay === 'wheel' ? live?.toeDeg : live?.toeTotalDeg;
  const toeRow = settings.showToe ? rowState(available, toeSource) : 'hidden';
  const suspensionRow = settings.showSuspension
    ? rowState(available, live?.suspensionPositionMm)
    : 'hidden';

  const corners = rideHeightCorners(live?.rideHeightMm, settings);
  const rake = rakeFigure(live?.rakeMm, settings.wheelbase);
  const cambers = [0, 1, 2, 3].map((wheel) =>
    camberFigure(live?.camberDeg?.[wheel])
  );
  const camberClassName = (wheel: number) =>
    cambers[wheel].positive ? 'text-amber-300' : '';

  return (
    <div
      className="flex h-full w-full flex-col gap-1.5 rounded bg-slate-800/(--bg-opacity) p-2 font-medium text-white"
      style={{
        ['--bg-opacity' as string]: `${settings.background.opacity}%`,
      }}
    >
      {rideHeightRow !== 'hidden' && (
        <Row id="ride" caption="Ride" unit="mm" twoLines>
          {[0, 2].map((left) => (
            <RideHeightLine
              key={left}
              leftText={corners[left].text}
              leftFill={corners[left].fill}
              leftBottoming={corners[left].bottoming}
              rightText={corners[left + 1].text}
              rightFill={corners[left + 1].fill}
              rightBottoming={corners[left + 1].bottoming}
            />
          ))}
        </Row>
      )}

      {rakeRow !== 'hidden' && (
        <Row id="rake" caption="Rake">
          <Pair
            left={rake.angle}
            right={rake.millimetres || NO_READING}
            leftClassName={`font-bold ${rake.low ? 'text-sky-400' : ''}`}
            rightClassName="text-slate-300"
          />
        </Row>
      )}

      {rollRow !== 'hidden' && (
        <Row id="roll" caption="Roll">
          <Pair
            left={rollFigure(live?.rollMm?.[0], settings.trackFront)}
            right={rollFigure(live?.rollMm?.[1], settings.trackRear)}
            leftLabel="F"
            rightLabel="R"
            trailing={
              settings.showRollShare
                ? rollShareFigure(
                    live?.rollShareFront,
                    settings.trackFront,
                    settings.trackRear
                  )
                : undefined
            }
          />
        </Row>
      )}

      {camberRow !== 'hidden' && (
        <Row id="camber" caption="Camber" twoLines>
          {[0, 2].map((left) => (
            <Pair
              key={left}
              left={cambers[left].text}
              right={cambers[left + 1].text}
              leftClassName={camberClassName(left)}
              rightClassName={camberClassName(left + 1)}
            />
          ))}
        </Row>
      )}

      {toeRow !== 'hidden' &&
        (settings.toeDisplay === 'wheel' ? (
          <Row id="toe" caption="Toe" twoLines>
            {[0, 2].map((left) => (
              <Pair
                key={left}
                left={wheelToeFigure(live?.toeDeg?.[left])}
                right={wheelToeFigure(live?.toeDeg?.[left + 1])}
              />
            ))}
          </Row>
        ) : (
          <Row id="toe" caption="Toe">
            <Pair
              left={axleToeFigure(live?.toeTotalDeg?.[0])}
              right={axleToeFigure(live?.toeTotalDeg?.[1])}
              leftLabel="F"
              rightLabel="R"
            />
          </Row>
        ))}

      {suspensionRow !== 'hidden' && (
        <Row id="suspension" caption="Susp" unit="mm" twoLines>
          {[0, 2].map((left) => (
            <Pair
              key={left}
              left={formatMillimetres(live?.suspensionPositionMm?.[left])}
              right={formatMillimetres(live?.suspensionPositionMm?.[left + 1])}
            />
          ))}
        </Row>
      )}
    </div>
  );
};
