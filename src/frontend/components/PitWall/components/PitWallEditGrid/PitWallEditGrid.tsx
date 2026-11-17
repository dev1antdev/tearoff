import { memo } from 'react';
import {
  PIT_WALL_CUSTOM_COLUMNS,
  PIT_WALL_CUSTOM_ROWS,
  PIT_WALL_GAP_PX,
  type PitWallCells,
  type PitWallCustomVerdict,
} from '@irdashies/types';
import { cellSizeLabel, cellsOnGrid, cellsText } from '../../pitWallCustomEdit';

/** The tracks of the Custom layout's grid: every cell one. */
export const PIT_WALL_CELL_TRACKS = {
  gridTemplateColumns: `repeat(${PIT_WALL_CUSTOM_COLUMNS}, minmax(0, 1fr))`,
  gridTemplateRows: `repeat(${PIT_WALL_CUSTOM_ROWS}, minmax(0, 1fr))`,
} as const;

const CELLS = Array.from(
  { length: PIT_WALL_CUSTOM_COLUMNS * PIT_WALL_CUSTOM_ROWS },
  (_, index) => index
);

/**
 * The cells of the page, drawn faintly behind its panels while it is being
 * arranged, so that it can be seen what a panel snaps to and where there is
 * room. Laid over the page's own grid with the same tracks, gap and margin,
 * which is what keeps the two in step at any size.
 */
export const PitWallEditCells = memo(() => (
  <div
    aria-hidden="true"
    data-item="cells"
    className="pointer-events-none absolute inset-0 grid"
    style={{
      ...PIT_WALL_CELL_TRACKS,
      gap: PIT_WALL_GAP_PX,
      padding: PIT_WALL_GAP_PX,
    }}
  >
    {CELLS.map((cell) => (
      <div key={cell} className="rounded-sm bg-slate-400/10" />
    ))}
  </div>
));
PitWallEditCells.displayName = 'PitWallEditCells';

const VERDICT_WORDS: Record<PitWallCustomVerdict, string> = {
  fits: '',
  outside: 'Off the page',
  overlap: 'No room here',
  small: 'Too small',
};

interface PitWallEditTargetProps {
  /** The cells the panel held would take. */
  cells: PitWallCells;
  verdict: PitWallCustomVerdict;
}

/**
 * Where the panel held by the pointer would land: its cells, green where it
 * may have them and red where it may not, with a word of why. Only the part
 * of them that is on the page can be drawn; a panel dragged wholly off it
 * has no mark at all, and is put back when let go of.
 */
export const PitWallEditTarget = ({
  cells,
  verdict,
}: PitWallEditTargetProps) => {
  const drawn = cellsOnGrid(cells);
  if (!drawn) return null;
  const fits = verdict === 'fits';
  return (
    <div
      aria-hidden="true"
      data-item="target"
      data-verdict={verdict}
      data-cells={cellsText(cells)}
      style={{
        gridColumn: `${drawn.x + 1} / span ${drawn.w}`,
        gridRow: `${drawn.y + 1} / span ${drawn.h}`,
      }}
      className={[
        // Over every panel, and never in the way of the pointer.
        'settings-shell pointer-events-none relative z-20 flex min-h-0 min-w-0 items-center justify-center overflow-hidden rounded-lg border-2 border-dashed text-center text-sm font-semibold tabular-nums',
        fits
          ? 'border-emerald-400 bg-emerald-400/15 text-emerald-200'
          : 'border-red-400 bg-red-500/20 text-red-200',
      ].join(' ')}
    >
      {/* On a ground of its own: the mark lies over panels, whose names
          and handles would otherwise show through its words. */}
      <p className="flex flex-col gap-0.5 rounded-md bg-slate-950/85 px-2.5 py-1">
        <span>{cellSizeLabel(cells)}</span>
        {!fits && <span className="text-xs">{VERDICT_WORDS[verdict]}</span>}
      </p>
    </div>
  );
};
PitWallEditTarget.displayName = 'PitWallEditTarget';
