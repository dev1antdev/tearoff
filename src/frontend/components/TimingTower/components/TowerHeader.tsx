import { memo } from 'react';
import {
  lapAveragesOverProperty,
  STINT_PACE_AGAINST_LABEL,
  STINT_PACE_AGAINST_OPTIONS,
  type LapAverageLaps,
  type StintPaceReference,
} from '@irdashies/types';
import { getTailwindStyle } from '@irdashies/utils/colors';
import type { TowerTab } from '../towerRows';

const BUTTON =
  'flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] leading-5 whitespace-nowrap transition-colors';
const buttonClass = (on: boolean) =>
  `${BUTTON} ${
    on
      ? 'border-slate-400 bg-slate-600 font-semibold text-white'
      : 'border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-700'
  }`;

interface SwitchProps<T extends string> {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

/** A choice of a few, with what it chooses written before it. */
const Switch = <T extends string>({
  label,
  options,
  value,
  onChange,
}: SwitchProps<T>) => (
  <div className="flex items-center gap-1.5">
    <span className="text-[11px] whitespace-nowrap text-slate-400">
      {label}
    </span>
    <div role="group" aria-label={label} className="flex gap-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={buttonClass(option.value === value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  </div>
);

interface TowerHeaderProps {
  /** Empty in a session of one class, which has nothing to choose. */
  tabs: readonly TowerTab[];
  activeTab: string;
  onTabChange: (tab: string) => void;
  /** Left out, the switch is not drawn: neither average column is on. */
  averagesOver?: LapAverageLaps;
  onAveragesOverChange: (laps: LapAverageLaps) => void;
  /** Left out, the switch is not drawn: the pace column is off. */
  paceAgainst?: StintPaceReference;
  onPaceAgainstChange: (against: StintPaceReference) => void;
  /** Cars in the list on show. */
  cars: number;
}

/**
 * The bar over the tower's table: a tab for each class and one for the
 * whole field, and the two switches that change what its pace columns are
 * made of. Nothing chosen here is saved: see `useViewSetting`.
 */
export const TowerHeader = memo(
  ({
    tabs,
    activeTab,
    onTabChange,
    averagesOver,
    onAveragesOverChange,
    paceAgainst,
    onPaceAgainstChange,
    cars,
  }: TowerHeaderProps) => (
    <div
      data-testid="tower-header"
      className="flex flex-none flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-slate-700 px-2 py-1.5"
    >
      {tabs.length > 0 && (
        <div role="group" aria-label="Class" className="flex flex-wrap gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              data-tab={tab.id}
              aria-pressed={tab.id === activeTab}
              onClick={() => onTabChange(tab.id)}
              className={buttonClass(tab.id === activeTab)}
            >
              {tab.color !== undefined && (
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{
                    backgroundColor: getTailwindStyle(
                      tab.color,
                      undefined,
                      true
                    ).canvasFill,
                  }}
                />
              )}
              {tab.label}
            </button>
          ))}
        </div>
      )}
      <div className="grow" />
      {averagesOver !== undefined && (
        <Switch
          label={lapAveragesOverProperty.label}
          options={lapAveragesOverProperty.options}
          value={averagesOver}
          onChange={onAveragesOverChange}
        />
      )}
      {paceAgainst !== undefined && (
        <Switch
          label={STINT_PACE_AGAINST_LABEL}
          options={STINT_PACE_AGAINST_OPTIONS}
          value={paceAgainst}
          onChange={onPaceAgainstChange}
        />
      )}
      <span
        data-testid="tower-count"
        className="text-[11px] whitespace-nowrap text-slate-400 tabular-nums"
      >
        {cars} {cars === 1 ? 'car' : 'cars'}
      </span>
    </div>
  )
);
TowerHeader.displayName = 'TowerHeader';
