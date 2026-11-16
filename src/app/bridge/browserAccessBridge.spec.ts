import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserAccess } from '@irdashies/types';

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

import {
  BROWSER_ACCESS_DEVICES,
  BROWSER_ACCESS_GET,
  BROWSER_ACCESS_REPLACE_KEY,
  setupBrowserAccessBridge,
} from './browserAccessBridge';

const KEY = 'k'.repeat(32);
const NEW_KEY = 'n'.repeat(32);
const SETTINGS = 7;
const OVERLAY = 8;

const access = (key = KEY): BrowserAccess => ({
  listening: true,
  port: 3000,
  networkAccess: true,
  host: '192.168.1.50',
  key,
  devices: 2,
});

const sender = (id: number) => {
  const mainFrame = { id: `main-${id}` };
  return {
    id,
    mainFrame,
    send: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
  };
};

/** A call from a window's own page, or from a frame inside it. */
const invokeFrom = (
  from: ReturnType<typeof sender>,
  channel: string,
  { frame = from.mainFrame as unknown, args = [] as unknown[] } = {}
) => {
  const handler = mock.handlers.get(channel);
  if (!handler) throw new Error(`No handler for ${channel}`);
  return handler({ sender: from, senderFrame: frame }, ...args);
};

const window = (id: number, destroyed = false) => ({
  isDestroyed: () => destroyed,
  webContents: { id, send: vi.fn() },
});

function setup() {
  const listeners = new Set<(devices: number) => void>();
  const source = {
    getAccess: vi.fn(() => access()),
    replaceKey: vi.fn(async () => access(NEW_KEY)),
    onDevicesChanged: vi.fn((listener: (devices: number) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    isSettingsWindow: (from: { id: number }) => from.id === SETTINGS,
  };
  const dispose = setupBrowserAccessBridge(
    source as unknown as Parameters<typeof setupBrowserAccessBridge>[0]
  );
  return {
    source,
    dispose,
    listeners,
    announce: (devices: number) => listeners.forEach((l) => l(devices)),
  };
}

beforeEach(() => {
  mock.handlers.clear();
  mock.windows.length = 0;
  vi.clearAllMocks();
});

describe('setupBrowserAccessBridge', () => {
  it('registers its channels by the names the preload calls', () => {
    setup();

    expect(BROWSER_ACCESS_GET).toBe('browserAccess:get');
    expect(BROWSER_ACCESS_REPLACE_KEY).toBe('browserAccess:replaceKey');
    expect(BROWSER_ACCESS_DEVICES).toBe('browserAccess:devices');
    expect([...mock.handlers.keys()].sort()).toEqual([
      'browserAccess:get',
      'browserAccess:replaceKey',
      'browserAccess:subscribe',
      'browserAccess:unsubscribe',
    ]);
  });

  it('hands the settings window the links and the key', () => {
    setup();

    expect(invokeFrom(sender(SETTINGS), BROWSER_ACCESS_GET)).toEqual(access());
  });

  it('makes a new key for the settings window', async () => {
    const { source } = setup();

    await expect(
      invokeFrom(sender(SETTINGS), BROWSER_ACCESS_REPLACE_KEY)
    ).resolves.toEqual(access(NEW_KEY));
    expect(source.replaceKey).toHaveBeenCalledTimes(1);
  });

  it('passes on that a new key could not be stored', async () => {
    const { source } = setup();
    source.replaceKey.mockRejectedValueOnce(new Error('EPERM'));

    await expect(
      invokeFrom(sender(SETTINGS), BROWSER_ACCESS_REPLACE_KEY)
    ).rejects.toThrow('EPERM');
  });

  it.each([BROWSER_ACCESS_GET, BROWSER_ACCESS_REPLACE_KEY])(
    'refuses %s to a window that is not the settings window',
    (channel) => {
      const { source } = setup();

      expect(() => invokeFrom(sender(OVERLAY), channel)).toThrow(
        'settings window only'
      );
      expect(source.getAccess).not.toHaveBeenCalled();
      expect(source.replaceKey).not.toHaveBeenCalled();
    }
  );

  it.each([BROWSER_ACCESS_GET, BROWSER_ACCESS_REPLACE_KEY])(
    'refuses %s to a frame inside the settings window',
    (channel) => {
      const { source } = setup();

      for (const frame of [{ id: 'embedded' }, null]) {
        expect(() => invokeFrom(sender(SETTINGS), channel, { frame })).toThrow(
          'settings window only'
        );
      }
      expect(source.getAccess).not.toHaveBeenCalled();
      expect(source.replaceKey).not.toHaveBeenCalled();
    }
  );

  it.each([BROWSER_ACCESS_GET, BROWSER_ACCESS_REPLACE_KEY])(
    'refuses %s when it is called with anything',
    (channel) => {
      const { source } = setup();

      for (const args of [[undefined], [KEY], [{ key: KEY }], [1, 2]]) {
        expect(() => invokeFrom(sender(SETTINGS), channel, { args })).toThrow(
          'takes no arguments'
        );
      }
      expect(source.getAccess).not.toHaveBeenCalled();
      expect(source.replaceKey).not.toHaveBeenCalled();
    }
  );

  it('tells a window the count as it subscribes, and each change after', () => {
    const { announce } = setup();
    const settings = sender(SETTINGS);
    const settingsWindow = window(SETTINGS);
    const overlayWindow = window(OVERLAY);
    mock.windows.push(settingsWindow, overlayWindow, window(9, true));

    invokeFrom(settings, 'browserAccess:subscribe', { args: ['devices'] });
    expect(settings.send).toHaveBeenCalledExactlyOnceWith(
      BROWSER_ACCESS_DEVICES,
      2
    );

    announce(3);
    expect(settingsWindow.webContents.send).toHaveBeenCalledExactlyOnceWith(
      BROWSER_ACCESS_DEVICES,
      3
    );
    // A window that did not ask is not told.
    expect(overlayWindow.webContents.send).not.toHaveBeenCalled();

    invokeFrom(settings, 'browserAccess:unsubscribe', { args: ['devices'] });
    announce(0);
    expect(settingsWindow.webContents.send).toHaveBeenCalledTimes(1);
  });

  it('never pushes the key, only the count', () => {
    const { announce } = setup();
    const settings = sender(SETTINGS);
    const settingsWindow = window(SETTINGS);
    mock.windows.push(settingsWindow);

    invokeFrom(settings, 'browserAccess:subscribe', { args: ['devices'] });
    announce(1);

    const pushed = JSON.stringify([
      ...settings.send.mock.calls,
      ...settingsWindow.webContents.send.mock.calls,
    ]);
    expect(pushed).not.toContain(KEY);
  });

  it('refuses a subscription to anything else', () => {
    setup();

    for (const key of ['key', 'state', undefined, { devices: true }]) {
      expect(() =>
        invokeFrom(sender(SETTINGS), 'browserAccess:subscribe', {
          args: [key],
        })
      ).toThrow('Invalid browserAccess subscription');
    }
  });

  it('lets go of everything when disposed', () => {
    const { dispose, listeners } = setup();

    dispose();

    expect(mock.handlers.size).toBe(0);
    expect(listeners.size).toBe(0);
  });
});
