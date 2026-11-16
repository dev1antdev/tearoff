import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserAccess, BrowserAccessBridge } from '@irdashies/types';
import logger from '@irdashies/utils/logger';
import { useBrowserAccess } from './useBrowserAccess';

vi.mock('@irdashies/utils/logger', () => ({
  default: { warn: vi.fn() },
}));

const KEY = 'k'.repeat(32);
const NEW_KEY = 'n'.repeat(32);

const access = (values: Partial<BrowserAccess> = {}): BrowserAccess => ({
  listening: true,
  port: 3000,
  networkAccess: true,
  host: '192.168.1.50',
  key: KEY,
  devices: 0,
  ...values,
});

function fakeBridge(first: BrowserAccess = access()) {
  const listeners = new Set<(devices: number) => void>();
  const bridge = {
    getAccess: vi.fn(async () => first),
    replaceKey: vi.fn(async () => access({ key: NEW_KEY })),
    onDevicesChanged: vi.fn((callback: (devices: number) => void) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    }),
  } satisfies BrowserAccessBridge;
  return {
    bridge,
    listeners,
    announce: (devices: number) =>
      act(() => listeners.forEach((listener) => listener(devices))),
  };
}

afterEach(() => {
  vi.clearAllMocks();
  delete window.browserAccessBridge;
});

describe('useBrowserAccess', () => {
  it('has nobody to ask outside the desktop app', async () => {
    const { result } = renderHook(() => useBrowserAccess());

    expect(result.current).toMatchObject({
      access: null,
      available: false,
      failed: false,
    });
    await expect(result.current.replaceKey()).resolves.toBe(false);
  });

  it('asks the preload bridge unless it is handed another', async () => {
    const { bridge } = fakeBridge();
    window.browserAccessBridge = bridge;

    const { result } = renderHook(() => useBrowserAccess());

    await waitFor(() => expect(result.current.access).toEqual(access()));
    expect(result.current.available).toBe(true);
  });

  it('follows the number of devices as it changes', async () => {
    const { bridge, announce } = fakeBridge();
    const { result } = renderHook(() => useBrowserAccess(bridge));
    await waitFor(() => expect(result.current.access?.devices).toBe(0));

    announce(2);
    expect(result.current.access?.devices).toBe(2);
    announce(0);
    expect(result.current.access?.devices).toBe(0);
  });

  it('takes a count that came before the answer over the one in the answer', async () => {
    const answer = Promise.withResolvers<BrowserAccess>();
    const { bridge, announce } = fakeBridge();
    bridge.getAccess.mockReturnValue(answer.promise);
    const { result } = renderHook(() => useBrowserAccess(bridge));

    announce(3);
    expect(result.current.access).toBeNull();
    await act(async () => answer.resolve(access({ devices: 1 })));

    expect(result.current.access?.devices).toBe(3);
  });

  it('shows the new key once it has been made', async () => {
    const { bridge } = fakeBridge();
    const { result } = renderHook(() => useBrowserAccess(bridge));
    await waitFor(() => expect(result.current.access?.key).toBe(KEY));

    let replaced: boolean | undefined;
    await act(async () => {
      replaced = await result.current.replaceKey();
    });

    expect(replaced).toBe(true);
    expect(result.current.access?.key).toBe(NEW_KEY);
  });

  it('keeps showing the old key when a new one could not be made', async () => {
    const { bridge } = fakeBridge();
    bridge.replaceKey.mockRejectedValueOnce(new Error('EPERM'));
    const { result } = renderHook(() => useBrowserAccess(bridge));
    await waitFor(() => expect(result.current.access?.key).toBe(KEY));

    let replaced: boolean | undefined;
    await act(async () => {
      replaced = await result.current.replaceKey();
    });

    expect(replaced).toBe(false);
    expect(result.current.access?.key).toBe(KEY);
  });

  it('says so when the main process does not answer', async () => {
    const { bridge } = fakeBridge();
    bridge.getAccess.mockRejectedValueOnce(new Error('refused'));
    const { result } = renderHook(() => useBrowserAccess(bridge));

    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.access).toBeNull();
  });

  it('stops following when it is gone, and drops a late answer', async () => {
    const answer = Promise.withResolvers<BrowserAccess>();
    const { bridge, listeners } = fakeBridge();
    bridge.getAccess.mockReturnValue(answer.promise);
    const { result, unmount } = renderHook(() => useBrowserAccess(bridge));
    expect(listeners.size).toBe(1);

    unmount();
    await act(async () => answer.resolve(access()));

    expect(listeners.size).toBe(0);
    expect(result.current.access).toBeNull();
  });

  it('never writes the key to the log', async () => {
    const { bridge } = fakeBridge();
    bridge.replaceKey.mockRejectedValueOnce(new Error('EPERM'));
    const { result } = renderHook(() => useBrowserAccess(bridge));
    await waitFor(() => expect(result.current.access?.key).toBe(KEY));
    await act(async () => {
      await result.current.replaceKey();
    });

    expect(logger.warn).toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain(
      KEY
    );
  });
});
