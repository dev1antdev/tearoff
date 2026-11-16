import { memo } from 'react';
import { useGridPlaceChange } from '@irdashies/domain';
import { RatingChange } from '../../../../../shared/RatingChange/RatingChange';
import { sessionBarItemWrapperClass } from '../../sessionBarItemWrapperClass';
import type { SessionBarItemProps } from '../../sessionBarItemTypes';

/**
 * Places gained or lost since the grid, as the standings' own column draws
 * it: a green caret up and the count, a red caret down and the count, a dash
 * when level.
 *
 * In class unless the setting says overall. A race's figure: not rendered in
 * any other session, nor for a car with no grid result.
 */
export const PositionChangeItem = memo(
  ({ settings, standalone }: SessionBarItemProps) => {
    const scope = settings?.positionChange?.scope ?? 'class';
    const change = useGridPlaceChange(scope);
    if (change === undefined) return null;

    return (
      <div className={sessionBarItemWrapperClass(standalone)}>
        <div
          data-item="positionChange"
          data-change={change}
          className="flex justify-center items-center text-nowrap tabular-nums"
          title={
            scope === 'overall'
              ? 'Places since the grid, overall'
              : 'Places since the grid, in class'
          }
        >
          <RatingChange value={change} />
        </div>
      </div>
    );
  }
);
PositionChangeItem.displayName = 'PositionChangeItem';
