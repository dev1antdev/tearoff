import React from 'react';
import { formatFuel, type FuelDisplayUnit } from '../fuelCalculations';
import type { FuelCalculation, FuelCalculatorSettings } from '../types';

interface FuelCalculatorWidgetProps {
  fuelData: FuelCalculation | null;
  displayData: FuelCalculation;
  fuelUnits: FuelDisplayUnit;
  settings?: FuelCalculatorSettings;
  widgetId?: string;
  customStyles?: {
    fontSize?: number;
    labelFontSize?: number;
    valueFontSize?: number;
    barFontSize?: number;
  };
  compactMode?: 'off' | 'compact' | 'ultra';
}

export const getFuelStatusColors = (
  status: 'safe' | 'caution' | 'danger' = 'safe'
) => {
  switch (status) {
    case 'safe':
      return {
        text: 'text-green-400',
        bar: 'from-green-500 to-green-400',
        border: 'border-green-500/50',
        bg: 'bg-green-500/10',
        borderSolid: 'border-green-500/50',
      };
    case 'caution':
      return {
        text: 'text-amber-400',
        bar: 'from-amber-500 to-amber-400',
        border: 'border-amber-500/50',
        bg: 'bg-amber-500/10',
        borderSolid: 'border-amber-500/50',
      };
    case 'danger':
      return {
        text: 'text-red-400',
        bar: 'from-red-500 to-red-400',
        border: 'border-red-500/50',
        bg: 'bg-red-500/10',
        borderSolid: 'border-red-500/50',
      };
    default:
      return {
        text: 'text-green-400',
        bar: 'from-green-500 to-green-400',
        border: 'border-green-500/50',
        bg: 'bg-green-500/10',
        borderSolid: 'border-green-500/50',
      };
  }
};

export const FuelCalculatorGauge: React.FC<FuelCalculatorWidgetProps> = ({
  fuelData,
  displayData,
  fuelUnits,
  settings,
  widgetId,
  customStyles,
  compactMode = 'off',
}) => {
  // Custom style handling for separate label/value sizes
  const widgetStyle =
    customStyles || (widgetId && settings?.widgetStyles?.[widgetId]) || {};
  const labelFontSize = widgetStyle.labelFontSize
    ? `${widgetStyle.labelFontSize}px`
    : widgetStyle.fontSize
      ? `${widgetStyle.fontSize}px`
      : '10px';
  const valueFontSize = widgetStyle.valueFontSize
    ? `${widgetStyle.valueFontSize}px`
    : widgetStyle.fontSize
      ? `${widgetStyle.fontSize}px`
      : '18px';

  if (!fuelData) return null;

  const currentFuel = displayData.fuelLevel;
  const tankCapacity = fuelData.fuelTankCapacity ?? 60;
  const fuelPct = Math.min(
    100,
    Math.max(0, (currentFuel / tankCapacity) * 100)
  );

  const status = fuelData.fuelStatus || 'safe';
  const statusColors = getFuelStatusColors(status);
  const gradient = statusColors.bar;

  const fuelString = formatFuel(currentFuel, fuelUnits, 1);
  const lapsString = displayData.lapsWithFuel.toFixed(1);
  const tankString = formatFuel(tankCapacity, fuelUnits, 0);

  // A car on virtual energy: the bar is its energy, and its fuel tank gets a
  // line of its own underneath. The car stops when either runs out, and the
  // two are filled to run out close together, so the tank is always shown
  // and marked when it is the one that will be empty first.
  const isEnergy = fuelData.budget === 'virtualEnergy';
  const tank = isEnergy ? displayData.tank : undefined;
  const tankUnits = settings?.fuelUnits ?? 'L';
  const tankEndsFirst =
    tank !== undefined &&
    tank.laps !== null &&
    displayData.lapsWithFuel > 0 &&
    tank.laps < displayData.lapsWithFuel;

  const paddingClass =
    compactMode === 'ultra'
      ? ''
      : compactMode === 'compact'
        ? 'px-1 pt-1 pb-0'
        : 'px-2 pt-1 pb-0';

  return (
    <div className={`${paddingClass} mb-1`}>
      <div
        className={`flex justify-between text-[0.75em] text-slate-400 font-medium items-end ${compactMode !== 'off' ? 'mb-0.5' : 'mb-1'}`}
      >
        <span
          className="uppercase tracking-wide"
          style={{ fontSize: labelFontSize }}
        >
          {isEnergy ? 'Energy' : 'Tank'}
        </span>
        <span
          className="text-white font-bold tracking-wide"
          style={{ fontSize: valueFontSize }}
        >
          {fuelString} <span className="text-slate-500 font-medium">·</span>{' '}
          {lapsString} laps
        </span>
        {/* A budget in percent is full at 100: no capacity to state. */}
        {!isEnergy && (
          <span
            className="uppercase tracking-wide"
            style={{ fontSize: labelFontSize }}
          >
            {tankString} cap
          </span>
        )}
      </div>
      <div className="h-1.5 bg-slate-700/80 rounded-sm overflow-hidden">
        <div
          className={`h-full bg-gradient-to-r ${gradient} transition-all duration-300`}
          style={{ width: `${fuelPct}%` }}
        />
      </div>
      {tank && (
        <div
          data-testid="fuel-gauge-tank"
          className={`mt-1 flex justify-between tabular-nums ${tankEndsFirst ? 'text-amber-400' : 'text-slate-400'}`}
          style={{ fontSize: labelFontSize }}
          title={
            tankEndsFirst
              ? 'The fuel tank will be empty before the virtual energy is'
              : 'Fuel in the tank'
          }
        >
          <span className="uppercase tracking-wide">
            {tankEndsFirst ? 'Fuel ends first' : 'Fuel'}
          </span>
          <span className={tankEndsFirst ? 'font-bold' : ''}>
            {formatFuel(tank.level, tankUnits, 1)}
            {tank.laps !== null && (
              <>
                {' '}
                <span className="text-slate-500 font-medium">·</span>{' '}
                {tank.laps.toFixed(1)} laps
              </>
            )}
          </span>
        </div>
      )}
    </div>
  );
};
