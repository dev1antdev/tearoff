import { memo, useLayoutEffect, useRef, useState } from 'react';
import { getWindIntensityClass } from '../../../domain/weather/wind';
import { speedFromMs } from '@irdashies/utils/units';
import { WindCompass } from '../../shared/WindCompass';

export interface WindDirectionProps {
  speedMs?: number;
  direction?: number;
  metric?: boolean;
}

export const WindDirection = memo(
  ({ speedMs, direction, metric = true }: WindDirectionProps) => {
    const speed =
      speedMs !== undefined
        ? speedFromMs(speedMs, metric ? 'km/h' : 'mph')
        : undefined;
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [size, setSize] = useState<number | null>(null);
    const windIntensityClass = getWindIntensityClass(speed);

    useLayoutEffect(() => {
      const node = containerRef.current;
      if (!node) return;

      const updateSize = () => {
        const { clientWidth, clientHeight } = node;
        if (!clientWidth || !clientHeight) return;

        setSize(Math.round(Math.min(clientWidth, clientHeight)));
      };

      updateSize();
      const observer = new ResizeObserver(updateSize);
      observer.observe(node);

      return () => observer.disconnect();
    }, []);

    const visualSize = size ? `${size}px` : '100%';
    const fontSize = size ? Math.max(10, Math.round(size * 0.27)) : 32;

    return (
      <div
        ref={containerRef}
        className="flex h-full w-full min-h-0 min-w-0 items-center justify-center"
      >
        <div
          data-testid="wind-direction"
          className={`relative flex aspect-square items-center justify-center transition-colors duration-300 ${windIntensityClass}`}
          style={{ width: visualSize, height: visualSize }}
        >
          {/* The arrow's point is drawn a little outside the view box (the
              stroke's mitre), which cut it flat: let it show. */}
          <WindCompass
            direction={direction}
            className="absolute overflow-visible w-full h-full"
          />

          <div
            className="absolute flex h-full w-full items-center justify-center leading-none"
            style={{ fontSize }}
          >
            {speed !== undefined ? Math.round(speed) : '-'}
          </div>
        </div>
      </div>
    );
  }
);
WindDirection.displayName = 'WindDirection';
