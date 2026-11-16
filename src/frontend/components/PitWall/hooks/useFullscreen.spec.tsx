import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import logger from '@irdashies/utils/logger';
import { useFullscreen } from './useFullscreen';

vi.mock('@irdashies/utils/logger', () => ({
  default: { warn: vi.fn() },
}));

const root = document.documentElement as Partial<
  Pick<HTMLElement, 'requestFullscreen'>
>;
const page = document as { exitFullscreen?: () => Promise<void> };

/** Gives the page a Fullscreen API, which the test DOM has none of. */
function offerFullscreen({ refused = false } = {}) {
  let element: Element | null = null;
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => element,
  });
  const change = (next: Element | null) => {
    element = next;
    document.dispatchEvent(new Event('fullscreenchange'));
  };
  root.requestFullscreen = vi.fn(async () => {
    if (refused) throw new Error('not allowed');
    change(document.documentElement);
  });
  page.exitFullscreen = vi.fn(async () => change(null));
}

afterEach(() => {
  delete root.requestFullscreen;
  delete page.exitFullscreen;
  delete (document as { fullscreenElement?: unknown }).fullscreenElement;
  vi.clearAllMocks();
});

describe('useFullscreen', () => {
  it('goes full screen and comes back through the page’s own API', async () => {
    offerFullscreen();
    const { result } = renderHook(() => useFullscreen());
    expect(result.current.fullscreen).toBe(false);

    await act(async () => result.current.toggle());
    expect(root.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(result.current.fullscreen).toBe(true);

    await act(async () => result.current.toggle());
    expect(page.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(result.current.fullscreen).toBe(false);
  });

  it('toggles on F11, and keeps the key from the window', async () => {
    offerFullscreen();
    renderHook(() => useFullscreen());
    const key = new KeyboardEvent('keydown', { key: 'F11', cancelable: true });

    await act(async () => {
      window.dispatchEvent(key);
    });

    expect(key.defaultPrevented).toBe(true);
    expect(root.requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it('says so and stays as it was where full screen is refused', async () => {
    offerFullscreen({ refused: true });
    const { result } = renderHook(() => useFullscreen());

    await act(async () => result.current.toggle());

    expect(result.current.fullscreen).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      '[PitWall] Full screen was refused',
      expect.any(Error)
    );
  });

  it('is not full screen, and does not throw, in a browser with no full screen for a page', () => {
    // A phone's browser: neither call exists, and nothing is ever the
    // full screen element.
    const { result } = renderHook(() => useFullscreen());

    expect(result.current.fullscreen).toBe(false);
    expect(() => act(() => result.current.toggle())).not.toThrow();
    expect(result.current.fullscreen).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      '[PitWall] This browser has no full screen for a page'
    );
  });
});
