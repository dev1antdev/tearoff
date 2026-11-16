import { BrowserWindow, ipcMain } from 'electron';
import type { BrowserAccess } from '@irdashies/types';
import { defineRendererSubscriptionBridge } from './defineBridge';

export const BROWSER_ACCESS_GET = 'browserAccess:get';
export const BROWSER_ACCESS_REPLACE_KEY = 'browserAccess:replaceKey';
export const BROWSER_ACCESS_DEVICES = 'browserAccess:devices';

export interface BrowserAccessSource {
  /** The built-in web server now, with the key other devices show it. */
  getAccess: () => BrowserAccess;
  /** Rejects, with the old key still in force, when it could not be done. */
  replaceKey: () => Promise<BrowserAccess>;
  onDevicesChanged: (listener: (devices: number) => void) => () => void;
  /** Whether a renderer is the settings window's. */
  isSettingsWindow: (sender: Electron.WebContents) => boolean;
}

/**
 * What the settings window asks about the pages a browser can open: where
 * they are, the key a device that is not this PC opens them with, a new key,
 * and how many such devices are connected.
 *
 * The key leaves the main process on these two channels and no others, and
 * only for the settings window: an overlay or Pit Wall window that asks is
 * refused. Neither channel takes an argument, so there is nothing of the
 * renderer's to act on; a call that brings one is not a call this app makes.
 *
 * The count is not a secret and is pushed to whichever window subscribes.
 */
export function setupBrowserAccessBridge(
  source: BrowserAccessSource
): () => void {
  const requireSettingsWindow = (
    event: Electron.IpcMainInvokeEvent,
    channel: string,
    args: unknown[]
  ) => {
    if (args.length > 0) {
      throw new TypeError(`${channel} takes no arguments`);
    }
    if (
      event.senderFrame !== event.sender.mainFrame ||
      !source.isSettingsWindow(event.sender)
    ) {
      throw new Error(`${channel} is answered to the settings window only`);
    }
  };

  ipcMain.handle(BROWSER_ACCESS_GET, (event, ...args: unknown[]) => {
    requireSettingsWindow(event, BROWSER_ACCESS_GET, args);
    return source.getAccess();
  });
  ipcMain.handle(BROWSER_ACCESS_REPLACE_KEY, (event, ...args: unknown[]) => {
    requireSettingsWindow(event, BROWSER_ACCESS_REPLACE_KEY, args);
    return source.replaceKey();
  });

  const subscriptions = defineRendererSubscriptionBridge({
    name: 'browserAccess',
    isValidKey: (value: unknown): value is 'devices' => value === 'devices',
    onSubscribe: (sender) =>
      sender.send(BROWSER_ACCESS_DEVICES, source.getAccess().devices),
  });
  const unsubscribe = source.onDevicesChanged((devices) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (
        !window.isDestroyed() &&
        subscriptions.registry.has(window.webContents.id, 'devices')
      ) {
        window.webContents.send(BROWSER_ACCESS_DEVICES, devices);
      }
    }
  });

  return () => {
    unsubscribe();
    subscriptions.dispose();
    ipcMain.removeHandler(BROWSER_ACCESS_GET);
    ipcMain.removeHandler(BROWSER_ACCESS_REPLACE_KEY);
  };
}
