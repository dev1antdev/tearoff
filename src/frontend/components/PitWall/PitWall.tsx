import { memo, useCallback, type ReactNode } from 'react';
import {
  SessionTimingStoreUpdater,
  useDashboard,
  useRunningState,
} from '@irdashies/context';
import {
  PIT_WALL_GAP_PX,
  PIT_WALL_WIDGET_ID,
  getWidgetManifest,
  type ResolvedPitWallPanel,
} from '@irdashies/types';
import { PitWallHeader } from './components/PitWallHeader/PitWallHeader';
import {
  PitWallPanel,
  PitWallPanelNote,
} from './components/PitWallPanel/PitWallPanel';
import { usePitWallReconnecting } from './PitWallConnection';
import { PitWallTabs } from './components/PitWallTabs/PitWallTabs';
import { useFullscreen } from './hooks/useFullscreen';
import { usePitWallHeader } from './hooks/usePitWallHeader';
import {
  usePitWallPage,
  useSetPitWallLayout,
  useSetPitWallTab,
} from './hooks/usePitWallPage';

export interface PitWallProps {
  /**
   * Draws what a panel hosts. The window's host passes it, the way the Gantry
   * is handed its dock: this page only receives what it renders. Without one
   * a panel names its widget and nothing more.
   */
  renderPanel?: (panel: ResolvedPitWallPanel) => ReactNode;
}

const panelTitle = (panel: ResolvedPitWallPanel) =>
  getWidgetManifest(panel.slot.widget)?.name ?? panel.slot.widget;

const EmptyState = ({ children }: { children: ReactNode }) => (
  <div className="settings-shell flex min-h-0 flex-1 items-center justify-center p-6 text-center text-base text-slate-400">
    <p className="max-w-md">{children}</p>
  </div>
);

/**
 * The Pit Wall page: a header about the session and our car over the panels
 * of the chosen layout, each of which hosts one of the app's widgets. A
 * layout made of tabs has a bar of them under the header. The panels are a
 * fixed grid, or on a phone a stack the page scrolls down.
 */
export const PitWall = memo(({ renderPanel }: PitWallProps) => {
  const { bridge } = useDashboard();
  const { running } = useRunningState();
  const page = usePitWallPage();
  const header = usePitWallHeader();
  const setLayout = useSetPitWallLayout();
  const setTab = useSetPitWallTab();
  const { fullscreen, toggle: toggleFullscreen } = useFullscreen();
  // Only ever true in a browser, whose page is fed over a socket.
  const reconnecting = usePitWallReconnecting();
  const stacked = page.stack !== undefined;

  // The settings window is the app's. A browser has no way to open it, so
  // the page it shows is drawn without the gears that would.
  const canOpenSettings = typeof bridge.openWidgetSettings === 'function';
  const openSettings = useCallback(
    (target: string) => void bridge.openWidgetSettings?.(target),
    [bridge]
  );
  const openOwnSettings = useCallback(
    () => openSettings(PIT_WALL_WIDGET_ID),
    [openSettings]
  );

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-settings-page text-white tabular-nums">
      {/* The header's clock. Hosted widgets that read the same store share it. */}
      <SessionTimingStoreUpdater enabled />
      <PitWallHeader
        data={header}
        layout={page.layout.id}
        // A phone is given the tabs whatever layout is chosen, so it is
        // offered no choice of one.
        onLayoutChange={stacked ? undefined : setLayout}
        fullscreen={fullscreen}
        onToggleFullscreen={toggleFullscreen}
        onOpenSettings={canOpenSettings ? openOwnSettings : undefined}
        reconnecting={reconnecting}
      />
      {page.tabs.length > 1 && (
        <PitWallTabs tabs={page.tabs} tab={page.tab.id} onTabChange={setTab} />
      )}
      {!running ? (
        <EmptyState>
          No simulator is running. The Pit Wall fills in when Le Mans Ultimate
          or iRacing starts.
        </EmptyState>
      ) : !header.inSession ? (
        <EmptyState>
          Waiting for a session. The panels appear once you are in one.
        </EmptyState>
      ) : (
        <main
          className={
            stacked
              ? // Down the page only: a panel wider than a phone scrolls
                // sideways inside itself.
                'flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto'
              : 'grid min-h-0 flex-1'
          }
          data-layout={page.layout.id}
          data-tab={page.tab.id}
          data-stacked={stacked || undefined}
          style={{
            // The gap the grid reckoned its tracks with.
            gap: PIT_WALL_GAP_PX,
            padding: PIT_WALL_GAP_PX,
            ...(stacked
              ? {}
              : {
                  gridTemplateColumns: page.grid.columns,
                  gridTemplateRows: page.grid.rows,
                  gridTemplateAreas: page.grid.areas,
                }),
          }}
        >
          {page.panels.map((panel, index) => {
            const title = panelTitle(panel);
            const type = panel.slot.widget;
            return (
              <PitWallPanel
                // By type alone, so a panel two tabs share stays as it was
                // left: the class chosen in the tower, the car in a list.
                key={type}
                title={title}
                area={stacked ? undefined : type}
                basis={page.stack?.[index]}
                // A panel with no widget offers its settings in its body.
                onOpenSettings={
                  panel.status === 'ready' && canOpenSettings
                    ? () => openSettings(panel.widget.id)
                    : undefined
                }
              >
                {panel.status === 'missing' ? (
                  <PitWallPanelNote
                    message={`This profile has no ${title} widget.`}
                    action={
                      canOpenSettings
                        ? {
                            label: `Open ${title} settings`,
                            onClick: () => openSettings(type),
                          }
                        : undefined
                    }
                  />
                ) : renderPanel ? (
                  renderPanel(panel)
                ) : (
                  <PitWallPanelNote message={`${title} is shown here.`} />
                )}
              </PitWallPanel>
            );
          })}
        </main>
      )}
    </div>
  );
});
PitWall.displayName = 'PitWall';
