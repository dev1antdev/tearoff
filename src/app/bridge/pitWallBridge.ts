import { ipcMain } from 'electron';

export const PIT_WALL_SHOW_WINDOW = 'pitWall:showWindow';

/**
 * The Pit Wall's one request from a renderer: open its window, or bring it
 * to the front.
 *
 * The channel takes no arguments, so there is nothing of the renderer's to
 * act on; a call that brings any is refused rather than ignored, since it is
 * not a call this app makes.
 *
 * @param showWindow Opens the window for the current profile. False when the
 * widget is switched off or the running sim cannot show it.
 */
export function setupPitWallBridge(showWindow: () => boolean): () => void {
  ipcMain.handle(PIT_WALL_SHOW_WINDOW, (_event, ...args: unknown[]) => {
    if (args.length > 0) {
      throw new TypeError(`${PIT_WALL_SHOW_WINDOW} takes no arguments`);
    }
    return showWindow() === true;
  });
  return () => ipcMain.removeHandler(PIT_WALL_SHOW_WINDOW);
}
