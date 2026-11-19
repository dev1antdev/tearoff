import { useEffect, useState } from 'react';
import type { CarData } from '../../../utils/carData';
import type { ShiftPointSettings, TachometerConfig } from '@irdashies/types';
import { EngineWarnings } from '@irdashies/types';
import { getLedRpmOverride } from '@irdashies/domain/shiftLight/shiftLight';

/** The palette's dark neutral, for a light that is off. */
const UNLIT_COLOR = 'var(--color-slate-800)';
/** A unit or label beside a value: smaller, grey, spaced capitals. */
const UNIT_CLASS = 'text-[0.6em] font-semibold tracking-wider text-slate-400';

export interface TachometerProps {
  rpm: number;
  maxRpm: number;
  engineWarnings?: number;
  /** Current gear */
  gear?: number;
  /** RPM when LEDs should turn purple (shift point) */
  shiftRpm?: number;
  /** RPM when LEDs should start blinking */
  blinkRpm?: number;
  /** Number of LED lights to display (default: 10) */
  numLights?: number;
  /** Whether to show RPM text display (default: true) */
  showRpmText?: boolean;
  rpmOrientation?: 'horizontal' | 'bottom' | 'top';
  /** Car-specific RPM thresholds for each LED */
  gearRpmThresholds?: number[] | null;
  /** Car-specific LED colors */
  ledColors?: string[] | null;
  /** Car data for LED count */
  carData?: CarData | null;
  /** CarPath from iRacing session (for custom shift points) */
  carPath?: string;
  /** CarModel, where the sim sets one: the key of this car's settings as-is. */
  carModel?: string;
  /** Custom shift point settings */
  shiftPointSettings?: ShiftPointSettings;
  /** LED thresholds set by hand, per car */
  ledRpmOverrides?: TachometerConfig['ledRpmOverrides'];
  /** Background opacity */
  opacity?: number;
  oilTemp?: number;
  waterTemp?: number;
  showOilTemp?: boolean;
  showWaterTemp?: boolean;
  oilTempPosition?: 'top' | 'bottom';
  waterTempPosition?: 'top' | 'bottom';
  /** Swap which side oil/water sit on (default: oil left, water right). */
  swapTempSides?: boolean;
  /** 0-100: slide the oil box from the edge toward the centre. */
  oilEdgeOffset?: number;
  /** 0-100: slide the water box from the edge toward the centre. */
  waterEdgeOffset?: number;
}

export const Tachometer = ({
  rpm,
  maxRpm,
  gear = 0,
  engineWarnings = 0,
  shiftRpm = 0, // Optional shift RPM (DriverCarSLShiftRPM)
  blinkRpm = 0, // Optional blink RPM (DriverCarSLBlinkRPM)
  numLights = 10,
  showRpmText = true,
  rpmOrientation = 'bottom',
  gearRpmThresholds: carRpmThresholds = null,
  ledColors = null,
  carData = null,
  carPath = undefined,
  carModel = undefined,
  shiftPointSettings = undefined,
  ledRpmOverrides = undefined,
  opacity = 100,
  oilTemp = 0,
  waterTemp = 0,
  showOilTemp = true,
  showWaterTemp = true,
  oilTempPosition = 'top',
  waterTempPosition = 'top',
  swapTempSides = false,
  oilEdgeOffset = 0,
  waterEdgeOffset = 0,
}: TachometerProps) => {
  const [flash, setFlash] = useState(false);
  const [customShiftFlash, setCustomShiftFlash] = useState(false);

  // Settings are keyed by the car's model where the sim sets one, otherwise by
  // the canonical bundled car ID.
  const carId = carModel || carData?.carId || carPath;
  // Thresholds set by hand replace everything the car would use otherwise.
  const ledOverride = getLedRpmOverride(ledRpmOverrides, carId);
  const gearRpmThresholds = ledOverride ? null : carRpmThresholds;

  // Ensure RPM is within valid range. A threshold set by hand may lie above
  // the limit the sim reports, and has to stay reachable.
  const clampedRpm = Math.max(
    0,
    Math.min(rpm || 0, Math.max(maxRpm, ledOverride?.blinkRpm ?? 0))
  );

  // Calculate effective thresholds with fallbacks
  const effectiveShiftRpm =
    ledOverride?.fullRpm ??
    (gearRpmThresholds ? gearRpmThresholds[0] : shiftRpm || maxRpm * 0.9); // Use redline from car data
  const effectiveBlinkRpm =
    ledOverride?.blinkRpm ??
    (gearRpmThresholds ? gearRpmThresholds[0] : blinkRpm || maxRpm * 0.97); // Use redline from car data
  const shouldBlink = clampedRpm >= effectiveBlinkRpm;

  // Use car-specific LED count if available
  const effectiveNumLights =
    carData?.ledNumber || (ledColors ? ledColors.length - 1 : numLights);

  const carConfig = carId && shiftPointSettings?.carConfigs[carId];
  const customShiftPoint =
    carConfig && typeof carConfig !== 'string' && carConfig.enabled
      ? carConfig.gearShiftPoints[gear.toString()]?.shiftRpm
      : undefined;
  const shouldShowCustomShift = !!(
    shiftPointSettings?.enabled &&
    customShiftPoint &&
    clampedRpm >= customShiftPoint &&
    gear > 0
  );
  const indicatorType = shiftPointSettings?.indicatorType || 'glow';
  const indicatorColor = shiftPointSettings?.indicatorColor || '#00ff00';

  // Calculate activation thresholds for each light with distinct values
  const getActivationThreshold = (ledIndex: number) => {
    // Thresholds set by hand: evenly from the first LED to the last
    if (ledOverride) {
      const { firstRpm, fullRpm } = ledOverride;
      const steps = Math.max(1, effectiveNumLights - 1);
      return firstRpm + ((fullRpm - firstRpm) * ledIndex) / steps;
    }

    // Use car-specific thresholds if available
    if (gearRpmThresholds && gearRpmThresholds[ledIndex + 1]) {
      return gearRpmThresholds[ledIndex + 1]; // Skip first element (redline), LEDs start at index 1
    }

    // Fallback to original logic
    const lastLedIndex = effectiveNumLights - 1;
    const secondLastIndex = effectiveNumLights - 2;
    const thirdLastIndex = effectiveNumLights - 3;

    // Special thresholds for last three LEDs
    if (ledIndex === lastLedIndex) {
      return effectiveShiftRpm * 0.9; // Last LED (red) at 90%
    } else if (ledIndex === secondLastIndex) {
      return effectiveShiftRpm * 0.85; // Second last LED (yellow) at 85%
    } else if (ledIndex === thirdLastIndex) {
      return effectiveShiftRpm * 0.8; // Third last LED (yellow) at 80%
    }

    // For the rest, distribute evenly between 0% and 75%
    const normalizedIndex = ledIndex / (effectiveNumLights - 3);
    return effectiveShiftRpm * 0.75 * normalizedIndex;
  };

  // Calculate how many LEDs should be active based on RPM
  const getActiveLights = () => {
    // Always show no lights when RPM is 0
    if (clampedRpm <= 0) return 0;

    // Always show all lights when at or above shift point
    if (clampedRpm >= effectiveShiftRpm) return effectiveNumLights;

    // Use car-specific thresholds if available
    if (gearRpmThresholds && gearRpmThresholds.length > 1) {
      // Count how many thresholds are met (skip first element which is redline)
      let activeCount = 0;
      for (
        let i = 1;
        i < gearRpmThresholds.length && i <= effectiveNumLights;
        i++
      ) {
        if (clampedRpm >= gearRpmThresholds[i]) {
          activeCount++;
        }
      }
      return activeCount;
    }

    // Fallback: Count how many LEDs should be active based on current RPM
    let activeCount = 0;
    for (let i = 0; i < effectiveNumLights; i++) {
      if (clampedRpm >= getActivationThreshold(i)) {
        activeCount = i + 1;
      }
    }

    return activeCount;
  };

  // Determine if a specific LED should be active (handles center-out pattern)
  const isLedActive = (ledIndex: number): boolean => {
    if (!gearRpmThresholds || gearRpmThresholds.length <= 1) {
      // Fallback: simple left-to-right
      return ledIndex < activeLights;
    }

    // Car-specific: check if this LED's threshold is met
    const thresholdIndex = ledIndex + 1; // Skip redline (index 0)
    if (thresholdIndex < gearRpmThresholds.length) {
      return clampedRpm >= gearRpmThresholds[thresholdIndex];
    }

    return false;
  };

  const activeLights = getActiveLights();

  // Get custom shift indicator style for RPM text box
  const getRpmBoxStyle = () => {
    if (!shouldShowCustomShift) return {};

    const baseStyle = {
      transition: 'all 0.2s ease',
    };

    switch (indicatorType) {
      case 'glow':
        return {
          ...baseStyle,
          boxShadow: `0 0 20px ${indicatorColor}, 0 0 40px ${indicatorColor}`,
          backgroundColor: indicatorColor,
          color: '#000000',
          border: `inset 2px solid ${indicatorColor}`,
        };
      case 'border':
        return {
          ...baseStyle,
          boxShadow: `0 0 15px ${indicatorColor}`,
          border: `inset 3px solid ${indicatorColor}`,
          backgroundColor: 'rgba(0,0,0,0.8)',
        };
      case 'pulse':
        return {
          ...baseStyle,
          boxShadow: `0 0 15px ${indicatorColor}`,
          backgroundColor: customShiftFlash
            ? indicatorColor
            : 'rgba(0,0,0,0.8)',
          color: customShiftFlash ? '#000000' : '#ffffff',
          border: `inset 2px solid ${indicatorColor}`,
        };
      default:
        return baseStyle;
    }
  };

  // Determine if RPM box should be shown - always show when custom shift points are configured
  const hasCustomShiftPoints = !!(
    shiftPointSettings?.enabled &&
    carConfig &&
    typeof carConfig !== 'string'
  );
  const shouldShowRpmBox = showRpmText || hasCustomShiftPoints;

  // Flash effect when RPM exceeds blink threshold
  useEffect(() => {
    if (shouldBlink) {
      // Set up flashing with a shorter interval for better visibility
      const interval = setInterval(() => {
        setFlash((prevFlash) => !prevFlash);
      }, 200); // Faster flashing - 200ms instead of 250ms

      return () => {
        clearInterval(interval);
        setFlash(false);
      };
    }
  }, [shouldBlink]);

  // Custom shift point flash effect
  useEffect(() => {
    if (shouldShowCustomShift && indicatorType === 'pulse') {
      const interval = setInterval(() => {
        setCustomShiftFlash((prevFlash) => !prevFlash);
      }, 500);
      return () => {
        clearInterval(interval);
        setCustomShiftFlash(false);
      };
    }
  }, [shouldShowCustomShift, indicatorType]);

  // Determine the color for each LED
  const getLedColor = (index: number): string => {
    // An unlit light takes the palette's dark neutral.
    if (!isLedActive(index)) {
      return UNLIT_COLOR;
    }

    // Phase 1: At or above blinkRpm - flash purple/white with stronger colors
    if (shouldBlink) {
      return flash
        ? '#ffffff' /* Brighter white */
        : '#9333ea'; /* More vivid purple */
    }

    // Phase 2: At or above shiftRpm - solid purple
    if (clampedRpm >= effectiveShiftRpm) {
      return '#a855f7'; // Solid purple
    }

    // Use car-specific colors if available (convert from ARGB to RGB)
    if (ledColors && ledColors[index + 1]) {
      const argbColor = ledColors[index + 1];
      // Convert #FFRRGGBB to #RRGGBB
      if (argbColor.length === 9 && argbColor.startsWith('#FF')) {
        return '#' + argbColor.slice(3);
      }
      return argbColor;
    }

    // Phase 3: Below shift point - fixed color pattern based on position
    const lastLedIndex = effectiveNumLights - 1;
    const secondLastIndex = effectiveNumLights - 2;
    const thirdLastIndex = effectiveNumLights - 3;

    if (index === lastLedIndex) {
      return '#ef4444'; // Red for last LED
    } else if (index === secondLastIndex || index === thirdLastIndex) {
      return '#eab308'; // Yellow for second and third last LEDs
    } else {
      return '#22c55e'; // Green for all other LEDs
    }
  };

  // Match the RPM readout box exactly (text-2xl / 1.5em tall / px-4) so the
  // oil & water boxes are the same visual size.
  const tempBoxClass =
    'overlay-panel text-2xl flex min-w-[5em] font-bold tabular-nums px-4 whitespace-nowrap justify-center items-center gap-1';
  const tempBoxStyle = {
    height: '1.5em',
    ['--bg-opacity' as string]: `${opacity ?? 80}%`,
  };

  // Map a 0-100 edge offset to a horizontal position (% of the LED bar),
  // capped well short of the centre so a box never covers a centred RPM box.
  const EDGE_PCT = 6;
  const CENTER_MAX_PCT = 38;
  const toOffsetPct = (offset: number) =>
    EDGE_PCT +
    (Math.max(0, Math.min(100, offset)) / 100) * (CENTER_MAX_PCT - EDGE_PCT);
  const oilOnLeft = !swapTempSides;

  const oilWarning = !!(engineWarnings & EngineWarnings.OilTempWarning);
  const waterWarning = !!(engineWarnings & EngineWarnings.WaterTempWarning);

  const renderTemp = (label: string, value: number, warning: boolean) => (
    <div
      className={`${tempBoxClass} ${warning ? 'text-red-400' : 'text-white'}`}
      style={tempBoxStyle}
    >
      <span className={UNIT_CLASS}>{label}</span>
      <span>{Math.round(value)}°C</span>
    </div>
  );

  const renderTempBox = (
    key: string,
    label: string,
    value: number,
    warning: boolean,
    position: 'top' | 'bottom',
    onLeft: boolean,
    offset: number
  ) => {
    const offsetPct = toOffsetPct(offset);
    return (
      <div
        key={key}
        className={`absolute ${position === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'}`}
        style={
          onLeft
            ? { left: `${offsetPct}%`, transform: 'translateX(-50%)' }
            : { right: `${offsetPct}%`, transform: 'translateX(50%)' }
        }
      >
        {renderTemp(label, value, warning)}
      </div>
    );
  };
  return (
    <div
      className={`@container-[size] flex ${rpmOrientation === 'horizontal' ? 'flex-row' : rpmOrientation === 'top' ? 'flex-col-reverse' : 'flex-col'} justify-center items-center w-full h-full gap-2`}
    >
      {/* LED lights */}
      <div
        id="ledcontainer"
        className="overlay-panel flex relative items-center justify-center"
        style={{
          ['--bg-opacity' as string]: `${opacity ?? 80}%`,
          padding: `4px min(40cqh, ${(42.5 / effectiveNumLights).toFixed(2)}cqw)`,
        }}
      >
        {/* OIL — defaults to the left of the bar, swappable */}
        {showOilTemp &&
          renderTempBox(
            'oil',
            'OIL',
            oilTemp,
            oilWarning,
            oilTempPosition,
            oilOnLeft,
            oilEdgeOffset
          )}

        {/* WATER — opposite side of oil */}
        {showWaterTemp &&
          renderTempBox(
            'water',
            'H₂O',
            waterTemp,
            waterWarning,
            waterTempPosition,
            !oilOnLeft,
            waterEdgeOffset
          )}

        {Array.from({ length: effectiveNumLights }, (_, i) => (
          <div
            key={i}
            className="aspect-square p-0.5"
            style={{
              width: `min(80cqh, ${(85 / effectiveNumLights).toFixed(2)}cqw)`,
            }}
          >
            {/* A rounded segment, lit or not at once: no glow, edge or fade,
                which would cost the GPU every frame and lag the RPM. */}
            <div
              className="w-full h-full rounded-[30%]"
              style={{ backgroundColor: getLedColor(i) }}
              aria-label={`LED ${i + 1}`}
            />
          </div>
        ))}

        {/* RPM display - Horinztonal - shows when showRpmText is true OR when custom shift points exist */}
        {shouldShowRpmBox && rpmOrientation === 'horizontal' && (
          <div
            id="rpm-text"
            className="overlay-panel text-2xl absolute right-[-8em] flex min-w-[6em] font-bold tabular-nums text-white px-4 mx-2 transition-colors duration-200 whitespace-nowrap justify-center items-center"
            style={{
              ...getRpmBoxStyle(),
              height: '2em',
              ['--bg-opacity' as string]: `${opacity ?? 80}%`,
            }}
          >
            {showRpmText && (
              <>
                {shouldShowCustomShift ? (
                  <span className="font-bold">SHIFT</span>
                ) : (
                  <>
                    {Math.round(clampedRpm).toLocaleString('en-US')}
                    <span className={`${UNIT_CLASS} ml-2`}>RPM</span>
                  </>
                )}
              </>
            )}
            {!showRpmText && shouldShowCustomShift && (
              <span className="font-bold">SHIFT</span>
            )}
          </div>
        )}
      </div>

      {/* RPM display - Vertical - shows when showRpmText is true OR when custom shift points exist */}
      {shouldShowRpmBox && rpmOrientation !== 'horizontal' && (
        <div
          id="rpm-text"
          className="overlay-panel text-2xl flex min-w-[6em] font-bold tabular-nums text-white px-4 mx-2 transition-colors duration-200 whitespace-nowrap justify-center items-center"
          style={{
            ...getRpmBoxStyle(),
            height: '1.5em',
            ['--bg-opacity' as string]: `${opacity ?? 80}%`,
          }}
        >
          {showRpmText && (
            <>
              {shouldShowCustomShift ? (
                <span className="font-bold">SHIFT</span>
              ) : (
                <>
                  {Math.round(clampedRpm).toLocaleString('en-US')}
                  <span className={`${UNIT_CLASS} ml-2`}>RPM</span>
                </>
              )}
            </>
          )}
          {!showRpmText && shouldShowCustomShift && (
            <span className="font-bold">SHIFT</span>
          )}
        </div>
      )}
    </div>
  );
};
