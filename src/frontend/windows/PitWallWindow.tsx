import {
  DashboardProvider,
  RunningStateProvider,
  SessionProvider,
  useDashboard,
  useResetOnDisconnect,
  useRunningState,
} from '@irdashies/context';
import { WidgetScale } from '@irdashies/domain/widgetPresentation/WidgetScale';
import { PIT_WALL_WIDGET_ID } from '@irdashies/types';
import { PitWallHost } from '../components/PitWallHost/PitWallHost';
import { ThemeManager } from '../components/ThemeManager/ThemeManager';
import { WidgetRuntimeProvider } from '../widgetRuntime';

/**
 * The Pit Wall page as its window shows it, and as the settings preview does:
 * inside the overlay theme, which the hosted widgets keep, at the scale saved
 * for the page.
 */
export const PitWallContent = () => {
  const { running } = useRunningState();
  const { currentDashboard } = useDashboard();
  const pitWall = currentDashboard?.widgets.find(
    (widget) => (widget.type || widget.id) === PIT_WALL_WIDGET_ID
  );
  useResetOnDisconnect(running);
  return (
    <WidgetRuntimeProvider widgetType={PIT_WALL_WIDGET_ID}>
      <ThemeManager>
        <WidgetScale scale={pitWall?.scale}>
          <PitWallHost />
        </WidgetScale>
      </ThemeManager>
    </WidgetRuntimeProvider>
  );
};

export default function PitWallWindow() {
  return (
    <DashboardProvider bridge={window.dashboardBridge}>
      <RunningStateProvider bridge={window.irsdkBridge}>
        {/* The header reads the session; the panels' widgets share it. */}
        <SessionProvider bridge={window.irsdkBridge} />
        <PitWallContent />
      </RunningStateProvider>
    </DashboardProvider>
  );
}
