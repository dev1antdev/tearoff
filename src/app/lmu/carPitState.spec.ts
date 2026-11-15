import { describe, expect, it } from 'vitest';
import { LMU_NO_CAR, writeLmuCarPitState } from './carPitState';
import type { LmuCarPitSource } from './carPitState';

type Frame = Record<string, { value: unknown[] }>;

/**
 * Four slots as scoring leaves them in a race: one car out on the circuit
 * having stopped once, one stationary at its box on its second stop, one in
 * its garage, and a gap in the slot ids, which keeps the zeros its arrays
 * were created with and the -1 the addon fills the lap fraction with.
 */
const grid = (): Required<LmuCarPitSource> => ({
  vehPitState: new Uint8Array([0, 3, 0, 0]),
  vehNumPitstops: new Int32Array([1, 2, 0, 0]),
  vehInGarageStall: new Uint8Array([0, 0, 1, 0]),
  vehLapDistPct: new Float64Array([0.42, 0.97, 0.03, -1]),
});

const write = (raw: LmuCarPitSource): Frame => {
  const frame: Frame = {};
  writeLmuCarPitState(frame, raw);
  return frame;
};

describe('writeLmuCarPitState', () => {
  it('publishes the pit state of each car, by slot', () => {
    expect(write(grid()).LmuCarIdxPitState.value).toEqual([
      0,
      3,
      0,
      LMU_NO_CAR,
    ]);
  });

  it.each([
    [1, 'a stop asked for'],
    [2, 'on its way in'],
    [3, 'stationary'],
    [4, 'on its way out'],
  ])('passes state %i through as the sim numbers it: %s', (state) => {
    const frame = write({
      ...grid(),
      vehPitState: new Uint8Array([state, 0, 0, 0]),
    });

    expect(frame.LmuCarIdxPitState.value[0]).toBe(state);
  });

  it('publishes the stops each car has made', () => {
    expect(write(grid()).LmuCarIdxPitStops.value).toEqual([
      1,
      2,
      0,
      LMU_NO_CAR,
    ]);
  });

  it('keeps a car that has not stopped apart from a slot with no car', () => {
    // Both read 0 in shared memory. Slot 2 is a car; slot 3 is a gap.
    const stops = write(grid()).LmuCarIdxPitStops.value;

    expect(stops[2]).toBe(0);
    expect(stops[3]).toBe(-1);
  });

  it('says which cars are in their garage', () => {
    expect(write(grid()).LmuCarIdxInGarage.value).toEqual([
      false,
      false,
      true,
      false,
    ]);
  });

  it('does not put a car in the garage of a slot that has none', () => {
    const frame = write({
      ...grid(),
      vehInGarageStall: new Uint8Array([0, 0, 1, 1]),
    });

    expect(frame.LmuCarIdxInGarage.value).toEqual([false, false, true, false]);
  });

  it('tells a stop at the box from the garage, which the track surface cannot', () => {
    // Slot 1 is stationary at its box, slot 2 is in its garage. Both are
    // "in pit stall" to CarIdxTrackSurface.
    const frame = write(grid());

    expect(frame.LmuCarIdxPitState.value[1]).toBe(3);
    expect(frame.LmuCarIdxInGarage.value[1]).toBe(false);
    expect(frame.LmuCarIdxPitState.value[2]).toBe(0);
    expect(frame.LmuCarIdxInGarage.value[2]).toBe(true);
  });

  it('leaves each key out when the read does not carry its source', () => {
    const { vehLapDistPct } = grid();

    expect(write({ vehLapDistPct })).toEqual({});

    // An addon built before the stop count was exported still has the rest.
    const withoutStops = write({ ...grid(), vehNumPitstops: undefined });
    expect(withoutStops.LmuCarIdxPitStops).toBeUndefined();
    expect(withoutStops.LmuCarIdxPitState).toBeDefined();
    expect(withoutStops.LmuCarIdxInGarage).toBeDefined();
  });

  it('publishes the same cells from frame to frame while nothing moves', () => {
    // 64 frames a second, and a pit state moves a few times a race.
    const first = write(grid());
    const second = write(grid());

    expect(second.LmuCarIdxPitState).toBe(first.LmuCarIdxPitState);
    expect(second.LmuCarIdxPitStops).toBe(first.LmuCarIdxPitStops);
    expect(second.LmuCarIdxInGarage).toBe(first.LmuCarIdxInGarage);
  });

  it('publishes a new cell when a car’s state moves, leaving the old one as it was', () => {
    const before = write(grid());
    const after = write({
      ...grid(),
      // The car in slot 1 pulls away from its box.
      vehPitState: new Uint8Array([0, 4, 0, 0]),
    });

    expect(after.LmuCarIdxPitState).not.toBe(before.LmuCarIdxPitState);
    expect(after.LmuCarIdxPitState.value).toEqual([0, 4, 0, -1]);
    expect(before.LmuCarIdxPitState.value).toEqual([0, 3, 0, -1]);
    // The other two did not move.
    expect(after.LmuCarIdxPitStops).toBe(before.LmuCarIdxPitStops);
    expect(after.LmuCarIdxInGarage).toBe(before.LmuCarIdxInGarage);
  });

  it('follows a car into a slot that was empty', () => {
    const empty = write(grid());
    const joined = write({
      ...grid(),
      vehLapDistPct: new Float64Array([0.42, 0.97, 0.03, 0]),
    });

    expect(empty.LmuCarIdxPitStops.value[3]).toBe(-1);
    expect(joined.LmuCarIdxPitStops.value[3]).toBe(0);
    expect(joined.LmuCarIdxPitState.value[3]).toBe(0);
  });
});
