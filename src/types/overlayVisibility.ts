/**
 * Whether the overlay is drawn at all, and what decided it.
 *
 * Two things can take the overlay off the screen: the driver, with the switch
 * in the settings window, the tray menu or the Hide / Show UI shortcut; and
 * the sim, by being paused, when the setting says a pause should. Either is
 * enough. Widgets, layouts and profiles are untouched by it: this is the
 * screen being cleared, not anything being disabled.
 */
export interface OverlayVisibilityState {
  /** Turned off by the driver. Not kept between runs of the app. */
  userHidden: boolean;
  /** The sim says the game is paused. Only Le Mans Ultimate says so. */
  gamePaused: boolean;
  /** The setting: whether a paused game takes the overlay off the screen. */
  hideWhenPaused: boolean;
  /** The outcome of the three above: nothing is drawn. */
  hidden: boolean;
}

/** What the settings window can ask about the overlay's visibility. */
export interface OverlayVisibilityBridge {
  getState: () => Promise<OverlayVisibilityState>;
  /** Turns the overlay off or back on, as the shortcut and the tray do. */
  setUserHidden: (hidden: boolean) => Promise<OverlayVisibilityState>;
  /** Changes the setting, which is kept between runs. */
  setHideWhenPaused: (enabled: boolean) => Promise<OverlayVisibilityState>;
  /** Fires with the state on subscribing and on every change after. */
  onChanged: (callback: (state: OverlayVisibilityState) => void) => () => void;
}
