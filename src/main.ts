import { setupStorageStatusBridge } from './app/bridge/storageStatusBridge';
import { setupWidgetPreviewBridge } from './app/bridge/widgetPreviewBridge';
import { setupWindowVisibilityBridge } from './app/bridge/windowVisibilityBridge';
import { app, autoUpdater, BrowserWindow, ipcMain } from 'electron';
import { setupReleaseNotesBridge } from './app/bridge/releaseNotesBridge';
import log from './app/logger';
import {
  iRacingSDKSetup,
  getActiveSimulator,
  getCurrentBridge,
  getIsDemoMode,
  getSessionLifecycle,
  onActiveSimulatorChanged,
  onBridgeChanged,
  onConnectedSimulatorChanged,
} from './app/bridge/iracingSdk/setup';
import {
  applyDefaultsToAllProfiles,
  getOrCreateDefaultDashboard,
  getCurrentProfileId,
  getProfile,
  listDashboards,
  setCurrentProfile,
} from './app/storage/dashboards';
import {
  getHideOverlayWhenPaused,
  getSessionProfileMap,
  setHideOverlayWhenPaused,
} from './app/storage/appSettings';
import { createOverlayVisibility } from './app/overlayVisibility';
import { watchGamePause } from './app/overlayPauseWatch';
import { setupOverlayVisibilityBridge } from './app/bridge/overlayVisibilityBridge';
import { createSessionProfileSwitcher } from './app/services/sessionProfileSwitcher';
import type { SessionProfileSwitcher } from './app/services/sessionProfileSwitcher';
import { setupTaskbar, KeybindingManager } from './app';
import {
  publishDashboardUpdates,
  dashboardBridge,
} from './app/bridge/dashboard/dashboardBridge';
import { setupPitLaneBridge } from './app/bridge/pitLaneBridge';
import { setupFuelCalculatorBridge } from './app/bridge/fuelCalculatorBridge';
import { OverlayManager } from './app/overlayManager';
import {
  startComponentServer,
  getComponentServerHost,
  getComponentServerPort,
} from './app/webserver/componentServer';
import { updateElectronApp } from 'update-electron-app';
// @ts-expect-error no types for squirrel
import started from 'electron-squirrel-startup';
import { Analytics } from './app/analytics';
import { onAnalyticsOptOutChanged } from './app/storage/analytics';
import { setupKeybindingsBridge } from './app/bridge/keybindingsBridge';
import { setupLogBridge } from './app/bridge/logBridge';
import { setupPersonalBestLapTimesBridge } from './app/bridge/personalBestLapTimesBridge';
import {
  getGarage61SearchInfoFromSession,
  setupLapTraceBridge,
} from './app/bridge/lapTraceBridge';
import {
  validateReferenceLapFile,
  flushReferenceLapsOnShutdown,
} from './app/storage/referenceLaps';
import {
  closeLapLibraryOnShutdown,
  startLapLibrary,
} from './app/storage/lapLibrary';
import { PlayerLedgerRuntime } from './app/processors/playerLedgerRuntime';
import { setLivePlayerStintSource } from './app/processors/livePlayerStint';
import { wirePlayerLapRecording } from './app/playerLapRecording';
import { setupLapLibraryBridge } from './app/bridge/lapLibraryBridge';
import { flushLapTracesOnShutdown } from './app/storage/lapTraces';
import { flushPitLaneDataOnShutdown } from './app/storage/pitLaneData';
import {
  flushGarage61SearchSessionOnShutdown,
  saveGarage61SearchSession,
} from './app/storage/garage61SearchSession';
import { flushStorageWritesOnShutdown } from './app/storage/storage';
import {
  initializeSettingsWindowBounds,
  flushSettingsWindowBoundsOnShutdown,
} from './app/storage/settingsWindowBounds';
import {
  initializePitWallWindowBounds,
  flushPitWallWindowBoundsOnShutdown,
} from './app/storage/pitWallWindowBounds';
import { flushSimulatorUsageOnShutdown } from './app/storage/simulatorUsage';
import { flushTrackCarStoreOnShutdown } from './app/storage/trackCarStore';
import { brakeLimitStore, getWearTuning } from './app/storage/wearForecast';
import { flushTrackProfilesOnShutdown } from './app/storage/trackProfiles';
import {
  getSessionTrackKey,
  setupTrackProfileRecording,
  startTrackProfiles,
} from './app/trackProfileRecording';
import { setupTrackProfileBridge } from './app/bridge/trackProfileBridge';
import { setupChromiumFlagsBridge } from './app/bridge/chromiumFlagsBridge';
import { getHiddenWidgets } from './app/widgetVisibility';
import { setupRaceControlBridge } from './app/bridge/raceControlBridge';
import { setupPitWallBridge } from './app/bridge/pitWallBridge';
import { setupRacePlanBridge } from './app/bridge/racePlanBridge';
import { flushRacePlanHistoryOnShutdown } from './app/storage/racePlanHistory';
import {
  flushPitStopHistoryOnShutdown,
  getPitStopHistoryStore,
} from './app/storage/pitStopHistory';
import { PitStopRuntime } from './app/processors/pitStopRuntime';
import {
  flushIncidentsOnShutdown,
  appendIncident,
  listArchivedIncidentSessions,
} from './app/storage/incidentStorage';
import {
  IncidentRuntime,
  type IncidentPersistence,
  type PerformanceSections,
} from './app/processors/incidentRuntime';
import { LapHistoryRuntime } from './app/processors/lapHistoryRuntime';
import { watchLapHistoryDemand } from './app/lapHistoryDemand';
import { createLapHistoryArchive } from './app/lapHistoryArchive';
import { watchPitStopDemand } from './app/pitStopDemand';
import { createPitStopArchive } from './app/pitStopArchive';
import { canSimulatorShowRacePlan } from './app/racePlanDemand';
import {
  flushLapHistoryOnShutdown,
  listArchivedLapHistorySessions,
  loadArchivedLapHistory,
  pruneOldSessions as pruneOldLapHistorySessions,
} from './app/storage/lapHistoryStorage';
import { ReplayContextRuntime } from './app/processors/replayContextRuntime';
import { setupTapeReplayBridge } from './app/bridge/tapeReplayBridge';
import { createTapeReplayWindow } from './app/tapeReplayWindow';
import type { ArchiveIndex } from './app/processors/ReplayContextProcessor';
import { flushRadarPoleSideOverrides } from './app/storage/radarPoleSideOverrides';
import { createKnownLocalUserIdStore } from './app/storage/knownLocalUserIds';
import { setupLapHistoryBridge } from './app/bridge/lapHistoryBridge';
import { onDashboardUpdated } from './app/storage/dashboardEvents';
import { setupStreamChat } from './app/streamChat/setupStreamChat';
import {
  getSimWidgetSupport,
  loadSimWidgetSupport,
} from './app/storage/simWidgetSupport';
import { simulatorHasUniqueSessionIds } from '@irdashies/types';
import type { DashboardLayout, Session } from '@irdashies/types';
import { getActivePerfMetrics } from './app/perfMetrics';
import {
  createPerfDashboard,
  getPerfRunConfig,
  updatePerfDashboardMetadata,
  PERF_CAPTURE_ORIGIN_LOG_PREFIX,
  PERF_VISIBILITY_LOG_PREFIX,
} from './app/perfRunConfig';
import { ChannelBus, setupChannelBridge } from './app/bridge/channelBridge';
import { connectSessionLifecycleChannel } from './app/bridge/sessionLifecycleChannel';
import { setupRendererDataSubscriptions } from './app/bridge/rendererDataSubscriptions';
import { PerfHeapProfiler } from './app/perfHeapProfiler';
import { createBeforeQuitHandler } from './app/shutdownCoordinator';
import { monitorDevParent } from './app/devParentMonitor';
import { flushWindowMovementOnShutdown } from './app/trackWindowMovement';

const safeErrorDetails = (error: unknown) => {
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
      ? error.code
      : undefined;
  return {
    name: error instanceof Error ? error.name : 'UnknownError',
    ...(code ? { code } : {}),
  };
};

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) app.quit();

// Only the released build auto-updates.
//
// The update feed is this fork's own GitHub releases (package.json
// `repository`), which only ever publish the app named below. A build with a
// different app identity (a side-by-side beta with another name/productName)
// that checked the feed would be offered a release built for a *different*
// application, download it in the background, and Squirrel would apply it on
// the next launch — after which that build no longer starts. The version
// number is not the problem and bumping it would not help; the identity
// mismatch is. Keep this in step with `name`/`productName` in package.json.
if (app.getName() === 'tearoff') {
  updateElectronApp();
} else {
  log.info(
    `[update] Auto-update disabled for non-official build "${app.getName()}"`
  );
}

const overlayManager = new OverlayManager();
const analytics = new Analytics();
const perfRun = getPerfRunConfig();
analytics.setupLogTransport(overlayManager.getVersion());
// Before any bridge exists, so the first connect is heard even when the sim
// was already running as Tearoff started.
onConnectedSimulatorChanged((simulator) =>
  analytics.setConnectedSimulator(simulator)
);
getSessionLifecycle().onWatchingStateChange((watching) =>
  analytics.setWatchingTrack(watching)
);
onAnalyticsOptOutChanged((optOut) => void analytics.setOptOut(optOut));

overlayManager.setupChromiumFlags();
overlayManager.setupHardwareAcceleration();
overlayManager.setupSingleInstanceLock();
const releaseNotes = overlayManager.hasLock()
  ? setupReleaseNotesBridge()
  : undefined;
overlayManager.setupAutoStart();

// Hoisted so the quit handler can tear down the WebHID host window cleanly.
let keybindingManager: KeybindingManager | undefined;
// Whether the overlay is drawn at all. One state for the shortcut, the tray,
// the settings window and the pause watch, so none of them can disagree with
// what is on screen. Created here because the storage it reads is ready and
// the windows that follow it are not yet.
const overlayVisibility = createOverlayVisibility({
  hideWhenPaused: getHideOverlayWhenPaused(),
  logError: (message, error) => log.error(message, error),
});
let disposeOverlayVisibility: (() => void) | undefined;
const channelBus = new ChannelBus({
  deliveryEnabled: !perfRun.enabled || perfRun.channelDelivery === 'on',
});
let disconnectLifecycleChannel: (() => void) | undefined;
let sessionProfileSwitcher: SessionProfileSwitcher | undefined;
let incidentRuntime: IncidentRuntime | undefined;
let disposeLapHistoryRuntime: (() => void) | undefined;
let disposeLapLibraryRecording: (() => void) | undefined;
let disposeTrackProfileRecording: (() => void) | undefined;
let disposePitStopRuntime: (() => void) | undefined;
let disposeStreamChat: (() => void) | undefined;
let disposeReplayContextRuntime: (() => void) | undefined;
const knownLocalUserIds = createKnownLocalUserIdStore();
let disposeGarage61SearchSession: (() => void) | undefined;
let racePlan: ReturnType<typeof setupRacePlanBridge> | undefined;
// Resolved per call: a runtime outlives any single SDK bridge, so it must
// not hold a reference to a metrics instance that has stopped reporting.
const runtimePerfMetrics: PerformanceSections = {
  markStart: (label) => getActivePerfMetrics()?.markStart(label),
  markEnd: (label) => getActivePerfMetrics()?.markEnd(label),
};
const incidentPersistence: IncidentPersistence = {
  save: (sessionId, incident) => {
    appendIncident(sessionId, incident).catch((err) =>
      log.error('[RaceControl] Failed to persist incident:', err)
    );
  },
};
/**
 * Whether the running simulator's session id names this event and no other.
 * Read at each use: left on auto-detect the simulator is named only once a
 * game is found, and a profile can pin another one later.
 */
const sessionIdNamesOneEvent = () =>
  simulatorHasUniqueSessionIds(getActiveSimulator());
const lapHistoryPersistence = createLapHistoryArchive({
  canArchive: sessionIdNamesOneEvent,
  logError: (message, error) => log.error(message, error),
});
/** Session numbers this PC archived for an event: incidents or lap history. */
const replayArchiveIndex: ArchiveIndex = {
  has: async (subSessionId) => {
    const [incidentSessions, lapSessions] = await Promise.all([
      listArchivedIncidentSessions(subSessionId),
      listArchivedLapHistorySessions(subSessionId),
    ]);
    return [...incidentSessions, ...lapSessions];
  },
};
let disposeRendererDataSubscriptions: (() => void) | undefined;

/**
 * Records every lap the player completes into the lap library, with what
 * the lap cost and the stint it belongs to, and publishes the player's
 * ledger and stint channels.
 *
 * Hosted outside the ProcessorHost, like the lap history: a processor runs
 * only while a window wants its channel, and a library that recorded laps
 * only while some widget happened to be on screen would have holes nobody
 * could explain.
 */
function setupLapLibraryRecording(replayContext: ReplayContextRuntime): void {
  const library = startLapLibrary();
  const disposeBridge = setupLapLibraryBridge(library);
  const lifecycle = getSessionLifecycle();
  // A tape is somebody's old session played back for development: its laps
  // are not the player's.
  const isTapeReplay = Boolean(
    process.env.IRDASHIES_TELEMETRY_REPLAY || process.env.IRDASHIES_LMU_REPLAY
  );
  const bootId = Date.now().toString(36);
  let ledger: PlayerLedgerRuntime | undefined;
  let replaySource = false;

  // A tape, a replay source and demo mode are measured and shown, but none
  // of it is the player's to keep. With a replay file loaded nothing is
  // measured at all: scrubbing is not driving.
  const applyEnabled = () => {
    ledger?.setPersisting(!isTapeReplay && !replaySource && !getIsDemoMode());
    ledger?.setPaused(replayContext.isReplayFile());
  };
  // Before any ledger exists, so that one hears of a replay source before
  // it starts over for the new connection.
  const unsubscribeEnter = lifecycle.onEnter(({ replay }) => {
    replaySource = replay;
    applyEnabled();
  });

  // The simulator as well as the bridge: left on auto-detect, the bridge is
  // there before any game is found, and the recorder can only be made once
  // the simulator has a name.
  const disposeWiring = wirePlayerLapRecording({
    getBridge: getCurrentBridge,
    getSimulator: getActiveSimulator,
    onBridgeChanged,
    onSimulatorChanged: onActiveSimulatorChanged,
    createRecorder: (simulator) => {
      log.info(`[LapLibrary] Recording the player's laps for ${simulator}`);
      return new PlayerLedgerRuntime(
        channelBus,
        lifecycle,
        runtimePerfMetrics,
        library,
        {
          simulator,
          bootId,
          now: () => Date.now(),
          log: (message) => log.info(message),
          logError: (message, error) => log.error(message, error),
          // Where a tyre and a disc are finished is the wear widget's to
          // say; what a failed brake taught is kept per car.
          wear: { tuning: getWearTuning, limits: brakeLimitStore },
        }
      );
    },
    onRecorderChanged: (next) => {
      // The one before stores what it has in hand and lets go.
      ledger?.dispose();
      ledger = next;
      // Its stints are where the best lap of a stint ends.
      setLivePlayerStintSource(next);
      applyEnabled();
    },
  });
  const unsubscribeReplayContext = replayContext.onChange(applyEnabled);

  // Before the library closes: the lap waiting for its time and the open
  // stint are stored by this.
  disposeLapLibraryRecording = () => {
    disposeWiring();
    unsubscribeEnter();
    unsubscribeReplayContext();
    disposeBridge();
    ledger?.dispose();
    ledger = undefined;
    setLivePlayerStintSource(undefined);
  };
}

/**
 * Hosts lap-history recording outside the ProcessorHost, the way the incident
 * runtime is hosted: an enabled Gantry keeps recording while its window is
 * closed. Gated on widgets whose manifest sets `usesLapHistory` and on live
 * subscribers such as browser sources, so a user who uses none of them pays
 * no frame cost.
 */
function setupLapHistoryRuntime(
  initialDashboard: DashboardLayout,
  replayContext: ReplayContextRuntime
): void {
  const runtime = new LapHistoryRuntime(
    channelBus,
    getSessionLifecycle(),
    runtimePerfMetrics,
    lapHistoryPersistence
  );
  runtime.updateReplayPaused(replayContext.isReplayFile());
  const unsubscribeReplayContext = replayContext.onChange((context) =>
    runtime.updateReplayPaused(context.mode === 'replayFile')
  );
  setupLapHistoryBridge({
    getCurrentSessionId: () => runtime.getCurrentSessionId(),
    canReadArchive: () => replayContext.canReadArchive(),
    load: (sessionId, sessionNum) =>
      loadArchivedLapHistory(sessionId, sessionNum),
  });

  const unsubscribeDemand = watchLapHistoryDemand(
    channelBus,
    initialDashboard,
    onDashboardUpdated,
    (needed) => runtime.updateEnabled(needed),
    (layout) => createPerfDashboard(layout, perfRun)
  );

  let unsubscribeSession: (() => void) | undefined;
  let unsubscribeTelemetry: (() => void) | undefined;
  const wireToTelemetryBridge = () => {
    unsubscribeSession?.();
    unsubscribeTelemetry?.();
    const bridge = getCurrentBridge();
    if (!bridge) return;
    unsubscribeSession =
      bridge.onSessionData((session) => runtime.onSession(session)) ??
      undefined;
    unsubscribeTelemetry =
      bridge.onTelemetry((telemetry) => runtime.onFrame(telemetry)) ??
      undefined;
  };
  wireToTelemetryBridge();
  const unsubscribeBridgeChanged = onBridgeChanged(wireToTelemetryBridge);

  // Retention: the current race plus one previous race.
  const unsubscribeSessionId = runtime.onSessionIdChanged((sessionId) => {
    // A replay's event is not the newest race, so pruning around it would
    // delete a newer archive. Nor is a session that is not archived at all:
    // it has no file to keep, and would cost an older race its own.
    if (!sessionId || replayContext.isReplayFile() || !sessionIdNamesOneEvent())
      return;
    pruneOldLapHistorySessions(sessionId).catch((err) =>
      log.error('[LapHistory] Failed to prune old sessions:', err)
    );
  });

  // Every inbound subscription has to stop before the shutdown flush, or a late
  // frame can schedule a debounced write that the flush has already passed.
  disposeLapHistoryRuntime = () => {
    unsubscribeSession?.();
    unsubscribeTelemetry?.();
    unsubscribeSession = undefined;
    unsubscribeTelemetry = undefined;
    unsubscribeBridgeChanged?.();
    unsubscribeDemand();
    unsubscribeSessionId?.();
    unsubscribeReplayContext();
    runtime.dispose();
  };
}

/**
 * Builds each track's profile (its elevation, its line and its sector
 * starts) from the laps the player drives. Always on and outside the
 * ProcessorHost, like the lap library and for the same reason; like it, it
 * takes nothing from a tape, a replay or demo mode.
 *
 * The settings window reaches the same profiles over a bridge of their own:
 * the notes editor, and the elevation widget's "record again".
 */
function setupTrackProfiles(replayContext: ReplayContextRuntime): void {
  const isTapeReplay = Boolean(
    process.env.IRDASHIES_TELEMETRY_REPLAY || process.env.IRDASHIES_LMU_REPLAY
  );
  const profiles = startTrackProfiles();
  const disposeBridge = setupTrackProfileBridge({
    store: profiles,
    getSessionTrackKey,
  });
  const disposeRecording = setupTrackProfileRecording({
    store: profiles,
    getBridge: getCurrentBridge,
    getSimulator: getActiveSimulator,
    onBridgeChanged,
    onSimulatorChanged: onActiveSimulatorChanged,
    lifecycle: getSessionLifecycle(),
    isLive: () =>
      !isTapeReplay && !replayContext.isReplayFile() && !getIsDemoMode(),
    onLiveChanged: (callback) => replayContext.onChange(callback),
    metrics: runtimePerfMetrics,
    logInfo: (message) => log.info(message),
    logError: (message, error) => log.error(message, error),
  });
  disposeTrackProfileRecording = () => {
    disposeBridge();
    disposeRecording();
  };
}

// Kept on disk only under a session id that names one event: with the Pit
// Wall a reason to record them, stops are recorded under Le Mans Ultimate
// too, whose id the next race at the same track shares.
const pitStopPersistence = createPitStopArchive({
  canArchive: sessionIdNamesOneEvent,
  store: getPitStopHistoryStore,
});

/**
 * Hosts pit stop recording like lap history: gated on the Gantry and the Pit
 * Wall, and kept running while their windows are closed. Not for a widget
 * the running simulator hides, which leaves the widget's own switch as the
 * user set it.
 */
function setupPitStopRuntime(
  initialDashboard: DashboardLayout,
  replayContext: ReplayContextRuntime
): void {
  const runtime = new PitStopRuntime(
    channelBus,
    getSessionLifecycle(),
    runtimePerfMetrics,
    pitStopPersistence
  );
  runtime.updateReplayPaused(replayContext.isReplayFile());
  const unsubscribeReplayContext = replayContext.onChange((context) =>
    runtime.updateReplayPaused(context.mode === 'replayFile')
  );

  const unsubscribeDemand = watchPitStopDemand({
    initialLayout: initialDashboard,
    onDashboardUpdated,
    getSimulator: getActiveSimulator,
    onSimulatorChanged: onActiveSimulatorChanged,
    getSupport: getSimWidgetSupport,
    onChange: (needed) => runtime.updateEnabled(needed),
  });

  let unsubscribeSession: (() => void) | undefined;
  let unsubscribeTelemetry: (() => void) | undefined;
  const wireToTelemetryBridge = () => {
    unsubscribeSession?.();
    unsubscribeTelemetry?.();
    const bridge = getCurrentBridge();
    if (!bridge) return;
    unsubscribeSession =
      bridge.onSessionData((session) => runtime.onSession(session)) ??
      undefined;
    unsubscribeTelemetry =
      bridge.onTelemetry((telemetry) => runtime.onFrame(telemetry)) ??
      undefined;
  };
  wireToTelemetryBridge();
  const unsubscribeBridgeChanged = onBridgeChanged(wireToTelemetryBridge);

  disposePitStopRuntime = () => {
    unsubscribeSession?.();
    unsubscribeTelemetry?.();
    unsubscribeSession = undefined;
    unsubscribeTelemetry = undefined;
    unsubscribeBridgeChanged?.();
    unsubscribeDemand();
    unsubscribeReplayContext();
    runtime.dispose();
  };
}

/**
 * Hosts the replay context outside the ProcessorHost. It is created before the
 * incident and lap-history runtimes and wired to the bridge first, so a
 * replay file is recognised before they see its session. Frames are only read
 * while lap history is recorded; sessions are always read so this PC's user
 * ids are remembered.
 */
function setupReplayContextRuntime(
  initialDashboard: DashboardLayout
): ReplayContextRuntime {
  const runtime = new ReplayContextRuntime(
    channelBus,
    getSessionLifecycle(),
    runtimePerfMetrics,
    replayArchiveIndex,
    knownLocalUserIds,
    {
      isLiveSource: () =>
        !getIsDemoMode() &&
        !process.env.IRDASHIES_TELEMETRY_REPLAY &&
        !process.env.IRDASHIES_LMU_REPLAY &&
        process.env.IRDASHIES_IRSDK_REPLAY !== '1',
    }
  );

  let readFrames = false;
  const unsubscribeDemand = watchLapHistoryDemand(
    channelBus,
    initialDashboard,
    onDashboardUpdated,
    (needed) => {
      readFrames = needed;
    },
    (layout) => createPerfDashboard(layout, perfRun)
  );

  let unsubscribeSession: (() => void) | undefined;
  let unsubscribeTelemetry: (() => void) | undefined;
  const wireToTelemetryBridge = () => {
    unsubscribeSession?.();
    unsubscribeTelemetry?.();
    const bridge = getCurrentBridge();
    if (!bridge) return;
    unsubscribeSession =
      bridge.onSessionData((session) => runtime.onSession(session)) ??
      undefined;
    unsubscribeTelemetry =
      bridge.onTelemetry((telemetry) => {
        if (readFrames) runtime.onFrame(telemetry);
      }) ?? undefined;
  };
  wireToTelemetryBridge();
  const unsubscribeBridgeChanged = onBridgeChanged(wireToTelemetryBridge);

  disposeReplayContextRuntime = () => {
    unsubscribeSession?.();
    unsubscribeTelemetry?.();
    unsubscribeSession = undefined;
    unsubscribeTelemetry = undefined;
    unsubscribeBridgeChanged?.();
    unsubscribeDemand();
    runtime.dispose();
  };
  return runtime;
}

/**
 * Remembers the track and car being driven so the Settings window can offer a
 * Garage 61 lap-search link for them.
 *
 * Gated on the LapTrace widget, the only thing that uses the link, so a user
 * who never enables it pays nothing: no session subscription at all rather
 * than one that wakes on every session publish to discard the result. Follows
 * the lap-history runtime above — the enabled state is re-read whenever the
 * dashboard changes, so toggling the widget takes effect without a restart.
 */
function setupGarage61SearchSession(initialDashboard: DashboardLayout): void {
  let enabled = false;
  let unsubscribeSession: (() => void) | undefined;

  const wireToTelemetryBridge = () => {
    unsubscribeSession?.();
    unsubscribeSession = undefined;
    if (!enabled) return;
    const bridge = getCurrentBridge();
    if (!bridge) return;
    unsubscribeSession = bridge.onSessionData((session: Session) => {
      // Same derivation the bridge serves to Settings, shared rather than
      // repeated, so the persisted identity can never drift from the live one.
      const info = getGarage61SearchInfoFromSession(session);
      if (info) saveGarage61SearchSession(info);
    });
  };

  const applyDashboard = (layout: DashboardLayout | undefined) => {
    const next =
      layout?.widgets.find((w) => w.id === 'laptrace')?.enabled ?? false;
    if (next === enabled) return;
    enabled = next;
    // Subscribing re-delivers the latest session immediately, so enabling the
    // widget mid-session captures the identity without waiting for the next
    // session publish.
    wireToTelemetryBridge();
  };

  applyDashboard(initialDashboard);
  const unsubscribeBridgeChanged = onBridgeChanged(wireToTelemetryBridge);
  const unsubscribeDashboard = onDashboardUpdated(applyDashboard);

  disposeGarage61SearchSession = () => {
    unsubscribeSession?.();
    unsubscribeBridgeChanged();
    unsubscribeDashboard();
  };
}

// Native startup calls can let Electron become ready before we reach this
// registration. The promise also runs initialization when ready already fired.
void app.whenReady().then(async () => {
  // Don't start services if we don't have the single instance lock
  // (this instance should be quitting)
  if (!overlayManager.hasLock()) {
    return;
  }

  await initializeSettingsWindowBounds();
  // Likewise read before a dashboard can open the Pit Wall window.
  await initializePitWallWindowBounds();

  if (perfRun.enabled) {
    log.info('[PerfRun] Configuration', perfRun);
  }

  // Every profile, not only the active one: switching profiles reads them as
  // stored.
  applyDefaultsToAllProfiles();
  // Resolve benchmark metadata before metrics reporting starts so every
  // interval carries the same active-widget workload description.
  const dashboard = getOrCreateDefaultDashboard();
  const runDashboard = createPerfDashboard(dashboard, perfRun);
  if (perfRun.enabled) {
    updatePerfDashboardMetadata(runDashboard);
  }

  // Read off the window-build path before anything can ask for it: the
  // widget-visibility check that consults this list is synchronous and runs
  // for every overlay window.
  await loadSimWidgetSupport();

  setupChannelBridge(channelBus, {
    isAlwaysFed: (sender) => overlayManager.isGantryWebContents(sender),
  });
  const rendererDataSubscriptions = setupRendererDataSubscriptions({
    onSubscribe: (sender, stream) => {
      if (stream === 'sessionData') overlayManager.seedSessionData(sender);
    },
  });
  disposeRendererDataSubscriptions = rendererDataSubscriptions.dispose;
  overlayManager.setRendererDataSubscriptions(
    rendererDataSubscriptions.registry
  );
  disconnectLifecycleChannel = connectSessionLifecycleChannel(
    getSessionLifecycle(),
    channelBus
  );
  // Before the telemetry bridge: its reference recorder asks the library
  // for the player's all-time lap as soon as it is created.
  startLapLibrary();
  // Likewise: the track profile channel reads them from its first frame.
  startTrackProfiles();
  await iRacingSDKSetup(overlayManager, channelBus);
  setupTapeReplayBridge(getCurrentBridge);
  if (process.env.IRDASHIES_TELEMETRY_REPLAY) createTapeReplayWindow();

  // Perform one-time cleanup of old reference laps
  validateReferenceLapFile();

  const bridge = getCurrentBridge();

  // Setup IPC bridges
  setupLogBridge();
  setupStorageStatusBridge();
  setupWindowVisibilityBridge();
  const disposeWidgetPreviews = setupWidgetPreviewBridge(runtimePerfMetrics);
  app.once('will-quit', disposeWidgetPreviews);
  fuelDatabase = setupFuelCalculatorBridge();
  const pitLaneBridge = setupPitLaneBridge(overlayManager, channelBus);
  setupPersonalBestLapTimesBridge();
  setupLapTraceBridge(overlayManager);
  setupGarage61SearchSession(dashboard);
  setupChromiumFlagsBridge();
  racePlan = setupRacePlanBridge({
    // A plan is fetched unasked only while the running simulator has a widget
    // to show it in. Settings can still load one by hand.
    autoRefresh: {
      isAllowed: () =>
        canSimulatorShowRacePlan(getActiveSimulator(), getSimWidgetSupport()),
      onChange: onActiveSimulatorChanged,
    },
  });
  ipcMain.handle('widgetVisibility:getHidden', () => getHiddenWidgets());
  const replayContextRuntime = setupReplayContextRuntime(dashboard);
  const incidents = new IncidentRuntime(
    channelBus,
    getSessionLifecycle(),
    runtimePerfMetrics,
    incidentPersistence,
    { isDev: !app.isPackaged }
  );
  incidentRuntime = incidents;
  incidents.updateReplayPaused(replayContextRuntime.isReplayFile());
  replayContextRuntime.onChange((context) =>
    incidents.updateReplayPaused(context.mode === 'replayFile')
  );
  setupRaceControlBridge(incidents, dashboard, replayContextRuntime);
  setupLapHistoryRuntime(dashboard, replayContextRuntime);
  setupLapLibraryRecording(replayContextRuntime);
  setupTrackProfiles(replayContextRuntime);
  setupPitStopRuntime(dashboard, replayContextRuntime);
  disposeStreamChat = setupStreamChat(channelBus, listDashboards);
  // Returns false when the Gantry widget is disabled, so Settings can explain
  // why the button did nothing instead of appearing to be broken.
  ipcMain.handle('raceControl:showGantryWindow', () =>
    overlayManager.createGantryWindow(getOrCreateDefaultDashboard())
  );
  // Likewise false when the Pit Wall is switched off.
  setupPitWallBridge(() =>
    overlayManager.showPitWallWindow(getOrCreateDefaultDashboard())
  );

  // Local-only feature modules (git-excluded src/local/). Empty glob => no-op.
  // The negative pattern keeps co-located *.spec.ts test files out of the bundle.
  const localMainModules = import.meta.glob(
    ['./local/main/*.ts', '!./local/main/*.spec.ts'],
    { eager: true }
  ) as Record<
    string,
    {
      register?: (deps: {
        overlayManager: OverlayManager;
      }) => void | Promise<void>;
    }
  >;
  for (const mod of Object.values(localMainModules)) {
    await mod.register?.({ overlayManager });
  }

  // Start component server for browser components
  await startComponentServer(
    bridge,
    dashboardBridge,
    channelBus,
    pitLaneBridge
  );

  ipcMain.handle('getComponentServerPort', () => getComponentServerPort());
  ipcMain.handle('getComponentServerHost', () => getComponentServerHost());

  if (!perfRun.enabled || perfRun.overlayMode !== 'observer') {
    // Empty mode keeps the normal overlay window count/bounds while the
    // renderer receives a dashboard with every widget disabled. This isolates
    // transparent-window/global-provider cost from widget rendering.
    const windowDashboard =
      perfRun.enabled && perfRun.overlayMode === 'empty'
        ? { ...dashboard, generalSettings: runDashboard.generalSettings }
        : runDashboard;
    if (perfRun.enabled && perfRun.overlayMode === 'empty') {
      overlayManager.setWindowLayoutOverride(windowDashboard);
    }
    overlayManager.createOverlays(windowDashboard, {
      createSettingsWindow: !perfRun.enabled,
    });
  }

  if (perfRun.enabled) {
    const captureOriginMs = Date.now();
    const captureOrigin = new Date(captureOriginMs).toISOString();
    log.info(
      `${PERF_CAPTURE_ORIGIN_LOG_PREFIX}${JSON.stringify({
        timestamp: captureOrigin,
        runId: process.env.PERF_RUN_ID ?? 'manual',
      })}`
    );
    const heapProfilePath = process.env.PERF_HEAP_PROFILE_PATH;
    if (heapProfilePath && perfRun.durationSeconds <= 0) {
      log.error(
        `[PerfRun] PERF_HEAP_PROFILE_PATH requires a fixed capture duration`
      );
      app.quit();
      return;
    }
    let heapProfiler: PerfHeapProfiler | undefined;
    if (heapProfilePath) {
      try {
        heapProfiler = new PerfHeapProfiler(heapProfilePath);
        await heapProfiler.start();
        log.info(`[PerfRun] Main-process heap sampling started`);
      } catch (error) {
        heapProfiler = undefined;
        log.error(
          `[PerfRun] Main-process heap sampling failed`,
          safeErrorDetails(error)
        );
      }
    }
    if (perfRun.durationSeconds > 0) {
      setTimeout(async () => {
        try {
          if (heapProfiler) {
            await heapProfiler.stop();
            log.info(`[PerfRun] Main-process heap profile written`);
          }
        } catch (error) {
          log.error(
            `[PerfRun] Main-process heap profile export failed`,
            safeErrorDetails(error)
          );
        } finally {
          log.info(
            `[PerfRun] Completed fixed ${perfRun.durationSeconds}s capture`
          );
          app.quit();
        }
      }, perfRun.durationSeconds * 1000);
    }

    let phaseStartSeconds = 0;
    perfRun.visibilityPhases.forEach((phase, index) => {
      const applyPhase = () => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (window.isDestroyed()) continue;
          if (phase.visibility === 'hidden') window.hide();
          else window.showInactive();
        }
        log.info(
          `${PERF_VISIBILITY_LOG_PREFIX}${JSON.stringify({
            timestamp: index === 0 ? captureOrigin : new Date().toISOString(),
            runId: process.env.PERF_RUN_ID ?? 'manual',
            index,
            visibility: phase.visibility,
            durationSeconds: phase.durationSeconds,
          })}`
        );
      };
      if (index === 0) applyPhase();
      else setTimeout(applyPhase, phaseStartSeconds * 1000);
      phaseStartSeconds += phase.durationSeconds;
    });
  }

  keybindingManager = new KeybindingManager(overlayManager, overlayVisibility);
  keybindingManager.registerAll();
  // Start the WebHID host window that reads game controllers for gamepad bindings.
  if (!perfRun.enabled) {
    keybindingManager.startGamepad();
  }

  setupTaskbar(overlayManager, keybindingManager, overlayVisibility);
  const disposeVisibilityBridge = setupOverlayVisibilityBridge(
    overlayVisibility,
    setHideOverlayWhenPaused
  );
  // A paused game takes the overlay off the screen, where the sim says it is
  // paused. Follows the telemetry bridge across a change of simulator.
  const stopPauseWatch = watchGamePause({
    getBridge: getCurrentBridge,
    onBridgeChanged,
    onPaused: (paused) => overlayVisibility.setGamePaused(paused),
  });
  disposeOverlayVisibility = () => {
    stopPauseWatch();
    disposeVisibilityBridge();
  };
  await publishDashboardUpdates(
    overlayManager,
    analytics,
    perfRun.enabled
      ? (updatedDashboard) => {
          const appliedDashboard = createPerfDashboard(
            updatedDashboard,
            perfRun
          );
          updatePerfDashboardMetadata(appliedDashboard);
          return appliedDashboard;
        }
      : undefined
  );
  // Deliberately after publishDashboardUpdates: switching a profile emits
  // 'dashboardUpdated', and that listener is what actually applies it to the
  // windows. Wired any earlier — telemetry starts flowing back at
  // iRacingSDKSetup — a switch triggered by the session the player is already
  // in would emit into an EventEmitter with no listener, silently leaving the
  // stored profile and the visible overlays disagreeing.
  //
  // Arriving this late is also why the switcher seeds itself from the
  // lifecycle's current state on construction: by now the SDK has been
  // publishing for a while, and the events it fires are transitions that are
  // not replayed to a new subscriber.
  sessionProfileSwitcher = createSessionProfileSwitcher({
    lifecycle: getSessionLifecycle(),
    getMap: getSessionProfileMap,
    getCurrentProfileId,
    profileExists: (profileId) => getProfile(profileId) !== null,
    switchProfile: (profileId) => setCurrentProfile(profileId),
  });
  setupKeybindingsBridge(keybindingManager);

  await analytics.init(overlayManager.getVersion(), dashboard);
});

app.on('window-all-closed', () => {
  if (perfRun.enabled && perfRun.overlayMode === 'observer') {
    return;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
app.on('quit', () => {
  log.info('App quit');
  analytics.shutdown();
});

let fuelDatabase: ReturnType<typeof setupFuelCalculatorBridge> | undefined;

const SHUTDOWN_FLUSH_TIMEOUT_MS = 5_000;

const handleBeforeQuit = createBeforeQuitHandler({
  prepareToQuit: () => overlayManager.markQuitting(),
  shutdown: async () => {
    flushWindowMovementOnShutdown();
    keybindingManager?.stopGamepad();
    disconnectLifecycleChannel?.();
    sessionProfileSwitcher?.dispose();
    disposeRendererDataSubscriptions?.();
    incidentRuntime?.dispose();
    disposeLapHistoryRuntime?.();
    disposeLapLibraryRecording?.();
    disposeTrackProfileRecording?.();
    disposePitStopRuntime?.();
    disposeOverlayVisibility?.();
    disposeStreamChat?.();
    disposeReplayContextRuntime?.();
    disposeGarage61SearchSession?.();
    racePlan?.dispose();
    channelBus.dispose();
    // Storage writes are debounced, so drain all pending queues within the
    // coordinator deadline before the process exits.
    await Promise.all([
      flushLapTracesOnShutdown(),
      flushPitLaneDataOnShutdown(),
      flushReferenceLapsOnShutdown(),
      closeLapLibraryOnShutdown(),
      fuelDatabase?.flush(),
      flushIncidentsOnShutdown(),
      flushLapHistoryOnShutdown(),
      knownLocalUserIds.flush(),
      flushRadarPoleSideOverrides(),
      releaseNotes?.flush(),
      racePlan?.flush(),
      flushRacePlanHistoryOnShutdown(),
      flushPitStopHistoryOnShutdown(),
      flushGarage61SearchSessionOnShutdown(),
      flushStorageWritesOnShutdown(),
      flushSettingsWindowBoundsOnShutdown(),
      flushPitWallWindowBoundsOnShutdown(),
      flushSimulatorUsageOnShutdown(),
      flushTrackCarStoreOnShutdown(),
      flushTrackProfilesOnShutdown(),
    ]);
  },
  quit: () => app.quit(),
  reportFailure: (err) => log.error('[Shutdown] Cleanup failed:', err),
  timeoutMs: SHUTDOWN_FLUSH_TIMEOUT_MS,
});

app.on('before-quit', handleBeforeQuit);
// An update restart closes windows before `before-quit`, so the Gantry has to
// know it is quitting earlier or it hides instead of closing.
autoUpdater.on('before-quit-for-update', () => overlayManager.markQuitting());

// Terminal shutdown must use the same cleanup and storage flush as tray quit.
process.on('SIGINT', () => app.quit());
process.on('SIGTERM', () => app.quit());

if (!app.isPackaged) {
  monitorDevParent(process.ppid, () => app.quit());
}
