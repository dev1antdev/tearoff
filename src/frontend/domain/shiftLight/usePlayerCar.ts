import { useMemo } from 'react';
import { useActiveSimulatorStatus, useSessionStore } from '@irdashies/context';
import { loadCarData } from '@irdashies/utils/carData';

/**
 * The car the user is driving, as the car settings and the bundled car data
 * know it.
 *
 * `carId` is the key its settings are saved under: the model where the sim
 * names one, otherwise the bundled id, otherwise the path. The bundled data is
 * iRacing's, and LMU's CarPath is a livery's file, which can read like an
 * iRacing car. So the path counts only once the running sim is known not to be
 * LMU, and an LMU car whose model has not arrived yet has no key at all.
 */
export const usePlayerCar = (enabled = true) => {
  const { simulator, loaded } = useActiveSimulatorStatus();
  const driver = useSessionStore((state) => {
    const info = state.session?.DriverInfo;
    return info?.Drivers?.find((d) => d.CarIdx === info.DriverCarIdx);
  });
  const carModel = driver?.CarModel || undefined;
  const carPath = loaded && simulator !== 'lmu' ? driver?.CarPath : undefined;
  const carData = useMemo(
    () => (enabled && carPath && !carModel ? loadCarData(carPath) : null),
    [enabled, carPath, carModel]
  );
  return {
    carModel,
    carPath,
    carData,
    carId: carModel || carData?.carId || carPath,
  };
};
