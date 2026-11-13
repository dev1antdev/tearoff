import React from 'react';
import type { FuelCalculation, FuelCalculatorSettings } from '../types';
import { refuelLevelPercent, type FuelDisplayUnit } from '../fuelCalculations';
import { useFuelProjectionSnapshot } from '@irdashies/context';

/**
 * What a stop puts in and what is left at the flag, as the two cells read.
 *
 * A tank is topped up by an amount. Virtual energy is set as the level the
 * car leaves the stop with, in whole percent, so the first cell changes
 * meaning with the budget and the column heading changes with it.
 */
const stopCells = (
  neededAfterStop: number,
  leftAtFinish: number,
  isEnergy: boolean
): { add: string; finish: string } =>
  isEnergy
    ? {
        add: `${refuelLevelPercent(neededAfterStop)}%`,
        finish: `${leftAtFinish.toFixed(1)}%`,
      }
    : {
        add: `+${neededAfterStop.toFixed(1)}`,
        finish: leftAtFinish.toFixed(1),
      };

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

// Helper component for the Target row to avoid duplication
const TargetScenarioRow: React.FC<{
  targetLap: number;
  fuelData: FuelCalculation;
  displayData: FuelCalculation;
  settings: FuelCalculatorSettings;
  valueFontSize: string;
  isTesting: boolean;
  isEnergy: boolean;
  compactMode?: 'off' | 'compact' | 'ultra';
}> = ({
  targetLap,
  fuelData,
  displayData,
  settings,
  valueFontSize,
  isTesting,
  isEnergy,
  compactMode,
}) => {
  const lapsLeftAfterPit = Math.max(0, fuelData.totalLaps - targetLap);
  const safetyMargin = settings?.safetyMargin ?? 0.05;
  // Select consumption based on basis setting
  const basis = settings?.targetPitLapBasis || 'avg';
  let consumption = displayData.avgLaps;

  switch (basis) {
    case 'avg':
      consumption = displayData.avgLaps;
      break;
    case 'avg10':
      consumption = displayData.avg10Laps;
      break;
    case 'last':
      consumption = displayData.lastLapUsage;
      break;
    case 'max':
      consumption = displayData.maxLapUsage;
      break;
    case 'min':
      consumption = displayData.minLapUsage;
      break;
    case 'qual':
      consumption = displayData.maxQualify || 0;
      break;
  }

  // Fallback if selected is 0 or null
  consumption =
    consumption || displayData.avgLaps || displayData.avg10Laps || 0;
  const fuelToAddHypothetical =
    lapsLeftAfterPit * consumption * (1 + safetyMargin);
  const fuelBurnedToFinish = lapsLeftAfterPit * consumption;
  const estimatedFinishFuel = Math.max(
    0,
    fuelToAddHypothetical - fuelBurnedToFinish
  );

  const cells = stopCells(fuelToAddHypothetical, estimatedFinishFuel, isEnergy);
  const hidden = isTesting || consumption === 0;
  const addDisplay = hidden ? '--' : cells.add;
  const finishDisplay = hidden ? '--' : cells.finish;
  const rowColor = 'text-white font-bold';
  const cellPadding =
    compactMode === 'ultra' ? '' : compactMode === 'compact' ? 'p-1' : 'p-2';

  return (
    <div className="col-span-4 grid grid-cols-subgrid bg-slate-700/50">
      <div
        className={`${rowColor} text-center ${cellPadding}`}
        style={{ fontSize: valueFontSize }}
      >
        L{targetLap}
      </div>
      <div
        className={`${rowColor} text-center ${cellPadding}`}
        style={{ fontSize: valueFontSize }}
      >
        {addDisplay}
      </div>
      <div
        className={`${rowColor} text-center ${cellPadding}`}
        style={{ fontSize: valueFontSize }}
      >
        {finishDisplay}
      </div>
      <div
        className={`${rowColor} text-center ${cellPadding}`}
        style={{ fontSize: valueFontSize }}
      >
        TARGET
      </div>
    </div>
  );
};

export const FuelCalculatorPitScenarios: React.FC<
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
  const isEnergy = units === '%';
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
      : '12px';

  const sessionType = useFuelProjectionSnapshot()?.sessionType;
  const isTesting = sessionType === 'Offline Testing';

  // Determine visibility based on settings (default true if missing)
  if (settings && settings.showFuelScenarios === false) return null;

  if (
    !fuelData ||
    !displayData.targetScenarios ||
    displayData.targetScenarios.length === 0
  ) {
    // Show "Pit scenarios available after more laps" placeholder if empty
    return (
      <div>
        <div className="border-t border-slate-600/30 mb-2"></div>
        <div
          className="text-[0.75em] text-center text-slate-400 mb-3 py-2 bg-slate-900/40 rounded"
          style={{ fontSize: labelFontSize }}
        >
          Pit scenarios available after more laps
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        className={`border-t border-slate-600/30 ${compactMode !== 'off' ? 'mb-0.5' : 'mb-2'}`}
      ></div>

      <div className="grid grid-cols-4 mb-3">
        <div
          className="text-slate-500 text-center"
          style={{ fontSize: labelFontSize }}
        >
          PIT @
        </div>
        <div
          className="text-slate-500 text-center"
          style={{ fontSize: labelFontSize }}
        >
          {isEnergy ? 'FILL TO' : 'ADD'}
        </div>
        <div
          className="text-slate-500 text-center"
          style={{ fontSize: labelFontSize }}
        >
          FINISH
        </div>
        <div
          className="text-slate-500 text-center"
          style={{ fontSize: labelFontSize }}
        >
          WINDOW
        </div>

        {displayData.targetScenarios.map((scenario) => {
          // Calculate values for this scenario
          // const fuelPerLap = scenario.fuelPerLap;
          // const lapsToCover = fuelData.lapsRemaining; // Rough estimate, technically depends on when we pit

          const pitLap = fuelData.currentLap + scenario.laps;

          // Fuel to Add calculation:
          // Color coding
          // let colorClass = 'text-cyan-400';
          // if (scenario.isCurrentTarget) colorClass = 'text-green-400 font-medium';

          // Calculate hypothetical ADD
          // If we drive `scenario.laps` laps, we arrive at pit.
          const lapsLeftAfterPit = Math.max(0, fuelData.totalLaps - pitLap);
          const safetyMargin = settings?.safetyMargin ?? 0.05;
          const consumption = displayData.avgLaps || displayData.avg10Laps || 0;
          // Additive Safety Margin logic, in the unit the margin is typed in:
          // gallons become the litres the sums are in, litres and percent
          // of energy already are what they are in.
          const marginAmount =
            units === 'gal' ? safetyMargin * 3.78541 : safetyMargin;
          const calculationFuelNeeded =
            lapsLeftAfterPit * consumption + marginAmount;
          const fuelToAddHypothetical = Math.max(0, calculationFuelNeeded);

          // Calculate estimated fuel at finish: (Added) - (Needed for remaining laps)
          const fuelBurnedToFinish = lapsLeftAfterPit * consumption;
          const estimatedFinishFuel = Math.max(
            0,
            fuelToAddHypothetical - fuelBurnedToFinish
          );

          let windowStatus;
          if (scenario.isCurrentTarget) {
            windowStatus = 'Ideal';
          } else if (scenario.laps < (displayData.lapsWithFuel || 0)) {
            windowStatus = '-1 Lap';
          } else {
            windowStatus = '+1 Lap';
          }

          const cells = stopCells(
            fuelToAddHypothetical,
            estimatedFinishFuel,
            isEnergy
          );
          const addDisplay = isTesting ? '--' : cells.add;
          const finishDisplay = isTesting ? '--' : cells.finish;
          const windowDisplay = isTesting ? '--' : windowStatus;

          const rowColor = scenario.isCurrentTarget
            ? 'text-white font-bold'
            : 'text-slate-300';

          const cellPadding =
            compactMode === 'ultra'
              ? ''
              : compactMode === 'compact'
                ? 'p-1'
                : 'p-2';

          return (
            <div
              key={scenario.laps}
              className={`col-span-4 grid grid-cols-subgrid ${scenario.isCurrentTarget ? 'bg-slate-700/50' : ''}`}
            >
              <div
                className={`${rowColor} text-center ${cellPadding}`}
                style={{ fontSize: valueFontSize }}
              >
                L{pitLap}
              </div>
              <div
                className={`${rowColor} text-center ${cellPadding}`}
                style={{ fontSize: valueFontSize }}
              >
                {addDisplay}
              </div>
              <div
                className={`${rowColor} text-center ${cellPadding}`}
                style={{ fontSize: valueFontSize }}
              >
                {finishDisplay}
              </div>
              <div
                className={`${rowColor} text-center ${cellPadding}`}
                style={{ fontSize: valueFontSize }}
              >
                {windowDisplay}
              </div>
            </div>
          );
        })}

        {/* Optional 4th Row for Fixed Target */}
        {settings?.enableTargetPitLap && settings.targetPitLap && (
          <TargetScenarioRow
            targetLap={settings.targetPitLap}
            fuelData={fuelData}
            displayData={displayData}
            settings={settings}
            valueFontSize={valueFontSize}
            isTesting={isTesting}
            isEnergy={isEnergy}
            compactMode={compactMode}
          />
        )}
      </div>
    </div>
  );
};
