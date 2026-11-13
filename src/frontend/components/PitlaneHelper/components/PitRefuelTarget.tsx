import { memo } from 'react';
import { GasPumpIcon, LightningIcon } from '@phosphor-icons/react';

interface PitRefuelTargetProps {
  /** Litres of fuel, or a virtual energy level in percent. */
  amount: number;
  /** Which of the two `amount` is. */
  isVirtualEnergy: boolean;
}

/**
 * Whole percent for energy, because the pit menu only offers whole steps. One
 * decimal for fuel, which it offers in fractions of a litre.
 */
const formatAmount = (amount: number, isVirtualEnergy: boolean): string =>
  isVirtualEnergy ? `${Math.round(amount)}%` : `${amount.toFixed(1)} L`;

/**
 * What the next stop is set to put in.
 *
 * The one thing worth checking on the way down the pit lane: a stop set to the
 * wrong amount cannot be fixed once the car is on its jacks. The icon says
 * which budget the figure is, because 45 means something quite different as a
 * percentage of energy and as litres.
 */
export const PitRefuelTarget = memo(
  ({ amount, isVirtualEnergy }: PitRefuelTargetProps) => (
    <div
      data-testid="pit-refuel-target"
      className="flex items-center justify-center gap-1 text-xs py-1 px-2 bg-slate-700 rounded tabular-nums"
      title={
        isVirtualEnergy
          ? 'Virtual energy the next stop fills to'
          : 'Fuel set for the next stop'
      }
    >
      <span className="text-slate-300">Refuel</span>
      {isVirtualEnergy ? (
        <LightningIcon aria-label="Virtual energy" weight="fill" />
      ) : (
        <GasPumpIcon aria-label="Fuel" />
      )}
      <span className="font-bold">{formatAmount(amount, isVirtualEnergy)}</span>
    </div>
  )
);
PitRefuelTarget.displayName = 'PitRefuelTarget';
