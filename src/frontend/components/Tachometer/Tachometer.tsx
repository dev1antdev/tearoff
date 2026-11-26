import { useTachometerData } from '@irdashies/domain/shiftLight/useTachometerData';
import { useTachometerSettings } from './hooks/useTachometerSettings';
import { Tachometer as TachometerComponent } from './TachometerComponent/TachometerComponent';
import {
  useDrivingState,
  useSessionVisibility,
  useWatchingOwnCarTelemetry,
} from '@irdashies/context';

/**
 * The revs of the user's own car: at the wheel, or with a team-mate driving it
 * where the sim sends that car's revs. With the camera on another car the
 * figures on hand are still the own car's, so the LEDs stay dark and the
 * temperatures are left out.
 */
export const Tachometer = () => {
  const tachometerData = useTachometerData();
  const settings = useTachometerSettings();

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

  const { oilTemp, waterTemp } = tachometerData;

  return (
    <TachometerComponent
      rpm={isWatchingOtherCar ? 0 : tachometerData.rpm}
      gear={tachometerData.gear}
      maxRpm={tachometerData.maxRpm}
      shiftRpm={tachometerData.shiftRpm}
      blinkRpm={tachometerData.blinkRpm}
      showRpmText={settings?.showRpmText ?? false}
      rpmOrientation={settings?.rpmOrientation ?? 'bottom'}
      gearRpmThresholds={tachometerData.gearRpmThresholds}
      ledColors={tachometerData.carData?.ledColor}
      carData={tachometerData.carData}
      carPath={tachometerData.carPath}
      carModel={tachometerData.carModel}
      shiftPointSettings={settings?.shiftPointSettings}
      ledRpmOverrides={settings?.ledRpmOverrides}
      opacity={settings?.background.opacity}
      showOilTemp={
        (settings?.oilTemp?.enabled ?? true) &&
        !isWatchingOtherCar &&
        oilTemp !== undefined
      }
      showWaterTemp={
        (settings?.waterTemp?.enabled ?? true) &&
        !isWatchingOtherCar &&
        waterTemp !== undefined
      }
      oilTempPosition={settings?.oilTemp?.position ?? 'top'}
      waterTempPosition={settings?.waterTemp?.position ?? 'top'}
      swapTempSides={settings?.tempLayout?.swapSides ?? false}
      oilEdgeOffset={settings?.oilTemp?.edgeOffset ?? 0}
      waterEdgeOffset={settings?.waterTemp?.edgeOffset ?? 0}
      oilTemp={oilTemp}
      waterTemp={waterTemp}
      engineWarnings={tachometerData.engineWarnings}
    />
  );
};
