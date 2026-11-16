import { useEffect, useState } from 'react';

/**
 * Whether the result of the lap just finished is being held on screen.
 *
 * A lap that ends while the widget is watching starts the hold, and the
 * widget's own timer ends it: no clock is read from another channel.
 *
 * `completedAt` is when the last timed lap ended, on the session clock, or
 * null with none; undefined before the channel has said anything. The first
 * value seen starts nothing: it says a lap ended, not how long ago, and a
 * widget shown mid-lap would otherwise open on a result minutes old.
 */
export const useLapFinalHold = (
  completedAt: number | null | undefined,
  holdSeconds: number
): boolean => {
  /** The value last seen, once the channel has answered. */
  const [seen, setSeen] = useState<{ completedAt: number | null } | null>(null);
  /** The lap whose result is on hold. */
  const [held, setHeld] = useState<number | null>(null);

  // Set during render, guarded, as React asks for state that follows a
  // prop: the hold starts on the render that sees the lap end.
  if (
    completedAt !== undefined &&
    (seen === null || seen.completedAt !== completedAt)
  ) {
    setSeen({ completedAt });
    setHeld(
      seen !== null && completedAt !== null && holdSeconds > 0
        ? completedAt
        : null
    );
  }

  const holding = held !== null && holdSeconds > 0;
  useEffect(() => {
    if (!holding) return;
    const timer = setTimeout(() => setHeld(null), holdSeconds * 1000);
    return () => clearTimeout(timer);
  }, [holding, held, holdSeconds]);

  return holding && held === completedAt;
};
