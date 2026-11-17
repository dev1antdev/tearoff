import { useEffect, useRef, type ReactNode } from 'react';

/**
 * One thing done to the Pit Wall page of a story, in the order given.
 *
 * - `press`: a button, by its accessible name or, failing that, its text.
 * - `hold`: a handle of a panel, by the name of its button (`Move Race
 *   Log`, `Size Our Car`): a pointer goes down on it, is taken so many
 *   cells across and down, and is not let go of.
 */
export type PitWallEditStep =
  { press: string } | { hold: string; across: number; down: number };

interface PitWallEditStepsProps {
  steps: readonly PitWallEditStep[];
  children: ReactNode;
}

// About four seconds of frames: a page that has not drawn what a step
// needs by then is not going to.
const MAX_FRAMES = 240;
/** Frames the page's box has to hold still for before a panel is dragged. */
const SETTLED_FRAMES = 6;
/** The page's gap between cells: PIT_WALL_GAP_PX. */
const GAP_PX = 12;

const buttonNamed = (root: Element, name: string) => {
  const buttons = Array.from(root.querySelectorAll('button'));
  return (
    buttons.find((button) => button.getAttribute('aria-label') === name) ??
    buttons.find((button) => button.textContent === name)
  );
};

/**
 * Arranges the Custom layout of a Pit Wall story by hand, once the page is
 * drawn, so that the story opens on a moment of an edit and a screenshot
 * shows it: the edit begun, the list of panels open, a panel held over a
 * place it fits or does not.
 *
 * Nothing is staged: the buttons are pressed and the pointer events sent
 * as a hand would send them, and the page does the rest. A panel held is
 * never let go of, since what is to be seen is the mark of where it would
 * land. Each step is waited for until what it needs is there.
 */
export const PitWallEditSteps = ({
  steps,
  children,
}: PitWallEditStepsProps) => {
  const container = useRef<HTMLDivElement>(null);
  const key = JSON.stringify(steps);

  useEffect(() => {
    const remaining = JSON.parse(key) as PitWallEditStep[];
    let frame = 0;
    let frames = 0;
    let still = 0;
    let size = '';

    /** True once the step is done; false while what it needs is not there. */
    const take = (root: Element, step: PitWallEditStep): boolean => {
      if ('press' in step) {
        const button = buttonNamed(root, step.press);
        button?.click();
        return button !== undefined;
      }
      const handle = buttonNamed(root, step.hold);
      const page = root.querySelector('main[data-editing]');
      const box = page?.getBoundingClientRect();
      const now = box ? `${box.width}x${box.height}` : '';
      still = now !== '' && now === size ? still + 1 : 0;
      size = now;
      if (!handle || !box || box.width <= 0 || still < SETTLED_FRAMES) {
        return false;
      }
      const grip = handle.getBoundingClientRect();
      const from = {
        clientX: grip.left + grip.width / 2,
        clientY: grip.top + grip.height / 2,
      };
      const pointer = {
        bubbles: true,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
      };
      handle.dispatchEvent(
        new PointerEvent('pointerdown', {
          ...pointer,
          ...from,
          button: 0,
          buttons: 1,
        })
      );
      // A cell and its gap, as the page reckons it (`cellPitch`): on a page
      // drawn larger than it is laid out the gap is larger with it.
      const gap =
        page instanceof HTMLElement && page.offsetWidth > 0
          ? (GAP_PX * box.width) / page.offsetWidth
          : GAP_PX;
      window.dispatchEvent(
        new PointerEvent('pointermove', {
          ...pointer,
          buttons: 1,
          clientX: from.clientX + (step.across * (box.width - gap)) / 24,
          clientY: from.clientY + (step.down * (box.height - gap)) / 16,
        })
      );
      return true;
    };

    const seek = () => {
      const root = container.current;
      while (root && remaining.length > 0 && take(root, remaining[0])) {
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
