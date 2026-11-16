import { describe, expect, it } from 'vitest';
import {
  lmuSectorTime,
  mapLmuSectorTimes,
  writeLmuCarSectorTimes,
  type LmuCarSectorSource,
} from './sectorTimes';

type Frame = Record<string, { value: unknown[] }>;

/**
 * Four slots as scoring leaves them part-way through a race: a car on its
 * third lap with both laps timed, a car in the second sector of its second
 * lap, a car whose last lap the sim gave no time, and a gap in the slot ids,
 * which keeps the zeros its arrays were created with.
 *
 * LMU's second figure is the time to the end of the second sector, not the
 * second sector's own.
 */
const grid = (): Record<keyof LmuCarSectorSource, Float64Array> => ({
  vehCurSector1: new Float64Array([31.9, 33.1, 0, 0]),
  vehCurSector2: new Float64Array([0, 0, 0, 0]),
  vehLastSector1: new Float64Array([32.4, 33.5, 34.2, 0]),
  vehLastSector2: new Float64Array([73.4, 75.25, 77.7, 0]),
  vehLastLapTime: new Float64Array([133.4, 136.75, -1, 0]),
  vehBestSector1: new Float64Array([32.1, 33.5, 34.2, 0]),
  vehBestSector2: new Float64Array([73.4, 75.25, 77.7, 0]),
  vehBestLapTime: new Float64Array([133.4, 136.75, 139.2, 0]),
});

const write = (raw: LmuCarSectorSource): Frame => {
  const frame: Frame = {};
  writeLmuCarSectorTimes(frame, raw);
  return frame;
};

/** One car's three entries of a flat per-car key. */
const ofCar = (frame: Frame, key: string, carIdx: number) =>
  frame[key].value.slice(carIdx * 3, carIdx * 3 + 3);

describe('lmuSectorTime', () => {
  it('is each sector of the three the player’s key is made of', () => {
    for (const [sector1, sector1And2, lapTime] of [
      [32.4, 73.4, 133.4],
      [32.4, 73.4, undefined],
      [32.4, -1, 133.4],
      [-1, 73.4, 133.4],
      [0, 0, 0],
      [73.4, 32.4, 20],
    ] as const) {
      expect([
        lmuSectorTime(0, sector1, sector1And2, lapTime),
        lmuSectorTime(1, sector1, sector1And2, lapTime),
        lmuSectorTime(2, sector1, sector1And2, lapTime),
      ]).toEqual(mapLmuSectorTimes(sector1, sector1And2, lapTime));
    }
  });
});

describe('writeLmuCarSectorTimes', () => {
  it('publishes three sector times for every slot, flat', () => {
    const frame = write(grid());

    for (const key of [
      'LmuCarIdxCurrentSectorTimes',
      'LmuCarIdxLastSectorTimes',
      'LmuCarIdxBestSectorTimes',
    ]) {
      expect(frame[key].value).toHaveLength(4 * 3);
    }
  });

  it('takes the second sector out of the sim’s running total', () => {
    const frame = write(grid());

    const last = ofCar(frame, 'LmuCarIdxLastSectorTimes', 0) as number[];
    expect(last[0]).toBe(32.4);
    expect(last[1]).toBeCloseTo(41);
    expect(last[2]).toBeCloseTo(60);
    // They are the lap, within what a float keeps.
    expect(last[0] + last[1] + last[2]).toBeCloseTo(133.4, 9);
  });

  it('gives each car the figures the player’s keys would have for it', () => {
    const raw = grid();
    const frame = write(raw);

    for (let carIdx = 0; carIdx < 4; carIdx += 1) {
      expect(ofCar(frame, 'LmuCarIdxCurrentSectorTimes', carIdx)).toEqual(
        mapLmuSectorTimes(raw.vehCurSector1[carIdx], raw.vehCurSector2[carIdx])
      );
      expect(ofCar(frame, 'LmuCarIdxLastSectorTimes', carIdx)).toEqual(
        mapLmuSectorTimes(
          raw.vehLastSector1[carIdx],
          raw.vehLastSector2[carIdx],
          raw.vehLastLapTime[carIdx]
        )
      );
      expect(ofCar(frame, 'LmuCarIdxBestSectorTimes', carIdx)).toEqual(
        mapLmuSectorTimes(
          raw.vehBestSector1[carIdx],
          raw.vehBestSector2[carIdx],
          raw.vehBestLapTime[carIdx]
        )
      );
    }
  });

  it('has no third sector for the lap under way', () => {
    const frame = write(grid());

    expect(ofCar(frame, 'LmuCarIdxCurrentSectorTimes', 0)).toEqual([
      31.9,
      null,
      null,
    ]);
  });

  it('has no third sector for a last lap the sim gave no time', () => {
    const frame = write(grid());

    const last = ofCar(frame, 'LmuCarIdxLastSectorTimes', 2);
    expect(last[0]).toBe(34.2);
    expect(last[1]).toBeCloseTo(43.5);
    expect(last[2]).toBeNull();
  });

  it('reads null three times for a slot with no car in it', () => {
    const frame = write(grid());

    for (const key of [
      'LmuCarIdxCurrentSectorTimes',
      'LmuCarIdxLastSectorTimes',
      'LmuCarIdxBestSectorTimes',
    ]) {
      expect(ofCar(frame, key, 3)).toEqual([null, null, null]);
    }
  });

  it('leaves out a key whose source the read does not carry', () => {
    const { vehLastSector1, vehLastSector2, vehLastLapTime } = grid();
    const frame = write({ vehLastSector1, vehLastSector2, vehLastLapTime });

    expect(Object.keys(frame)).toEqual(['LmuCarIdxLastSectorTimes']);
  });

  it('hands on the cell it had while no figure has moved', () => {
    const first = write(grid());
    const second = write(grid());

    // The mapper runs at the poll rate; a sector time moves a few times a
    // lap. The same cell, so a frame allocates nothing for the three keys.
    expect(second.LmuCarIdxCurrentSectorTimes).toBe(
      first.LmuCarIdxCurrentSectorTimes
    );
    expect(second.LmuCarIdxLastSectorTimes).toBe(
      first.LmuCarIdxLastSectorTimes
    );
    expect(second.LmuCarIdxBestSectorTimes).toBe(
      first.LmuCarIdxBestSectorTimes
    );
  });

  it('replaces a cell when a figure moves, and never writes to the old one', () => {
    const first = write(grid());
    const before = [...first.LmuCarIdxCurrentSectorTimes.value];
    const moved = grid();
    // Car 1 reaches the end of its second sector.
    moved.vehCurSector2[1] = 75.6;

    const second = write(moved);

    expect(second.LmuCarIdxCurrentSectorTimes).not.toBe(
      first.LmuCarIdxCurrentSectorTimes
    );
    expect(first.LmuCarIdxCurrentSectorTimes.value).toEqual(before);
    const current = ofCar(second, 'LmuCarIdxCurrentSectorTimes', 1) as number[];
    expect(current[0]).toBe(33.1);
    expect(current[1]).toBeCloseTo(42.5);
    // The last lap's figures did not move, so that cell is the one held.
    expect(second.LmuCarIdxLastSectorTimes).toBe(
      first.LmuCarIdxLastSectorTimes
    );
  });

  it('follows the grid when a slot is added', () => {
    write(grid());
    const grown = grid();
    const frame = write({
      ...grown,
      vehLastSector1: new Float64Array([...grown.vehLastSector1, 35]),
      vehLastSector2: new Float64Array([...grown.vehLastSector2, 80]),
      vehLastLapTime: new Float64Array([...grown.vehLastLapTime, 140]),
    });

    expect(frame.LmuCarIdxLastSectorTimes.value).toHaveLength(5 * 3);
    expect(ofCar(frame, 'LmuCarIdxLastSectorTimes', 4)).toEqual([35, 45, 60]);
  });
});
