import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EMPTY_FLAG_STATE,
  type ChannelBridge,
  type ChannelName,
  type FlagStateSnapshot,
  type TrackProfileSnapshot,
} from '@irdashies/types';
import { useLearnedMapSectors } from './useLearnedMapSectors';

/** Laguna Seca, as the recorded lap placed its sectors. */
const LAGUNA = [0, 0.39, 0.792];

const profile = (
  overrides: Partial<TrackProfileSnapshot> = {}
): TrackProfileSnapshot => ({
  trackKey: 'lmu:694510461',
  trackLengthM: 3590.35,
  elevationM: [],
  lineElevationM: 0,
  elevationRangeM: 0,
  elevationSource: null,
  recordingProgress: null,
  // A copy each time, as every publish arrives as a new object.
  sectorStartPct: [...LAGUNA],
  sectorSource: 'learned',
  notes: [],
  sessionNum: 0,
  version: 1,
  ...overrides,
});

const flags = (yellowSectors: boolean[]): FlagStateSnapshot => ({
  ...EMPTY_FLAG_STATE,
  yellowSectors,
});

/** The channels as the main process would feed them, published by hand. */
const createChannels = () => {
  const listeners = new Map<ChannelName, (payload: unknown) => void>();
  const bridge = {
    subscribe: (channel: ChannelName, callback: (payload: unknown) => void) => {
      listeners.set(channel, callback);
      return () => listeners.delete(channel);
    },
  } as unknown as ChannelBridge;
  return {
    bridge,
    subscribed: () => [...listeners.keys()].sort(),
    profile: (snapshot: TrackProfileSnapshot) =>
      act(() => listeners.get('track-profile.snapshot')?.(snapshot)),
    flags: (snapshot: FlagStateSnapshot) =>
      act(() => listeners.get('flag-state.snapshot')?.(snapshot)),
  };
};

describe('useLearnedMapSectors', () => {
  let channels: ReturnType<typeof createChannels>;
  const previousBridge = window.channelBridge;

  beforeEach(() => {
    channels = createChannels();
    window.channelBridge = channels.bridge;
  });
  afterEach(() => {
    window.channelBridge = previousBridge;
  });

  it('has no sectors and no yellow stretch before anything is published', () => {
    const { result } = renderHook(() => useLearnedMapSectors());

    expect(result.current.sectors).toBeUndefined();
    expect(result.current.yellowSpans).toEqual([]);
  });

  it('gives the sectors once the profile has learned where they start', () => {
    const { result } = renderHook(() => useLearnedMapSectors());
    channels.profile(profile());

    expect(result.current.sectors).toEqual([
      { SectorNum: 0, SectorStartPct: 0 },
      { SectorNum: 1, SectorStartPct: 0.39 },
      { SectorNum: 2, SectorStartPct: 0.792 },
    ]);
    expect(result.current.yellowSpans).toEqual([]);
  });

  it('gives the stretch of the sector under yellow', () => {
    const { result } = renderHook(() => useLearnedMapSectors());
    channels.profile(profile());
    channels.flags(flags([false, true, false]));

    expect(result.current.yellowSpans).toEqual([{ from: 0.39, to: 0.792 }]);

    // And takes it away when the flag goes in.
    channels.flags(flags([false, false, false]));
    expect(result.current.yellowSpans).toEqual([]);
  });

  it('paints no yellow while the starts are only the even thirds of the session', () => {
    const { result } = renderHook(() => useLearnedMapSectors());
    channels.profile(
      profile({ sectorStartPct: [0, 1 / 3, 2 / 3], sectorSource: 'nominal' })
    );
    channels.flags(flags([false, true, false]));

    // The flag is out, and where its sector lies is not known: nothing is
    // drawn rather than the wrong third of the circuit.
    expect(result.current.sectors).toBeUndefined();
    expect(result.current.yellowSpans).toEqual([]);

    // The lap that crosses them is kept, with the flag still out.
    channels.profile(profile({ version: 2 }));
    expect(result.current.sectors).toHaveLength(3);
    expect(result.current.yellowSpans).toEqual([{ from: 0.39, to: 0.792 }]);
  });

  it('hands back the same lists while the channels repeat themselves', () => {
    const { result } = renderHook(() => useLearnedMapSectors());
    channels.profile(profile());
    channels.flags(flags([false, false, true]));
    const before = result.current;

    // The flag state goes out ten times a second, and the profile again
    // for every note and every 5 % of a lap being recorded: new objects
    // saying the same thing, which must not redraw the map's static layer.
    channels.flags(flags([false, false, true]));
    channels.profile(profile({ version: 2, recordingProgress: 0.35 }));

    expect(result.current).toBe(before);
    expect(result.current.sectors).toBe(before.sectors);
    expect(result.current.yellowSpans).toBe(before.yellowSpans);
  });

  it('asks for neither channel while the map is hidden', () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => useLearnedMapSectors(enabled),
      { initialProps: { enabled: false } }
    );

    expect(channels.subscribed()).toEqual([]);
    expect(result.current.sectors).toBeUndefined();

    rerender({ enabled: true });
    expect(channels.subscribed()).toEqual([
      'flag-state.snapshot',
      'track-profile.snapshot',
    ]);
  });
});
