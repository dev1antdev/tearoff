import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { LapAverageLaps } from '@irdashies/types';
import { useLapTimesStore } from '../LapTimesStore/LapTimesStore';
import { useCarIdxLapAverage } from './useCarIdxLapAverage';

afterEach(() => useLapTimesStore.getState().reset());

// Car 0 ran six laps and pitted on the fourth; car 1 has three; car 2 none.
const SNAPSHOT = {
  lapTimes: [],
  lapTimeHistory: [[90, 91, 92, 130, 125, 93], [80, 81, 82], []],
  cleanLapTimeHistory: [[90, 91, 92, 93], [81, 82], []],
  sessionNum: 0,
  version: 1,
};

const mount = (count: number, laps: LapAverageLaps, enabled = true) =>
  renderHook(
    (props: { count: number; laps: LapAverageLaps; enabled: boolean }) =>
      useCarIdxLapAverage(props.count, props.laps, props.enabled),
    { initialProps: { count, laps, enabled } }
  );

describe('each car’s average of its last laps', () => {
  it('averages every lap, the pit laps with it, when asked for all', () => {
    useLapTimesStore.getState().applySnapshot(SNAPSHOT);

    const { result } = mount(3, 'all');

    expect(result.current).toEqual([116, 81, null]);
  });

  it('averages the clean laps only when asked for clean', () => {
    useLapTimesStore.getState().applySnapshot(SNAPSHOT);

    const { result } = mount(3, 'clean');

    // Car 1 has three laps but only two clean ones.
    expect(result.current).toEqual([92, null, null]);
  });

  it('gives nothing until a car has the laps asked for', () => {
    useLapTimesStore.getState().applySnapshot(SNAPSHOT);

    const { result, rerender } = mount(6, 'all');
    expect(result.current).toEqual([103.5, null, null]);

    rerender({ count: 7, laps: 'all', enabled: true });
    expect(result.current).toEqual([null, null, null]);
  });

  it('has no clean average where the source sends no clean history', () => {
    useLapTimesStore.getState().applySnapshot({
      lapTimes: [],
      lapTimeHistory: SNAPSHOT.lapTimeHistory,
      sessionNum: 0,
      version: 1,
    });

    // Nothing at all, rather than the average of every lap.
    expect(mount(3, 'clean').result.current).toEqual([]);
    expect(mount(3, 'all').result.current).toEqual([116, 81, null]);
  });

  it('follows the store as laps arrive and empties with it', () => {
    const { result } = mount(3, 'clean');
    expect(result.current).toEqual([]);

    act(() => useLapTimesStore.getState().applySnapshot(SNAPSHOT));
    expect(result.current).toEqual([92, null, null]);

    act(() =>
      useLapTimesStore.getState().applySnapshot({
        ...SNAPSHOT,
        cleanLapTimeHistory: [[90, 91, 92, 93], [81, 82, 83], []],
        version: 2,
      })
    );
    expect(result.current).toEqual([92, 82, null]);

    act(() => useLapTimesStore.getState().reset());
    expect(result.current).toEqual([]);
  });

  it('is empty, and the same array each time, while switched off', () => {
    useLapTimesStore.getState().applySnapshot(SNAPSHOT);

    const { result, rerender } = mount(3, 'all', false);
    const first = result.current;
    expect(first).toEqual([]);

    rerender({ count: 5, laps: 'clean', enabled: false });
    expect(result.current).toBe(first);
  });
});
