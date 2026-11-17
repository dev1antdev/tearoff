import { memo, type ReactNode } from 'react';
import { GearIcon } from '@phosphor-icons/react';

interface PitWallPanelProps {
  title: string;
  /** The panel's `grid-area` in the page's grid. */
  area?: string;
  /**
   * Where the panels are one under another instead of in a grid: the
   * height this one has at the least, as a CSS length.
   */
  basis?: string;
  /** Opens the settings of what the panel shows; no button without it. */
  onOpenSettings?: () => void;
  children: ReactNode;
}

/**
 * One panel of the Pit Wall: a titled frame in the settings theme around a
 * body that is left outside it, because the body holds an overlay widget
 * that keeps its own look.
 */
export const PitWallPanel = memo(
  ({ title, area, basis, onOpenSettings, children }: PitWallPanelProps) => (
    <section
      aria-label={title}
      style={
        area
          ? { gridArea: area }
          : basis !== undefined
            ? // Never shrunk: the page scrolls past what does not fit.
              // Grown only where the panels together leave room over.
              { flex: `1 0 ${basis}` }
            : undefined
      }
      className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-settings-hover bg-settings-control/40"
    >
      <div className="settings-shell flex shrink-0 items-center justify-between gap-2 min-h-8 border-b border-slate-700 py-1 pr-1.5 pl-3">
        <h2 className="truncate text-[11px] font-bold tracking-[0.1em] text-slate-400 uppercase">
          {title}
        </h2>
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
      <div className="min-h-0 flex-1">{children}</div>
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
