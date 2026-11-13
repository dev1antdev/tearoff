import React from 'react';
import { fuelDisplayValue, type FuelDisplayUnit } from '../fuelCalculations';
import type { FuelCalculation, FuelCalculatorSettings } from '../types';

interface FuelCalculatorWidgetProps {
  fuelData: FuelCalculation | null;
  displayData: FuelCalculation;
  fuelUnits?: FuelDisplayUnit;
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

export const FuelCalculatorEconomyPredict: React.FC<
  FuelCalculatorWidgetProps
> = ({
  fuelData,
  displayData,
  fuelUnits,
  settings,
  widgetId,
  customStyles,
  compactMode,
}) => {
  // The unit handed down, which is percent for a car on virtual energy
  // whatever the fuel unit setting says.
  const units = fuelUnits ?? settings?.fuelUnits ?? 'L';
  // Custom style handling for separate label/value sizes
  const widgetStyle =
    customStyles || (widgetId && settings?.widgetStyles?.[widgetId]) || {};
  // Use slightly larger default value font size for readability
  const labelFontSize = widgetStyle.labelFontSize
    ? `${widgetStyle.labelFontSize}px`
    : widgetStyle.fontSize
      ? `${widgetStyle.fontSize}px`
      : '12px';
  const valueFontSize = widgetStyle.valueFontSize
    ? `${widgetStyle.valueFontSize}px`
    : widgetStyle.fontSize
      ? `${widgetStyle.fontSize * 1.2}px`
      : '14px';

  // Determine which data to show
  // Reverted to always 'live' mode as per user request
  const scenariosToShow = displayData?.targetScenarios || [];

  // console.log('[EconomyPredict] Render', { mode, currentLap: fuelData?.currentLap, bufferLen: bufferedScenarios.length, showLen: scenariosToShow.length });

  if (!fuelData || !scenariosToShow || scenariosToShow.length === 0) {
    return (
      <div
        className={`flex items-center justify-center w-full rounded bg-slate-900/40 text-slate-500 italic`}
        style={{ fontSize: labelFontSize, minHeight: '30px' }}
      >
        Needs Fuel Data
      </div>
    );
  }

  return (
    <div className="grid w-full grid-cols-3 border-y border-slate-600/40">
      {scenariosToShow.map((scenario) => {
        const isCurrent = scenario.isCurrentTarget;
        const lapsRemaining = scenario.laps;
        const absoluteTargetLap = displayData.currentLap + lapsRemaining;
        const fuelPerLap = fuelDisplayValue(scenario.fuelPerLap, units).toFixed(
          2
        );

        const textColor = isCurrent ? 'text-slate-100' : 'text-slate-400';
        const valueColor = isCurrent
          ? 'text-green-400 font-bold'
          : 'text-slate-200 font-medium';
        const padding =
          compactMode === 'ultra'
            ? 'py-0.5'
            : compactMode === 'compact'
              ? 'py-1'
              : 'py-1.5';

        return (
          <div
            key={lapsRemaining}
            className={`flex min-w-0 flex-col items-center justify-center px-1 ${padding} ${isCurrent ? 'bg-slate-700/60' : ''} ${lapsRemaining !== scenariosToShow[0]?.laps ? 'border-l border-slate-600/40' : ''}`}
          >
            <span
              className={`${textColor} uppercase leading-none`}
              style={{ fontSize: labelFontSize }}
            >
              L{absoluteTargetLap}
            </span>
            <span
              className={`${valueColor} mt-0.5 whitespace-nowrap leading-none tabular-nums`}
              style={{ fontSize: valueFontSize }}
            >
              {fuelPerLap}
              <span className="ml-0.5 text-[0.7em] text-slate-500">
                {units}/lap
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
};
