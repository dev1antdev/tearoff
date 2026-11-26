import { useEffect, useRef, useState } from 'react';

/**
 * Where the wind comes from, in radians, turned the short way.
 *
 * Weather data arrives as a bearing, so it walks from 3.1 to -3.1 now and
 * then. Turning the difference through π would spin the arrow the long way
 * round; taking the shortest way keeps the arrow on the side the wind is.
 */
export const useWindAngle = (direction: number | undefined): number => {
  const [angle, setAngle] = useState(0);
  const previousRef = useRef(0);

  useEffect(() => {
    if (direction === undefined) return;

    const previous = previousRef.current;
    let difference = direction - previous;

    while (difference > Math.PI) difference -= 2 * Math.PI;
    while (difference < -Math.PI) difference += 2 * Math.PI;

    setAngle((value) => value + difference);
    previousRef.current = direction;
  }, [direction]);

  return angle;
};
