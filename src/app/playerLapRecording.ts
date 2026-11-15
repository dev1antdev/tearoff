import type { ActiveSimulator, Session, Telemetry } from '../types';

/** Ends a subscription, where the source hands one back. */
type Unsubscribe = (() => unknown) | undefined;

/** As much of a telemetry bridge as lap recording needs. */
export interface LapRecordingBridge {
  onSessionData(callback: (session: Session) => void): Unsubscribe;
  onTelemetry(callback: (telemetry: Telemetry) => void): Unsubscribe;
}

/** What is fed the session and every frame: the player's lap recorder. */
export interface LapRecordingSink {
  onSession(session: Session): void;
  onFrame(telemetry: Telemetry): void;
}

export interface LapRecordingOptions<Recorder extends LapRecordingSink> {
  getBridge: () => LapRecordingBridge | undefined;
  getSimulator: () => ActiveSimulator | undefined;
  /** Called when the app moves to another bridge. */
  onBridgeChanged: (callback: () => void) => Unsubscribe;
  /** Called when the running simulator becomes known, changes or is lost. */
  onSimulatorChanged: (callback: () => void) => Unsubscribe;
  /** A new recorder for laps driven in this simulator. */
  createRecorder: (simulator: ActiveSimulator) => Recorder;
  /** Told which recorder is fed now; undefined while there is none. */
  onRecorderChanged: (recorder: Recorder | undefined) => void;
}

/**
 * Keeps one lap recorder fed from the telemetry bridge for as long as the
 * simulator is known.
 *
 * A lap is filed under its simulator, so there is no recorder until the app
 * knows which one is running. With the simulator pinned in the settings that
 * is at startup. Left on auto-detect, the bridge exists first and the
 * simulator is named later, when a game is found: the recorder has to be made
 * then, on the same bridge. Wiring only when the bridge changed left an
 * auto-detecting app with no recorder at all, and a lap library that stayed
 * empty through whole races.
 *
 * A recorder is replaced only when the bridge or the simulator really is
 * another one: a lap half driven should not be dropped for a notification
 * that changed nothing.
 */
export const wirePlayerLapRecording = <Recorder extends LapRecordingSink>({
  getBridge,
  getSimulator,
  onBridgeChanged,
  onSimulatorChanged,
  createRecorder,
  onRecorderChanged,
}: LapRecordingOptions<Recorder>): (() => void) => {
  let wiredBridge: LapRecordingBridge | undefined;
  let wiredSimulator: ActiveSimulator | undefined;
  let unsubscribeSession: Unsubscribe;
  let unsubscribeTelemetry: Unsubscribe;

  const unwire = () => {
    unsubscribeSession?.();
    unsubscribeTelemetry?.();
    unsubscribeSession = undefined;
    unsubscribeTelemetry = undefined;
    wiredBridge = undefined;
    wiredSimulator = undefined;
  };

  const wire = () => {
    const bridge = getBridge();
    const simulator = getSimulator();
    if (!bridge || !simulator) {
      if (wiredBridge) {
        unwire();
        onRecorderChanged(undefined);
      }
      return;
    }
    if (bridge === wiredBridge && simulator === wiredSimulator) return;

    unwire();
    // A new recorder each time: the simulator is part of what a lap is filed
    // under, and a half-driven lap does not carry over to another sim.
    const recorder = createRecorder(simulator);
    wiredBridge = bridge;
    wiredSimulator = simulator;
    onRecorderChanged(recorder);
    unsubscribeSession = bridge.onSessionData((session) =>
      recorder.onSession(session)
    );
    unsubscribeTelemetry = bridge.onTelemetry((telemetry) =>
      recorder.onFrame(telemetry)
    );
  };

  wire();
  const unsubscribeBridgeChanged = onBridgeChanged(wire);
  const unsubscribeSimulatorChanged = onSimulatorChanged(wire);

  return () => {
    unsubscribeBridgeChanged?.();
    unsubscribeSimulatorChanged?.();
    unwire();
  };
};
