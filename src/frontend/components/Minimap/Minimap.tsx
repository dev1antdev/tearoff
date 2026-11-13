import { useMemo } from 'react';
import {
  useActiveSimulator,
  useDrivingState,
  useGeneralSettings,
  useMinimapSnapshot,
  useSessionDrivers,
  useSessionStore,
  useSessionVisibility,
} from '@irdashies/context';
import { useSessionTrackGeometry } from '@irdashies/domain/track';
import { colorNumToHex } from '@irdashies/utils/colors';
import { useMinimapSettings } from './hooks/useMinimapSettings';
import { MinimapCanvas, type MinimapCar } from './MinimapCanvas';
import { NEUTRAL_MARKER, markerLabel, textColorOn } from './minimapModel';

/** Ring round the focus car when no highlight colour is set. */
const DEFAULT_FOCUS_COLOR = '#fbbf24';
/**
 * The focus car is always white inside its ring. Filled with its class colour
 * it disappears among team-mates, and a highlight colour close to that class
 * colour would leave the ring invisible as well.
 */
const FOCUS_FILL = '#ffffff';
const NO_CARS: readonly MinimapCar[] = [];

/**
 * A close-range map: the stretch of track around the car being watched, with
 * every car on it.
 *
 * Cars are placed along the track by how far round the lap they are, the same
 * way the full track map places them, so a car in the pit lane is drawn on the
 * road beside it.
 */
export const Minimap = () => {
  const settings = useMinimapSettings();
  const generalSettings = useGeneralSettings();
  const { isDriving } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);
  const visible =
    isSessionVisible && !(settings.showOnlyWhenOnTrack && !isDriving);

  const snapshot = useMinimapSnapshot(visible);
  const { geometry } = useSessionTrackGeometry(visible);
  const drivers = useSessionDrivers();
  const paceCarIdx =
    useSessionStore((state) => state.session?.DriverInfo?.PaceCarIdx) ?? -1;
  const simulator = useActiveSimulator();

  const cars = useMemo(() => {
    if (!snapshot || !drivers) return NO_CARS;
    const out: MinimapCar[] = [];
    for (const driver of drivers) {
      const carIdx = driver.CarIdx;
      if (driver.CarIsPaceCar || driver.IsSpectator || carIdx === paceCarIdx) {
        continue;
      }
      const progress = snapshot.carIdxLapDistPct[carIdx];
      if (progress === undefined || progress < 0) continue;
      const isFocus = carIdx === snapshot.focusCarIdx;
      const fill = isFocus
        ? FOCUS_FILL
        : ((settings.useClassColors
            ? colorNumToHex(driver.CarClassColor)
            : undefined) ?? NEUTRAL_MARKER);
      out.push({
        progress,
        driver: { CarIdx: carIdx },
        fill,
        textColor: textColorOn(fill),
        label: markerLabel(settings.label, {
          position: snapshot.carIdxPosition[carIdx],
          classPosition: snapshot.carIdxClassPosition[carIdx],
          carNumber: driver.CarNumber,
        }),
        isFocus,
        inPits: snapshot.carIdxOnPitRoad[carIdx] === true,
      });
    }
    return out;
  }, [snapshot, drivers, paceCarIdx, settings.useClassColors, settings.label]);

  if (!visible) return <></>;

  return (
    <div className="h-full w-full">
      <MinimapCanvas
        geometry={geometry}
        cars={cars}
        range={settings.range}
        orientation={settings.orientation}
        markerSize={settings.markerSize}
        trackWidth={settings.trackWidth}
        showStartFinish={settings.showStartFinish}
        dimCarsInPits={settings.dimCarsInPits}
        backgroundOpacity={settings.background.opacity}
        focusColor={
          colorNumToHex(generalSettings?.highlightColor) ?? DEFAULT_FOCUS_COLOR
        }
        emptyMessage={
          simulator === 'lmu'
            ? 'No map yet: drive one full lap'
            : 'No map for this track'
        }
      />
    </div>
  );
};
