import { describe, expect, it, vi } from 'vitest';
import { createOverlayVisibility } from './overlayVisibility';

describe('overlay visibility', () => {
  it('starts shown, with the stored pause setting', () => {
    expect(
      createOverlayVisibility({ hideWhenPaused: true }).getState()
    ).toEqual({
      userHidden: false,
      gamePaused: false,
      hideWhenPaused: true,
      hidden: false,
    });
    expect(
      createOverlayVisibility({ hideWhenPaused: false }).getState()
        .hideWhenPaused
    ).toBe(false);
  });

  it('is hidden by the driver, and shown again', () => {
    const visibility = createOverlayVisibility({ hideWhenPaused: true });

    visibility.setUserHidden(true);
    expect(visibility.getState()).toMatchObject({
      userHidden: true,
      hidden: true,
    });

    visibility.toggleUserHidden();
    expect(visibility.getState()).toMatchObject({
      userHidden: false,
      hidden: false,
    });
    visibility.toggleUserHidden();
    expect(visibility.getState().hidden).toBe(true);
  });

  it('is hidden by a paused game only when the setting says so', () => {
    const visibility = createOverlayVisibility({ hideWhenPaused: true });

    visibility.setGamePaused(true);
    expect(visibility.getState()).toMatchObject({
      gamePaused: true,
      hidden: true,
    });

    // Turning the setting off mid-pause brings the overlay straight back.
    visibility.setHideWhenPaused(false);
    expect(visibility.getState()).toMatchObject({
      gamePaused: true,
      hideWhenPaused: false,
      hidden: false,
    });

    visibility.setHideWhenPaused(true);
    expect(visibility.getState().hidden).toBe(true);
    visibility.setGamePaused(false);
    expect(visibility.getState().hidden).toBe(false);
  });

  it('stays hidden by the driver through a pause and after it', () => {
    const visibility = createOverlayVisibility({ hideWhenPaused: true });
    visibility.setUserHidden(true);

    visibility.setGamePaused(true);
    visibility.setGamePaused(false);

    // Resuming the game does not turn back on what the driver turned off.
    expect(visibility.getState()).toMatchObject({
      userHidden: true,
      hidden: true,
    });
  });

  it('tells its listeners of each change, and only of changes', () => {
    const visibility = createOverlayVisibility({ hideWhenPaused: true });
    const listener = vi.fn();
    const unsubscribe = visibility.onChange(listener);

    visibility.setGamePaused(false);
    visibility.setUserHidden(false);
    visibility.setHideWhenPaused(true);
    expect(listener).not.toHaveBeenCalled();

    visibility.setGamePaused(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith({
      userHidden: false,
      gamePaused: true,
      hideWhenPaused: true,
      hidden: true,
    });

    unsubscribe();
    visibility.setGamePaused(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps telling the rest when one listener throws', () => {
    const logError = vi.fn();
    const visibility = createOverlayVisibility({
      hideWhenPaused: true,
      logError,
    });
    const second = vi.fn();
    visibility.onChange(() => {
      throw new Error('broken window');
    });
    visibility.onChange(second);

    visibility.setUserHidden(true);

    expect(second).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledTimes(1);
  });
});
