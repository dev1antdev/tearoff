import { useEffect, useRef, type ReactNode } from 'react';
import { mockDashboardBridge } from '@irdashies/storybook';
import {
  defaultDashboard,
  type DashboardBridge,
  type WidgetConfigMap,
  type WidgetId,
} from '@irdashies/types';

/**
 * What the stories of a settings page share: a dashboard with one widget's
 * config changed, and a way to bring a section of a long page into view.
 * Used by stories only.
 */

/** The mock dashboard bridge, with one widget's saved config overridden. */
export const dashboardBridgeWith = <K extends WidgetId>(
  widgetId: K,
  config: Partial<WidgetConfigMap[K]>
): DashboardBridge => {
  const dashboard = {
    ...defaultDashboard,
    widgets: defaultDashboard.widgets.map((widget) =>
      widget.id === widgetId
        ? { ...widget, config: { ...widget.config, ...config } }
        : widget
    ),
  };
  return {
    ...mockDashboardBridge,
    dashboardUpdated: (callback) => {
      callback(dashboard, undefined);
      return () => undefined;
    },
  };
};

/** How often the page is looked at for the section, until it is there. */
const LOOK_EVERY_MS = 100;
const LOOK_FOR_MS = 5000;

/**
 * Brings the section with this heading to the top of the page, as scrolling
 * to it would. The page is drawn once the dashboard has loaded, so the
 * heading is looked for until it turns up.
 */
export const ShowSection = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const heading = [...(root.current?.querySelectorAll('h3') ?? [])].find(
        (candidate) => candidate.textContent === title
      );
      if (heading) heading.scrollIntoView({ block: 'start' });
      if (heading || Date.now() - startedAt > LOOK_FOR_MS) {
        clearInterval(timer);
      }
    }, LOOK_EVERY_MS);
    return () => clearInterval(timer);
  }, [title]);
  return (
    <div ref={root} className="contents">
      {children}
    </div>
  );
};
