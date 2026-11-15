import { describe, expect, it, vi } from 'vitest';
import type { ActiveSimulator, Session, Telemetry } from '../types';
import {
  wirePlayerLapRecording,
  type LapRecordingBridge,
} from './playerLapRecording';

/** A telemetry bridge a spec can push a session and frames through. */
const fakeBridge = () => {
  const sessions = new Set<(value: Session) => void>();
  const frames = new Set<(value: Telemetry) => void>();
  const bridge: LapRecordingBridge = {
    onSessionData: (callback) => {
      sessions.add(callback);
      return () => sessions.delete(callback);
    },
    onTelemetry: (callback) => {
      frames.add(callback);
      return () => frames.delete(callback);
    },
  };
  return {
    bridge,
    session: () => sessions.forEach((callback) => callback({} as Session)),
    frame: () => frames.forEach((callback) => callback({} as Telemetry)),
    listeners: () => sessions.size + frames.size,
  };
};

/** The app's side of the wiring: which bridge, which sim, and the two events. */
const fakeApp = (
  bridge: LapRecordingBridge | undefined,
  simulator: ActiveSimulator | undefined
) => {
  const state = { bridge, simulator };
  const bridgeListeners = new Set<() => void>();
  const simulatorListeners = new Set<() => void>();
  const recorders: {
    simulator: ActiveSimulator;
    onSession: ReturnType<typeof vi.fn>;
    onFrame: ReturnType<typeof vi.fn>;
  }[] = [];
  const onRecorderChanged = vi.fn();
  const dispose = wirePlayerLapRecording({
    getBridge: () => state.bridge,
    getSimulator: () => state.simulator,
    onBridgeChanged: (callback) => {
      bridgeListeners.add(callback);
      return () => bridgeListeners.delete(callback);
    },
    onSimulatorChanged: (callback) => {
      simulatorListeners.add(callback);
      return () => simulatorListeners.delete(callback);
    },
    createRecorder: (sim) => {
      const recorder = { simulator: sim, onSession: vi.fn(), onFrame: vi.fn() };
      recorders.push(recorder);
      return recorder;
    },
    onRecorderChanged,
  });
  return {
    recorders,
    onRecorderChanged,
    dispose,
    setSimulator: (next: ActiveSimulator | undefined) => {
      state.simulator = next;
      simulatorListeners.forEach((callback) => callback());
    },
    setBridge: (next: LapRecordingBridge | undefined) => {
      state.bridge = next;
      bridgeListeners.forEach((callback) => callback());
    },
    notifyBridge: () => bridgeListeners.forEach((callback) => callback()),
    listeners: () => bridgeListeners.size + simulatorListeners.size,
  };
};

describe('player lap recording', () => {
  it('records from the start when the simulator is pinned', () => {
    const sim = fakeBridge();
    const app = fakeApp(sim.bridge, 'lmu');

    expect(app.recorders).toHaveLength(1);
    expect(app.recorders[0].simulator).toBe('lmu');
    expect(app.onRecorderChanged).toHaveBeenLastCalledWith(app.recorders[0]);

    sim.session();
    sim.frame();
    sim.frame();
    expect(app.recorders[0].onSession).toHaveBeenCalledTimes(1);
    expect(app.recorders[0].onFrame).toHaveBeenCalledTimes(2);
  });

  it('starts recording when auto-detect finds the game later', () => {
    // Auto-detect: the bridge is there from the start, the simulator is not.
    // This is the case that left the lap library empty: nothing re-wired the
    // recorder when the game was found, because the bridge had not changed.
    const sim = fakeBridge();
    const app = fakeApp(sim.bridge, undefined);
    expect(app.recorders).toHaveLength(0);
    expect(sim.listeners()).toBe(0);

    app.setSimulator('lmu');
    expect(app.recorders).toHaveLength(1);
    expect(app.recorders[0].simulator).toBe('lmu');

    // The simulator is named before its bridge is attached, so the recorder
    // is listening by the time the first session arrives.
    sim.session();
    sim.frame();
    expect(app.recorders[0].onSession).toHaveBeenCalledTimes(1);
    expect(app.recorders[0].onFrame).toHaveBeenCalledTimes(1);
  });

  it('files the laps of another simulator under a new recorder', () => {
    const sim = fakeBridge();
    const app = fakeApp(sim.bridge, 'lmu');

    app.setSimulator('iracing');
    expect(app.recorders).toHaveLength(2);
    expect(app.recorders[1].simulator).toBe('iracing');

    sim.frame();
    expect(app.recorders[0].onFrame).not.toHaveBeenCalled();
    expect(app.recorders[1].onFrame).toHaveBeenCalledTimes(1);
    // One session and one telemetry subscription, not one per recorder.
    expect(sim.listeners()).toBe(2);
  });

  it('follows the app to another bridge', () => {
    const first = fakeBridge();
    const second = fakeBridge();
    const app = fakeApp(first.bridge, 'lmu');

    app.setBridge(second.bridge);
    expect(app.recorders).toHaveLength(2);
    expect(first.listeners()).toBe(0);

    first.frame();
    second.frame();
    expect(app.recorders[0].onFrame).not.toHaveBeenCalled();
    expect(app.recorders[1].onFrame).toHaveBeenCalledTimes(1);
  });

  it('keeps the recorder when nothing has changed', () => {
    // A pinned simulator is named and its bridge announced one after the
    // other; the second notification must not drop a lap half driven.
    const sim = fakeBridge();
    const app = fakeApp(sim.bridge, 'lmu');

    app.notifyBridge();
    app.setSimulator('lmu');
    expect(app.recorders).toHaveLength(1);
    expect(app.onRecorderChanged).toHaveBeenCalledTimes(1);
  });

  it('stops when the simulator is no longer known', () => {
    const sim = fakeBridge();
    const app = fakeApp(sim.bridge, 'lmu');

    app.setSimulator(undefined);
    expect(app.onRecorderChanged).toHaveBeenLastCalledWith(undefined);
    expect(sim.listeners()).toBe(0);

    sim.frame();
    expect(app.recorders[0].onFrame).not.toHaveBeenCalled();

    // And starts again, with a new recorder, when a game is found.
    app.setSimulator('lmu');
    expect(app.recorders).toHaveLength(2);
    sim.frame();
    expect(app.recorders[1].onFrame).toHaveBeenCalledTimes(1);
  });

  it('has no recorder without a bridge, and says so only once', () => {
    const app = fakeApp(undefined, 'lmu');
    expect(app.recorders).toHaveLength(0);
    app.notifyBridge();
    expect(app.onRecorderChanged).not.toHaveBeenCalled();

    const sim = fakeBridge();
    app.setBridge(sim.bridge);
    expect(app.recorders).toHaveLength(1);
  });

  it('lets go of everything when disposed', () => {
    const sim = fakeBridge();
    const app = fakeApp(sim.bridge, 'lmu');

    app.dispose();
    expect(sim.listeners()).toBe(0);
    expect(app.listeners()).toBe(0);

    app.setSimulator('iracing');
    expect(app.recorders).toHaveLength(1);
  });
});
