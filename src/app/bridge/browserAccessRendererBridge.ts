import { ipcRenderer } from 'electron';
import type { BrowserAccessBridge } from '../../types/browserAccess';
import { defineBridge, createSubscriptionBridgeClient } from './defineBridge';

/**
 * The preload side of the settings window's questions about browser pages.
 * It is exposed in every window, as every preload bridge is; the main
 * process answers the two that carry the key to the settings window alone.
 */
export const exposeBrowserAccessBridge = () => {
  const subscription =
    createSubscriptionBridgeClient<'devices'>('browserAccess');
  // Consumers share one per-window subscription; callbacks never live in main.
  let consumers = 0;
  return defineBridge<BrowserAccessBridge>('browserAccessBridge', {
    getAccess: () => ipcRenderer.invoke('browserAccess:get'),
    replaceKey: () => ipcRenderer.invoke('browserAccess:replaceKey'),
    onDevicesChanged(callback) {
      const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
        if (typeof value === 'number' && Number.isInteger(value) && value >= 0)
          callback(value);
      };
      ipcRenderer.on('browserAccess:devices', listener);
      consumers++;
      // Main answers a subscription with the count, to this whole window.
      void subscription
        .subscribe('devices')
        .catch(() =>
          ipcRenderer.send('log', 'warn', '[BrowserAccess] Subscription failed')
        );
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        ipcRenderer.removeListener('browserAccess:devices', listener);
        if (--consumers === 0) {
          void subscription
            .unsubscribe('devices')
            .catch(() =>
              ipcRenderer.send(
                'log',
                'warn',
                '[BrowserAccess] Unsubscribe failed'
              )
            );
        }
      };
    },
  });
};
