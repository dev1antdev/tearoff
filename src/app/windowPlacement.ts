import { screen, type BrowserWindow } from 'electron';
import logger from './logger';
import { markCorrectedBounds } from './trackWindowMovement';
import { sanitizeWindowBounds, type Rect } from './windowBounds';

const workAreas = (): Rect[] =>
  screen.getAllDisplays().map((display) => display.workArea);

/**
 * Saved bounds, checked against the displays connected right now.
 *
 * Saved bounds outlive the display arrangement that produced them, so a
 * window saved on a monitor that has since been unplugged or rearranged would
 * otherwise be restored somewhere unreachable. `name` is the window as the
 * log calls it, for example "settings window".
 */
export function restoreWindowBounds(
  saved: Rect | undefined,
  name: string
): Rect | undefined {
  if (!saved) return undefined;

  const bounds = sanitizeWindowBounds(
    saved,
    workAreas(),
    screen.getPrimaryDisplay().workArea
  );

  if (bounds && (bounds.x !== saved.x || bounds.y !== saved.y)) {
    logger.info(
      `[OverlayManager] Saved ${name} bounds were off-screen ` +
        `(x=${saved.x}, y=${saved.y}); moved to x=${bounds.x}, y=${bounds.y}`
    );
  }

  return bounds;
}

/**
 * Correct a window that has ended up where no display covers it.
 *
 * Validating the saved bounds on the way in only guards the restore path. This
 * checks where the window actually landed, so it also catches a window placed
 * off-screen by something other than a stale saved position — Electron's own
 * default placement, or a display set that was not fully enumerated when the
 * window was created. #539 was reported on a freshly installed Windows with no
 * saved bounds at all, which the restore-path check cannot explain, so the
 * guard is deliberately cause-agnostic: it asks only whether the window can be
 * reached, never why it could not be.
 */
export function ensureWindowOnScreen(
  browserWindow: BrowserWindow,
  name: string
): void {
  const actual = browserWindow.getBounds();
  const corrected = sanitizeWindowBounds(
    actual,
    workAreas(),
    screen.getPrimaryDisplay().workArea
  );

  if (!corrected) return;
  if (corrected.x === actual.x && corrected.y === actual.y) return;

  const label = name.charAt(0).toUpperCase() + name.slice(1);
  logger.warn(
    `[OverlayManager] ${label} opened off-screen at x=${actual.x}, ` +
      `y=${actual.y}; moved to x=${corrected.x}, y=${corrected.y}`
  );

  // Flagged before the move so the saved position survives it. Rescuing a
  // window must not overwrite where the user put it, or reconnecting the
  // monitor would no longer bring it back.
  markCorrectedBounds(browserWindow, corrected);
  browserWindow.setBounds(corrected);
}
