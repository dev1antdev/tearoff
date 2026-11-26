import { usePlayerCar } from '@irdashies/domain/shiftLight/usePlayerCar';
import { getGearKey } from '@irdashies/utils/carData';

/**
 * Hook for car-specific tachometer data from lovely-car-data
 */
export const useCarTachometerData = (gear = 0) => {
  const { carData } = usePlayerCar();

  // Get gear-specific RPM thresholds
  const getGearRpmThresholds = (): number[] | null => {
    if (!carData?.ledRpm?.[0]) return null;

    const gearKey = getGearKey(gear);
    const gearData = carData.ledRpm[0][gearKey];

    return gearData || null;
  };

  return {
    carData,
    gearRpmThresholds: getGearRpmThresholds(),
    hasCarData: !!carData,
  };
};
