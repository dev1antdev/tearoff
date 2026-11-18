import { useSessionStore } from '@irdashies/context';
import { getRedlineFlashRpm } from '@irdashies/domain/shiftLight/shiftLight';
import { usePlayerCar } from '@irdashies/domain/shiftLight/usePlayerCar';
import type { ShiftPointSettings } from '@irdashies/types';

export const DEFAULT_SHIFT_RPM_RATIO = 0.9;

export interface CurrentCar {
  /** The key the widgets find this car's settings by. */
  carId: string;
  carName: string;
  /** The sim names this car by model, so no car list can offer it. */
  namedByModel: boolean;
  redlineRpm: number;
  gearCount: number;
  /** Where the sim's shift lights start; 0 when it states none. */
  firstLedRpm: number;
  shiftRpm: number;
  blinkRpm: number;
}

/**
 * The car being driven, with what the session holds about it: the rev limit,
 * the gear count and the shift-light thresholds the bridge settled on.
 */
export const useCurrentCar = (): CurrentCar | undefined => {
  const { carModel, carData, carId } = usePlayerCar();
  const info = useSessionStore((state) => state.session?.DriverInfo);
  if (!carId) return undefined;
  const redlineRpm = info?.DriverCarRedLine || 8000;
  return {
    carId,
    carName: carModel || carData?.carName || carId,
    namedByModel: !!carModel,
    redlineRpm,
    gearCount: info?.DriverCarGearNumForward || 6,
    firstLedRpm: info?.DriverCarSLFirstRPM ?? 0,
    shiftRpm:
      info?.DriverCarSLShiftRPM ||
      Math.round(redlineRpm * DEFAULT_SHIFT_RPM_RATIO),
    blinkRpm: getRedlineFlashRpm(
      redlineRpm,
      info?.DriverCarSLBlinkRPM ?? 0,
      undefined
    ),
  };
};

/** A custom shift point entry for that car: its shift point in every gear. */
export const currentCarShiftPoints = (
  car: CurrentCar
): ShiftPointSettings['carConfigs'][string] => {
  const gearShiftPoints: Record<string, { shiftRpm: number }> = {};
  for (let i = 1; i <= car.gearCount; i++) {
    gearShiftPoints[i.toString()] = { shiftRpm: car.shiftRpm };
  }
  return {
    enabled: true,
    carId: car.carId,
    carName: car.carName,
    gearCount: car.gearCount,
    redlineRpm: car.redlineRpm,
    gearShiftPoints,
  };
};
