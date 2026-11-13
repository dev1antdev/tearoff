import type { OverlayVisibilityBridge } from '@irdashies/types';
import { ToggleSwitch } from './ToggleSwitch';
import { useOverlayVisibility } from './useOverlayVisibility';

interface OverlayPauseSettingProps {
  /** For stories and specs; the app uses the preload bridge. */
  bridge?: OverlayVisibilityBridge;
}

/**
 * The setting for taking the overlay off the screen while the game is
 * paused. Kept by the app, not by a profile: it is about the pause menu, not
 * about a layout.
 */
export const OverlayPauseSetting = ({ bridge }: OverlayPauseSettingProps) => {
  const { state, available, setHideWhenPaused } = useOverlayVisibility(bridge);
  if (!available) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h4
            id="hide-overlay-when-paused-label"
            className="text-md font-medium text-slate-200"
          >
            Hide Overlay While the Game Is Paused
          </h4>
          <p className="text-sm text-slate-400">
            Takes every overlay off the screen while the pause menu is open and
            brings it back when you resume, within about a second. Works in Le
            Mans Ultimate; iRacing does not report a pause.
          </p>
        </div>
        <ToggleSwitch
          enabled={state?.hideWhenPaused ?? true}
          onToggle={setHideWhenPaused}
          disabled={state === null}
          ariaLabelledBy="hide-overlay-when-paused-label"
        />
      </div>
    </div>
  );
};
