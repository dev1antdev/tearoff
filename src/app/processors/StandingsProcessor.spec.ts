import { describe, expect, it } from 'vitest';
import type { Session, Telemetry } from '@irdashies/types';
import { SessionState } from '@irdashies/types';
import { StandingsProcessor } from './StandingsProcessor';

const session = {
  DriverInfo: { DriverCarIdx: 1 },
} as Session;

const frame = (
  sessionTime: number,
  overrides: Partial<Record<keyof Telemetry, unknown>> = {}
): Telemetry =>
  ({
    SessionTime: { value: [sessionTime] },
    SessionNum: { value: [2] },
    SessionState: { value: [4] },
    CamCarIdx: { value: [1] },
    CarIdxF2Time: { value: [0, 1.25] },
    CarIdxEstTime: { value: [10, 11] },
    CarIdxOnPitRoad: { value: [false, false] },
    CarIdxLap: { value: [3, 3] },
    CarIdxLapDistPct: { value: [0.5, 0.4] },
    CarIdxTrackSurface: { value: [3, 3] },
    CarIdxTireCompound: { value: [1, 2] },
    CarIdxSessionFlags: { value: [0, 8] },
    ...overrides,
  }) as Telemetry;

describe('StandingsProcessor', () => {
  it('projects only the driver state consumed by standings', () => {
    const processor = new StandingsProcessor();
    processor.init(session);
    processor.onFrame(frame(10));

    expect(processor.snapshot()).toMatchObject({
      focusCarIdx: 1,
      sessionNum: 2,
      carIdxF2Time: [0, 1.25],
      carIdxLapDistPct: [0.5, 0.4],
      carIdxSessionFlags: [0, 8],
      version: 1,
    });
  });

  it('projects every frame supplied by the host, including focus changes', () => {
    const processor = new StandingsProcessor();
    processor.init(session);
    processor.onFrame(frame(10));
    processor.onFrame(frame(10.1));
    expect(processor.snapshot().version).toBe(2);

    processor.onFrame(frame(10.1, { CamCarIdx: { value: [0] } }));
    expect(processor.snapshot().focusCarIdx).toBe(0);
    expect(processor.snapshot().version).toBe(3);
  });

  it('reuses projection buffers between accepted frames', () => {
    const processor = new StandingsProcessor();
    processor.init(session);
    processor.onFrame(frame(10));
    const first = processor.snapshot();
    const firstLapBuffer = first.carIdxLap;
    const firstPitBuffer = first.carIdxOnPitRoad;
    const firstHistoryBuffer = first.lastPitLap;

    processor.onFrame(frame(10.2));

    expect(processor.snapshot()).toBe(first);
    expect(processor.snapshot().carIdxLap).toBe(firstLapBuffer);
    expect(processor.snapshot().carIdxOnPitRoad).toBe(firstPitBuffer);
    expect(processor.snapshot().lastPitLap).toBe(firstHistoryBuffer);
  });

  it('tracks pit laps and previous track surfaces', () => {
    const processor = new StandingsProcessor();
    processor.init(session);
    processor.onFrame(frame(10));
    processor.onFrame(
      frame(10.2, {
        CarIdxOnPitRoad: { value: [false, true] },
        CarIdxLap: { value: [3, 4] },
        CarIdxTrackSurface: { value: [3, 1] },
      })
    );

    expect(processor.snapshot().lastPitLap).toEqual([undefined, 4]);
    expect(processor.snapshot().previousCarTrackSurface).toEqual([
      undefined,
      3,
    ]);
  });

  it('projects live positions within each class for race sessions', () => {
    const processor = new StandingsProcessor();
    processor.init({
      DriverInfo: { DriverCarIdx: 1, PaceCarIdx: 0 },
      SessionInfo: {
        Sessions: [
          {
            SessionNum: 2,
            SessionType: 'Race',
            ResultsPositions: [
              { CarIdx: 1, ClassPosition: 1, LapsComplete: 2 },
              { CarIdx: 2, ClassPosition: 0, LapsComplete: 2 },
              { CarIdx: 3, ClassPosition: 0, LapsComplete: 1 },
            ],
          },
        ],
      },
    } as Session);
    processor.onFrame(
      frame(10, {
        CarIdxLapCompleted: { value: [0, 2, 2, 1] },
        CarIdxLapDistPct: { value: [0, 0.4, 0.7, 0.9] },
        CarIdxClass: { value: [-1, 10, 10, 20] },
      })
    );

    expect(processor.snapshot().liveClassPosition).toEqual([
      undefined,
      2,
      1,
      1,
    ]);
  });

  it('keeps unfinished cars ordered by live progress under checkered', () => {
    const processor = new StandingsProcessor();
    processor.init({
      DriverInfo: { DriverCarIdx: 1, PaceCarIdx: 0 },
      SessionInfo: {
        Sessions: [
          {
            SessionNum: 2,
            SessionType: 'Race',
            ResultsPositions: [
              {
                Position: 1,
                CarIdx: 1,
                ClassPosition: 0,
                LapsComplete: 2,
              },
              {
                Position: 2,
                CarIdx: 2,
                ClassPosition: 1,
                LapsComplete: 2,
              },
            ],
          },
        ],
      },
    } as Session);

    processor.onFrame(
      frame(10, {
        SessionState: { value: [SessionState.Checkered] },
        CarIdxLapCompleted: { value: [0, 2, 2] },
        CarIdxLapDistPct: { value: [0, 0.7, 0.9] },
        CarIdxClass: { value: [-1, 10, 10] },
      })
    );

    expect(processor.snapshot().liveClassPosition).toEqual([undefined, 2, 1]);
  });

  it('resets accumulated state on session changes and disconnect', () => {
    const processor = new StandingsProcessor();
    processor.init(session);
    processor.onFrame(
      frame(10, {
        CarIdxOnPitRoad: { value: [false, true] },
      })
    );
    processor.onLifecycle({ type: 'sessionNumChange' });
    expect(processor.snapshot().lastPitLap).toEqual([]);
    processor.onLifecycle({ type: 'disconnect' });
    expect(processor.snapshot()).toMatchObject({
      focusCarIdx: null,
      sessionNum: null,
      carIdxLap: [],
    });
  });

  it("carries LMU's per-car finish status, and drops it on disconnect", () => {
    const processor = new StandingsProcessor();
    processor.init(session);
    processor.onFrame(frame(10));
    // Absent under iRacing, so the copy leaves it empty.
    expect(processor.snapshot().carIdxFinishStatus).toEqual([]);

    processor.onFrame(frame(11, { LmuCarIdxFinishStatus: { value: [1, 3] } }));
    expect(processor.snapshot().carIdxFinishStatus).toEqual([1, 3]);

    processor.onLifecycle({ type: 'disconnect' });
    expect(processor.snapshot().carIdxFinishStatus).toEqual([]);
  });

  it('carries which last laps the sim did not time, and drops them on reset', () => {
    const processor = new StandingsProcessor();
    processor.init(session);
    processor.onFrame(frame(10));
    // iRacing says nothing about other cars' laps: empty, so nobody is marked.
    expect(processor.snapshot().carIdxLastLapInvalid).toEqual([]);

    processor.onFrame(
      frame(11, { LmuCarIdxLastLapInvalid: { value: [false, true] } })
    );
    expect(processor.snapshot().carIdxLastLapInvalid).toEqual([false, true]);

    // The next lap counted: the flag goes with the frame, it is not latched.
    processor.onFrame(
      frame(12, { LmuCarIdxLastLapInvalid: { value: [false, false] } })
    );
    expect(processor.snapshot().carIdxLastLapInvalid).toEqual([false, false]);

    processor.onFrame(
      frame(13, { LmuCarIdxLastLapInvalid: { value: [true, false] } })
    );
    // A new session: the clock starts over and the flags go with the rest.
    processor.onFrame(frame(1, { SessionNum: { value: [3] } }));
    expect(processor.snapshot().carIdxLastLapInvalid).toEqual([]);

    processor.onFrame(
      frame(2, {
        SessionNum: { value: [3] },
        LmuCarIdxLastLapInvalid: { value: [true, false] },
      })
    );
    processor.onLifecycle({ type: 'disconnect' });
    expect(processor.snapshot().carIdxLastLapInvalid).toEqual([]);
  });

  it("carries LMU's garage flag, and drops it on disconnect", () => {
    const processor = new StandingsProcessor();
    processor.init(session);
    processor.onFrame(frame(10));
    // Absent under iRacing, where a car in the garage is not in the world.
    expect(processor.snapshot().carIdxInGarage).toEqual([]);

    processor.onFrame(
      frame(11, { LmuCarIdxInGarage: { value: [false, true] } })
    );
    expect(processor.snapshot().carIdxInGarage).toEqual([false, true]);

    processor.onLifecycle({ type: 'disconnect' });
    expect(processor.snapshot().carIdxInGarage).toEqual([]);
  });

  it("carries LMU's pit stop count and pit state, and drops them on a new session", () => {
    const processor = new StandingsProcessor();
    processor.init(session);
    processor.onFrame(frame(10));
    // Absent under iRacing, which counts no stops and states no request.
    expect(processor.snapshot().carIdxPitStops).toEqual([]);
    expect(processor.snapshot().carIdxPitState).toEqual([]);

    processor.onFrame(
      frame(11, {
        LmuCarIdxPitStops: { value: [2, -1] },
        LmuCarIdxPitState: { value: [1, -1] },
      })
    );
    // -1 is an empty slot, and stays one.
    expect(processor.snapshot().carIdxPitStops).toEqual([2, -1]);
    expect(processor.snapshot().carIdxPitState).toEqual([1, -1]);

    processor.onFrame(frame(1, { SessionNum: { value: [3] } }));
    expect(processor.snapshot().carIdxPitStops).toEqual([]);
    expect(processor.snapshot().carIdxPitState).toEqual([]);

    processor.onFrame(
      frame(2, {
        SessionNum: { value: [3] },
        LmuCarIdxPitStops: { value: [0, 0] },
        LmuCarIdxPitState: { value: [0, 3] },
      })
    );
    processor.onLifecycle({ type: 'disconnect' });
    expect(processor.snapshot().carIdxPitStops).toEqual([]);
    expect(processor.snapshot().carIdxPitState).toEqual([]);
  });

  it('carries which budget each LMU car runs on, and drops it on disconnect', () => {
    const processor = new StandingsProcessor();
    processor.init(session);
    processor.onFrame(frame(10));
    // Absent under iRacing, so the copy leaves it empty.
    expect(processor.snapshot().carIdxEnergyIsVirtual).toEqual([]);

    processor.onFrame(
      frame(11, {
        LmuCarIdxEnergyRemaining: { value: [0.42, 0.2] },
        LmuCarIdxEnergyIsVirtual: { value: [true, false] },
      })
    );
    expect(processor.snapshot().carIdxEnergyRemaining).toEqual([0.42, 0.2]);
    expect(processor.snapshot().carIdxEnergyIsVirtual).toEqual([true, false]);

    processor.onLifecycle({ type: 'disconnect' });
    expect(processor.snapshot().carIdxEnergyIsVirtual).toEqual([]);
  });

  describe("a full tank that is not one: LMU's fuel byte at the line", () => {
    /** Car 0 is the one read; car 1 burns steadily beside it. */
    const start = () => {
      const processor = new StandingsProcessor();
      processor.init(session);
      const feed = (
        sessionTime: number,
        reading: number,
        extra: Partial<Record<keyof Telemetry, unknown>> = {}
      ) => {
        processor.onFrame(
          frame(sessionTime, {
            LmuCarIdxEnergyRemaining: { value: [reading, 0.5] },
            LmuCarIdxEnergyIsVirtual: { value: [false, true] },
            ...extra,
          })
        );
        return processor.snapshot().carIdxEnergyRemaining[0];
      };
      return { processor, feed };
    };

    it('never shows a leap to full that is gone by the next update', () => {
      const { processor, feed } = start();

      expect(feed(100, 0.3725)).toBe(0.3725);
      // One scoring update at 255, read on two ticks of five a second.
      expect(feed(100.2, 1)).toBe(0.3725);
      expect(feed(100.4, 1)).toBe(0.3725);
      // The car's own level again, a lap's worth lower.
      expect(feed(100.6, 0.3686)).toBe(0.3686);
      expect(feed(100.8, 0.3686)).toBe(0.3686);
      // The car beside it was never touched.
      expect(processor.snapshot().carIdxEnergyRemaining[1]).toBe(0.5);
    });

    it('shows a tank filled on pit road at once', () => {
      const { feed } = start();
      const onPitRoad = { CarIdxOnPitRoad: { value: [true, false] } };

      feed(100, 0.2);
      expect(feed(100.2, 0.6, onPitRoad)).toBe(0.6);
      expect(feed(100.4, 1, onPitRoad)).toBe(1);
      // And it is still full when the car is back on track.
      expect(feed(130, 1)).toBe(1);
      expect(feed(131, 0.99)).toBe(0.99);
    });

    it('shows one filled in the garage at once', () => {
      const { feed } = start();

      feed(100, 0.2);
      expect(
        feed(100.2, 1, { LmuCarIdxInGarage: { value: [true, false] } })
      ).toBe(1);
    });

    it('shows one that stays full out on the track, a second late', () => {
      const { feed } = start();

      feed(100, 0.2);
      // A car refuelled where the sim does not call it pit road: standing
      // still, full from here on.
      expect(feed(100.2, 1)).toBe(0.2);
      expect(feed(100.8, 1)).toBe(0.2);
      expect(feed(101.2, 1)).toBe(1);
      expect(feed(101.4, 1)).toBe(1);
    });

    it('lets any other rise through as it comes', () => {
      const { feed } = start();

      feed(100, 0.2);
      // Not full: not the artefact, whatever it is.
      expect(feed(100.2, 0.9)).toBe(0.9);
      expect(feed(100.4, 0.21)).toBe(0.21);
    });

    it('takes a first reading of full as it is, and one after none', () => {
      const { feed } = start();

      // The grid, tanks brimmed: nothing before it to have leapt from.
      expect(feed(100, 1)).toBe(1);
      expect(feed(100.2, 1)).toBe(1);

      const later = start();
      // No reading, as for a car with no telemetry yet, and then one.
      expect(later.feed(100, -1)).toBe(-1);
      expect(later.feed(100.2, 1)).toBe(1);
    });

    it('holds each leap for its own second, and starts over with the session', () => {
      const { processor, feed } = start();

      feed(100, 0.4);
      expect(feed(100.2, 1)).toBe(0.4);
      expect(feed(100.4, 0.39)).toBe(0.39);
      // A lap on, the same again: held as the first was.
      expect(feed(190.2, 1)).toBe(0.39);
      expect(feed(190.4, 0.38)).toBe(0.38);

      // A new session has no figure before its first.
      processor.onFrame(
        frame(5, {
          SessionNum: { value: [3] },
          LmuCarIdxEnergyRemaining: { value: [1, 0.5] },
        })
      );
      expect(processor.snapshot().carIdxEnergyRemaining[0]).toBe(1);
    });
  });
});
