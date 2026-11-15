import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OverlayHiddenContext } from '@irdashies/context';
import { getWidgetDefaultConfig } from '@irdashies/types';
import { Input } from './Input';

const state = vi.hoisted(() => ({
  driving: false,
  watching: false,
  sessionVisible: true,
  mounts: 0,
  unmounts: 0,
  /** Whether the engine is at the shift flash threshold. */
  atShiftPoint: false,
  /** What the shift blink and the gear flash were last asked to do. */
  blinking: undefined as boolean | undefined,
  gearFlashing: undefined as boolean | undefined,
}));
vi.mock('@irdashies/context', async (original) => ({
  ...(await original<typeof import('@irdashies/context')>()),
  useDrivingState: () => ({
    isDriving: state.driving,
    isWatching: state.watching,
  }),
  useSessionVisibility: () => state.sessionVisible,
}));
vi.mock('./hooks/useInputSettings', async (original) => ({
  ...(await original<typeof import('./hooks/useInputSettings')>()),
  useInputSettings: () => undefined,
}));
vi.mock('./hooks/useInputs', async () => {
  const { useEffect } = await import('react');
  return {
    useInputs: () => {
      useEffect(() => {
        state.mounts++;
        return () => {
          state.unmounts++;
        };
      }, []);
      return {};
    },
  };
});
vi.mock('@irdashies/domain/shiftLight', () => ({
  useBlink: (active: boolean) => {
    state.blinking = active;
    return false;
  },
  useShiftFlashActive: () => state.atShiftPoint,
}));
vi.mock('./hooks/useGearFlash', () => ({
  useGearFlash: (_gear: number | undefined, enabled: boolean) => {
    state.gearFlashing = enabled;
    return undefined;
  },
}));
vi.mock('./InputContainer/InputContainer', () => ({
  InputContainer: () => <div>Inputs</div>,
}));

afterEach(() => {
  cleanup();
  state.driving = false;
  state.watching = false;
  state.sessionVisible = true;
  state.mounts = 0;
  state.unmounts = 0;
  state.atShiftPoint = false;
  state.blinking = undefined;
  state.gearFlashing = undefined;
  delete window.windowVisibilityBridge;
});

describe('Input high-frequency consumers', () => {
  it('mounts only when visible and releases subscriptions on hide', () => {
    const config = getWidgetDefaultConfig('input');
    const view = render(<Input {...config} />);
    expect(state.mounts).toBe(0);
    state.driving = true;
    view.rerender(<Input {...config} />);
    expect(state.mounts).toBe(1);
    state.driving = false;
    view.rerender(<Input {...config} />);
    expect(state.unmounts).toBe(1);
    state.driving = true;
    view.rerender(<Input {...config} />);
    expect(state.mounts).toBe(2);
    state.sessionVisible = false;
    view.rerender(<Input {...config} />);
    expect(state.unmounts).toBe(2);
  });

  it('stays unmounted while watching a car: the pedals are the user’s own', () => {
    // A team-mate's stint. The sim writes no pedals for a watched car that
    // the app reads yet, so watching does not count as on track here.
    state.watching = true;
    const view = render(<Input {...getWidgetDefaultConfig('input')} />);

    expect(state.mounts).toBe(0);
    expect(view.container.textContent).toBe('');
  });

  it('can remain active off-track when the configuration requests it', () => {
    render(
      <Input {...getWidgetDefaultConfig('input')} showOnlyWhenOnTrack={false} />
    );
    expect(state.mounts).toBe(1);
  });
});

describe('Input flashes while nothing it paints can be seen', () => {
  const flashing = {
    ...getWidgetDefaultConfig('input'),
    showOnlyWhenOnTrack: false,
    shiftFlash: { enabled: true, source: 'redline' as const, color: '#9333ea' },
    gearFlash: { enabled: true, upColor: '#22c55e', downColor: '#ef4444' },
  };
  const widget = (hidden: boolean) => (
    <OverlayHiddenContext.Provider value={hidden}>
      <Input {...flashing} />
    </OverlayHiddenContext.Provider>
  );

  it('runs the shift blink and the gear flash while the overlay is on screen', () => {
    state.atShiftPoint = true;
    render(widget(false));

    expect(state.blinking).toBe(true);
    expect(state.gearFlashing).toBe(true);
  });

  it('rests both timers while the overlay is hidden, and starts them again when it is back', () => {
    state.atShiftPoint = true;
    const view = render(widget(false));

    view.rerender(widget(true));
    // The widget stays mounted: only its two timers stop.
    expect(state.mounts).toBe(1);
    expect(state.unmounts).toBe(0);
    expect(state.blinking).toBe(false);
    expect(state.gearFlashing).toBe(false);

    view.rerender(widget(false));
    expect(state.blinking).toBe(true);
    expect(state.gearFlashing).toBe(true);
  });

  it('rests both while the window is hidden or minimised', () => {
    let notify: ((visible: boolean) => void) | undefined;
    window.windowVisibilityBridge = {
      onVisibilityChanged: (callback) => {
        notify = callback;
        return () => undefined;
      },
    };
    state.atShiftPoint = true;
    render(widget(false));
    expect(state.blinking).toBe(true);

    act(() => notify?.(false));
    expect(state.blinking).toBe(false);
    expect(state.gearFlashing).toBe(false);

    act(() => notify?.(true));
    expect(state.blinking).toBe(true);
    expect(state.gearFlashing).toBe(true);
  });

  it('leaves a flash that is switched off in the settings off', () => {
    state.atShiftPoint = true;
    render(
      <Input
        {...flashing}
        gearFlash={{ ...flashing.gearFlash, enabled: false }}
      />
    );

    expect(state.gearFlashing).toBe(false);
  });
});
