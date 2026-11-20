import { memo } from 'react';
import { getTailwindStyle, type TailwindStyles } from '@irdashies/utils/colors';

interface CarNumberCellProps {
  carNumber?: string;
  tailwindStyles: TailwindStyles;
  showBackground?: boolean;
  showBorder?: boolean;
  compactMode?: string;
}

export const CarNumberCell = memo(
  ({
    carNumber,
    tailwindStyles,
    showBackground = true,
    showBorder = true,
    compactMode,
  }: CarNumberCellProps) => {
    const colorClass = showBackground
      ? tailwindStyles.driverIcon
      : showBorder
        ? tailwindStyles.borderColor
        : '';
    const borderClass = showBorder ? 'border-l-4' : '';
    const pxClass = compactMode === 'ultra' ? '' : 'px-1';

    return (
      <td
        data-column="carNumber"
        className={`w-auto ${colorClass} ${borderClass} ${showBackground ? 'text-white' : 'text-slate-400'} text-right ${pxClass} whitespace-nowrap`}
      >
        <span className="inline-block min-w-[4ch]">{`#${carNumber}`}</span>
      </td>
    );
  }
);

CarNumberCell.displayName = 'CarNumberCell';

export interface CarNumberProps {
  carNumber: string;
  /** The session's class colour. */
  color: number | undefined;
  /** Used instead of the class colour in a single-class session. */
  highlightColor?: number;
  isMultiClass: boolean;
  /** Text size and placing; each row sets its own. */
  className?: string;
}

/**
 * The number as `CarNumberCell` draws it by default, grey after a bar in the
 * class colour, for a row that is a grid or a flex line, not a table.
 */
export const CarNumber = memo(
  ({
    carNumber,
    color,
    highlightColor,
    isMultiClass,
    className = '',
  }: CarNumberProps) => (
    <span
      data-testid="car-number"
      className={`border-l-4 ${getTailwindStyle(color, highlightColor, isMultiClass).borderColor} pl-1 whitespace-nowrap text-slate-400 ${className}`}
    >
      {`#${carNumber}`}
    </span>
  )
);
CarNumber.displayName = 'CarNumber';
