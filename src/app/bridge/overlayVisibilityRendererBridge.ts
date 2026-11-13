import { ipcRenderer } from 'electron';
import type {
  OverlayVisibilityBridge,
  OverlayVisibilityState,
} from '../../types/overlayVisibility';
import { defineBridge, createSubscriptionBridgeClient } from './defineBridge';

const isState = (value: unknown): value is OverlayVisibilityState =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as OverlayVisibilityState).hidden === 'boolean' &&
  typeof (value as OverlayVisibilityState).userHidden === 'boolean' &&
  typeof (value as OverlayVisibilityState).gamePaused === 'boolean' &&
  typeof (value as OverlayVisibilityState).hideWhenPaused === 'boolean';

const subscription =
  createSubscriptionBridgeClient<'state'>('overlayVisibility');
// Consumers in this window share one subscription; callbacks never live in
// main. Main answers a subscription with the current state, so a consumer
// that joins while another is already subscribed asks for it instead.
let consumers = 0;

/**
 * Follows the overlay's visibility from this window: the state now, then
 * every change. Shared by the overlay windows, which only want to know
 * whether to draw, and the settings window's bridge below.
 */
export const subscribeOverlayVisibility = (
  callback: (state: OverlayVisibilityState) => void
): (() => void) => {
  let active = true;
  let heard = false;
  const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
    if (!isState(value)) return;
    heard = true;
    callback(value);
  };
  ipcRenderer.on('overlayVisibility:changed', listener);
  const first = consumers === 0;
  consumers++;
  if (first) {
    void subscription
      .subscribe('state')
      .catch(() =>
        ipcRenderer.send(
          'log',
          'warn',
          '[OverlayVisibility] Subscription failed'
        )
      );
  } else {
    ipcRenderer
      .invoke('overlayVisibility:getState')
      .then((state: unknown) => {
        // A change that arrived meanwhile is newer than this answer.
        if (active && !heard && isState(state)) callback(state);
      })
      .catch(() => undefined);
  }
  return () => {
    if (!active) return;
    active = false;
    ipcRenderer.removeListener('overlayVisibility:changed', listener);
    if (--consumers === 0) {
      void subscription
        .unsubscribe('state')
        .catch(() =>
          ipcRenderer.send(
            'log',
            'warn',
            '[OverlayVisibility] Unsubscribe failed'
          )
        );
    }
  };
};

/** The preload side of the overlay's visibility, for the settings window. */
export const exposeOverlayVisibilityBridge = () =>
  defineBridge<OverlayVisibilityBridge>('overlayVisibilityBridge', {
    getState: () => ipcRenderer.invoke('overlayVisibility:getState'),
    setUserHidden: (hidden) =>
      ipcRenderer.invoke('overlayVisibility:setUserHidden', hidden),
    setHideWhenPaused: (enabled) =>
      ipcRenderer.invoke('overlayVisibility:setHideWhenPaused', enabled),
    onChanged: (callback) => subscribeOverlayVisibility(callback),
  });
