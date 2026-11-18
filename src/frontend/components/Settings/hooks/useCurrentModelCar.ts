import { useSessionStore } from '@irdashies/context';
import type { ShiftPointSettings } from '@irdashies/types';

export const DEFAULT_SHIFT_RPM_RATIO = 0.9;

export interface CurrentModelCar {
  carId: string;
  redlineRpm: number;
  gearCount: number;
  shiftRpm: number;
}

/**
 * The car being driven, when the sim names it by model.
 *
 * The car list comes from the bundled iRacing car data, so an LMU car can
 * never be picked from it. LMU sets CarModel, which is also the key the widgets
 * look custom shift points up by there (see useTachometerData), and the
 * session already holds what a new entry needs: the rev limit, the gear count
 * and the shift point the bridge settled on for that car.
 */
export const useCurrentModelCar = (): CurrentModelCar | undefined => {
  const carId = useSessionStore((state) => {
    const info = state.session?.DriverInfo;
    return info?.Drivers?.find((d) => d.CarIdx === info.DriverCarIdx)?.CarModel;
  });
  const redlineRpm = useSessionStore(
    (state) => state.session?.DriverInfo?.DriverCarRedLine
  );
  const gearCount = useSessionStore(
    (state) => state.session?.DriverInfo?.DriverCarGearNumForward
  );
  const shiftRpm = useSessionStore(
    (state) => state.session?.DriverInfo?.DriverCarSLShiftRPM
  );
  if (!carId) return undefined;
  const redline = redlineRpm || 8000;
  return {
    carId,
    redlineRpm: redline,
    gearCount: gearCount || 6,
    shiftRpm: shiftRpm || Math.round(redline * DEFAULT_SHIFT_RPM_RATIO),
  };
};

/** A custom shift point entry for that car: its shift point in every gear. */
export const currentModelCarConfig = (
  car: CurrentModelCar
): ShiftPointSettings['carConfigs'][string] => {
  const gearShiftPoints: Record<string, { shiftRpm: number }> = {};
  for (let i = 1; i <= car.gearCount; i++) {
    gearShiftPoints[i.toString()] = { shiftRpm: car.shiftRpm };
  }
  return {
    enabled: true,
    carId: car.carId,
    carName: car.carId,
    gearCount: car.gearCount,
    redlineRpm: car.redlineRpm,
    gearShiftPoints,
  };
};
