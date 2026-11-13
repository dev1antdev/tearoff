import { EyeIcon, EyeSlashIcon, PauseIcon } from '@phosphor-icons/react';
import type { OverlayVisibilityBridge } from '@irdashies/types';
import { useOverlayVisibility } from './useOverlayVisibility';

interface OverlaySwitchButtonProps {
  /** The Hide / Show UI shortcut, shown beside the label when there is one. */
  accelerator?: string;
  /** For stories and specs; the app uses the preload bridge. */
  bridge?: OverlayVisibilityBridge;
}

/**
 * The overlay's on/off switch, in the settings window's header.
 *
 * It turns every overlay window off and back on without touching which
 * widgets are enabled, the same thing the Hide / Show UI shortcut and the tray
 * do, and it follows them when they are used instead. A paused game can have
 * the overlay off the screen while this is still on; the button says so, so
 * an empty screen is never unexplained.
 */
export const OverlaySwitchButton = ({
  accelerator,
  bridge,
}: OverlaySwitchButtonProps) => {
  const { state, available, setUserHidden } = useOverlayVisibility(bridge);
  // Outside the desktop app, and before the first answer, there is nothing
  // true to show.
  if (!available || !state) return null;

  const on = !state.userHidden;
  const pausedAway = on && state.hidden;
  const Icon = !on ? EyeSlashIcon : pausedAway ? PauseIcon : EyeIcon;
  const label = !on ? 'Overlay Off' : pausedAway ? 'Overlay Paused' : 'Overlay';
  const shortcut = accelerator ? ` (${accelerator})` : '';
  const title = !on
    ? `The overlay is off. Turn it on${shortcut}`
    : pausedAway
      ? `Hidden while the game is paused. Turn the overlay off${shortcut}`
      : `The overlay is on. Turn it off${shortcut}`;

  return (
    <button
      type="button"
      onClick={() => setUserHidden(on)}
      aria-label="Overlay"
      aria-pressed={on}
      title={title}
      className={`flex min-h-8 items-center gap-2 rounded-md border bg-slate-800 px-2 py-1 text-sm font-semibold transition-colors hover:border-accent-400 lg:px-3 ${
        on ? 'border-settings-boundary' : 'border-amber-400/70 text-amber-300'
      }`}
    >
      <Icon size={16} weight="bold" />
      <span className="hidden lg:inline">{label}</span>
      {accelerator && (
        <kbd className="ml-1 hidden rounded bg-black/20 px-1 text-xs lg:inline">
          {accelerator}
        </kbd>
      )}
    </button>
  );
};
