import type { RendererPerfMeasureName } from '@irdashies/types';
import { useLapTraceStore } from '@irdashies/context';
import { perfMetrics } from '@irdashies/utils/perfMetrics';

type LapTraceState = ReturnType<typeof useLapTraceStore.getState>;

export interface LapTraceFrameScheduler {
  /** Ask for a frame. At most one is pending, however often this is called. */
  request: () => void;
  /**
   * Hold frames back while what they draw cannot be seen. Pausing drops the
   * pending frame, and a request made while paused asks for nothing. Resuming
   * asks for one frame, which draws from whatever is current by then.
   */
  setPaused: (paused: boolean) => void;
  /** Stop: no frame runs after this, and the lap store is let go. */
  dispose: () => void;
}

/**
 * Runs `draw` on the next animation frame whenever something it shows may have
 * changed, and not otherwise. Shared by the plot and the brake cue, which both
 * draw outside React from the lap store and a telemetry subscription.
 *
 * A frame is requested by the caller's telemetry subscription (through
 * `request`), by any lap store change `storeChanged` accepts, and once at
 * start, since the settings the caller was built from are new. `draw` runs
 * under the given perf measure. The pending frame is cleared before `draw`
 * runs, so `draw` may request the next one itself.
 *
 * `startPaused` starts it holding frames back (see `setPaused`): the frame it
 * would have drawn at start is drawn when it is resumed.
 */
export function scheduleLapTraceFrames(
  measure: RendererPerfMeasureName,
  draw: () => void,
  storeChanged: (state: LapTraceState, prev: LapTraceState) => boolean,
  startPaused = false
): LapTraceFrameScheduler {
  let raf = 0;
  let disposed = false;
  let paused = startPaused;

  const frame = () => {
    raf = 0;
    perfMetrics.measure(measure, draw);
  };
  const request = () => {
    if (!disposed && !paused && raf === 0) raf = requestAnimationFrame(frame);
  };

  const unsubscribe = useLapTraceStore.subscribe((state, prev) => {
    if (storeChanged(state, prev)) request();
  });

  request();

  return {
    request,
    setPaused: (next) => {
      if (disposed || next === paused) return;
      paused = next;
      if (paused) {
        if (raf !== 0) cancelAnimationFrame(raf);
        raf = 0;
      } else {
        request();
      }
    },
    dispose: () => {
      disposed = true;
      unsubscribe();
      if (raf !== 0) cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}
