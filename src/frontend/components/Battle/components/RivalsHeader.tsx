import type { SpeedUnit } from '@irdashies/utils/units';
import type { BattleColumnKey } from '../battleColumns';

interface RivalsHeaderProps {
  columns: readonly BattleColumnKey[];
  speedUnit: SpeedUnit;
}

const LABEL =
  'px-1 pb-0.5 text-2xs leading-none font-normal uppercase tracking-wide text-slate-400 whitespace-nowrap';

/**
 * The small labels above the rows. A row of bare figures (laps, stops,
 * percent, seconds) is only readable once it is known by heart; the labels
 * say which is which. The columns that explain themselves have none.
 */
export const RivalsHeader = ({ columns, speedUnit }: RivalsHeaderProps) => {
  const cells: React.JSX.Element[] = [];
  const label = (key: string, text: string, align = 'text-center') =>
    cells.push(
      <th key={key} scope="col" className={`${LABEL} ${align}`}>
        {text}
      </th>
    );

  for (const key of columns) {
    switch (key) {
      case 'stint':
        label(key, 'Stint');
        break;
      case 'pitStops':
        label(key, 'Pit');
        break;
      case 'energy':
        label(key, 'Left', 'text-right');
        break;
      case 'energyUse':
        label(key, '%/Lap', 'text-right');
        break;
      case 'bestTime':
        label(key, 'Best', 'text-left pl-2');
        break;
      case 'lastTime':
        label(key, 'Last', 'text-left pl-2');
        break;
      case 'speed':
        label(key, speedUnit, 'text-right');
        break;
      case 'trackLimits':
        label(key, 'TL', 'text-right');
        break;
      case 'gap':
        label('gap', 'Gap', 'text-right');
        label('lineGap', 'Line', 'text-right');
        label('trend', '/Lap', 'text-right pr-2');
        break;
      case 'forecast':
        label(key, 'Catch', 'text-right pr-2');
        break;
      default:
        cells.push(<th key={key} aria-hidden="true" />);
    }
  }

  return (
    <thead>
      <tr data-row="header">{cells}</tr>
    </thead>
  );
};
RivalsHeader.displayName = 'RivalsHeader';
