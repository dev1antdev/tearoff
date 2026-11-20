import { memo } from 'react';
import { useFitLevel } from '@irdashies/domain/widgetPresentation/useFitLevel';
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
  'flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] leading-5 whitespace-nowrap transition-colors';
const buttonClass = (on: boolean) =>
  `${BUTTON} ${
    on
      ? 'border-white/20 bg-slate-800 font-semibold text-white'
      : 'border-white/5 text-slate-300 hover:bg-slate-800/60'
  }`;

/**
 * How much the two switches write of themselves. `short` shortens what a
 * switch chooses ("Avg", "vs"); `shorter` shortens its choices as well
 * ("Clean", "Prev stint"); `shortest` leaves a word of them ("Stint").
 */
export type TowerHeaderWords = 'full' | 'short' | 'shorter' | 'shortest';

export interface TowerHeaderLook {
  words: TowerHeaderWords;
  /** The rows the header may take; 0 for as many as it needs. */
  rows: 0 | 1 | 2;
}

/**
 * The ways the header is drawn, the one wanted most first. It keeps to one
 * row by writing less of its switches, as far as their choices still say
 * what they choose; then it takes a second row, again with the most words
 * that fit, down to the barest. A header that two rows cannot hold with
 * the barest words, as one of very many classes, takes the rows it needs:
 * a switch is never left out.
 */
export const TOWER_HEADER_LOOKS: readonly TowerHeaderLook[] = [
  { words: 'full', rows: 1 },
  { words: 'short', rows: 1 },
  { words: 'shorter', rows: 1 },
  { words: 'full', rows: 2 },
  { words: 'short', rows: 2 },
  { words: 'shorter', rows: 2 },
  { words: 'shortest', rows: 2 },
  { words: 'shortest', rows: 0 },
];

/** A switch's words as they shorten: its label, and each choice of it. */
interface SwitchWords<T extends string> {
  label: string;
  /** For each choice: shorter, and shortest. */
  options: Record<T, readonly [string, string]>;
}

const AVERAGES_WORDS: SwitchWords<LapAverageLaps> = {
  label: 'Avg',
  options: { clean: ['Clean', 'Clean'], all: ['All', 'All'] },
};

// The column these choose for is headed "vs stint", which is what the
// shortest of them lean on.
const PACE_WORDS: SwitchWords<StintPaceReference> = {
  label: 'vs',
  options: {
    stint: ['Prev stint', 'Stint'],
    driver: ['Prev driver', 'Driver'],
  },
};

interface SwitchProps<T extends string> {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  /** What it writes where the header is short of room. */
  shortened: SwitchWords<T>;
  words: TowerHeaderWords;
}

/**
 * A choice of a few, with what it chooses written before it. Whatever it
 * writes, it is named in full to a screen reader and to whoever points at
 * it.
 */
const Switch = <T extends string>({
  label,
  options,
  value,
  onChange,
  shortened,
  words,
}: SwitchProps<T>) => (
  <div className="flex flex-none items-center gap-1.5">
    <span
      // The group below carries the name for a reader.
      aria-hidden={words === 'full' ? undefined : true}
      title={words === 'full' ? undefined : label}
      className="text-[11px] whitespace-nowrap text-slate-400"
    >
      {words === 'full' ? label : shortened.label}
    </span>
    <div role="group" aria-label={label} className="flex gap-1">
      {options.map((option) => {
        const written =
          words === 'shorter'
            ? shortened.options[option.value][0]
            : words === 'shortest'
              ? shortened.options[option.value][1]
              : option.label;
        const cut = written !== option.label;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={option.value === value}
            aria-label={cut ? option.label : undefined}
            title={cut ? `${label}: ${option.label}` : undefined}
            onClick={() => onChange(option.value)}
            className={buttonClass(option.value === value)}
          >
            {written}
          </button>
        );
      })}
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
 *
 * It is one row where it can be and seldom more than two: see
 * `TOWER_HEADER_LOOKS`.
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
  }: TowerHeaderProps) => {
    const fit = useFitLevel({
      levels: TOWER_HEADER_LOOKS.length,
      // Everything written in the bar, and which buttons are pressed: a
      // pressed one is bolder, and so a little wider.
      content: [
        tabs.map((tab) => tab.label).join(),
        activeTab,
        averagesOver,
        paceAgainst,
        cars,
      ].join('|'),
    });
    const { words, rows } = TOWER_HEADER_LOOKS[fit.level];

    return (
      <div
        data-testid="tower-header"
        data-words={words}
        data-rows={rows}
        className="flex-none border-b overlay-divider px-2 py-1.5"
      >
        <div
          ref={fit.target}
          // Never clipped: a look that does not fit is not kept, and a
          // button's mark of focus reaches past its box.
          className={`flex items-center gap-x-4 gap-y-1.5 ${
            rows === 1
              ? 'flex-nowrap'
              : rows === 2
                ? // Two rows of buttons and the gap between them.
                  'max-h-[calc(var(--spacing)*13.5_+_4px)] flex-wrap'
                : 'flex-wrap'
          }`}
        >
          {tabs.length > 0 && (
            <div
              role="group"
              aria-label="Class"
              className={`flex gap-1 ${rows === 1 ? 'flex-none' : 'flex-wrap'}`}
            >
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
          {/* Takes the room that is left over, and no gap of its own. */}
          <div className="-mr-4 grow" />
          {averagesOver !== undefined && (
            <Switch
              label={lapAveragesOverProperty.label}
              options={lapAveragesOverProperty.options}
              value={averagesOver}
              onChange={onAveragesOverChange}
              shortened={AVERAGES_WORDS}
              words={words}
            />
          )}
          {paceAgainst !== undefined && (
            <Switch
              label={STINT_PACE_AGAINST_LABEL}
              options={STINT_PACE_AGAINST_OPTIONS}
              value={paceAgainst}
              onChange={onPaceAgainstChange}
              shortened={PACE_WORDS}
              words={words}
            />
          )}
          <span
            data-testid="tower-count"
            className="flex-none text-[11px] whitespace-nowrap text-slate-400 tabular-nums"
          >
            {cars} {cars === 1 ? 'car' : 'cars'}
          </span>
        </div>
      </div>
    );
  }
);
TowerHeader.displayName = 'TowerHeader';
