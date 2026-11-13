import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    handle: vi.fn(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }
    ),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel);
    }),
    windows: [] as {
      isDestroyed: () => boolean;
      webContents: { id: number; send: ReturnType<typeof vi.fn> };
    }[],
  };
});
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: {},
  ipcMain: { handle: mock.handle, removeHandler: mock.removeHandler },
  BrowserWindow: { getAllWindows: () => mock.windows },
}));

import { createOverlayVisibility } from '../overlayVisibility';
import { setupOverlayVisibilityBridge } from './overlayVisibilityBridge';

const sender = (id: number) => ({
  id,
  send: vi.fn(),
  once: vi.fn(),
  removeListener: vi.fn(),
});

const invokeFrom = (
  from: ReturnType<typeof sender>,
  channel: string,
  ...args: unknown[]
) => {
  const handler = mock.handlers.get(channel);
  if (!handler) throw new Error(`No handler for ${channel}`);
  return handler({ sender: from }, ...args);
};

const invoke = (channel: string, ...args: unknown[]) =>
  invokeFrom(sender(1), channel, ...args);

const window = (id: number, destroyed = false) => ({
  isDestroyed: () => destroyed,
  webContents: { id, send: vi.fn() },
});

const setup = () => {
  const visibility = createOverlayVisibility({ hideWhenPaused: true });
  const persist = vi.fn();
  const dispose = setupOverlayVisibilityBridge(visibility, persist);
  return { visibility, persist, dispose };
};

beforeEach(() => {
  mock.handlers.clear();
  mock.windows.length = 0;
  vi.clearAllMocks();
});

describe('overlay visibility bridge', () => {
  it('answers with the state and applies what the settings window asks', () => {
    const { visibility, persist } = setup();

    expect(invoke('overlayVisibility:getState')).toEqual(visibility.getState());

    expect(invoke('overlayVisibility:setUserHidden', true)).toMatchObject({
      userHidden: true,
      hidden: true,
    });
    expect(visibility.getState().userHidden).toBe(true);
    // The driver's switch is for this run of the app; it is not stored.
    expect(persist).not.toHaveBeenCalled();
  });

  it('stores the pause setting as well as applying it', () => {
    const { visibility, persist } = setup();

    expect(invoke('overlayVisibility:setHideWhenPaused', false)).toMatchObject({
      hideWhenPaused: false,
    });

    expect(persist).toHaveBeenCalledWith(false);
    expect(visibility.getState().hideWhenPaused).toBe(false);
  });

  it.each([
    ['overlayVisibility:setUserHidden', 'yes'],
    ['overlayVisibility:setUserHidden', 1],
    ['overlayVisibility:setUserHidden', undefined],
    ['overlayVisibility:setHideWhenPaused', 'false'],
    ['overlayVisibility:setHideWhenPaused', null],
  ])('refuses %s with %j and changes nothing', (channel, value) => {
    const { visibility, persist } = setup();
    const before = visibility.getState();

    expect(() => invoke(channel, value)).toThrow(TypeError);

    expect(visibility.getState()).toEqual(before);
    expect(persist).not.toHaveBeenCalled();
  });

  it('tells a window the state as it subscribes', () => {
    const { visibility } = setup();
    visibility.setUserHidden(true);
    const overlay = sender(7);

    invokeFrom(overlay, 'overlayVisibility:subscribe', 'state');

    // A window opened while the overlay is off must start off.
    expect(overlay.send).toHaveBeenCalledWith(
      'overlayVisibility:changed',
      expect.objectContaining({ userHidden: true, hidden: true })
    );
  });

  it('sends each change to the windows that subscribed, and only to them', () => {
    const { visibility } = setup();
    const subscribed = window(7);
    const other = window(8);
    const gone = window(9, true);
    mock.windows.push(subscribed, other, gone);
    invokeFrom(sender(7), 'overlayVisibility:subscribe', 'state');
    invokeFrom(sender(9), 'overlayVisibility:subscribe', 'state');

    visibility.setGamePaused(true);

    expect(subscribed.webContents.send).toHaveBeenCalledWith(
      'overlayVisibility:changed',
      expect.objectContaining({ gamePaused: true, hidden: true })
    );
    expect(other.webContents.send).not.toHaveBeenCalled();
    expect(gone.webContents.send).not.toHaveBeenCalled();
  });

  it('refuses a subscription to anything but the state', () => {
    setup();

    expect(() =>
      invokeFrom(sender(7), 'overlayVisibility:subscribe', 'everything')
    ).toThrow();
  });

  it('lets go of its handlers and its listener when disposed', () => {
    const { visibility, dispose } = setup();
    const subscribed = window(7);
    mock.windows.push(subscribed);
    invokeFrom(sender(7), 'overlayVisibility:subscribe', 'state');

    dispose();
    visibility.setUserHidden(true);

    expect(mock.handlers.size).toBe(0);
    expect(subscribed.webContents.send).not.toHaveBeenCalled();
  });
});
