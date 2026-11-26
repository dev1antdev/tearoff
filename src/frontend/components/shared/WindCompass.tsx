import { memo } from 'react';
import { useWindAngle } from './useWindAngle';

export interface WindCompassProps {
  /** Where the wind comes from, in radians. Straight ahead before it is told. */
  direction?: number;
  /** The svg's own size and layout, from the widget it sits in. */
  className?: string;
  /** How heavy the ring and the arrow are drawn. */
  strokeWidth?: string;
}

/**
 * The ring with the arrow that shows where the wind comes from.
 *
 * The Weather and Wind widgets draw it at very different sizes, so the size
 * is the caller's. The turn happens inside the drawing — on a group, not on
 * the svg — because a rotated svg element reaches past the square it fills,
 * which the app smoke run reads as content larger than the widget's box.
 */
export const WindCompass = memo(
  ({
    direction,
    className = '',
    strokeWidth = 'stroke-[1.5]',
  }: WindCompassProps) => {
    const angle = useWindAngle(direction);

    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 60 60"
        aria-hidden="true"
        className={`stroke-current box-border fill-none ${className}`}
      >
        <g
          className="transition-transform duration-1000 ease-out"
          style={{
            transformBox: 'view-box',
            transformOrigin: '50% 50%',
            rotate: `calc(${angle} * 1rad + 0.5turn)`,
          }}
        >
          <path
            d="M48 8A28 28 90 0158 30c0 15.464-12.536 28-28 28S2 45.464 2 30A28 28 90 0112 8M22 9 30 1l8 8"
            className={strokeWidth}
          />
        </g>
      </svg>
    );
  }
);
WindCompass.displayName = 'WindCompass';
