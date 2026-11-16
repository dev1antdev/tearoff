import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionTimingStoreUpdater } from './SessionTimingStoreUpdater';
import { useSessionTimingStore } from './SessionTimingStore';
import { useSessionTimingSnapshot } from '../ChannelStore';

vi.mock('../ChannelStore');

const snapshot = {
  sessionType: 'Race',
  state: 4,
  currentLap: 3,
  totalLaps: 20,
  time: 123,
  timeTotal: 3600,
  timeRemaining: 3477,
  greenFlagTimestamp: 100,
  isFixedLapRace: true,
  totalRaceLaps: 20,
  totalRaceTime: 2400,
  adjustedRaceTime: 2350,
  sessionNum: 0,
  version: 1,
};

describe('useSessionTimingStoreUpdater', () => {
  beforeEach(() => {
    useSessionTimingStore.setState({
      state: 0,
      currentLap: 0,
      totalLaps: 0,
      time: 0,
      timeTotal: 0,
      timeRemaining: 0,
      greenFlagTimestamp: 0,
      isFixedLapRace: true,
      totalRaceLaps: 0,
      totalRaceTime: 0,
      adjustedRaceTime: 0,
    });
    vi.mocked(useSessionTimingSnapshot).mockReturnValue(snapshot);
  });

  it('writes the channel snapshot into the store when enabled', () => {
    renderHook(() => useSessionTimingStoreUpdater(true));

    expect(useSessionTimingStore.getState()).toMatchObject({
      sessionType: 'Race',
      state: 4,
      currentLap: 3,
      totalLaps: 20,
      time: 123,
      timeTotal: 3600,
      timeRemaining: 3477,
      greenFlagTimestamp: 100,
      isFixedLapRace: true,
      totalRaceLaps: 20,
      totalRaceTime: 2400,
      adjustedRaceTime: 2350,
    });
  });

  it('re-syncs the store when the underlying hook results change', () => {
    const { rerender } = renderHook(() => useSessionTimingStoreUpdater(true));

    vi.mocked(useSessionTimingSnapshot).mockReturnValue({
      ...snapshot,
      currentLap: 4,
      version: 2,
    });
    rerender();

    expect(useSessionTimingStore.getState().currentLap).toBe(4);
  });

  it('carries the laps done and the projection into the store', () => {
    vi.mocked(useSessionTimingSnapshot).mockReturnValue({
      ...snapshot,
      lapsCompleted: 2,
      lapProgress: 0.72,
      projectedLaps: 10.28,
      projectedLapsExact: false,
      extraLaps: 1,
    });
    renderHook(() => useSessionTimingStoreUpdater(true));

    expect(useSessionTimingStore.getState()).toMatchObject({
      lapsCompleted: 2,
      lapProgress: 0.72,
      projectedLaps: 10.28,
      projectedLapsExact: false,
      extraLaps: 1,
    });
  });

  it('reads a snapshot from before the projection as nothing projected', () => {
    // A recording, or a mock, made before the five fields existed. What the
    // last snapshot left in the store must not stay there.
    useSessionTimingStore.setState({
      lapsCompleted: 7,
      lapProgress: 0.5,
      projectedLaps: 30,
      projectedLapsExact: true,
      extraLaps: 1,
    });
    renderHook(() => useSessionTimingStoreUpdater(true));

    expect(useSessionTimingStore.getState()).toMatchObject({
      lapsCompleted: 0,
      lapProgress: 0,
      projectedLaps: 0,
      projectedLapsExact: false,
      extraLaps: 0,
    });
  });

  it('does not write to the store when disabled', () => {
    renderHook(() => useSessionTimingStoreUpdater(false));

    expect(useSessionTimingStore.getState()).toMatchObject({
      state: 0,
      currentLap: 0,
      totalLaps: 0,
    });
  });
});
