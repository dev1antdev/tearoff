import { memo, type ReactNode } from 'react';
import type { CarChoice } from '@irdashies/domain/raceHistory/carChoice';
import { CarChoiceSelect } from './CarChoiceSelect';

interface CarPanelHeaderProps {
  choices: readonly CarChoice[];
  /** The car the panel shows; null while the session has none. */
  carIdx: number | null;
  onChoose: (carIdx: number) => void;
  /** What the panel says of the car, at the far end of the bar. */
  children?: ReactNode;
}

/**
 * The bar over a panel about one car: which car it is, and a few words on
 * what the panel holds of it. Nothing chosen here is saved.
 */
export const CarPanelHeader = memo(
  ({ choices, carIdx, onChoose, children }: CarPanelHeaderProps) => (
    <div
      data-testid="car-panel-header"
      className="flex flex-none flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-slate-700 px-2 py-1.5"
    >
      {carIdx !== null && (
        <CarChoiceSelect choices={choices} value={carIdx} onChange={onChoose} />
      )}
      <span className="text-xs leading-5 whitespace-nowrap text-slate-400 tabular-nums">
        {children}
      </span>
    </div>
  )
);
CarPanelHeader.displayName = 'CarPanelHeader';
