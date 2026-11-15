import { useTachometerData } from './hooks/useTachometerData';
import { useShiftLightSettings } from './hooks/useShiftLightSettings';
import { ShiftLight as ShiftLightComponent } from './ShiftLightComponent/ShiftLightComponent';
import {
  useDrivingState,
  useSessionVisibility,
  useWatchingOwnCarTelemetry,
} from '@irdashies/context';

/**
 * The shift lights of the user's own car: at the wheel, or with a team-mate
 * driving it where the sim sends that car's revs. With the camera on another
 * car the revs on hand are still the own car's, and the lights stay dark.
 */
export const ShiftLight = () => {
  const tachometerData = useTachometerData();
  const settings = useShiftLightSettings();

  const { isDriving, isWatchingOtherCar } = useDrivingState();
  const isWatchingOwnCarTelemetry = useWatchingOwnCarTelemetry();

  const sessionVisible = useSessionVisibility(settings?.sessionVisibility);
  if (!sessionVisible) return <></>;

  // Show only when on track setting
  if (
    settings?.showOnlyWhenOnTrack &&
    !(isDriving || isWatchingOwnCarTelemetry)
  ) {
    return <></>;
  }

  return (
    <ShiftLightComponent
      rpm={isWatchingOtherCar ? 0 : tachometerData.rpm}
      gear={tachometerData.gear}
      gearCount={tachometerData.gearCount}
      throttle={tachometerData.throttle}
      brake={tachometerData.brake}
      maxRpm={tachometerData.maxRpm}
      shiftRpm={tachometerData.shiftRpm}
      showRpmText={settings?.showRpmText ?? true}
      carData={tachometerData.carData}
      carPath={tachometerData.carPath}
      carModel={tachometerData.carModel}
      shiftPointSettings={settings?.shiftPointSettings}
      opacity={settings?.background.opacity}
    />
  );
};
