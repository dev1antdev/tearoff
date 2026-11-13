import { describe, expect, it, vi } from 'vitest';
import type { Telemetry } from '../types';
import { watchGamePause, type PauseWatchBridge } from './overlayPauseWatch';

/** A telemetry bridge a spec can push frames and running states through. */
const fakeBridge = () => {
  const telemetry = new Set<(value: Telemetry) => void>();
  const running = new Set<(value: boolean) => void>();
  const bridge: PauseWatchBridge = {
    onTelemetry: (callback) => {
      telemetry.add(callback);
      return () => telemetry.delete(callback);
    },
    onRunningState: (callback) => {
      running.add(callback);
      return () => running.delete(callback);
    },
  };
  return {
    bridge,
    frame: (paused: boolean | undefined) =>
      telemetry.forEach((callback) =>
        callback(
          (paused === undefined
            ? {}
            : { LmuGamePaused: { value: [paused] } }) as unknown as Telemetry
        )
      ),
    setRunning: (value: boolean) =>
      running.forEach((callback) => callback(value)),
    listeners: () => telemetry.size + running.size,
  };
};

describe('game pause watch', () => {
  it('reports a pause and its end once each', () => {
    const sim = fakeBridge();
    const onPaused = vi.fn();
    watchGamePause({
      getBridge: () => sim.bridge,
      onBridgeChanged: () => undefined,
      onPaused,
    });

    sim.frame(false);
    sim.frame(true);
    sim.frame(true);
    sim.frame(true);
    sim.frame(false);
    sim.frame(false);

    expect(onPaused.mock.calls).toEqual([[true], [false]]);
  });

  it('never fires under a sim that does not say', () => {
    const sim = fakeBridge();
    const onPaused = vi.fn();
    watchGamePause({
      getBridge: () => sim.bridge,
      onBridgeChanged: () => undefined,
      onPaused,
    });

    // iRacing: the channel is not there at all.
    sim.frame(undefined);
    sim.frame(undefined);

    expect(onPaused).not.toHaveBeenCalled();
  });

  it('ends the pause when the sim closes while paused', () => {
    const sim = fakeBridge();
    const onPaused = vi.fn();
    watchGamePause({
      getBridge: () => sim.bridge,
      onBridgeChanged: () => undefined,
      onPaused,
    });
    sim.frame(true);

    // No frame follows a closed sim; the last one still said paused.
    sim.setRunning(false);

    expect(onPaused.mock.calls).toEqual([[true], [false]]);
  });

  it('follows the app to another sim and drops the old one', () => {
    const first = fakeBridge();
    const second = fakeBridge();
    let current = first;
    let bridgeChanged: () => void = () => undefined;
    const onPaused = vi.fn();
    watchGamePause({
      getBridge: () => current.bridge,
      onBridgeChanged: (callback) => {
        bridgeChanged = callback;
        return undefined;
      },
      onPaused,
    });
    first.frame(true);

    current = second;
    bridgeChanged();

    // The pause belonged to the sim that was left.
    expect(onPaused.mock.calls).toEqual([[true], [false]]);
    expect(first.listeners()).toBe(0);
    first.frame(true);
    expect(onPaused).toHaveBeenCalledTimes(2);
    second.frame(true);
    expect(onPaused).toHaveBeenLastCalledWith(true);
  });

  it('waits for a bridge when there is none yet, and lets go when stopped', () => {
    const sim = fakeBridge();
    let current: PauseWatchBridge | undefined = undefined;
    let bridgeChanged: () => void = () => undefined;
    const unsubscribeBridgeChanged = vi.fn();
    const onPaused = vi.fn();
    const stop = watchGamePause({
      getBridge: () => current,
      onBridgeChanged: (callback) => {
        bridgeChanged = callback;
        return unsubscribeBridgeChanged;
      },
      onPaused,
    });
    expect(sim.listeners()).toBe(0);

    current = sim.bridge;
    bridgeChanged();
    sim.frame(true);
    expect(onPaused).toHaveBeenCalledWith(true);

    stop();
    expect(sim.listeners()).toBe(0);
    expect(unsubscribeBridgeChanged).toHaveBeenCalledOnce();
  });
});
