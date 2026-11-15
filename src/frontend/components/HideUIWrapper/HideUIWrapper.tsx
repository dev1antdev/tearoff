import { useEffect, useState, type ReactNode } from 'react';
import { OverlayHiddenContext } from '@irdashies/context';

declare global {
  interface Window {
    globalKey?: {
      onToggle: (cb: (hide: boolean) => void) => () => void;
      onWidgetToggle: (
        cb: (widgetId: string, hide: boolean) => void
      ) => () => void;
    };
  }
}

interface HideUIWrapperProps {
  children: ReactNode;
}

/**
 * Takes the overlay off the screen while it is switched off or the sim is
 * paused, and puts it back as it was.
 *
 * Hidden, not unmounted. Unmounting drops every channel subscription, and a
 * processor nobody subscribes to is destroyed: a pause of a few seconds left
 * the lap delta blank until the next lap, emptied the sector bests and threw
 * away the laps the fuel figures were built on. With the widgets still
 * mounted the processors keep their state, and keep it current, so the
 * overlay comes back showing what it would have shown.
 *
 * `invisible` rather than `hidden`, as the profile switch does and for its
 * reason: the subtree is not painted and keeps its layout, so nothing is
 * measured again on the way back.
 *
 * Not everything a widget does is painting, and a child can set its own
 * visibility over this one. What has to stop while the overlay is hidden
 * reads the context this provides: the brake cue's tones and its bars.
 *
 * Nor does hiding the subtree stop a widget that draws for itself. A canvas
 * or a frame loop goes on drawing into pixels that are not shown, so those
 * read `usePaintingPaused`, which is this context and the window's own
 * visibility: the radar, the maps, the Lap Trace plot, the blind spot bars.
 */
export const HideUIWrapper = ({ children }: HideUIWrapperProps) => {
  const [hideUI, setHideUI] = useState(false);

  useEffect(() => {
    if (!window.globalKey?.onToggle) return;

    const unsub = window.globalKey.onToggle((hide) => setHideUI(hide));
    return () => unsub();
  }, []);

  return (
    <OverlayHiddenContext.Provider value={hideUI}>
      <div className={hideUI ? 'invisible' : ''}>{children}</div>
    </OverlayHiddenContext.Provider>
  );
};
