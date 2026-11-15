import { ipcRenderer } from 'electron';
import type { TrackProfileBridge } from '../../types/trackProfileBridge';
import { defineBridge, createSubscriptionBridgeClient } from './defineBridge';

/** The preload side of the track profiles: what the settings pages call. */
export const exposeTrackProfileBridge = () => {
  const subscription =
    createSubscriptionBridgeClient<'changed'>('trackProfile');
  // Consumers share one per-window subscription; callbacks never live in main.
  let consumers = 0;
  return defineBridge<TrackProfileBridge>('trackProfileBridge', {
    listTracks: () => ipcRenderer.invoke('trackProfile:listTracks'),
    getProfile: (trackKey) =>
      ipcRenderer.invoke('trackProfile:getProfile', trackKey),
    saveNotes: (trackKey, notes) =>
      ipcRenderer.invoke('trackProfile:saveNotes', trackKey, notes),
    importNotes: (trackKey, kind, fileText) =>
      ipcRenderer.invoke('trackProfile:importNotes', trackKey, kind, fileText),
    exportNotes: (trackKey, kind) =>
      ipcRenderer.invoke('trackProfile:exportNotes', trackKey, kind),
    clearElevation: (trackKey) =>
      ipcRenderer.invoke('trackProfile:clearElevation', trackKey),
    onChanged(callback) {
      const listener = () => callback();
      ipcRenderer.on('trackProfile:changed', listener);
      consumers++;
      void subscription
        .subscribe('changed')
        .catch(() =>
          ipcRenderer.send(
            'log',
            'warn',
            '[TrackProfiles] Change subscription failed'
          )
        );
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        ipcRenderer.removeListener('trackProfile:changed', listener);
        if (--consumers === 0) {
          void subscription
            .unsubscribe('changed')
            .catch(() =>
              ipcRenderer.send(
                'log',
                'warn',
                '[TrackProfiles] Change unsubscribe failed'
              )
            );
        }
      };
    },
  });
};
