import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BrowserAccess, BrowserAccessBridge } from '@irdashies/types';
import logger from '@irdashies/utils/logger';

export interface BrowserAccessControls {
  /** Null until the main process has answered, and where there is no bridge. */
  access: BrowserAccess | null;
  /** False outside the desktop app, where there is nobody to ask. */
  available: boolean;
  /** The main process was asked and did not answer. */
  failed: boolean;
  /**
   * Replaces the key other devices open pages with. Resolves false, with the
   * old key still in force, when it could not be replaced.
   */
  replaceKey: () => Promise<boolean>;
}

/**
 * The built-in web server as the main process has it: where its pages are,
 * the key a device that is not this PC opens them with, and how many such
 * devices are connected, which is followed as it changes.
 *
 * Only the settings window is answered. What comes back holds the key, so
 * nothing here writes it to the log.
 *
 * @param bridge For stories and specs; the app uses the preload bridge.
 */
export const useBrowserAccess = (
  bridge: BrowserAccessBridge | undefined = window.browserAccessBridge
): BrowserAccessControls => {
  const [answer, setAnswer] = useState<BrowserAccess | null>(null);
  const [devices, setDevices] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    let active = true;
    bridge
      .getAccess()
      .then((value) => {
        if (active) setAnswer(value);
      })
      .catch((error: unknown) => {
        logger.warn('Could not read the browser page links', error);
        if (active) setFailed(true);
      });
    // The count is pushed, so it is newer than the one in any answer.
    const stop = bridge.onDevicesChanged(setDevices);
    return () => {
      active = false;
      stop();
    };
  }, [bridge]);

  const replaceKey = useCallback(async () => {
    if (!bridge) return false;
    try {
      setAnswer(await bridge.replaceKey());
      return true;
    } catch (error) {
      logger.warn('Could not replace the key for other devices', error);
      return false;
    }
  }, [bridge]);

  const access = useMemo(
    () => answer && { ...answer, devices: devices ?? answer.devices },
    [answer, devices]
  );

  return { access, available: bridge !== undefined, failed, replaceKey };
};
