import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LAP_TRACE_COLORS,
  type ChannelBridge,
  type TrackStateSnapshot,
} from '@irdashies/types';
import { OverlayHiddenContext, useLapTraceStore } from '@irdashies/context';
import { playBrakeCue } from '@irdashies/utils/brakeCueAudio';
import { hydrateLapTrace } from '@irdashies/domain/lapTrace/hydrateLapTrace';
import type { BrakeCueOutput } from '@irdashies/domain/lapTrace/brakeCueLatch';
import { makeSyntheticLapTrace } from '../fixtures/syntheticLap';
import { BrakeCue } from '../components/BrakeCue';

/**
 * The brake cue's tone in an overlay that is hidden.
 *
 * Apart from useBrakeCue.spec.tsx because the countdown is replaced here by
 * one that calls for the tone on every frame: what is under test is whether
 * a tone that is called for is played, not when the countdown calls for one.
 */
vi.mock('@irdashies/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@irdashies/utils/brakeCueAudio', () => ({
  playBrakeCue: vi.fn(),
  primeBrakeCueAudio: vi.fn(),
  setBrakeCueOutputDevice: vi.fn(),
}));

vi.mock('@irdashies/domain/lapTrace/brakeCueLatch', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@irdashies/domain/lapTrace/brakeCueLatch')
  >()),
  stepBrakeCueLatch: (_latch: unknown, out: BrakeCueOutput) => {
    out.fire = 'brake';
    out.bars = 1;
    out.tone = 'red';
    out.distanceM = 0;
    out.progress = 1;
    return out;
  },
}));

const TRACK_LENGTH_M = 5000;

/** A bridge that delivers one track-state snapshot when told to. */
const trackStateBridge = () => {
  let deliver: ((payload: TrackStateSnapshot) => void) | undefined;
  window.channelBridge = {
    subscribe: (
      channel: string,
      callback: (payload: TrackStateSnapshot) => void
    ) => {
      if (channel === 'track-state.snapshot') deliver = callback;
      return () => undefined;
    },
  } as unknown as ChannelBridge;
  return () =>
    deliver?.({
      lapDistPct: 0.2,
      speed: 90,
      sessionTime: 100,
      isOnTrack: true,
      onPitRoad: false,
      isReplayPlaying: false,
    } as TrackStateSnapshot);
};

const cueInOverlay = (hidden: boolean) => (
  <OverlayHiddenContext.Provider value={hidden}>
    <BrakeCue
      cuePointsM={new Float32Array([1000])}
      showBars
      barSide="right"
      lastBar="top"
      playAudio
      volume={0.6}
      audioCueLeadSec={0}
      colors={DEFAULT_LAP_TRACE_COLORS}
    />
  </OverlayHiddenContext.Provider>
);

const nextFrames = (count: number) =>
  new Promise<void>((resolve) => {
    const step = (left: number) =>
      left === 0 ? resolve() : setTimeout(() => step(left - 1), 20);
    step(count);
  });

describe('the brake cue in a hidden overlay', () => {
  beforeEach(() => {
    vi.mocked(playBrakeCue).mockClear();
    useLapTraceStore.getState().reset();
    useLapTraceStore.setState({
      trackLengthM: TRACK_LENGTH_M,
      referenceLap: hydrateLapTrace(
        makeSyntheticLapTrace({ trackLengthM: TRACK_LENGTH_M })
      ),
    });
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, 'channelBridge');
    useLapTraceStore.getState().reset();
  });

  it('sounds with the overlay shown', async () => {
    const snapshot = trackStateBridge();
    render(cueInOverlay(false));
    act(() => snapshot());
    await nextFrames(3);
    expect(vi.mocked(playBrakeCue)).toHaveBeenCalled();
  });

  it('is silent with the overlay hidden, and shows no bars', async () => {
    // The widget is still mounted behind a hidden overlay, and counting.
    // Switching the overlay off has to switch its tones off too.
    const snapshot = trackStateBridge();
    const view = render(cueInOverlay(true));
    act(() => snapshot());
    await nextFrames(3);
    expect(vi.mocked(playBrakeCue)).not.toHaveBeenCalled();
    expect(view.getByTestId('brake-cue-bars').style.visibility).toBe('hidden');
  });
});
