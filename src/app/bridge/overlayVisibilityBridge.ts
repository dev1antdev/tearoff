import { BrowserWindow, ipcMain } from 'electron';
import type { OverlayVisibility } from '../overlayVisibility';
import { defineRendererSubscriptionBridge } from './defineBridge';

const CHANNELS = [
  'overlayVisibility:getState',
  'overlayVisibility:setUserHidden',
  'overlayVisibility:setHideWhenPaused',
] as const;

const booleanOrThrow = (value: unknown, channel: string): boolean => {
  if (typeof value !== 'boolean') {
    throw new TypeError(`Invalid value for ${channel}`);
  }
  return value;
};

/**
 * The overlay's visibility over IPC.
 *
 * Overlay windows subscribe to learn whether to draw; the settings window
 * subscribes to show the switch and asks for changes. A window is sent the
 * state the moment it subscribes, so one opened or reloaded while the overlay
 * is off starts off rather than waiting for the next change to find out.
 *
 * @param persistHideWhenPaused Stores the setting, which outlives the app.
 */
export function setupOverlayVisibilityBridge(
  visibility: OverlayVisibility,
  persistHideWhenPaused: (enabled: boolean) => void
) {
  const subscriptions = defineRendererSubscriptionBridge({
    name: 'overlayVisibility',
    isValidKey: (value: unknown): value is 'state' => value === 'state',
    onSubscribe: (sender) =>
      sender.send('overlayVisibility:changed', visibility.getState()),
  });

  ipcMain.handle('overlayVisibility:getState', () => visibility.getState());
  ipcMain.handle(
    'overlayVisibility:setUserHidden',
    (_event, hidden: unknown) => {
      visibility.setUserHidden(
        booleanOrThrow(hidden, 'overlayVisibility:setUserHidden')
      );
      return visibility.getState();
    }
  );
  ipcMain.handle(
    'overlayVisibility:setHideWhenPaused',
    (_event, enabled: unknown) => {
      const value = booleanOrThrow(
        enabled,
        'overlayVisibility:setHideWhenPaused'
      );
      persistHideWhenPaused(value);
      visibility.setHideWhenPaused(value);
      return visibility.getState();
    }
  );

  const unsubscribe = visibility.onChange((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (
        !window.isDestroyed() &&
        subscriptions.registry.has(window.webContents.id, 'state')
      ) {
        window.webContents.send('overlayVisibility:changed', state);
      }
    }
  });

  return () => {
    unsubscribe();
    subscriptions.dispose();
    for (const channel of CHANNELS) ipcMain.removeHandler(channel);
  };
}
