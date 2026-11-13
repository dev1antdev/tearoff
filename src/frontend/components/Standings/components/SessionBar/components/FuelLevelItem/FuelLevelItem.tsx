import { memo } from 'react';
import { GasPumpIcon, LightningIcon } from '@phosphor-icons/react';
import { useSessionBarSnapshot } from '@irdashies/context';
import { formatFuel } from '../../../../../FuelCalculator/fuelCalculations';
import { sessionBarItemWrapperClass } from '../../sessionBarItemWrapperClass';
import type { SessionBarItemProps } from '../../sessionBarItemTypes';

/**
 * Virtual energy as a percentage, to one decimal.
 *
 * One decimal because a lap costs only a point or two, and whether the stint
 * reaches the flag is decided inside that.
 */
export const formatVirtualEnergy = (fraction: number): string =>
  `${(fraction * 100).toFixed(1)}%`;

/**
 * What the player's car has left to run on.
 *
 * Litres for a fuel-limited car, as it always was. A Le Mans Ultimate car that
 * runs on virtual energy shows that first, because it is what ends the stint,
 * and the litres after it. Out of the car there is no reading and the item
 * goes away rather than claiming an empty tank.
 */
export const FuelLevelItem = memo(({ standalone }: SessionBarItemProps) => {
  const {
    fuelLevel: fuelLevelLiters,
    virtualEnergy,
    displayUnits,
  } = useSessionBarSnapshot() ?? { displayUnits: 0 };

  if (fuelLevelLiters === undefined && virtualEnergy === undefined) return null;

  const units = displayUnits === 1 ? 'L' : 'gal';

  return (
    <div className={sessionBarItemWrapperClass(standalone)}>
      <div className="flex justify-center gap-2 items-center tabular-nums">
        {virtualEnergy !== undefined && (
          <span
            className="flex items-center gap-1"
            title="Virtual energy remaining"
          >
            <LightningIcon aria-label="Virtual energy" weight="fill" />
            <span>{formatVirtualEnergy(virtualEnergy)}</span>
          </span>
        )}
        {fuelLevelLiters !== undefined && (
          <span className="flex items-center gap-1" title="Fuel in the tank">
            <GasPumpIcon aria-label="Fuel" />
            <span>{formatFuel(fuelLevelLiters, units, 1)}</span>
          </span>
        )}
      </div>
    </div>
  );
});
FuelLevelItem.displayName = 'FuelLevelItem';
