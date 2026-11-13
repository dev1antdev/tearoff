import type { Telemetry } from '../types';

/** Ends a subscription, where the source hands one back. */
type Unsubscribe = (() => unknown) | undefined;

/** As much of a telemetry bridge as the watch needs. */
export interface PauseWatchBridge {
  onTelemetry(callback: (telemetry: Telemetry) => void): Unsubscribe;
  onRunningState(callback: (running: boolean) => void): Unsubscribe;
}

export interface PauseWatchOptions {
  getBridge: () => PauseWatchBridge | undefined;
  /** Called when the app moves to another sim's bridge. */
  onBridgeChanged: (callback: () => void) => Unsubscribe;
  /** Told when the game becomes paused and when it stops being. */
  onPaused: (paused: boolean) => void;
}

/**
 * Follows whether the sim is paused, from the telemetry it publishes.
 *
 * Only Le Mans Ultimate says: its game state reads "paused" while the driver
 * is in the car with a menu open, and the mapper publishes that as
 * `LmuGamePaused`. iRacing has no pause to report, so under it this never
 * fires.
 *
 * The sim closing while paused leaves the last frame saying so with nothing
 * coming after it. The running state going false, or the app moving to another
 * sim, ends the pause instead: an overlay hidden for a game that is no longer
 * there would never come back.
 */
export const watchGamePause = ({
  getBridge,
  onBridgeChanged,
  onPaused,
}: PauseWatchOptions): (() => void) => {
  let paused = false;
  let unsubscribeTelemetry: Unsubscribe;
  let unsubscribeRunning: Unsubscribe;

  const report = (next: boolean) => {
    if (next === paused) return;
    paused = next;
    onPaused(next);
  };

  const wire = () => {
    unsubscribeTelemetry?.();
    unsubscribeRunning?.();
    unsubscribeTelemetry = undefined;
    unsubscribeRunning = undefined;
    // Whatever the last bridge said, it is not this one saying it.
    report(false);
    const bridge = getBridge();
    if (!bridge) return;
    unsubscribeTelemetry = bridge.onTelemetry((telemetry) =>
      report(telemetry.LmuGamePaused?.value?.[0] === true)
    );
    unsubscribeRunning = bridge.onRunningState((running) => {
      if (!running) report(false);
    });
  };

  wire();
  const unsubscribeBridgeChanged = onBridgeChanged(wire);

  return () => {
    unsubscribeTelemetry?.();
    unsubscribeRunning?.();
    unsubscribeBridgeChanged?.();
  };
};
