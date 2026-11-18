import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  useDashboard,
  useChannelSelector,
  useSessionStore,
} from '@irdashies/context';
import { getGearKey, loadCarData } from '@irdashies/utils/carData';
import type {
  DriverControlsSnapshot,
  TachometerConfig,
} from '@irdashies/types';
import {
  getCustomShiftRpm,
  getLedRpmOverride,
  getRedlineFlashRpm,
  getShiftFlashRpm,
  isShiftFlashActive,
  type ShiftFlashSource,
} from './shiftLight';

const FALLBACK_REDLINE_RPM = 7500;

/** The Tachometer settings own custom shift points and LED thresholds. */
const useTachometerConfig = (): Partial<TachometerConfig> | undefined => {
  const { currentDashboard } = useDashboard();
  return currentDashboard?.widgets.find((w) => w.id === 'tachometer')
    ?.config as Partial<TachometerConfig> | undefined;
};

/**
 * True while the player's RPM is at or above the flash threshold: the
 * Tachometer's flash point for this car, or its custom shift point for this
 * car and gear.
 */
export const useShiftFlashActive = (
  enabled: boolean,
  source: ShiftFlashSource
): boolean => {
  const config = useTachometerConfig();
  const shiftPointSettings = config?.shiftPointSettings;
  const ledRpmOverrides = config?.ledRpmOverrides;
  const driverCarRedLine = useSessionStore(
    (state) => state.session?.DriverInfo?.DriverCarRedLine
  );
  const driver = useSessionStore((state) => {
    const idx = state.session?.DriverInfo?.DriverCarIdx;
    if (idx === undefined) return undefined;
    return state.session?.DriverInfo?.Drivers?.find((d) => d.CarIdx === idx);
  });
  const carPath = driver?.CarPath;
  // Where the sim names the car by model (LMU) that is its key, and the
  // bundled car data, which is iRacing's, does not describe it.
  const carModel = driver?.CarModel;
  const carData = useMemo(
    () => (enabled && carPath && !carModel ? loadCarData(carPath) : null),
    [enabled, carPath, carModel]
  );
  const carId = carModel || carData?.carId || carPath;

  const selectActive = useCallback(
    (snapshot: DriverControlsSnapshot) => {
      const rpm = snapshot.rpm ?? 0;
      const gear = snapshot.gear ?? 0;
      const shiftGrindRpm = snapshot.shiftGrindRpm ?? 0;
      const maxRpm =
        driverCarRedLine ||
        (shiftGrindRpm > 0 ? shiftGrindRpm : null) ||
        FALLBACK_REDLINE_RPM;
      const gearRedlineRpm = carData?.ledRpm?.[0]?.[getGearKey(gear)]?.[0];

      const threshold = getShiftFlashRpm(
        source,
        getCustomShiftRpm(shiftPointSettings, carId, gear),
        getLedRpmOverride(ledRpmOverrides, carId)?.blinkRpm ??
          getRedlineFlashRpm(maxRpm, snapshot.blinkRpm ?? 0, gearRedlineRpm)
      );

      return isShiftFlashActive(rpm, threshold);
    },
    [
      source,
      shiftPointSettings,
      ledRpmOverrides,
      carData,
      carId,
      driverCarRedLine,
    ]
  );
  return (
    useChannelSelector('driver-controls.snapshot', selectActive, { enabled }) ??
    false
  );
};

/**
 * Toggles every intervalMs while active, starting in the on state so the
 * first flash is immediate. False when inactive.
 */
export const useBlink = (active: boolean, intervalMs = 200): boolean => {
  const [off, setOff] = useState(false);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setOff((prev) => !prev), intervalMs);
    return () => {
      clearInterval(id);
      setOff(false);
    };
  }, [active, intervalMs]);

  return active && !off;
};
