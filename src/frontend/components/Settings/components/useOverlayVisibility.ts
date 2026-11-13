import { useCallback, useEffect, useState } from 'react';
import type {
  OverlayVisibilityBridge,
  OverlayVisibilityState,
} from '@irdashies/types';
import logger from '@irdashies/utils/logger';

export interface OverlayVisibilityControls {
  /** Null until the main process has answered, and where there is no bridge. */
  state: OverlayVisibilityState | null;
  /** False outside the desktop app, where there is no overlay to switch. */
  available: boolean;
  setUserHidden: (hidden: boolean) => void;
  setHideWhenPaused: (enabled: boolean) => void;
}

/**
 * Whether the overlay is drawn, as the main process has it, and the two
 * things the settings window can change about it.
 *
 * The state is the main process's, not this window's: the shortcut and the
 * tray change it too, so it is followed rather than kept.
 *
 * @param bridge For stories and specs; the app uses the preload bridge.
 */
export const useOverlayVisibility = (
  bridge: OverlayVisibilityBridge | undefined = window.overlayVisibilityBridge
): OverlayVisibilityControls => {
  const [state, setState] = useState<OverlayVisibilityState | null>(null);

  useEffect(() => {
    if (!bridge) return;
    return bridge.onChanged(setState);
  }, [bridge]);

  const setUserHidden = useCallback(
    (hidden: boolean) => {
      bridge
        ?.setUserHidden(hidden)
        .then(setState)
        .catch((error: unknown) =>
          logger.warn('Could not switch the overlay', error)
        );
    },
    [bridge]
  );

  const setHideWhenPaused = useCallback(
    (enabled: boolean) => {
      bridge
        ?.setHideWhenPaused(enabled)
        .then(setState)
        .catch((error: unknown) =>
          logger.warn('Could not change the pause setting', error)
        );
    },
    [bridge]
  );

  return {
    state,
    available: bridge !== undefined,
    setUserHidden,
    setHideWhenPaused,
  };
};
