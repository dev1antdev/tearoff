import { memo } from 'react';
import {
  NO_FIGURE,
  type RivalOutcome,
} from '@irdashies/domain/finishProjection';
import { ClassLabel } from '../../shared/ClassLabel/ClassLabel';
import { DriverStatusBadges } from '../../shared/DriverStatusBadges/DriverStatusBadges';

const OUTCOME_CLASS: Record<RivalOutcome, string> = {
  ahead: 'text-green-400',
  behind: 'text-red-400',
  level: 'text-slate-300',
  unknown: 'text-slate-500',
};

/** The three figures of a row, in columns that line up down the section. */
const FIGURE = {
  gap: 'w-12 flex-none text-right',
  stops: 'w-12 flex-none text-center',
  projected: 'w-14 flex-none text-right',
} as const;

/** The captions over those columns. */
export const FinishRivalsCaption = () => (
  <div className="flex items-center gap-2 text-[0.65rem] font-medium uppercase leading-none tracking-wide text-slate-400">
    <span className="min-w-0 flex-1 truncate">Class rivals</span>
    <span className={FIGURE.gap}>Now</span>
    <span className={FIGURE.stops}>Stops</span>
    <span className={FIGURE.projected}>After</span>
  </div>
);

export interface FinishRivalRowProps {
  carIdx: number;
  classPosition: number;
  number: string;
  name: string;
  classColor: number | undefined;
  highlightColor: number;
  isMultiClass: boolean;
  inPit: boolean;
  /** The race gap now, as written. */
  gap: string;
  /**
   * Stops still owed: the rival's, then the player's, which is null while
   * what the player's car has aboard is not read.
   */
  rivalStops: number;
  playerStops: number | null;
  /** The gap once both have made them, as written. */
  projected: string;
  outcome: RivalOutcome;
  /** The rival's stops are assumed, not seen: the row is drawn fainter. */
  assumed: boolean;
}

/**
 * One class rival: its place, its number on the class colour, who drives
 * it, the gap now, the stops each car still owes and the gap once they are
 * made.
 */
export const FinishRivalRow = memo(
  ({
    carIdx,
    classPosition,
    number,
    name,
    classColor,
    highlightColor,
    isMultiClass,
    inPit,
    gap,
    rivalStops,
    playerStops,
    projected,
    outcome,
    assumed,
  }: FinishRivalRowProps) => (
    <div
      data-testid="finish-rival"
      data-car={carIdx}
      data-outcome={outcome}
      data-assumed={assumed}
      className={`flex items-center gap-2 text-xs leading-none ${
        assumed ? 'opacity-60' : ''
      }`}
    >
      <span className="w-5 flex-none text-right text-slate-400">
        {classPosition > 0 ? classPosition : ''}
      </span>
      <ClassLabel
        name={number ? `#${number}` : '#'}
        color={classColor}
        highlightColor={highlightColor}
        isMultiClass={isMultiClass}
        className="flex-none rounded-sm px-1.5 py-0.5 text-xs leading-none text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.7)]"
      />
      <span className="min-w-0 flex-1 truncate text-slate-200">{name}</span>
      {inPit && <DriverStatusBadges pit className="flex-none" />}
      <span data-testid="finish-rival-gap" className={FIGURE.gap}>
        {gap}
      </span>
      <span
        data-testid="finish-rival-stops"
        className={`${FIGURE.stops} text-slate-300`}
      >
        {assumed && '~'}
        {rivalStops} v {playerStops ?? NO_FIGURE}
      </span>
      <span
        data-testid="finish-rival-projected"
        className={`${FIGURE.projected} font-bold ${OUTCOME_CLASS[outcome]}`}
      >
        {projected}
      </span>
    </div>
  )
);
FinishRivalRow.displayName = 'FinishRivalRow';
