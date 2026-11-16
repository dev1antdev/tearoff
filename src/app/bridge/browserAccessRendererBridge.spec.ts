import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  listeners: new Set<(event: unknown, value: unknown) => void>(),
  invoke: vi.fn(async (): Promise<unknown> => undefined),
  send: vi.fn(),
}));
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcMain: {},
  ipcRenderer: {
    on: (
      _channel: string,
      callback: (event: unknown, value: unknown) => void
    ) => mock.listeners.add(callback),
    removeListener: (
      _channel: string,
      callback: (event: unknown, value: unknown) => void
    ) => mock.listeners.delete(callback),
    invoke: mock.invoke,
    send: mock.send,
  },
}));
import { exposeBrowserAccessBridge } from './browserAccessRendererBridge';

beforeEach(() => {
  mock.listeners.clear();
  vi.clearAllMocks();
});

it('asks main for the links and for a new key, with no arguments', async () => {
  const bridge = exposeBrowserAccessBridge();
  const access = { port: 3000 };
  mock.invoke.mockResolvedValue(access);

  await expect(bridge.getAccess()).resolves.toBe(access);
  await expect(bridge.replaceKey()).resolves.toBe(access);

  expect(mock.invoke.mock.calls).toEqual([
    ['browserAccess:get'],
    ['browserAccess:replaceKey'],
  ]);
});

it('takes only a count for the count, releases listeners and unsubscribes after the last consumer', () => {
  const bridge = exposeBrowserAccessBridge();
  const first = vi.fn();
  const second = vi.fn();
  const removeFirst = bridge.onDevicesChanged(first);
  const removeSecond = bridge.onDevicesChanged(second);
  for (const callback of mock.listeners) {
    callback({}, '2');
    callback({}, null);
    callback({}, -1);
    callback({}, 1.5);
    callback({}, { devices: 2 });
    callback({}, 2);
  }
  expect(first).toHaveBeenCalledExactlyOnceWith(2);
  expect(second).toHaveBeenCalledExactlyOnceWith(2);
  mock.invoke.mockClear();
  removeFirst();
  removeFirst();
  expect(mock.invoke).not.toHaveBeenCalled();
  removeSecond();
  expect(mock.invoke).toHaveBeenCalledExactlyOnceWith(
    'browserAccess:unsubscribe',
    'devices'
  );
  expect(mock.listeners.size).toBe(0);
});

it('handles subscription failure without dropping a rejected promise', async () => {
  mock.invoke.mockRejectedValueOnce(new Error('closed'));
  const cleanup = exposeBrowserAccessBridge().onDevicesChanged(vi.fn());
  await Promise.resolve();
  expect(mock.send).toHaveBeenCalledWith(
    'log',
    'warn',
    '[BrowserAccess] Subscription failed'
  );
  cleanup();
});
