import { useLayoutEffect, useState } from 'react';

/** What an element holds reaches past its box, across or down. */
const overflowsEitherWay = (element: HTMLElement): boolean =>
  // A pixel of slack: the browser rounds both figures.
  element.scrollWidth > element.clientWidth + 1 ||
  element.scrollHeight > element.clientHeight + 1;

export interface FitLevelOptions {
  /** How many ways there are to draw the content: levels 0 to this less 1. */
  levels: number;
  /**
   * What is drawn, in any words that tell one content from another. A
   * change starts again from the fullest level.
   */
  content: string;
  /** The room is the frame's width, or its width and its height. */
  room?: 'width' | 'size';
  /** Whether the target holds more than fits. Left out: either way. */
  overflows?: (target: HTMLElement) => boolean;
}

export interface FitLevel {
  /** The fullest level that fits, or the last one where none does. */
  level: number;
  /** The `ref` of the element that must hold its content. */
  target: (element: HTMLElement | null) => void;
  /**
   * The `ref` of the element whose size is the room there is, where that
   * is not the target itself. It must not change size with the level, or
   * the two would chase each other.
   */
  frame: (element: HTMLElement | null) => void;
  /**
   * How wide the frame is, in its own pixels whatever scale it is drawn
   * at; 0 until it is measured, and where nothing is laid out. For a
   * caller that draws differently above some width, which a media query
   * cannot tell it on a page that is drawn larger or smaller than life.
   */
  width: number;
}

const NOT_MEASURED = { width: 0, height: 0 };

/**
 * The fullest way of drawing something that fits where it is drawn.
 *
 * The caller has a few ways to draw its content, from the fullest (level 0)
 * to the barest, and draws the one this returns. Each is tried in turn, on
 * the page itself and before it is painted, until one does not overflow the
 * target or the last is reached; the search starts again when the room
 * changes, when the content does, and when the page's fonts arrive.
 *
 * Measured and not reckoned from the text, so that it holds for any name,
 * any font and any scale. Where nothing is laid out, as in a spec, nothing
 * overflows and the level is 0.
 */
export const useFitLevel = ({
  levels,
  content,
  room = 'width',
  overflows = overflowsEitherWay,
}: FitLevelOptions): FitLevel => {
  // Kept as state, so that an element drawn later than the first time
  // round is found when it comes.
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [ownFrame, setFrame] = useState<HTMLElement | null>(null);
  const frame = ownFrame ?? target;

  const [space, setSpace] = useState(NOT_MEASURED);
  useLayoutEffect(() => {
    // Nothing to watch where there is no layout, as in a spec.
    if (!frame || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const width = frame.clientWidth;
      // A height that is not the room is not kept: a change of it would
      // start the search again for nothing.
      const height = room === 'size' ? frame.clientHeight : 0;
      setSpace((now) =>
        now.width === width && now.height === height ? now : { width, height }
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [frame, room]);

  // Text is as wide as its font: a level found before the page's fonts
  // arrived is looked for again once they have.
  const [fonts, setFonts] = useState(0);
  useLayoutEffect(() => {
    // A spec's page has no such thing.
    const loading: FontFaceSet | undefined = document.fonts;
    if (!loading || loading.status === 'loaded') return;
    let wanted = true;
    void loading.ready.then(() => {
      if (wanted) setFonts(1);
    });
    return () => {
      wanted = false;
    };
  }, []);

  const key = `${levels}|${space.width}x${space.height}|${fonts}|${content}`;
  const [found, setFound] = useState({ key, level: 0 });
  // Other room or other content: from the fullest again.
  if (found.key !== key) setFound({ key, level: 0 });
  const level = found.key === key ? Math.min(found.level, levels - 1) : 0;

  // One level down while what was drawn does not fit. Asked again after
  // each step and each new start, which is every time the answer can differ.
  useLayoutEffect(() => {
    if (!target || level >= levels - 1) return;
    if (overflows(target)) setFound({ key, level: level + 1 });
  }, [target, level, levels, overflows, key]);

  return { level, target: setTarget, frame: setFrame, width: space.width };
};
