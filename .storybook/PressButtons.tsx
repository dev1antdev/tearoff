import { useEffect, useRef, type ReactNode } from 'react';

interface PressButtonsProps {
  /** The exact text of each button to press, in the order to press them. */
  labels: readonly string[];
  children: ReactNode;
}

// About two seconds of frames: a widget that has not drawn the button by
// then is not going to.
const MAX_FRAMES = 120;

/**
 * Presses buttons of a story once they are drawn, for a widget whose view
 * is chosen in the widget itself and kept nowhere a story could set it: a
 * tab, a switch in its header. The story then opens on that view, and a
 * screenshot of it shows it.
 *
 * Each button is looked for until it is there, because a lazily loaded
 * widget draws nothing at first. Each is pressed once.
 */
export const PressButtons = ({ labels, children }: PressButtonsProps) => {
  const container = useRef<HTMLDivElement>(null);
  const key = labels.join('\n');

  useEffect(() => {
    const remaining = key === '' ? [] : key.split('\n');
    let frame = 0;
    let frames = 0;
    const seek = () => {
      while (remaining.length > 0) {
        const target = Array.from(
          container.current?.querySelectorAll('button') ?? []
        ).find((button) => button.textContent === remaining[0]);
        if (!target) break;
        target.click();
        remaining.shift();
      }
      frames += 1;
      if (remaining.length > 0 && frames < MAX_FRAMES) {
        frame = requestAnimationFrame(seek);
      }
    };
    seek();
    return () => cancelAnimationFrame(frame);
  }, [key]);

  return (
    <div ref={container} className="h-full">
      {children}
    </div>
  );
};
