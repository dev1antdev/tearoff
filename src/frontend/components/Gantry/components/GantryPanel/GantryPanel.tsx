import { memo, type ReactNode } from 'react';

interface GantryPanelProps {
  title?: string;
  /** Names the panel when it draws its own heading. */
  label?: string;
  /** Sits opposite the title, such as a count. */
  aside?: ReactNode;
  /** Leaves the body outside the settings theme, for hosted overlay widgets. */
  overlayContent?: boolean;
  children: ReactNode;
}

export const GantryPanel = memo(
  ({
    title,
    label,
    aside,
    overlayContent = false,
    children,
  }: GantryPanelProps) => (
    <section
      aria-label={label ?? title}
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-settings-hover bg-settings-control/40"
    >
      {title && (
        <div className="settings-shell flex shrink-0 items-baseline justify-between gap-4 px-4 py-2">
          <h2 className="text-lg leading-snug font-semibold text-slate-200">
            {title}
          </h2>
          {aside}
        </div>
      )}
      <div
        className={[
          'flex min-h-0 flex-1 flex-col',
          // A hosted widget fills the frame: its panel's own edge and corners
          // would draw a second box inside this one. The edge turns
          // transparent rather than zero width, so a warning colour the widget
          // sets on it (the Fuel Calculator's) still shows.
          overlayContent
            ? '[&_.overlay-panel]:rounded-none [&_.overlay-panel]:border-transparent [&_[data-panel-stack]]:gap-0 [&_[data-panel-stack]]:rounded-none'
            : 'settings-shell',
        ].join(' ')}
      >
        {children}
      </div>
    </section>
  )
);
GantryPanel.displayName = 'GantryPanel';
