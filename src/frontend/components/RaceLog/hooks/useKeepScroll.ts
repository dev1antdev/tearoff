import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/** How far from the top still counts as being at it, in pixels. */
const AT_TOP_PX = 4;

export interface KeptScroll {
  /** For the element that scrolls. */
  ref: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  /** Lines added above the ones on screen since the reader left the top. */
  unseen: number;
  /** Goes back to the newest line. */
  toTop: () => void;
}

/**
 * Keeps a list that grows at its top where its reader left it.
 *
 * New lines arrive first. At the top of the list they simply appear; a
 * reader who has scrolled down is reading something, and the lines are
 * added above it without moving it, with a count of how many are waiting.
 *
 * The browser's own scroll anchoring is switched off on the element (it
 * would do the same thing a second time): the element carries
 * `[overflow-anchor:none]`.
 *
 * @param seqs The numbers of the lines drawn, newest first.
 * @param resetKey Changes when the list is another list, as when a switch
 *   over it is set: it then starts from its top.
 */
export const useKeepScroll = (
  seqs: readonly number[],
  resetKey: string
): KeptScroll => {
  const ref = useRef<HTMLDivElement>(null);
  const before = useRef<{
    height: number;
    newest: number | undefined;
    key: string;
  }>({ height: 0, newest: undefined, key: resetKey });
  const [unseen, setUnseen] = useState(0);
  const newest = seqs[0];

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const was = before.current;
    if (was.key !== resetKey) {
      element.scrollTop = 0;
      setUnseen(0);
    } else if (
      newest !== undefined &&
      was.newest !== undefined &&
      newest > was.newest &&
      element.scrollTop > AT_TOP_PX
    ) {
      // As much further down as the list grew at its top.
      element.scrollTop += element.scrollHeight - was.height;
      const added = seqs.indexOf(was.newest);
      setUnseen((count) => count + (added > 0 ? added : 1));
    }
    before.current = {
      height: element.scrollHeight,
      newest,
      key: resetKey,
    };
    // Whenever the lines drawn change: that is when the list's height does.
  }, [resetKey, newest, seqs]);

  const onScroll = useCallback(() => {
    const element = ref.current;
    if (element && element.scrollTop <= AT_TOP_PX) setUnseen(0);
  }, []);

  const toTop = useCallback(() => {
    if (ref.current) ref.current.scrollTop = 0;
    setUnseen(0);
  }, []);

  return { ref, onScroll, unseen, toTop };
};
