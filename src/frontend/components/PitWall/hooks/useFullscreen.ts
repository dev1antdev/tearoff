import { useCallback, useEffect, useState } from 'react';
import logger from '@irdashies/utils/logger';

// Undefined, not null, in a browser that has no full screen for a page.
const isFullscreen = () => !!document.fullscreenElement;

/**
 * Full screen through the page's own Fullscreen API, so the same page works
 * in a browser: no window is told to do anything. F11 toggles it; Escape
 * leaves it, which the browser does by itself.
 */
export const useFullscreen = () => {
  const [fullscreen, setFullscreen] = useState(isFullscreen);

  const toggle = useCallback(() => {
    // Typed as always there. A phone's browser offers a page neither.
    const root: Partial<Pick<HTMLElement, 'requestFullscreen'>> =
      document.documentElement;
    const page: Partial<Pick<Document, 'exitFullscreen'>> = document;
    const request = isFullscreen()
      ? page.exitFullscreen?.call(document)
      : root.requestFullscreen?.call(document.documentElement);
    if (!request) {
      logger.warn('[PitWall] This browser has no full screen for a page');
      return;
    }
    // Refused where the page is not allowed to, such as an embedded preview.
    request.catch((error: unknown) =>
      logger.warn('[PitWall] Full screen was refused', error)
    );
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(isFullscreen());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'F11' || event.repeat) return;
      // Handled here, so the window's own F11 does not also act on it.
      event.preventDefault();
      toggle();
    };
    document.addEventListener('fullscreenchange', onChange);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [toggle]);

  return { fullscreen, toggle };
};
