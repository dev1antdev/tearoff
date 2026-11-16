import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ChannelBridge,
  RaceHistorySummarySnapshot,
  StintPaceReference,
} from '@irdashies/types';
import { useCarIdxStintPace } from './useCarIdxStintPace';

/**
 * The summary as the recorder would publish it for three cars. Car 0 is in
 * the second half of a double stint, car 1 has two clean laps since its
 * stop, car 2 has not stopped.
 */
const summary = (
  over: Partial<RaceHistorySummarySnapshot> = {}
): RaceHistorySummarySnapshot => ({
  raceToken: 'boot:1',
  raceId: null,
  resumed: false,
  laps: [40, 38, 41],
  lastLap: [40, 38, 41],
  missingLaps: [0, 0, 0],
  stintFirstLap: [34, 36, 1],
  stintLaps: [7, 3, 41],
  stintDriver: ['B', 'C', 'D'],
  stintAvgLap: [114.0, 115.1, 113.2],
  stintCleanLaps: [6, 2, 40],
  previousStintAvgLap: [114.5, 115.0, -1],
  previousStintDriver: ['B', 'C', ''],
  previousDriverStintAvgLap: [113.6, -1, -1],
  previousDriverStintDriver: ['A', '', ''],
  driverChanges: [1, 0, 0],
  stops: [2, 1, 0],
  revision: [9, 7, 5],
  sessionNum: 0,
  version: 1,
  ...over,
});

const scene = {
  subscribed: [] as string[],
  publish: undefined as
    ((payload: RaceHistorySummarySnapshot) => void) | undefined,
};

beforeEach(() => {
  scene.subscribed = [];
  scene.publish = undefined;
  window.channelBridge = {
    subscribe: (
      channel: string,
      callback: (payload: RaceHistorySummarySnapshot) => void
    ) => {
      scene.subscribed.push(channel);
      scene.publish = callback;
      return () => undefined;
    },
  } as unknown as ChannelBridge;
});

afterEach(() => {
  Reflect.deleteProperty(window, 'channelBridge');
});

const mount = (against: StintPaceReference, enabled = true) =>
  renderHook(
    (props: { against: StintPaceReference; enabled: boolean }) =>
      useCarIdxStintPace(props.against, props.enabled),
    { initialProps: { against, enabled } }
  );

const rounded = (values: readonly (number | null)[]) =>
  values.map((value) => (value === null ? null : Math.round(value * 100)));

describe('each car’s pace against an earlier stint', () => {
  it('is against the stint before, for every car the summary holds', () => {
    const { result } = mount('stint');
    act(() => scene.publish?.(summary()));

    expect(rounded(result.current)).toEqual([-50, null, null]);
  });

  it('is against the last stint by another driver when asked for', () => {
    const { result, rerender } = mount('stint');
    act(() => scene.publish?.(summary()));

    rerender({ against: 'driver', enabled: true });

    expect(rounded(result.current)).toEqual([40, null, null]);
  });

  it('follows the summary as the race goes on', () => {
    const { result } = mount('stint');
    act(() => scene.publish?.(summary()));

    // Car 1 completes its third clean lap since the stop.
    act(() =>
      scene.publish?.(
        summary({
          stintAvgLap: [114.0, 114.8, 113.2],
          stintCleanLaps: [6, 3, 40],
          version: 2,
        })
      )
    );

    expect(rounded(result.current)).toEqual([-50, -20, null]);
  });

  it('is empty before the summary has arrived', () => {
    const { result } = mount('stint');

    expect(result.current).toEqual([]);
  });

  it('reads nothing while switched off, so that it records no race', () => {
    const { result, rerender } = mount('stint', false);

    expect(scene.subscribed).toEqual([]);
    expect(result.current).toEqual([]);
    // The same empty list every time: nothing for a row to redraw over.
    const empty = result.current;
    rerender({ against: 'driver', enabled: false });
    expect(result.current).toBe(empty);
    expect(scene.subscribed).toEqual([]);

    rerender({ against: 'driver', enabled: true });
    expect(scene.subscribed).toEqual(['race-history.summary']);
  });
});
