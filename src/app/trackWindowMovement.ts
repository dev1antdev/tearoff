import { BrowserWindow } from 'electron';
import { saveSettingsWindowBounds as persistBounds } from './storage/settingsWindowBounds';

const DEBOUNCE_MS = 200;
const pendingSaves = new Set<() => void>();

/**
 * Drain movement timers before the asynchronous storage shutdown flush, for
 * every window whose place is remembered.
 */
export const flushWindowMovementOnShutdown = (): void => {
  for (const save of pendingSaves) save();
};

/**
 * Bounds the app itself moved a window to, as opposed to the user dragging it.
 *
 * A window rescued from off-screen is repositioned with `setBounds`. If that
 * were persisted it would overwrite the position the user actually chose, and
 * reconnecting the monitor would no longer bring the window back — turning a
 * temporary rescue into a permanent move.
 *
 * A programmatic `setBounds` does not currently raise `moved` or `resized`, so
 * nothing is persisted anyway. That is Electron's present behaviour rather than
 * a guarantee, and nothing else pins it. Recording the corrected rectangle and
 * declining to save it makes the outcome deliberate instead of incidental.
 *
 * A WeakMap so a destroyed window takes its entry with it.
 */
const correctedBounds = new WeakMap<BrowserWindow, Electron.Rectangle>();

const sameRect = (a: Electron.Rectangle, b: Electron.Rectangle): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * Record that this window was moved by the app rather than by the user, so the
 * resulting position is not written back to disk. Call it alongside the
 * `setBounds` that performs the correction.
 */
export const markCorrectedBounds = (
  browserWindow: BrowserWindow,
  bounds: Electron.Rectangle
): void => {
  correctedBounds.set(browserWindow, { ...bounds });
};

/**
 * Whether these bounds are where the app itself last put the window, and so
 * not a place the user chose.
 */
export const wasMovedByApp = (
  browserWindow: BrowserWindow,
  bounds: Electron.Rectangle
): boolean => {
  const corrected = correctedBounds.get(browserWindow);
  return !!corrected && sameRect(bounds, corrected);
};

/** The window events that end a move or a resize made by the user. */
type PlacementEvent = 'moved' | 'resized' | 'maximize' | 'unmaximize';

/**
 * Calls `persist` shortly after the user has moved or resized a window, once
 * for a burst of events, and before the window closes if one is pending.
 */
export const trackWindowMovement = (
  browserWindow: BrowserWindow,
  persist: (browserWindow: BrowserWindow) => void,
  events: readonly PlacementEvent[] = ['moved', 'resized']
) => {
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    if (!debounceTimer) return;
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
    pendingSaves.delete(flush);
    if (!browserWindow.isDestroyed()) persist(browserWindow);
  };
  const debouncedSave = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    pendingSaves.add(flush);
    debounceTimer = setTimeout(flush, DEBOUNCE_MS);
  };

  // One listener per event: `on` is typed per event name.
  for (const event of events) {
    browserWindow.on(event as 'moved', debouncedSave);
  }
  // Drain the movement debounce while the native rectangle is still readable.
  // The storage writer is flushed by the before-quit coordinator.
  browserWindow.on('close', flush);
  browserWindow.on('closed', () => {
    clearTimeout(debounceTimer);
    pendingSaves.delete(flush);
  });
};

/**
 * Track settings window position and size changes
 */
export const trackSettingsWindowMovement = (browserWindow: BrowserWindow) =>
  trackWindowMovement(browserWindow, saveSettingsWindowBounds);

function saveSettingsWindowBounds(browserWindow: BrowserWindow): void {
  const bounds = browserWindow.getBounds();

  // Compared by value rather than suppressed with a flag and a timer: there is
  // no assumption about when, or whether, the event arrives after setBounds.
  // A user who drags the window to exactly the corrected position is not saved
  // either, which costs nothing — that position is on-screen and the next
  // launch would place the window there regardless.
  if (wasMovedByApp(browserWindow, bounds)) return;

  persistBounds(bounds);
}
