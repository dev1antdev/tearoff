import type {
  DashboardBridge,
  IrSdkBridge,
  PitLaneBridge,
  FuelCalculatorBridge,
  LogBridge,
  KeybindingsBridge,
  GamepadHostBridge,
  ChromiumFlagsBridge,
  RaceControlBridge,
  LapHistoryBridge,
  TelemetryInspectorBridge,
  RendererPerfBridge,
} from '@irdashies/types';
import type { ChannelBridge } from '@irdashies/types';

declare global {
  interface Window {
    widgetPreviewBridge?: import('./types/widgetPreview').WidgetPreviewBridge;
    storageStatusBridge?: import('./types/storageStatus').StorageStatusBridge;
    /** Absent outside the Electron preload, e.g. the browser server. */
    lapLibraryBridge?: import('./types/lapLibrary').LapLibraryBridge;
    /** Absent outside the Electron preload, e.g. the browser server. */
    raceHistoryBridge?: import('./types/raceHistory').RaceHistoryBridge;
    /**
     * The socket a page served to a browser is fed over. Absent in the
     * app's own windows, which have none.
     */
    browserConnection?: import('./types/browserConnection').BrowserConnection;
    /** Absent outside the Electron preload, e.g. the browser server. */
    trackProfileBridge?: import('./types/trackProfileBridge').TrackProfileBridge;
    /** Absent outside the Electron preload, e.g. the browser server. */
    overlayVisibilityBridge?: import('./types/overlayVisibility').OverlayVisibilityBridge;
    channelBridge: ChannelBridge;
    windowVisibilityBridge?: import('./types/windowVisibility').WindowVisibilityBridge;
    irsdkBridge: IrSdkBridge;
    telemetryInspectorBridge: TelemetryInspectorBridge;
    dashboardBridge: DashboardBridge;
    pitLaneBridge: PitLaneBridge;
    fuelCalculatorBridge: FuelCalculatorBridge;
    logBridge: LogBridge;
    keybindingsBridge: KeybindingsBridge;
    /** Present only in the hidden WebHID host renderer (src/hidHost.ts). */
    gamepadHost?: GamepadHostBridge;
    releaseNotesBridge?: import('./types/releaseNotes').ReleaseNotesBridge;
    chromiumFlagsBridge: ChromiumFlagsBridge;
    raceControlBridge: RaceControlBridge;
    /** Absent outside the Electron preload, e.g. the browser server. */
    lapHistoryBridge?: LapHistoryBridge;
    rendererPerfBridge?: RendererPerfBridge;
    tapeReplayBridge?: import('./types/tapeReplay').TapeReplayBridge;
    /** Absent outside the Electron preload, e.g. the browser server. */
    racePlanBridge?: import('./types/racePlan').RacePlanBridge;
    /** Absent outside the Electron preload, e.g. the browser server. */
    pitWallBridge?: import('./types/pitWall').PitWallBridge;
    /**
     * Absent outside the Electron preload. A page the browser server sends
     * has no way to it, which is what keeps the key from such a page.
     */
    browserAccessBridge?: import('./types/browserAccess').BrowserAccessBridge;
  }
}
