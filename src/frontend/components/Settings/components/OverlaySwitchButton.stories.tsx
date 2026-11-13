import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type {
  OverlayVisibilityBridge,
  OverlayVisibilityState,
} from '@irdashies/types';
import { OverlaySwitchButton } from './OverlaySwitchButton';
import { OverlayPauseSetting } from './OverlayPauseSetting';

/**
 * A stand-in for the main process: holds the state, applies the two changes
 * the window can ask for, and tells its subscribers, as the real one does.
 */
const createBridge = (
  initial: Partial<OverlayVisibilityState>
): OverlayVisibilityBridge => {
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
  return {
    getState: () => Promise.resolve(state),
    setUserHidden: (userHidden) => Promise.resolve(apply({ userHidden })),
    setHideWhenPaused: (hideWhenPaused) =>
      Promise.resolve(apply({ hideWhenPaused })),
    onChanged: (callback) => {
      listeners.add(callback);
      callback(state);
      return () => {
        listeners.delete(callback);
      };
    },
  };
};

interface HeaderControlsProps {
  state: Partial<OverlayVisibilityState>;
}

/** The switch as it sits in the settings header, with the setting under it. */
const HeaderControls = ({ state }: HeaderControlsProps) => {
  // Made once: the switch and the setting share it, as they share the main
  // process, and a new one each render would undo every click.
  const [bridge] = useState(() => createBridge(state));
  return (
    <div className="w-[560px] space-y-6 bg-slate-900 p-4 text-slate-200">
      <div className="flex justify-end gap-2 border-b border-slate-700 pb-3">
        <OverlaySwitchButton accelerator="Alt+H" bridge={bridge} />
      </div>
      <section className="space-y-6 rounded-lg border border-slate-700 bg-slate-800/40 p-4">
        <OverlayPauseSetting bridge={bridge} />
      </section>
    </div>
  );
};

const meta: Meta<typeof HeaderControls> = {
  component: HeaderControls,
  title: 'settings/OverlaySwitch',
};
export default meta;

type Story = StoryObj<typeof HeaderControls>;

/** The overlay is on: the usual state. */
export const On: Story = { args: { state: {} } };

/** Turned off by the driver, from here, the tray or the shortcut. */
export const Off: Story = { args: { state: { userHidden: true } } };

/** On, but off the screen while the game is paused. */
export const HiddenWhilePaused: Story = {
  args: { state: { gamePaused: true, hidden: true } },
};

/** The game is paused and the setting is off, so the overlay stays up. */
export const PauseSettingOff: Story = {
  args: { state: { gamePaused: true, hideWhenPaused: false } },
};
