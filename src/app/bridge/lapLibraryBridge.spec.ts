import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LapLibraryService } from '../storage/lapLibrary/lapLibraryService';

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

import { setupLapLibraryBridge } from './lapLibraryBridge';

const library = () => {
  let listener: (() => void) | undefined;
  const service = {
    recordLap: vi.fn(),
    referenceLap: vi.fn(),
    referenceRevision: vi.fn(),
    listSessions: vi.fn(async () => []),
    listLaps: vi.fn(async () => []),
    deleteLap: vi.fn(async () => true),
    deleteSession: vi.fn(async () => true),
    pinReference: vi.fn(async () => true),
    unpinReference: vi.fn(async () => true),
    getStats: vi.fn(async () => ({ sessions: 1, laps: 2 })),
    onChanged: vi.fn((callback: () => void) => {
      listener = callback;
      return () => {
        listener = undefined;
      };
    }),
  } satisfies LapLibraryService;
  return { service, emitChanged: () => listener?.() };
};

const sender = (id: number) => ({
  id,
  once: vi.fn(),
  removeListener: vi.fn(),
});

const invoke = (channel: string, ...args: unknown[]) => {
  const handler = mock.handlers.get(channel);
  if (!handler) throw new Error(`No handler for ${channel}`);
  return handler({ sender: sender(1) }, ...args);
};

const window = (id: number, destroyed = false) => ({
  isDestroyed: () => destroyed,
  webContents: { id, send: vi.fn() },
});

beforeEach(() => {
  mock.handlers.clear();
  mock.windows.length = 0;
  vi.clearAllMocks();
});

describe('lap library bridge', () => {
  it('passes each request on to the library', async () => {
    const { service } = library();
    setupLapLibraryBridge(service);

    await invoke('lapLibrary:listSessions', 50, 100);
    await invoke('lapLibrary:listLaps', 7);
    await invoke('lapLibrary:deleteLap', 8);
    await invoke('lapLibrary:deleteSession', 9);
    await invoke('lapLibrary:pinReference', 10);
    await invoke('lapLibrary:unpinReference', 11);

    expect(service.listSessions).toHaveBeenCalledWith(50, 100);
    expect(service.listLaps).toHaveBeenCalledWith(7);
    expect(service.deleteLap).toHaveBeenCalledWith(8);
    expect(service.deleteSession).toHaveBeenCalledWith(9);
    expect(service.pinReference).toHaveBeenCalledWith(10);
    expect(service.unpinReference).toHaveBeenCalledWith(11);
    expect(await invoke('lapLibrary:getStats')).toEqual({
      sessions: 1,
      laps: 2,
    });
  });

  it('lists sessions without a page asked for', async () => {
    const { service } = library();
    setupLapLibraryBridge(service);

    await invoke('lapLibrary:listSessions');

    expect(service.listSessions).toHaveBeenCalledWith(undefined, undefined);
  });

  it.each([
    'lapLibrary:listLaps',
    'lapLibrary:deleteLap',
    'lapLibrary:deleteSession',
    'lapLibrary:pinReference',
    'lapLibrary:unpinReference',
  ])('refuses %s with anything but a row id', (channel) => {
    const { service } = library();
    setupLapLibraryBridge(service);

    for (const bad of [0, -1, 1.5, '7', null, undefined, {}, Number.NaN]) {
      expect(() => invoke(channel, bad)).toThrow(TypeError);
    }
    for (const method of Object.values(service)) {
      if (method !== service.onChanged) expect(method).not.toHaveBeenCalled();
    }
  });

  it('refuses a page size or offset that is not a whole number', () => {
    const { service } = library();
    setupLapLibraryBridge(service);

    for (const bad of [-1, 2.5, '10', {}]) {
      expect(() => invoke('lapLibrary:listSessions', bad, 0)).toThrow(
        TypeError
      );
      expect(() => invoke('lapLibrary:listSessions', 10, bad)).toThrow(
        TypeError
      );
    }
    expect(service.listSessions).not.toHaveBeenCalled();
  });

  it('tells only the windows that asked when the library changes', () => {
    const { service, emitChanged } = library();
    setupLapLibraryBridge(service);
    const listening = window(1);
    const other = window(2);
    const closed = window(3, true);
    mock.windows.push(listening, other, closed);
    mock.handlers.get('lapLibrary:subscribe')?.(
      { sender: sender(1) },
      'changed'
    );
    mock.handlers.get('lapLibrary:subscribe')?.(
      { sender: sender(3) },
      'changed'
    );

    emitChanged();

    expect(listening.webContents.send).toHaveBeenCalledExactlyOnceWith(
      'lapLibrary:changed'
    );
    expect(other.webContents.send).not.toHaveBeenCalled();
    expect(closed.webContents.send).not.toHaveBeenCalled();
  });

  it('refuses a subscription to anything but changes', () => {
    const { service } = library();
    setupLapLibraryBridge(service);

    expect(() =>
      mock.handlers.get('lapLibrary:subscribe')?.({ sender: sender(1) }, 'all')
    ).toThrow();
  });

  it('removes its handlers and stops listening when disposed', () => {
    const { service, emitChanged } = library();
    const dispose = setupLapLibraryBridge(service);
    const listening = window(1);
    mock.windows.push(listening);
    mock.handlers.get('lapLibrary:subscribe')?.(
      { sender: sender(1) },
      'changed'
    );

    dispose();
    emitChanged();

    expect(mock.handlers.size).toBe(0);
    expect(listening.webContents.send).not.toHaveBeenCalled();
  });
});
