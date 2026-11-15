import { describe, expect, it, vi } from 'vitest';
import type { FuelLapData, Session, Telemetry } from '@irdashies/types';
import { FuelProjectionProcessor } from './FuelProjectionProcessor';

/**
 * The fuel calculator through a team-mate's stint under Le Mans Ultimate.
 *
 * The frames are as the mapper writes them: the user's own entry is car 0
 * and its lap, lap fraction and pit state go on through the stint, with
 * `IsOnTrack` false and `LmuWatching` saying the user is watching. What the
 * car has left is there only where the sim writes it for a car the user is
 * not in: the virtual energy of a car with a telemetry block.
 */
interface Scene {
  /** Laps completed, which is what LMU counts. */
  lap: number;
  pct: number;
  time: number;
  /** Virtual energy as a fraction; undefined for a car counted in litres. */
  energy?: number;
  /** Litres in the tank; undefined where the sim writes none. */
  fuel?: number;
  /** A team-mate is driving and the user is watching. */
  watched?: boolean;
  /**
   * Whether the sim sent a telemetry block for the car this frame. Without
   * one the per-car channel holds the last energy it read and the car's own
   * key is absent.
   */
  block?: boolean;
}

const lmuFrame = ({
  lap,
  pct,
  time,
  energy,
  fuel,
  watched = false,
  block = true,
}: Scene): Telemetry =>
  ({
    ...(fuel === undefined ? {} : { FuelLevel: { value: [fuel] } }),
    LmuCarIdxEnergyRemaining: { value: [energy ?? -1] },
    LmuCarIdxEnergyIsVirtual: { value: [energy !== undefined] },
    ...(energy !== undefined && block
      ? { LmuVirtualEnergy: { value: [energy] } }
      : {}),
    Lap: { value: [lap + 1] },
    LapCompleted: { value: [lap] },
    LapDistPct: { value: [pct] },
    OnPitRoad: { value: [false] },
    PlayerCarTowTime: { value: [0] },
    SessionFlags: { value: [0] },
    SessionNum: { value: [0] },
    SessionTime: { value: [time] },
    IsOnTrack: { value: [!watched] },
    LmuWatching: { value: [watched] },
  }) as unknown as Telemetry;

const session = {
  WeekendInfo: { TrackName: 'Laguna Seca', TrackID: 1 },
  DriverInfo: {
    DriverCarIdx: 0,
    DriverCarFuelMaxLtr: 120,
    DriverCarMaxFuelPct: 1,
    Drivers: [{ CarIdx: 0, CarPath: '74_26', CarModel: 'Ferrari 296 LMGT3' }],
  },
} as unknown as Session;

const setup = () => {
  const lapCompleted = vi.fn<(lap: FuelLapData) => void>();
  const saveLap = vi.fn<(lap: FuelLapData) => void>();
  const processor = new FuelProjectionProcessor({
    persistence: { lapCompleted, saveLap },
    persistLaps: true,
  });
  processor.init(session);
  const play = (frames: Scene[]) => {
    for (const each of frames) processor.onFrame(lmuFrame(each));
  };
  return { processor, play, lapCompleted, saveLap };
};

/** The lap numbers handed to a persistence call, in the order they came. */
const lapNumbers = (calls: { mock: { calls: [FuelLapData][] } }) =>
  calls.mock.calls.map(([lap]) => lap.lapNumber);

describe('FuelProjectionProcessor through a team-mate’s stint on virtual energy', () => {
  /** The user's own lap from the line, 45 % down to 42.75 %. */
  const ownLap: Scene[] = [
    { energy: 0.45, fuel: 44.9, lap: 0, pct: 0.01, time: 100 },
    { energy: 0.44, fuel: 43.9, lap: 0, pct: 0.5, time: 145 },
    { energy: 0.4275, fuel: 42.6, lap: 1, pct: 0.01, time: 190 },
  ];
  /** The team-mate's lap after it, from that crossing to the next. */
  const teamMatesLap: Scene[] = [
    { energy: 0.427, lap: 1, pct: 0.02, time: 192, watched: true },
    { energy: 0.415, lap: 1, pct: 0.5, time: 235, watched: true },
    { energy: 0.4045, lap: 2, pct: 0.01, time: 280, watched: true },
  ];

  it('counts the team-mate’s lap in the live projection', () => {
    const { processor, play } = setup();
    play([...ownLap, ...teamMatesLap]);

    const snapshot = processor.snapshot();
    expect(snapshot.completedLaps.map((lap) => lap.lapNumber)).toEqual([2, 1]);
    expect(snapshot.completedLaps[0]).toMatchObject({
      wasWatched: true,
      isValidForCalc: true,
    });
    // It is what the car used: 42.75 % down to 40.45 %.
    expect(snapshot.completedLaps[0].fuelUsed).toBeCloseTo(2.3, 6);
    expect(snapshot.lastLapUsage).toBeCloseTo(2.3, 6);
    expect(snapshot.fuelLevel).toBeCloseTo(40.45, 6);
    // The user's own lap is the lap it always was.
    expect(snapshot.completedLaps[1]).not.toHaveProperty('wasWatched');
  });

  it('never saves the team-mate’s lap', () => {
    const { play, lapCompleted, saveLap } = setup();
    play([...ownLap, ...teamMatesLap]);

    expect(lapNumbers(lapCompleted)).toEqual([1, 2]);
    expect(lapNumbers(saveLap)).toEqual([1]);
  });

  it('says the figures are live while the team-mate drives', () => {
    const { processor, play } = setup();
    play(ownLap);
    expect(processor.snapshot().watched).toBeUndefined();
    expect(processor.snapshot().isOnTrack).toBe(true);

    play(teamMatesLap.slice(0, 2));

    expect(processor.snapshot()).toMatchObject({
      watched: true,
      isOnTrack: false,
      budget: 'virtualEnergy',
    });
    // Measured within the lap as it is for the user: 42.75 % at the line.
    expect(processor.snapshot().currentLapUsage).toBeCloseTo(1.25, 6);
  });

  it('does not save the lap the user takes the car back on', () => {
    const { play, saveLap, lapCompleted } = setup();
    play([...ownLap, ...teamMatesLap]);
    // The stop, and the user out again for the rest of the lap.
    play([
      { energy: 0.4, lap: 2, pct: 0.3, time: 320, watched: true },
      { energy: 0.395, fuel: 39.4, lap: 2, pct: 0.6, time: 350 },
      { energy: 0.385, fuel: 38.2, lap: 3, pct: 0.01, time: 380 },
    ]);

    expect(lapNumbers(lapCompleted)).toEqual([1, 2, 3]);
    expect(lapNumbers(saveLap)).toEqual([1]);
  });

  it('saves the user’s own lap again from the next crossing', () => {
    const { processor, play, saveLap } = setup();
    play([...ownLap, ...teamMatesLap]);
    play([
      { energy: 0.4, lap: 2, pct: 0.3, time: 320, watched: true },
      { energy: 0.395, fuel: 39.4, lap: 2, pct: 0.6, time: 350 },
      { energy: 0.385, fuel: 38.2, lap: 3, pct: 0.01, time: 380 },
      { energy: 0.373, fuel: 37, lap: 3, pct: 0.5, time: 425 },
      { energy: 0.362, fuel: 35.9, lap: 4, pct: 0.01, time: 470 },
    ]);

    expect(lapNumbers(saveLap)).toEqual([1, 4]);
    expect(processor.snapshot().watched).toBeUndefined();
    expect(processor.snapshot().completedLaps[0]).not.toHaveProperty(
      'wasWatched'
    );
  });

  it('holds the reading through a frame without a telemetry block', () => {
    const { processor, play } = setup();
    play([
      ...ownLap,
      teamMatesLap[0],
      // A dropped frame: the per-car channel holds the last energy.
      {
        energy: 0.427,
        lap: 1,
        pct: 0.1,
        time: 192.5,
        watched: true,
        block: false,
      },
      ...teamMatesLap.slice(1),
    ]);

    expect(processor.snapshot().completedLaps[0]).toMatchObject({
      lapNumber: 2,
      wasWatched: true,
    });
    expect(processor.snapshot().completedLaps[0].fuelUsed).toBeCloseTo(2.3, 6);
  });

  it('counts nothing for a car the sim sends no telemetry block for', () => {
    const { processor, play, lapCompleted } = setup();
    play(ownLap);
    // The channel holds 42.75 % for the whole stint: there is a lap count
    // and nothing to measure it in.
    play([
      {
        energy: 0.4275,
        lap: 1,
        pct: 0.3,
        time: 220,
        watched: true,
        block: false,
      },
      {
        energy: 0.4275,
        lap: 2,
        pct: 0.01,
        time: 280,
        watched: true,
        block: false,
      },
      {
        energy: 0.4275,
        lap: 3,
        pct: 0.01,
        time: 370,
        watched: true,
        block: false,
      },
    ]);

    expect(lapNumbers(lapCompleted)).toEqual([1]);
    expect(processor.snapshot().watched).toBeUndefined();
    // The laps already counted stand.
    expect(processor.snapshot().completedLaps).toHaveLength(1);
  });

  it('does not charge the lap the user returns on with the whole stint', () => {
    const { processor, play, lapCompleted, saveLap } = setup();
    play(ownLap);
    play([
      {
        energy: 0.4275,
        lap: 1,
        pct: 0.3,
        time: 220,
        watched: true,
        block: false,
      },
      {
        energy: 0.4275,
        lap: 9,
        pct: 0.3,
        time: 900,
        watched: true,
        block: false,
      },
      // Back at the wheel, twenty points of energy and eight laps later.
      { energy: 0.24, fuel: 24, lap: 9, pct: 0.6, time: 940 },
      { energy: 0.23, fuel: 23, lap: 10, pct: 0.01, time: 980 },
      { energy: 0.218, fuel: 21.8, lap: 10, pct: 0.5, time: 1025 },
      { energy: 0.207, fuel: 20.7, lap: 11, pct: 0.01, time: 1070 },
    ]);

    // The lap of the return was not seen from the line and is not a lap.
    expect(lapNumbers(lapCompleted)).toEqual([1, 11]);
    expect(lapNumbers(saveLap)).toEqual([1, 11]);
    expect(processor.snapshot().completedLaps[0].fuelUsed).toBeCloseTo(2.3, 6);
  });
});

describe('FuelProjectionProcessor through a team-mate’s stint on fuel', () => {
  /** A car counted in litres: the user's lap from the line, 3 L of it. */
  const ownLap: Scene[] = [
    { fuel: 60, lap: 0, pct: 0.01, time: 100 },
    { fuel: 58.5, lap: 0, pct: 0.5, time: 145 },
    { fuel: 57, lap: 1, pct: 0.01, time: 190 },
  ];

  it('counts nothing while the sim writes no fuel for the car', () => {
    const { processor, play, lapCompleted } = setup();
    play(ownLap);
    play([
      { lap: 1, pct: 0.5, time: 235, watched: true },
      { lap: 2, pct: 0.01, time: 280, watched: true },
      { lap: 3, pct: 0.01, time: 370, watched: true },
    ]);

    // Not a lap of 57 L, which a level read as 0 would have made of it.
    expect(lapNumbers(lapCompleted)).toEqual([1]);
    expect(processor.snapshot().watched).toBeUndefined();
    expect(processor.snapshot().budget).toBeUndefined();
  });

  it('picks the user’s laps up again from the line after the stint', () => {
    const { processor, play, lapCompleted, saveLap } = setup();
    play(ownLap);
    play([
      { lap: 1, pct: 0.5, time: 235, watched: true },
      { lap: 8, pct: 0.3, time: 900, watched: true },
      // Refuelled, and the user back in half-way round the lap.
      { fuel: 80, lap: 8, pct: 0.6, time: 940 },
      { fuel: 79, lap: 9, pct: 0.01, time: 980 },
      { fuel: 77.5, lap: 9, pct: 0.5, time: 1025 },
      { fuel: 76, lap: 10, pct: 0.01, time: 1070 },
    ]);

    expect(lapNumbers(lapCompleted)).toEqual([1, 10]);
    expect(lapNumbers(saveLap)).toEqual([1, 10]);
    expect(processor.snapshot().completedLaps[0].fuelUsed).toBeCloseTo(3, 6);
  });

  it('counts the team-mate’s laps once the sim does write the fuel', () => {
    // What a later step brings: the litres of a car the user is not in.
    const { processor, play, lapCompleted, saveLap } = setup();
    play(ownLap);
    play([
      { fuel: 56.9, lap: 1, pct: 0.02, time: 192, watched: true },
      { fuel: 55.5, lap: 1, pct: 0.5, time: 235, watched: true },
      { fuel: 54, lap: 2, pct: 0.01, time: 280, watched: true },
    ]);

    expect(lapNumbers(lapCompleted)).toEqual([1, 2]);
    expect(lapNumbers(saveLap)).toEqual([1]);
    expect(processor.snapshot().watched).toBe(true);
  });
});

describe('FuelProjectionProcessor out of the car under iRacing', () => {
  it('goes on saving laps as it did: watching there is a later step', () => {
    const lapCompleted = vi.fn<(lap: FuelLapData) => void>();
    const saveLap = vi.fn<(lap: FuelLapData) => void>();
    const processor = new FuelProjectionProcessor({
      persistence: { lapCompleted, saveLap },
      persistLaps: true,
    });
    processor.init(session);
    const frame = (values: Record<string, number | boolean>): Telemetry =>
      Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key, { value: [value] }])
      ) as unknown as Telemetry;
    const at = (lap: number, pct: number, time: number, fuel: number) =>
      frame({
        FuelLevel: fuel,
        Lap: lap,
        LapDistPct: pct,
        SessionTime: time,
        SessionNum: 0,
        SessionFlags: 0,
        // No LmuWatching: an iRacing frame, with the player out of the car.
        IsOnTrack: false,
      });

    processor.onFrame(at(1, 0.01, 100, 40));
    processor.onFrame(at(1, 0.5, 145, 38.5));
    processor.onFrame(at(2, 0.01, 190, 37));

    expect(lapNumbers(saveLap)).toEqual([1]);
    expect(processor.snapshot().completedLaps[0]).not.toHaveProperty(
      'wasWatched'
    );
    expect(processor.snapshot().watched).toBeUndefined();
  });
});
