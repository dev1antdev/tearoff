import {
  memo,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  DotsSixVerticalIcon,
  GearIcon,
  NotchesIcon,
  XIcon,
} from '@phosphor-icons/react';
import type { PitWallCells } from '@irdashies/types';
import { cellSizeLabel, cellsText } from '../../pitWallCustomEdit';

/** What a panel is given while the page is being arranged. */
export interface PitWallPanelEdit {
  /** The pointer holds this panel. */
  held: boolean;
  /** Said under the panel's name, where there is something to say of it. */
  note?: string;
  /** The id of the words that say how a panel is arranged from the keyboard. */
  describedBy?: string;
  /** A pointer went down on the title bar, to move the panel. */
  onMoveStart: (event: PointerEvent<HTMLElement>) => void;
  /** A pointer went down on the lower right corner, to size it. */
  onSizeStart: (event: PointerEvent<HTMLElement>) => void;
  /** A key went down with the panel in focus. */
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onRemove: () => void;
}

interface PitWallPanelProps {
  title: string;
  /** The panel's `grid-area` in the page's grid. */
  area?: string;
  /**
   * Where the panels are one under another instead of in a grid: the
   * height this one has at the least, as a CSS length.
   */
  basis?: string;
  /**
   * The cells the panel takes, where the page places it by them and not by
   * a named area: while the page is being arranged.
   */
  cells?: PitWallCells;
  /** The page is being arranged: the panel is a thing to move, not to read. */
  edit?: PitWallPanelEdit;
  /**
   * In its place but not shown and not reached: a panel taken off the page
   * in an edit that is not saved yet. What it holds goes on running until
   * the edit is over, in case it is cancelled.
   */
  parked?: boolean;
  /** Opens the settings of what the panel shows; no button without it. */
  onOpenSettings?: () => void;
  children: ReactNode;
}

const titleClass = 'truncate text-[11px] font-bold tracking-[0.1em] uppercase';

// The frame clips what is outside it, so the mark of focus is drawn inside
// the button. Marked important because the settings theme's own rule for a
// focused button is outside every layer and would win otherwise.
const focusInside = 'focus-visible:-outline-offset-2!';

const placement = (
  area: string | undefined,
  cells: PitWallCells | undefined,
  basis: string | undefined
): CSSProperties | undefined =>
  area
    ? { gridArea: area }
    : cells
      ? {
          gridColumn: `${cells.x + 1} / span ${cells.w}`,
          gridRow: `${cells.y + 1} / span ${cells.h}`,
        }
      : basis !== undefined
        ? // Never shrunk: the page scrolls past what does not fit.
          // Grown only where the panels together leave room over.
          { flex: `1 0 ${basis}` }
        : undefined;

/**
 * One panel of the Pit Wall: a titled frame in the settings theme around a
 * body that is left outside it, because the body holds an overlay widget
 * that keeps its own look.
 *
 * While the page is being arranged the title bar is the handle the panel
 * is moved by, with a button that takes the panel off the page, the lower
 * right corner is the handle it is sized by, and the body shows the
 * widget's name and the panel's size in place of the widget. The widget
 * itself stays where it is in the tree, unseen and out of reach, so that
 * it goes on reading what it reads and is as it was when the edit is over.
 */
export const PitWallPanel = memo(
  ({
    title,
    area,
    basis,
    cells,
    edit,
    parked = false,
    onOpenSettings,
    children,
  }: PitWallPanelProps) => (
    <section
      aria-label={title}
      aria-hidden={parked || undefined}
      inert={parked || undefined}
      data-held={edit?.held || undefined}
      // Where the panel is, for whoever reads the page and not the screen.
      data-cells={cells && cellsText(cells)}
      style={placement(area, cells, basis)}
      className={[
        'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border',
        edit
          ? // Opaque, over the cells drawn behind the panels, and
            // positioned, for the corner handle.
            'relative bg-settings-page'
          : 'bg-settings-control/40',
        edit?.held
          ? // Dimmed inside and still opaque, so that the cells behind do
            // not show through the panel that is being carried.
            'border-dashed border-slate-400 *:opacity-40'
          : 'border-settings-hover',
        parked ? 'pointer-events-none invisible' : '',
      ].join(' ')}
    >
      {edit ? (
        <div className="settings-shell flex min-h-8 shrink-0 items-stretch border-b border-slate-700">
          <button
            type="button"
            data-handle="move"
            aria-label={`Move ${title}`}
            aria-describedby={edit.describedBy}
            title="Drag to move the panel"
            // No panning or scrolling of the page by a finger that drags.
            className={`flex min-w-0 flex-1 cursor-grab touch-none items-center gap-1.5 py-1 pr-2 pl-1.5 text-left select-none active:cursor-grabbing ${focusInside}`}
            onPointerDown={edit.onMoveStart}
            onKeyDown={edit.onKeyDown}
          >
            <DotsSixVerticalIcon
              size={14}
              weight="bold"
              className="shrink-0 text-slate-500"
            />
            <span className={`${titleClass} text-slate-300`}>{title}</span>
            {cells && (
              <span className="ml-auto shrink-0 text-[11px] text-slate-500 tabular-nums">
                {cellSizeLabel(cells)}
              </span>
            )}
          </button>
          <button
            type="button"
            className={`flex w-8 shrink-0 items-center justify-center text-slate-500 transition-colors hover:bg-slate-700 hover:text-slate-200 ${focusInside}`}
            title={`Take ${title} off the page`}
            aria-label={`Remove ${title}`}
            onClick={edit.onRemove}
          >
            <XIcon size={14} />
          </button>
        </div>
      ) : (
        <div className="settings-shell flex shrink-0 items-center justify-between gap-2 min-h-8 border-b border-slate-700 py-1 pr-1.5 pl-3">
          <h2 className={`${titleClass} text-slate-400`}>{title}</h2>
          {onOpenSettings && (
            <button
              type="button"
              className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-700 hover:text-slate-200"
              title={`Open ${title} settings`}
              aria-label={`Open ${title} settings`}
              onClick={onOpenSettings}
            >
              <GearIcon size={14} />
            </button>
          )}
        </div>
      )}
      {/* The same element arranged or not, with what it holds first in it:
          that is what keeps the widget as it is through an edit. */}
      <div
        className={
          // The frame is the widget's panel here: its own edge and corners
          // would draw a second box inside this one. The edge turns
          // transparent rather than zero width, so a warning colour the widget
          // sets on it (the Fuel Calculator's) still shows.
          `${edit ? 'invisible relative ' : ''}min-h-0 flex-1 [&_.overlay-panel]:rounded-none [&_.overlay-panel]:border-transparent [&_[data-panel-stack]]:gap-0 [&_[data-panel-stack]]:rounded-none`
        }
        inert={edit ? true : undefined}
      >
        {children}
        {edit && (
          <div
            data-item="placeholder"
            className="settings-shell visible absolute inset-0 flex flex-col items-center justify-center gap-0.5 overflow-hidden bg-settings-control/40 p-2 text-center"
          >
            <p className="max-w-full truncate text-sm font-semibold text-slate-200">
              {title}
            </p>
            {cells && (
              <p className="text-xs text-slate-400 tabular-nums">
                {cellSizeLabel(cells)} cells
              </p>
            )}
            {edit.note && <p className="text-xs text-amber-300">{edit.note}</p>}
          </div>
        )}
      </div>
      {edit && (
        <button
          type="button"
          // Sized from the keyboard with Shift and the arrows on the title
          // bar, so this is not a stop of the Tab key.
          tabIndex={-1}
          data-handle="size"
          aria-label={`Size ${title}`}
          title="Drag to size the panel"
          className="settings-shell absolute right-0 bottom-0 flex size-8 cursor-nwse-resize touch-none items-end justify-end rounded-tl-md p-0.5 text-slate-400 select-none hover:bg-slate-700 hover:text-slate-100"
          onPointerDown={edit.onSizeStart}
        >
          <NotchesIcon size={16} weight="bold" />
        </button>
      )}
    </section>
  )
);
PitWallPanel.displayName = 'PitWallPanel';

interface PitWallPanelNoteProps {
  message: string;
  action?: { label: string; onClick: () => void };
}

/** A line in place of a panel's content, with something to do about it. */
export const PitWallPanelNote = ({
  message,
  action,
}: PitWallPanelNoteProps) => (
  <div className="settings-shell flex h-full flex-col items-center justify-center gap-2 p-3 text-center text-sm text-slate-400">
    <p>{message}</p>
    {action && (
      <button
        type="button"
        className="settings-button"
        onClick={action.onClick}
      >
        {action.label}
      </button>
    )}
  </div>
);
PitWallPanelNote.displayName = 'PitWallPanelNote';
