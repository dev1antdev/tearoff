import { useEffect, useRef, type ReactNode } from 'react';

interface PointAtProps {
  /** The element pointed at, as a CSS selector. */
  selector: string;
  /** Where in it, as shares of its width and height from its top left. */
  x: number;
  y: number;
  children: ReactNode;
}

// About two seconds of frames: a widget that has not drawn the element by
// then is not going to.
const MAX_FRAMES = 120;
/** Frames the element's box has to hold still for before it is pointed at. */
const SETTLED_FRAMES = 6;

/**
 * Holds a mouse pointer over a place in a story once it is drawn, for what
 * a widget shows only while it is pointed at: the readout of a chart. The
 * story then opens with it up, and a screenshot of it shows it.
 *
 * The element is looked for until it is there and has stopped changing
 * size, because a lazily loaded widget draws nothing at first and a chart
 * is laid out again once its box has been measured.
 */
export const PointAt = ({ selector, x, y, children }: PointAtProps) => {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;
    let frames = 0;
    let still = 0;
    let size = '';
    const seek = () => {
      const target = container.current?.querySelector(selector);
      const rect = target?.getBoundingClientRect();
      const now = rect ? `${rect.width}x${rect.height}` : '';
      still = now !== '' && now === size ? still + 1 : 0;
      size = now;
      if (target && rect && rect.width > 0 && still >= SETTLED_FRAMES) {
        target.dispatchEvent(
          new PointerEvent('pointermove', {
            bubbles: true,
            pointerType: 'mouse',
            clientX: rect.left + rect.width * x,
            clientY: rect.top + rect.height * y,
          })
        );
        return;
      }
      frames += 1;
      if (frames < MAX_FRAMES) frame = requestAnimationFrame(seek);
    };
    seek();
    return () => cancelAnimationFrame(frame);
  }, [selector, x, y]);

  return (
    <div ref={container} className="h-full">
      {children}
    </div>
  );
};
