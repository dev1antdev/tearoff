import { memo } from 'react';
import { WarningIcon } from '@phosphor-icons/react';
import type { DashboardWidget } from '@irdashies/types';
import { WidgetScale } from '@irdashies/domain/widgetPresentation/WidgetScale';
import { getWidget } from '../../WidgetIndex';
import { WidgetRuntimeProvider } from '../../widgetRuntime';
import { ErrorBoundary } from '../ErrorBoundary/ErrorBoundary';

interface HostedPanelMessageProps {
  message: string;
  action?: { label: string; onClick: () => void };
}

/** What a panel says when it has no widget to draw. */
export const HostedPanelMessage = ({
  message,
  action,
}: HostedPanelMessageProps) => (
  <div className="h-full flex flex-col items-center justify-center gap-2 p-3 text-center text-xs text-slate-400">
    <WarningIcon size={18} className="text-slate-500" />
    <p>{message}</p>
    {action && (
      <button
        type="button"
        onClick={action.onClick}
        className="text-sky-400 hover:text-sky-300 underline"
      >
        {action.label}
      </button>
    )}
  </div>
);

const PANEL_ERROR = (
  <HostedPanelMessage message="This panel hit a problem. It will try again shortly." />
);

export interface HostedWidgetProps {
  /** The dashboard widget to draw, with its saved config. */
  widget: DashboardWidget;
  /** A sim is feeding the app. */
  running: boolean;
  /** Names the host in the error log, as in `gantry-dock:fuel`. */
  host: string;
  /** Said in place of the widget while no sim is feeding it, if anything. */
  waitingMessage?: string;
  /**
   * The content scale in percent, absolute like the widget's own. Left out,
   * the widget is drawn at the scale saved for it on the overlay.
   */
  scale?: number;
  /**
   * This is the widget itself on the overlay, not a copy in a panel: it does
   * the saving a copy leaves to the original and, as on the overlay, says
   * nothing when it fails. `scale` may be a product of two scales, which is
   * not held to the range of one.
   */
  onOverlay?: boolean;
  /**
   * Let content larger than the panel scroll inside it, and say
   * `emptyMessage` when the widget draws nothing, which a widget does at
   * moments it has nothing to show. Without it the widget is clipped to the
   * panel, as on the overlay.
   */
  scroll?: { emptyMessage: string };
}

/**
 * An overlay widget drawn inside a panel of another window, the way the
 * overlay draws it: through the registry, inside its own error boundary and
 * with its own channel rates. Shared by the Gantry dock and the Pit Wall.
 */
export const HostedWidget = memo(
  ({
    widget,
    running,
    host,
    waitingMessage,
    scale,
    onOverlay = false,
    scroll,
  }: HostedWidgetProps) => {
    const type = widget.type || widget.id;
    const Widget = getWidget(type);
    if (!Widget) return null;

    if (!running && !widget.alwaysEnabled) {
      return waitingMessage ? (
        <HostedPanelMessage message={waitingMessage} />
      ) : null;
    }

    // embedded: this copy must never write to disk.
    const content = (
      <Widget {...widget.config} {...(!onOverlay && { embedded: true })} />
    );

    return (
      <ErrorBoundary
        label={`${host}:${type}`}
        resetAfterMs={2000}
        fallback={onOverlay ? undefined : PANEL_ERROR}
      >
        <WidgetRuntimeProvider widgetType={type} widgetId={widget.id}>
          <WidgetScale scale={scale ?? widget.scale} exact={onOverlay}>
            {scroll ? (
              // Inside the scale, so the scrolling is in the widget's own
              // pixels and the scrollbar is not scaled away from the edge.
              <div className="h-full overflow-auto">
                <div className="peer h-full empty:hidden">{content}</div>
                {/* Faded in after a second, so it is not flashed while the
                    widget's code is still loading and has drawn nothing. */}
                <p className="hidden h-full items-center justify-center p-3 text-center text-xs text-slate-400 transition-opacity delay-1000 duration-300 peer-empty:flex starting:opacity-0">
                  {scroll.emptyMessage}
                </p>
              </div>
            ) : (
              content
            )}
          </WidgetScale>
        </WidgetRuntimeProvider>
      </ErrorBoundary>
    );
  }
);
HostedWidget.displayName = 'HostedWidget';
