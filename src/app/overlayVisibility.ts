import type { OverlayVisibilityState } from '../types/overlayVisibility';

/**
 * The one place that decides whether the overlay is drawn.
 *
 * The shortcut, the tray, the settings window and the pause watch all report
 * here, and everything that draws listens here, so they cannot disagree: the
 * shortcut used to keep its own flag, which a window opened afterwards never
 * heard about.
 */
export interface OverlayVisibility {
  getState(): OverlayVisibilityState;
  setUserHidden(hidden: boolean): void;
  toggleUserHidden(): void;
  setGamePaused(paused: boolean): void;
  setHideWhenPaused(enabled: boolean): void;
  /** Called with the new state whenever any part of it changes. */
  onChange(listener: (state: OverlayVisibilityState) => void): () => void;
}

export interface OverlayVisibilityOptions {
  /** The stored setting. */
  hideWhenPaused: boolean;
  /** Told of a listener that threw, so one cannot silence the rest. */
  logError?: (message: string, error: unknown) => void;
}

export const createOverlayVisibility = (
  options: OverlayVisibilityOptions
): OverlayVisibility => {
  let userHidden = false;
  let gamePaused = false;
  let hideWhenPaused = options.hideWhenPaused;
  const listeners = new Set<(state: OverlayVisibilityState) => void>();

  const getState = (): OverlayVisibilityState => ({
    userHidden,
    gamePaused,
    hideWhenPaused,
    hidden: userHidden || (hideWhenPaused && gamePaused),
  });

  const emit = () => {
    const state = getState();
    for (const listener of listeners) {
      try {
        listener(state);
      } catch (error) {
        options.logError?.(
          '[OverlayVisibility] A change listener failed:',
          error
        );
      }
    }
  };

  return {
    getState,
    setUserHidden(hidden) {
      if (hidden === userHidden) return;
      userHidden = hidden;
      emit();
    },
    toggleUserHidden() {
      userHidden = !userHidden;
      emit();
    },
    setGamePaused(paused) {
      if (paused === gamePaused) return;
      gamePaused = paused;
      emit();
    },
    setHideWhenPaused(enabled) {
      if (enabled === hideWhenPaused) return;
      hideWhenPaused = enabled;
      emit();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
