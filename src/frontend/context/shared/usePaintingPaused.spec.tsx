import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OverlayHiddenContext } from './useOverlayHidden';
import { usePaintingPaused } from './usePaintingPaused';

describe('usePaintingPaused', () => {
  afterEach(() => {
    cleanup();
    delete window.windowVisibilityBridge;
  });

  const overlay =
    (hidden: boolean) =>
    ({ children }: { children: ReactNode }) => (
      <OverlayHiddenContext.Provider value={hidden}>
        {children}
      </OverlayHiddenContext.Provider>
    );

  it('lets a widget paint in a window that is on screen', () => {
    // No bridge at all is the browser-source page: nothing to hide there.
    expect(renderHook(() => usePaintingPaused()).result.current).toBe(false);
    expect(
      renderHook(() => usePaintingPaused(), { wrapper: overlay(false) }).result
        .current
    ).toBe(false);
  });

  it('pauses while the overlay is hidden, though its window is not', () => {
    const { result } = renderHook(() => usePaintingPaused(), {
      wrapper: overlay(true),
    });

    expect(result.current).toBe(true);
  });

  it('pauses while the window is hidden or minimised, and stops when it is back', () => {
    let notify: ((visible: boolean) => void) | undefined;
    const unsubscribe = vi.fn();
    window.windowVisibilityBridge = {
      onVisibilityChanged: (callback) => {
        notify = callback;
        return unsubscribe;
      },
    };
    const { result, unmount } = renderHook(() => usePaintingPaused(), {
      wrapper: overlay(false),
    });
    expect(result.current).toBe(false);

    act(() => notify?.(false));
    expect(result.current).toBe(true);
    act(() => notify?.(true));
    expect(result.current).toBe(false);

    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
