import React from 'react';
import { GasPumpIcon, LightningIcon } from '@phosphor-icons/react';
import type { FuelCalculatorSettings, FuelCalculation } from '../types';
import type { FuelDisplayUnit } from '../fuelCalculations';

interface FuelCalculatorWidgetProps {
  fuelData: FuelCalculation | null;
  fuelUnits: FuelDisplayUnit;
  settings?: FuelCalculatorSettings;
  widgetId?: string;
  displayData?: FuelCalculation;
  customStyles?: {
    fontSize?: number;
    labelFontSize?: number;
    valueFontSize?: number;
    barFontSize?: number;
  };
  compactMode?: 'off' | 'compact' | 'ultra';
}

const getConfidenceConfig = (confidence: string) => {
  switch (confidence) {
    case 'high':
      // Confident is the normal state: the number stays white, the dot says it.
      return { color: 'text-white', bg: 'bg-green-500', pulse: '' };
    case 'medium':
      return {
        color: 'text-amber-400',
        bg: 'bg-amber-500',
        pulse: 'animate-pulse',
      };
    case 'very-low':
    case 'low':
    default:
      return {
        color: 'text-red-400',
        bg: 'bg-red-500',
        pulse: 'animate-pulse',
      };
  }
};

export const FuelCalculatorHeader: React.FC<FuelCalculatorWidgetProps> = ({
  fuelData,
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
      : '14px';

  const ownValueSize = Boolean(
    widgetStyle.valueFontSize || widgetStyle.fontSize
  );

  if (!fuelData) return null;

  const stopsRemaining = fuelData.stopsRemaining ?? 0;
  const pitWindowOpen = fuelData.pitWindowOpen;

  // Confidence logic (mapping from existing data)
  const confidence = fuelData.confidence || 'low';
  const confConfig = getConfidenceConfig(confidence);
  let lapsText = `${Math.ceil(fuelData.lapsRemaining)}`;
  if (confidence === 'medium')
    lapsText = `~${Math.ceil(fuelData.lapsRemaining)}`;
  if (confidence === 'low' || confidence === 'very-low')
    lapsText = `${Math.floor(fuelData.lapsRemaining)}-${Math.ceil(fuelData.lapsRemaining + 2)}`;

  // If no data (avgLaps is 0), show --
  const hasLaps = (fuelData.avgLaps || 0) > 0;
  if (!hasLaps) {
    lapsText = '--';
  }

  const paddingClass =
    compactMode === 'ultra'
      ? ''
      : compactMode === 'compact'
        ? 'p-1'
        : 'px-2 py-1';

  return (
    // One line, as the header always was, so a layout sized for it keeps
    // fitting. Next pit and Stops keep their width; the headline's column is
    // a size container, and the headline shrinks to the space left in it
    // rather than push them, its unit wrapping below it when the number needs
    // the whole column (as the old header's did).
    <div className={paddingClass}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-end gap-x-3">
        <div className="@container min-w-0">
          <div
            className="flex items-center gap-1 overlay-label"
            style={{ fontSize: labelFontSize }}
          >
            {/* The icon says which budget the whole widget is counting. */}
            {fuelData.budget === 'virtualEnergy' ? (
              <LightningIcon
                size={12}
                weight="fill"
                aria-label="Virtual energy"
              />
            ) : (
              <GasPumpIcon size={12} weight="fill" />
            )}
            <span>To go</span>
          </div>
          {/* The headline, its unit small and grey: the display-sm step, or
              1.6 times the box's own value size when the box sets one, and
              never more than its column leaves it: 18cqi lets the widest
              range ("104-106") and the dot fit the column. */}
          <div
            className={`flex flex-wrap items-baseline gap-x-1 ${confConfig.color} font-bold tabular-nums leading-none`}
            style={{
              fontSize: `min(${ownValueSize ? `calc(${valueFontSize} * 1.6)` : 'var(--text-display-sm)'}, 18cqi)`,
            }}
            title={`${confidence} confidence`}
          >
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <span
                className={`w-1.5 h-1.5 shrink-0 rounded-full ${confConfig.bg} ${confConfig.pulse}`}
              />
              {lapsText}
            </span>
            {hasLaps && (
              <span className="text-[0.5em] font-semibold text-slate-400">
                laps
              </span>
            )}
          </div>
        </div>
        <div className="flex items-baseline gap-1 whitespace-nowrap pb-px">
          <span className="overlay-label" style={{ fontSize: labelFontSize }}>
            Next pit
          </span>
          <span
            className="text-white font-bold tabular-nums"
            style={{ fontSize: valueFontSize }}
          >
            L{pitWindowOpen}
          </span>
        </div>
        <div className="flex items-baseline gap-1 whitespace-nowrap pb-px">
          <span className="overlay-label" style={{ fontSize: labelFontSize }}>
            Stops
          </span>
          <span
            className="text-white font-bold tabular-nums"
            style={{ fontSize: valueFontSize }}
          >
            {stopsRemaining}
          </span>
        </div>
      </div>
    </div>
  );
};
