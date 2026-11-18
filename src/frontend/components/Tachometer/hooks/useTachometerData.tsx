import { useDriverControlsSnapshot, useSessionStore } from '@irdashies/context';
import { usePlayerCar } from '@irdashies/domain/shiftLight/usePlayerCar';
import { useCarTachometerData } from './useCarTachometerData';

/**
 * Hook for tachometer-specific telemetry data.
 * Encapsulates all RPM and shift light logic with car-specific data integration.
 */
export const useTachometerData = () => {
  const snapshot = useDriverControlsSnapshot();
  const rpm = snapshot?.rpm ?? 0;
  const gear = snapshot?.gear ?? 1;
  const shiftGrindRpm = snapshot?.shiftGrindRpm ?? 0;
  // Absent, not 0, where the sim sends none: a car the user is not in.
  const oilTemp = snapshot?.oilTemp;
  const waterTemp = snapshot?.waterTemp;
  const engineWarnings = snapshot?.engineWarnings ?? 0;
  const { carData, gearRpmThresholds, hasCarData } = useCarTachometerData(gear);

  // Get car-specific redline from session data
  const driverCarRedLine = useSessionStore(
    (state) => state.session?.DriverInfo?.DriverCarRedLine
  );
  const { carPath, carModel } = usePlayerCar();

  // Use car-specific maximum RPM from multiple sources in order of preference
  const maxRpm =
    driverCarRedLine || // First preference: session data redline
    (shiftGrindRpm > 0 ? shiftGrindRpm : null) || // Second: telemetry shift grind RPM
    7500; // Conservative fallback for safety

  // iRacing shift-light thresholds projected from session data
  const shiftRpm = snapshot?.shiftRpm ?? 0; // Purple LEDs
  const blinkRpm = snapshot?.blinkRpm ?? 0; // Blinking LEDs

  return {
    rpm,
    gear,
    maxRpm,
    shiftRpm,
    blinkRpm,
    oilTemp,
    waterTemp,
    engineWarnings,
    // Car-specific data
    carData,
    gearRpmThresholds,
    hasCarData,
    carPath, // CarPath for custom shift points (matches lovely-car-data)
    carModel,
  };
};
