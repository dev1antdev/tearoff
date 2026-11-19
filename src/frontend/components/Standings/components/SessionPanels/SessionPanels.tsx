import type { ReactNode } from 'react';
import { IconContext } from '@phosphor-icons/react';
import type { SessionBarConfig } from '@irdashies/types';
import { OVERLAY_ICONS } from '@irdashies/utils/overlayIcons';
import { SessionBar } from '../SessionBar/SessionBar';

interface SessionPanelsProps {
  /** The session header bar, when it is shown. */
  header?: SessionBarConfig;
  /** The session footer bar, when it is shown. */
  footer?: SessionBarConfig;
  /** The bars' own background opacity (the widget's foreground opacity). */
  barOpacity?: number;
  compact: boolean;
  /** Fill the widget's height, clipping what does not fit. */
  fullHeight?: boolean;
  /** The widget's own panel, between the bars. */
  children: ReactNode;
}

/**
 * Standings and Relative as the overlay look draws them: the session's header
 * and footer bars are panels of their own above and below the widget's panel,
 * and every icon inside is thin. Marked as a stack of panels, so a Pit Wall or
 * Gantry frame closes it up into one box (docs/DESIGN_BOOK.md section 1).
 */
export const SessionPanels = ({
  header,
  footer,
  barOpacity,
  compact,
  fullHeight = false,
  children,
}: SessionPanelsProps) => (
  <IconContext.Provider value={OVERLAY_ICONS}>
    <div
      data-panel-stack
      className={`flex w-full flex-col ${fullHeight ? 'h-full overflow-hidden' : ''} ${compact ? 'gap-0.5' : 'gap-1.5'}`}
    >
      {header && (
        <SessionBar settings={header} opacity={barOpacity} position="header" />
      )}
      {children}
      {footer && (
        <SessionBar settings={footer} opacity={barOpacity} position="footer" />
      )}
    </div>
  </IconContext.Provider>
);
