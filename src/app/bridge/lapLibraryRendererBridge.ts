import { ipcRenderer } from 'electron';
import type { LapLibraryBridge } from '../../types/lapLibrary';
import { defineBridge, createSubscriptionBridgeClient } from './defineBridge';

/** The preload side of the lap library: what the settings page calls. */
export const exposeLapLibraryBridge = () => {
  const subscription = createSubscriptionBridgeClient<'changed'>('lapLibrary');
  // Consumers share one per-window subscription; callbacks never live in main.
  let consumers = 0;
  return defineBridge<LapLibraryBridge>('lapLibraryBridge', {
    listSessions: (limit, offset) =>
      ipcRenderer.invoke('lapLibrary:listSessions', limit, offset),
    listLaps: (sessionId) =>
      ipcRenderer.invoke('lapLibrary:listLaps', sessionId),
    deleteLap: (lapId) => ipcRenderer.invoke('lapLibrary:deleteLap', lapId),
    deleteSession: (sessionId) =>
      ipcRenderer.invoke('lapLibrary:deleteSession', sessionId),
    pinReference: (lapId) =>
      ipcRenderer.invoke('lapLibrary:pinReference', lapId),
    unpinReference: (lapId) =>
      ipcRenderer.invoke('lapLibrary:unpinReference', lapId),
    getStats: () => ipcRenderer.invoke('lapLibrary:getStats'),
    onChanged(callback) {
      const listener = () => callback();
      ipcRenderer.on('lapLibrary:changed', listener);
      consumers++;
      void subscription
        .subscribe('changed')
        .catch(() =>
          ipcRenderer.send(
            'log',
            'warn',
            '[LapLibrary] Change subscription failed'
          )
        );
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        ipcRenderer.removeListener('lapLibrary:changed', listener);
        if (--consumers === 0) {
          void subscription
            .unsubscribe('changed')
            .catch(() =>
              ipcRenderer.send(
                'log',
                'warn',
                '[LapLibrary] Change unsubscribe failed'
              )
            );
        }
      };
    },
  });
};
