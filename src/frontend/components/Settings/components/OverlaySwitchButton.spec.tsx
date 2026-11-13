import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type {
  OverlayVisibilityBridge,
  OverlayVisibilityState,
} from '@irdashies/types';
import { OverlaySwitchButton } from './OverlaySwitchButton';
import { OverlayPauseSetting } from './OverlayPauseSetting';

/** The main process, as far as the window can tell. */
const createBridge = (initial: Partial<OverlayVisibilityState> = {}) => {
  let state: OverlayVisibilityState = {
    userHidden: false,
    gamePaused: false,
    hideWhenPaused: true,
    hidden: false,
    ...initial,
  };
  const listeners = new Set<(next: OverlayVisibilityState) => void>();
  const apply = (change: Partial<OverlayVisibilityState>) => {
    const next = { ...state, ...change };
    state = {
      ...next,
      hidden: next.userHidden || (next.hideWhenPaused && next.gamePaused),
    };
    listeners.forEach((listener) => listener(state));
    return state;
  };
  const bridge: OverlayVisibilityBridge = {
    getState: vi.fn(() => Promise.resolve(state)),
    setUserHidden: vi.fn((userHidden: boolean) =>
      Promise.resolve(apply({ userHidden }))
    ),
    setHideWhenPaused: vi.fn((hideWhenPaused: boolean) =>
      Promise.resolve(apply({ hideWhenPaused }))
    ),
    onChanged: vi.fn((callback) => {
      listeners.add(callback);
      callback(state);
      return () => {
        listeners.delete(callback);
      };
    }),
  };
  return { bridge, apply, listeners: () => listeners.size };
};

describe('OverlaySwitchButton', () => {
  it('shows the overlay as on and turns it off when pressed', async () => {
    const { bridge } = createBridge();
    render(<OverlaySwitchButton accelerator="Alt+H" bridge={bridge} />);

    const button = screen.getByRole('button', { name: 'Overlay' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveTextContent('Overlay');
    expect(button).toHaveTextContent('Alt+H');

    await act(async () => {
      fireEvent.click(button);
    });

    expect(bridge.setUserHidden).toHaveBeenCalledWith(true);
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveTextContent('Overlay Off');
  });

  it('turns the overlay back on from off', async () => {
    const { bridge } = createBridge({ userHidden: true, hidden: true });
    render(<OverlaySwitchButton bridge={bridge} />);

    const button = screen.getByRole('button', { name: 'Overlay' });
    expect(button).toHaveAttribute('aria-pressed', 'false');

    await act(async () => {
      fireEvent.click(button);
    });

    expect(bridge.setUserHidden).toHaveBeenCalledWith(false);
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('follows a change made elsewhere, by the shortcut or the tray', () => {
    const { bridge, apply } = createBridge();
    render(<OverlaySwitchButton bridge={bridge} />);
    const button = screen.getByRole('button', { name: 'Overlay' });

    act(() => {
      apply({ userHidden: true });
    });

    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveTextContent('Overlay Off');
  });

  it('says so when a paused game has the overlay off the screen', () => {
    const { bridge } = createBridge({ gamePaused: true, hidden: true });
    render(<OverlaySwitchButton bridge={bridge} />);

    const button = screen.getByRole('button', { name: 'Overlay' });
    // Still on: resuming brings it back without the driver doing anything.
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveTextContent('Overlay Paused');
    expect(button.title).toContain('paused');
  });

  it('is not drawn where there is no overlay to switch', () => {
    const { container } = render(<OverlaySwitchButton bridge={undefined} />);

    // The browser view has no preload bridge.
    expect(container).toBeEmptyDOMElement();
  });

  it('stops listening when it goes away', () => {
    const { bridge, listeners } = createBridge();
    const { unmount } = render(<OverlaySwitchButton bridge={bridge} />);
    expect(listeners()).toBe(1);

    unmount();

    expect(listeners()).toBe(0);
  });
});

describe('OverlayPauseSetting', () => {
  it('shows the setting and changes it', async () => {
    const { bridge } = createBridge();
    render(<OverlayPauseSetting bridge={bridge} />);

    const toggle = screen.getByRole('switch', {
      name: 'Hide Overlay While the Game Is Paused',
    });
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(bridge.setHideWhenPaused).toHaveBeenCalledWith(false);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('says which sim it works in', () => {
    const { bridge } = createBridge();
    render(<OverlayPauseSetting bridge={bridge} />);

    expect(
      screen.getByText(/Works in Le\s+Mans Ultimate; iRacing does not report/)
    ).toBeInTheDocument();
  });

  it('is not drawn where there is no overlay', () => {
    const { container } = render(<OverlayPauseSetting bridge={undefined} />);

    expect(container).toBeEmptyDOMElement();
  });
});
