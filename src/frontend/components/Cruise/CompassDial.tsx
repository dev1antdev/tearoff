import { memo, useRef } from 'react';
import { CompassRoseIcon } from '@phosphor-icons/react';
import { NO_READING, formatDrift } from './cruiseFormat';

/** Beyond this many degrees between nose and path the car is sliding. */
const SLIDE_DEG = 10;

/**
 * An angle that keeps turning the way it was turned: from 350 to 10 degrees
 * it goes on to 370 and not back through 180, so an eased rotation takes the
 * short way round.
 */
const useContinuousAngle = (degrees: number): number => {
  const previous = useRef(degrees);
  const turned = useRef(degrees);
  const step = ((((degrees - previous.current) % 360) + 540) % 360) - 180;
  previous.current = degrees;
  turned.current += step;
  return turned.current;
};

export interface CompassDialProps {
  /** Whole degrees clockwise from north; null without an orientation. */
  headingDeg: number | null;
  /** Heading minus direction of travel, degrees; null without a velocity. */
  driftDeg: number | null;
}

/**
 * A compass rose that turns under the car: the white line is the car's own
 * axis and always points up, north is marked on the rose, and the amber
 * needle is the way the car is going. With the nose to the right of the
 * path the needle leans left, and it turns red when the two are more than
 * ten degrees apart. The angle between them is printed underneath.
 */
export const CompassDial = memo(
  ({ headingDeg, driftDeg }: CompassDialProps) => {
    const rose = useContinuousAngle(-(headingDeg ?? 0));
    const needle = useContinuousAngle(-(driftDeg ?? 0));
    const sliding = driftDeg !== null && Math.abs(driftDeg) > SLIDE_DEG;

    return (
      <div
        className="relative aspect-square h-full flex-none rounded-sm bg-slate-800/70"
        data-testid="compass-dial"
      >
        {/* The rose, with room left under it for the angle. */}
        <div className="absolute left-[10%] top-[2%] h-[80%] w-[80%]">
          <div
            className="absolute inset-0 transform-gpu transition-[rotate] duration-300 ease-out"
            style={{ rotate: `${rose}deg` }}
            data-testid="compass-rose"
          >
            <CompassRoseIcon
              weight="light"
              className="absolute inset-[14%] h-[72%] w-[72%] text-white/40"
            />
            {/* Inside the square at any turn: a little in from the edge. */}
            <span className="absolute left-1/2 top-0 -translate-x-1/2 text-[0.6rem] font-bold leading-none text-white">
              N
            </span>
          </div>
          {/* The car's own axis: nose up. */}
          <div className="absolute bottom-[24%] left-1/2 top-[24%] w-px -translate-x-1/2 bg-white/80" />
          {driftDeg !== null && (
            <div
              className="absolute inset-0 transform-gpu transition-[rotate] duration-300 ease-out"
              style={{ rotate: `${needle}deg` }}
              data-testid="compass-needle"
            >
              <div
                className={`absolute bottom-1/2 left-1/2 top-[20%] w-0.5 -translate-x-1/2 rounded-full ${
                  sliding ? 'bg-red-400' : 'bg-amber-300'
                }`}
              />
            </div>
          )}
          <div className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
        </div>
        <div
          className={`absolute inset-x-0 bottom-[3%] text-center text-xs leading-none tabular-nums ${
            sliding ? 'text-red-400' : 'text-white/60'
          }`}
        >
          {driftDeg === null ? NO_READING : formatDrift(driftDeg)}
        </div>
      </div>
    );
  }
);
CompassDial.displayName = 'CompassDial';
