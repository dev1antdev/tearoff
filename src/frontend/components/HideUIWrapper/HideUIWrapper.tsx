import { useEffect, useState, type ReactNode } from 'react';

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
 */
export const HideUIWrapper = ({ children }: HideUIWrapperProps) => {
  const [hideUI, setHideUI] = useState(false);

  useEffect(() => {
    if (!window.globalKey?.onToggle) return;

    const unsub = window.globalKey.onToggle((hide) => setHideUI(hide));
    return () => unsub();
  }, []);

  return <div className={hideUI ? 'invisible' : ''}>{children}</div>;
};
