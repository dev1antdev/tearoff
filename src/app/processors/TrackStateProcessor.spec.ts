import { describe, expect, it } from 'vitest';
import type { Telemetry } from '@irdashies/types';
import { TrackStateProcessor } from './TrackStateProcessor';

const frame = (values: Record<string, unknown[]>): Telemetry =>
  Object.fromEntries(
    Object.entries(values).map(([key, current]) => [key, { value: current }])
  ) as unknown as Telemetry;

describe('TrackStateProcessor', () => {
  it('projects positional, pit, and warning state', () => {
    const processor = new TrackStateProcessor();
    processor.onFrame(
      frame({
        CamCarIdx: [2],
        CarIdxLapDistPct: [0.1004, 0.2005, 0.30049],
        CarIdxOnPitRoad: [0, 1, 0],
        CarIdxTrackSurface: [3, 2, 3],
        CarIdxClassPosition: [1, 2, 3],
        CarLeftRight: [2],
        IsOnTrack: [true],
        OnPitRoad: [true],
        Speed: [41.5],
        EngineWarnings: [16],
        SessionFlags: [32],
        SessionNum: [1],
        LapLastLapTime: [96.797],
        LapCompleted: [12],
      })
    );

    expect(processor.snapshot()).toMatchObject({
      focusCarIdx: 2,
      carIdxLapDistPct: [0.1, 0.201, 0.3],
      carIdxOnPitRoad: [false, true, false],
      carIdxTrackSurface: [3, 2, 3],
      carIdxClassPosition: [1, 2, 3],
      carLeftRight: 2,
      isOnTrack: true,
      onPitRoad: true,
      speed: 41.5,
      engineWarnings: 16,
      sessionFlags: 32,
      sessionNum: 1,
      lastLapTime: 96.797,
      lapCompleted: 12,
      version: 1,
    });
  });

  it('reuses buffers, publishes only changes, and resets on disconnect', () => {
    const processor = new TrackStateProcessor();
    const telemetry = frame({ CarIdxLapDistPct: [0.25], IsOnTrack: [true] });
    processor.onFrame(telemetry);
    const positions = processor.snapshot().carIdxLapDistPct;
    processor.onFrame(telemetry);
    expect(processor.snapshot().version).toBe(1);
    expect(processor.snapshot().carIdxLapDistPct).toBe(positions);

    processor.onLifecycle({ type: 'disconnect' });
    expect(processor.snapshot()).toMatchObject({
      carIdxLapDistPct: [],
      isOnTrack: false,
      sessionNum: null,
      version: 2,
    });
  });

  it('ignores sub-millipercent position movement', () => {
    const processor = new TrackStateProcessor();
    processor.onFrame(frame({ CarIdxLapDistPct: [0.12341] }));
    processor.onFrame(frame({ CarIdxLapDistPct: [0.12344] }));

    expect(processor.snapshot()).toMatchObject({
      carIdxLapDistPct: [0.123],
      version: 1,
    });
  });

  it("carries LMU's refuel target with its unit, and drops it on disconnect", () => {
    const processor = new TrackStateProcessor();
    processor.onFrame(frame({}));
    // Absent under iRacing, and under LMU until its pit menu has answered.
    expect(processor.snapshot().refuelTarget).toBeUndefined();
    expect(processor.snapshot().refuelTargetIsVirtualEnergy).toBeUndefined();

    processor.onFrame(
      frame({
        LmuRefuelTarget: [45],
        LmuRefuelTargetIsVirtualEnergy: [true],
      })
    );
    expect(processor.snapshot()).toMatchObject({
      refuelTarget: 45,
      refuelTargetIsVirtualEnergy: true,
    });

    // Litres for a fuel-limited car: the same field, the other unit.
    processor.onFrame(
      frame({
        LmuRefuelTarget: [30.5],
        LmuRefuelTargetIsVirtualEnergy: [false],
      })
    );
    expect(processor.snapshot()).toMatchObject({
      refuelTarget: 30.5,
      refuelTargetIsVirtualEnergy: false,
    });

    processor.onLifecycle({ type: 'disconnect' });
    expect(processor.snapshot().refuelTarget).toBeUndefined();
    expect(processor.snapshot().refuelTargetIsVirtualEnergy).toBeUndefined();
  });

  it("carries LMU's not-in-a-session flag, and drops it on disconnect", () => {
    const processor = new TrackStateProcessor();
    processor.onFrame(frame({}));
    expect(processor.snapshot().notInSession).toBe(false);

    processor.onFrame(frame({ LmuNotInSession: [true] }));
    expect(processor.snapshot().notInSession).toBe(true);

    processor.onLifecycle({ type: 'disconnect' });
    expect(processor.snapshot().notInSession).toBe(false);
  });

  it("carries LMU's out-of-car flag beside live pit flags, and drops it on disconnect", () => {
    const processor = new TrackStateProcessor();
    processor.onFrame(frame({}));
    expect(processor.snapshot().outOfCar).toBe(false);

    // At the monitor with the car in its pit stall: both stand as reported.
    processor.onFrame(
      frame({
        LmuOutOfCar: [true],
        OnPitRoad: [true],
        PlayerCarInPitStall: [true],
      })
    );
    expect(processor.snapshot()).toMatchObject({
      outOfCar: true,
      onPitRoad: true,
      playerCarInPitStall: true,
    });

    processor.onLifecycle({ type: 'disconnect' });
    expect(processor.snapshot().outOfCar).toBe(false);
  });

  it("carries LMU's watching flag with the car watched, and drops it on disconnect", () => {
    const processor = new TrackStateProcessor();
    processor.onFrame(frame({}));
    expect(processor.snapshot().watching).toBe(false);

    // A team-mate's stint: out of the car, the focus on the team car.
    processor.onFrame(
      frame({
        LmuWatching: [true],
        LmuOutOfCar: [true],
        IsOnTrack: [false],
        CamCarIdx: [7],
      })
    );
    const version = processor.snapshot().version;
    expect(processor.snapshot()).toMatchObject({
      watching: true,
      outOfCar: true,
      isOnTrack: false,
      focusCarIdx: 7,
    });

    // The flag going is a change of its own: the car went into its garage.
    processor.onFrame(
      frame({
        LmuWatching: [false],
        LmuOutOfCar: [true],
        IsOnTrack: [false],
        CamCarIdx: [7],
      })
    );
    expect(processor.snapshot().watching).toBe(false);
    expect(processor.snapshot().version).toBe(version + 1);

    processor.onFrame(frame({ LmuWatching: [true] }));
    processor.onLifecycle({ type: 'disconnect' });
    expect(processor.snapshot().watching).toBe(false);
  });

  it('says whether the car watched is the user’s own entry', () => {
    const processor = new TrackStateProcessor();
    processor.onFrame(frame({}));
    expect(processor.snapshot().watchingOwnCar).toBe(false);

    // A team-mate's stint, the camera left on the team car.
    processor.onFrame(
      frame({ LmuWatching: [true], CamCarIdx: [7], PlayerCarIdx: [7] })
    );
    expect(processor.snapshot()).toMatchObject({
      watching: true,
      watchingOwnCar: true,
      focusCarIdx: 7,
    });

    // The camera moved to a rival: still watching, and not the own car.
    const version = processor.snapshot().version;
    processor.onFrame(
      frame({ LmuWatching: [true], CamCarIdx: [3], PlayerCarIdx: [7] })
    );
    expect(processor.snapshot()).toMatchObject({
      watching: true,
      watchingOwnCar: false,
      focusCarIdx: 3,
    });
    expect(processor.snapshot().version).toBe(version + 1);

    // At the wheel of the same car: not watched at all.
    processor.onFrame(
      frame({
        LmuWatching: [false],
        IsOnTrack: [true],
        CamCarIdx: [7],
        PlayerCarIdx: [7],
      })
    );
    expect(processor.snapshot().watchingOwnCar).toBe(false);

    processor.onFrame(
      frame({ LmuWatching: [true], CamCarIdx: [7], PlayerCarIdx: [7] })
    );
    processor.onLifecycle({ type: 'disconnect' });
    expect(processor.snapshot().watchingOwnCar).toBe(false);
  });

  it('says whether the own car’s pedals and revs are being read while it is watched', () => {
    const processor = new TrackStateProcessor();
    const stint = { LmuWatching: [true], CamCarIdx: [7], PlayerCarIdx: [7] };
    // Left out of the snapshot until it holds, at the wheel included.
    processor.onFrame(frame({ IsOnTrack: [true] }));
    expect(processor.snapshot()).not.toHaveProperty('watchingOwnCarTelemetry');
    processor.onFrame(frame(stint));
    expect(processor.snapshot().watchingOwnCar).toBe(true);
    expect(processor.snapshot().watchingOwnCarTelemetry).toBeUndefined();

    // The sim fills in the team car's block.
    const version = processor.snapshot().version;
    processor.onFrame(frame({ ...stint, LmuOwnEntryTelemetry: [true] }));
    expect(processor.snapshot().watchingOwnCarTelemetry).toBe(true);
    expect(processor.snapshot().version).toBe(version + 1);

    // The camera moves to a rival: the block is still the team car's.
    processor.onFrame(
      frame({ ...stint, CamCarIdx: [3], LmuOwnEntryTelemetry: [true] })
    );
    expect(processor.snapshot().watchingOwnCarTelemetry).toBeUndefined();

    processor.onFrame(frame({ ...stint, LmuOwnEntryTelemetry: [true] }));
    expect(processor.snapshot().watchingOwnCarTelemetry).toBe(true);
    processor.onLifecycle({ type: 'disconnect' });
    expect(processor.snapshot().watchingOwnCarTelemetry).toBeUndefined();
  });

  it('is never watching on a frame without the flag, as every iRacing frame is', () => {
    // Under iRacing nothing sets it yet, whatever the camera is on.
    const processor = new TrackStateProcessor();
    processor.onFrame(
      frame({
        CamCarIdx: [3],
        IsOnTrack: [false],
        CarIdxTrackSurface: [3, 3, 3, 3],
      })
    );

    expect(processor.snapshot().watching).toBe(false);
  });
});
