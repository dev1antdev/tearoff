import { useEffect, useRef, type ReactNode } from 'react';

interface ScrollToTextProps {
  /** The exact text of the element to bring into view. */
  text: string;
  /** Where in the scrolling area it should come to rest. */
  block?: ScrollLogicalPosition;
  children: ReactNode;
}

// About two seconds of frames: a page that has not drawn the row by then is
// not going to.
const MAX_FRAMES = 120;

/**
 * Scrolls a story to the row it is about, for a settings page whose row sits
 * far down a long list: without it the story opens on the top of the page
 * and a screenshot of it shows nothing of its subject.
 *
 * The row is looked for until it is there, because a settings page draws
 * its rows only once the dashboard has arrived. It scrolls once and then
 * leaves the page alone.
 */
export const ScrollToText = ({
  text,
  block = 'start',
  children,
}: ScrollToTextProps) => {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;
    let frames = 0;
    const seek = () => {
      const target = Array.from(
        container.current?.querySelectorAll('span, h3, h4') ?? []
      ).find((element) => element.textContent === text);
      if (target) {
        target.scrollIntoView({ block });
        return;
      }
      frames += 1;
      if (frames < MAX_FRAMES) frame = requestAnimationFrame(seek);
    };
    seek();
    return () => cancelAnimationFrame(frame);
  }, [text, block]);

  return (
    <div ref={container} className="h-full">
      {children}
    </div>
  );
};
