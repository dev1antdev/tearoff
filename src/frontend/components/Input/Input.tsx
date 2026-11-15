import { memo } from 'react';
import { InputContainer } from './InputContainer/InputContainer';
import { isInputConfig, useInputSettings } from './hooks/useInputSettings';
import { useGearFlash } from './hooks/useGearFlash';
import { useInputs } from './hooks/useInputs';
import { EMPTY_INPUTS } from './hooks/inputSelection';
import {
  useDrivingState,
  usePaintingPaused,
  useSessionVisibility,
  useWatchingOwnCarTelemetry,
} from '@irdashies/context';
import { useBlink, useShiftFlashActive } from '@irdashies/domain/shiftLight';
import type { InputConfig } from '@irdashies/types';

type InputWidgetProps = Partial<InputConfig>;

interface VisibleInputProps {
  settings: InputConfig;
  /** Draw no reading: the pedals on hand are not those of the car on screen. */
  blank: boolean;
}

/**
 * Pick the effective config and render the widget only while it is visible.
 *
 * On track is at the wheel, or watching the user's own car with a team-mate
 * driving it where the sim sends that car's pedals: they are the team-mate's
 * then, as the car received them. With the camera on another car the pedals
 * on hand are still the own car's, and the widget draws none.
 */
export const Input = (props: InputWidgetProps) => {
  // Each instance gets its own config as props. Storybook passes none.
  const dashboardSettings = useInputSettings();
  const settings = isInputConfig(props) ? props : dashboardSettings;
  const { isDriving, isWatchingOtherCar } = useDrivingState();
  const isWatchingOwnCarTelemetry = useWatchingOwnCarTelemetry();
  const sessionVisible = useSessionVisibility(settings?.sessionVisibility);
  if (
    !settings ||
    !sessionVisible ||
    (settings.showOnlyWhenOnTrack && !(isDriving || isWatchingOwnCarTelemetry))
  )
    return null;
  return <VisibleInput settings={settings} blank={isWatchingOtherCar} />;
};

/** Unmount high-frequency consumers while the parent tracks visibility. */
const VisibleInput = memo(({ settings, blank }: VisibleInputProps) => {
  const liveInputs = useInputs(settings);
  const inputs = blank ? EMPTY_INPUTS : liveInputs;
  const { shiftFlash, gearFlash } = settings;
  // The two flashes run on timers of their own. Neither runs while the
  // widget cannot be seen: the overlay hidden, or its window.
  const paintingPaused = usePaintingPaused();
  const flashActive = useShiftFlashActive(
    !!shiftFlash?.enabled,
    shiftFlash?.source ?? 'redline'
  );
  const flashOn = useBlink(flashActive && !paintingPaused);
  // Off rather than frozen: the hook goes on following the gear, so a shift
  // made unseen does not flash when the widget is back.
  const gearFlashColor = useGearFlash(
    inputs.gear,
    !!gearFlash?.enabled && !paintingPaused,
    gearFlash?.upColor ?? '#22c55e',
    gearFlash?.downColor ?? '#ef4444'
  );

  return (
    <div className="h-full flex flex-col">
      <InputContainer
        {...inputs}
        settings={settings}
        flashColor={flashOn ? shiftFlash?.color : undefined}
        gearFlashColor={gearFlashColor}
      />
    </div>
  );
});
VisibleInput.displayName = 'VisibleInput';
