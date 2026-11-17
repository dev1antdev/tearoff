import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@irdashies/context', () => ({
  useDashboard: () => ({}),
  useActiveSimulator: () => null,
  useSimWidgetSupport: () => ({ message: '', disabledWidgets: {} }),
}));

import { usePitWallPhone } from './usePitWallPage';

const original = window.matchMedia;

/** A browser that answers the page's question and can change its mind. */
const stageBrowser = (narrow: boolean) => {
  const state = { narrow, queries: [] as string[] };
  const listeners = new Set<() => void>();
  window.matchMedia = ((query: string) => {
    state.queries.push(query);
    return {
      get matches() {
        return state.narrow;
      },
      media: query,
      addEventListener: (_type: string, listener: () => void) =>
        listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) =>
        listeners.delete(listener),
    };
  }) as unknown as typeof window.matchMedia;
  return {
    queries: state.queries,
    listeners,
    resize: (next: boolean) => {
      state.narrow = next;
      listeners.forEach((listener) => listener());
    },
  };
};

afterEach(() => {
  window.matchMedia = original;
});

describe('usePitWallPhone', () => {
  it('asks the browser whether the page is narrower than 700 CSS pixels', () => {
    const browser = stageBrowser(false);
    renderHook(() => usePitWallPhone());
    // Up to and including 699: a page of 700 is not a phone's.
    expect(new Set(browser.queries)).toEqual(new Set(['(max-width: 699px)']));
  });

  it('is a phone on a narrow page and not on a wide one', () => {
    stageBrowser(true);
    expect(renderHook(() => usePitWallPhone()).result.current).toBe(true);

    stageBrowser(false);
    expect(renderHook(() => usePitWallPhone()).result.current).toBe(false);
  });

  it('follows the page as it is made narrower and wider', () => {
    const browser = stageBrowser(false);
    const { result } = renderHook(() => usePitWallPhone());
    expect(result.current).toBe(false);

    // A phone turned upright, or a browser window dragged narrow.
    act(() => browser.resize(true));
    expect(result.current).toBe(true);

    act(() => browser.resize(false));
    expect(result.current).toBe(false);
  });

  it('stops listening when the page goes', () => {
    const browser = stageBrowser(false);
    const { unmount } = renderHook(() => usePitWallPhone());
    expect(browser.listeners.size).toBe(1);
    unmount();
    expect(browser.listeners.size).toBe(0);
  });

  it('is not a phone where there is no browser to ask', () => {
    // As in a spec's page, which has no matchMedia at all.
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    expect(renderHook(() => usePitWallPhone()).result.current).toBe(false);
  });
});
