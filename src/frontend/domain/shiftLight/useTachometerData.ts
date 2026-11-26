import { useDriverControlsSnapshot, useSessionStore } from '@irdashies/context';
import { useCarTachometerData } from './useCarTachometerData';
import { usePlayerCar } from './usePlayerCar';

/**
 * What the Tachometer and the Shift Light read: the engine's revs and gear,
 * the car's redline and shift thresholds, and the car itself for its bundled
 * data and its shift points.
 *
 * One hook, because both widgets read the same numbers from the same
 * channels; where one needs more (the Shift Light's pedals and gear count),
 * the extra is here rather than in a copy that would drift.
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
  // Pedal positions, not the sim's processed values: an automatic blip on a
  // downshift moves the processed throttle without the driver touching it.
  const throttle = snapshot?.throttleRaw ?? snapshot?.throttle ?? 0;
  const brake = snapshot?.brakeRaw ?? snapshot?.brake ?? 0;
  const { carData, gearRpmThresholds, hasCarData } = useCarTachometerData(gear);

  // Get car-specific redline from session data
  const driverCarRedLine = useSessionStore(
    (state) => state.session?.DriverInfo?.DriverCarRedLine
  );
  const gearCount = useSessionStore(
    (state) => state.session?.DriverInfo?.DriverCarGearNumForward ?? 0
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
    gearCount,
    throttle,
    brake,
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
