import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import {
  SessionTimingStoreUpdater,
  useActiveSimulator,
  useDashboard,
  useRunningState,
  useSimWidgetSupport,
} from '@irdashies/context';
import {
  PIT_WALL_CUSTOM_LAYOUT_ID,
  PIT_WALL_GAP_PX,
  PIT_WALL_HOSTABLE,
  PIT_WALL_WIDGET_ID,
  getWidgetManifest,
  isWidgetDisabledForSim,
  pitWallCustomFreeSpace,
  pitWallPanelMinCells,
  simulatorDisplayName,
  type ResolvedPitWallPanel,
  type WidgetId,
} from '@irdashies/types';
import {
  PitWallEditBar,
  type PitWallAddable,
} from './components/PitWallEditBar/PitWallEditBar';
import {
  PIT_WALL_CELL_TRACKS,
  PitWallEditCells,
  PitWallEditTarget,
} from './components/PitWallEditGrid/PitWallEditGrid';
import { PitWallHeader } from './components/PitWallHeader/PitWallHeader';
import {
  PitWallPanel,
  PitWallPanelNote,
} from './components/PitWallPanel/PitWallPanel';
import { usePitWallReconnecting } from './PitWallConnection';
import { usePitWallDeviceLayout } from './PitWallDeviceLayout';
import { PitWallTabs } from './components/PitWallTabs/PitWallTabs';
import { useFullscreen } from './hooks/useFullscreen';
import { usePitWallCustomEdit } from './hooks/usePitWallCustomEdit';
import { usePitWallHeader } from './hooks/usePitWallHeader';
import {
  usePitWallPage,
  useSetPitWallCustom,
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

const titleOf = (widget: WidgetId): string =>
  getWidgetManifest(widget)?.name ?? widget;

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
 *
 * The Custom layout is the one the user arranges. In the app's own window
 * its header has an Edit layout button, which puts the page into a mode
 * where the panels are moved and sized by dragging, added and removed,
 * until Done saves the arrangement or Cancel drops it.
 */
export const PitWall = memo(({ renderPanel }: PitWallProps) => {
  const { bridge } = useDashboard();
  const { running } = useRunningState();
  const page = usePitWallPage();
  const header = usePitWallHeader();
  const setLayout = useSetPitWallLayout();
  const setTab = useSetPitWallTab();
  const setCustom = useSetPitWallCustom();
  const device = usePitWallDeviceLayout();
  const simulator = useActiveSimulator();
  const support = useSimWidgetSupport();
  const { fullscreen, toggle: toggleFullscreen } = useFullscreen();
  // Only ever true in a browser, whose page is fed over a socket.
  const reconnecting = usePitWallReconnecting();
  const stacked = page.stack !== undefined;
  const custom = page.layout.id === PIT_WALL_CUSTOM_LAYOUT_ID;
  // The panels have something to show: a sim is running a session.
  const live = running && header.inSession;

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

  // The arrangement of the Custom layout is the profile's, and a profile
  // is changed from the app's own window. A page in a browser shows the
  // arrangement as saved and is given no way to change it (rule R12.6):
  // it is told from the window twice over, by the bridge that can open no
  // settings and by its layout being a choice of the device. A phone is
  // never shown this layout at all.
  const editable = custom && canOpenSettings && device === null;
  const grid = useRef<HTMLElement>(null);
  const edit = usePitWallCustomEdit({
    saved: page.tab.cells,
    editable,
    onSave: setCustom,
    grid,
  });
  const { editing } = edit;
  const hintId = useId();

  // The keyboard goes back to the button the edit was begun with.
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && !editing) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  const simulatorName = simulatorDisplayName(simulator);
  const draft = edit.panels;
  const addable = useMemo<PitWallAddable[]>(
    () =>
      draft
        ? PIT_WALL_HOSTABLE.filter(
            (entry) => !draft.some((panel) => panel.widget === entry.widget)
          ).map(({ widget, kind }) => {
            const size = pitWallPanelMinCells(widget);
            return {
              widget,
              kind,
              title: titleOf(widget),
              size,
              hasRoom: pitWallCustomFreeSpace(draft, size) !== undefined,
              // It can be placed all the same: the arrangement is for
              // either sim, and the panel is there under the other.
              ...(isWidgetDisabledForSim(support, widget, simulator)
                ? { note: `not under ${simulatorName}` }
                : {}),
            };
          })
        : [],
    [draft, support, simulator, simulatorName]
  );

  /** What a panel of the page holds, arranged or not. */
  const bodyOf = (panel: ResolvedPitWallPanel): ReactNode => {
    const type = panel.slot.widget;
    const title = titleOf(type);
    return panel.status === 'missing' ? (
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
    );
  };

  const panels = (): ReactNode[] => {
    if (!draft) {
      return page.panels.map((panel, index) => {
        const type = panel.slot.widget;
        return (
          <PitWallPanel
            // By type alone, so a panel two tabs share stays as it was
            // left: the class chosen in the tower, the car in a list.
            key={type}
            title={titleOf(type)}
            area={stacked ? undefined : type}
            basis={page.stack?.[index]}
            // A panel with no widget offers its settings in its body.
            onOpenSettings={
              panel.status === 'ready' && canOpenSettings
                ? () => openSettings(panel.widget.id)
                : undefined
            }
          >
            {bodyOf(panel)}
          </PitWallPanel>
        );
      });
    }

    // Arranged, the page is the edit's copy of the list: every panel of it,
    // those the running sim leaves out as well, each a thing to move. A
    // panel the page was showing keeps what it holds, by the same key in
    // the same place in the tree, so its widget is never unmounted by an
    // edit: it reads on, unseen, and is as it was when the edit is over.
    const shown = new Map(
      live ? page.panels.map((panel) => [panel.slot.widget, panel]) : []
    );
    const arranged = draft.map((cells) => {
      const type = cells.widget;
      const panel = shown.get(type);
      return (
        <PitWallPanel
          key={type}
          title={titleOf(type)}
          cells={cells}
          edit={{
            held: edit.drag?.widget === type,
            note: isWidgetDisabledForSim(support, type, simulator)
              ? `Not shown under ${simulatorName}`
              : undefined,
            describedBy: hintId,
            onMoveStart: (event) => edit.beginDrag(type, 'move', event),
            onSizeStart: (event) => edit.beginDrag(type, 'size', event),
            onKeyDown: (event) => edit.stepByKey(type, event),
            onRemove: () => {
              edit.remove(type);
              // The button pressed goes with its panel. The keyboard is
              // left on the page, from where Tab reaches the next panel,
              // and not at the top of the window.
              grid.current?.focus();
            },
          }}
        >
          {panel ? bodyOf(panel) : null}
        </PitWallPanel>
      );
    });
    // A panel taken off the page in the edit is kept where it was, unseen
    // and out of reach, until the edit is over: Cancel brings it back with
    // nothing lost, and only Done lets it go.
    const parked = (page.tab.cells ?? []).flatMap((cells) => {
      const panel = shown.get(cells.widget);
      if (!panel || draft.some((entry) => entry.widget === cells.widget)) {
        return [];
      }
      return [
        <PitWallPanel
          key={cells.widget}
          title={titleOf(cells.widget)}
          cells={cells}
          parked
        >
          {bodyOf(panel)}
        </PitWallPanel>,
      ];
    });
    return [...arranged, ...parked];
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-settings-page text-white tabular-nums">
      {/* The header's clock. Hosted widgets that read the same store share it. */}
      <SessionTimingStoreUpdater enabled />
      {/* The strip and the tab bar as one positioned block, for the mark the
          strip hangs out while reconnecting: under the bar where there is
          one, so that it is on none of the tabs, and under the strip where
          there is none. */}
      <div className="relative shrink-0">
        <PitWallHeader
          data={header}
          layout={page.layout.id}
          // A phone is given the tabs whatever layout is chosen, so it is
          // offered no choice of one. Nor is a page being arranged: the
          // edit is ended first, by Done or by Cancel.
          onLayoutChange={stacked || editing ? undefined : setLayout}
          onEditLayout={editable && !editing ? edit.begin : undefined}
          editLayoutRef={editButton}
          fullscreen={fullscreen}
          onToggleFullscreen={toggleFullscreen}
          onOpenSettings={canOpenSettings ? openOwnSettings : undefined}
          reconnecting={reconnecting}
          markHangsOutside
          phone={stacked}
        />
        {editing && (
          <PitWallEditBar
            addable={addable}
            message={edit.message}
            hintId={hintId}
            onAdd={edit.add}
            onReset={edit.reset}
            onCancel={edit.cancel}
            onDone={edit.done}
          />
        )}
        {page.tabs.length > 1 && (
          <PitWallTabs
            tabs={page.tabs}
            tab={page.tab.id}
            onTabChange={setTab}
          />
        )}
      </div>
      {/* A page being arranged is drawn whatever the sim is doing: its
          panels are placed before a race as well as during one. */}
      {editing || (live && !(custom && page.panels.length === 0)) ? (
        <main
          ref={grid}
          className={
            stacked
              ? // Down the page only: a panel wider than a phone scrolls
                // sideways inside itself.
                'flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto'
              : editing
                ? // Positioned, for the cells drawn behind the panels.
                  'relative grid min-h-0 flex-1 select-none focus:outline-none'
                : 'grid min-h-0 flex-1'
          }
          // In focus only when it is put there, after a panel is taken off.
          tabIndex={editing ? -1 : undefined}
          data-layout={page.layout.id}
          data-tab={page.tab.id}
          data-stacked={stacked || undefined}
          data-editing={editing || undefined}
          style={{
            // The gap the grid reckoned its tracks with.
            gap: PIT_WALL_GAP_PX,
            padding: PIT_WALL_GAP_PX,
            ...(stacked
              ? {}
              : editing
                ? // Every cell a track: the panels are placed by their
                  // cells, which may be anywhere while they are moved.
                  PIT_WALL_CELL_TRACKS
                : {
                    gridTemplateColumns: page.grid.columns,
                    gridTemplateRows: page.grid.rows,
                    gridTemplateAreas: page.grid.areas,
                  }),
          }}
        >
          {editing && <PitWallEditCells />}
          {panels()}
          {edit.drag && (
            <PitWallEditTarget
              cells={edit.drag.cells}
              verdict={edit.drag.verdict}
            />
          )}
        </main>
      ) : !running ? (
        <EmptyState>
          No simulator is running. The Pit Wall fills in when Le Mans Ultimate
          or iRacing starts.
        </EmptyState>
      ) : !header.inSession ? (
        <EmptyState>
          Waiting for a session. The panels appear once you are in one.
        </EmptyState>
      ) : (
        <EmptyState>
          {editable
            ? 'The Custom layout has no panel to show. Choose Edit layout to put some on the page.'
            : 'The Custom layout has no panel to show. It is arranged in the Pit Wall window of Tearoff.'}
        </EmptyState>
      )}
    </div>
  );
});
PitWall.displayName = 'PitWall';
