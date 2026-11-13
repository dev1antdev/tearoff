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
    overlayVisibilityBridge?: import('./types/overlayVisibility').OverlayVisibilityBridge;
    channelBridge: ChannelBridge;
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
  }
}
