import { describe, expect, it, vi } from 'vitest';
import type { Session, Telemetry } from '@irdashies/types';
import { lmuYawNorth } from '../lmu/carMotion';
import {
  CruiseProcessor,
  driftDegrees,
  headingDegrees,
  noDrivingTotals,
  type DrivingTotals,
  type DrivingTotalsPersistence,
} from './CruiseProcessor';

const TRACK_ID = 694510461;
const CAR = 'Ferrari 296 LMGT3 Evo';

/** `car` is the model the sim names; null for a session that names none. */
const session = ({
  trackId = TRACK_ID,
  car = CAR as string | null,
  playerCarIdx = 0,
  length = '3590.35 m',
} = {}): Session =>
  ({
    WeekendInfo: { TrackID: trackId, TrackLength: length },
    DriverInfo: {
      DriverCarIdx: playerCarIdx,
      Drivers: [
        { CarIdx: 0, CarModel: car ?? undefined, CarPath: 'liveries/51' },
      ],
    },
  }) as unknown as Session;

interface FrameOptions {
  speed?: number;
  onTrack?: boolean;
  yawNorth?: number;
  velocityX?: number;
  velocityY?: number;
  height?: number;
  lapDistPct?: number;
  lapDist?: number;
  sessionNum?: number;
}

const frame = (
  time: number,
  {
    speed = 50,
    onTrack = true,
    yawNorth,
    velocityX,
    velocityY,
    height,
    lapDistPct,
    lapDist,
    sessionNum = 0,
  }: FrameOptions = {}
): Telemetry => {
  const values: Record<string, unknown[] | undefined> = {
    SessionTime: [time],
    SessionNum: [sessionNum],
    IsOnTrack: [onTrack],
    Speed: [speed],
    YawNorth: yawNorth === undefined ? undefined : [yawNorth],
    VelocityX: velocityX === undefined ? undefined : [velocityX],
    VelocityY: velocityY === undefined ? undefined : [velocityY],
    LmuPlayerWorldPos: height === undefined ? undefined : [120, height, -340],
    LapDistPct: lapDistPct === undefined ? undefined : [lapDistPct],
    LapDist: lapDist === undefined ? undefined : [lapDist],
  };
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, { value }])
  ) as unknown as Telemetry;
};

const KEY = `lmu|${TRACK_ID}|${CAR}`;

/**
 * A store that keeps what it is handed, by track and car. `stored` is what
 * it holds for the Ferrari at Laguna Seca to begin with; null for a store
 * whose file has not been read yet, which answers nothing until `known`.
 */
const persistence = (
  stored: DrivingTotals | null = { metres: 0, seconds: 0 }
) => {
  const state = { known: stored !== null };
  const totals = new Map<string, DrivingTotals>();
  if (stored) totals.set(KEY, stored);
  const added: { key: string; metres: number; seconds: number }[] = [];
  const store = {
    load: vi.fn((simulator: string, trackId: number, carKey: string) => {
      if (!state.known) return null;
      const held = totals.get(`${simulator}|${trackId}|${carKey}`);
      return held ? { ...held } : { metres: 0, seconds: 0 };
    }),
    add: vi.fn(
      (
        simulator: string,
        trackId: number,
        carKey: string,
        metres: number,
        seconds: number
      ) => {
        const key = `${simulator}|${trackId}|${carKey}`;
        added.push({ key, metres, seconds });
        const held = totals.get(key) ?? { metres: 0, seconds: 0 };
        totals.set(key, {
          metres: held.metres + metres,
          seconds: held.seconds + seconds,
        });
      }
    ),
  } satisfies DrivingTotalsPersistence;
  return { store, state, totals, added };
};

const start = (
  store: DrivingTotalsPersistence = noDrivingTotals,
  simulator = 'lmu'
) => {
  const processor = new CruiseProcessor(store, simulator);
  processor.onLifecycle({ type: 'enter', replay: false });
  processor.init(session());
  return processor;
};

/** Ten frames 0.016 s apart at 50 m/s: 8 m and 0.16 s after the first. */
const driveTenFrames = (processor: CruiseProcessor, from = 100) => {
  for (let index = 0; index <= 10; index += 1) {
    processor.onFrame(frame(from + index * 0.016));
  }
};

describe('headingDegrees', () => {
  it('reads the four points off the orientation of the car', () => {
    // The x and z of the third row of the sim's orientation matrix.
    expect(headingDegrees(lmuYawNorth(0, -1) ?? Number.NaN)).toBe(0);
    expect(headingDegrees(lmuYawNorth(1, 0) ?? Number.NaN)).toBe(90);
    expect(headingDegrees(lmuYawNorth(0, 1) ?? Number.NaN)).toBe(180);
    expect(headingDegrees(lmuYawNorth(-1, 0) ?? Number.NaN)).toBe(270);
  });

  it('rounds to whole degrees and wraps north of 359.5 to north', () => {
    const radians = (degrees: number) => (degrees * Math.PI) / 180;
    expect(headingDegrees(radians(344.2))).toBe(344);
    expect(headingDegrees(radians(359.4))).toBe(359);
    expect(headingDegrees(radians(359.6))).toBe(0);
    expect(headingDegrees(radians(360))).toBe(0);
    expect(headingDegrees(radians(-90))).toBe(270);
    expect(Object.is(headingDegrees(radians(-0.2)), 0)).toBe(true);
  });
});

describe('driftDegrees', () => {
  it('is negative with the nose to the left of the path', () => {
    // The recorded race: heading 344.2 against travel 346.2 at that moment.
    expect(driftDegrees(31.16, -0.96)).toBe(-1.8);
  });

  it('is positive with the nose to the right of the path', () => {
    expect(driftDegrees(29.96, 0.91)).toBe(1.7);
  });

  it('is nothing for a car that is standing', () => {
    expect(driftDegrees(0.6, 0.5)).toBe(0);
    expect(driftDegrees(0, 0)).toBe(0);
  });

  it('has no negative zero', () => {
    expect(Object.is(driftDegrees(40, -0.001), 0)).toBe(true);
  });
});

describe('CruiseProcessor', () => {
  describe('the readings', () => {
    it('publishes the heading, the drift, the height and the lap distance', () => {
      const processor = start();
      processor.onFrame(
        frame(100, {
          yawNorth: (344.2 * Math.PI) / 180,
          velocityX: 31.16,
          velocityY: -0.96,
          height: 38.4,
          lapDistPct: 0.5,
        })
      );

      expect(processor.snapshot()).toMatchObject({
        available: true,
        headingDeg: 344,
        driftDeg: -1.8,
        elevationM: 38,
        // Half of 3,590.35 m.
        lapDistanceM: 1795,
        sessionNum: 0,
      });
    });

    it('leaves out what the sim does not state', () => {
      // iRacing: a heading and a velocity, and no height.
      const processor = start(noDrivingTotals, 'iracing');
      processor.onFrame(
        frame(100, { yawNorth: 1, velocityX: 40, velocityY: 0, lapDist: 812.6 })
      );

      expect(processor.snapshot()).toMatchObject({
        headingDeg: 57,
        driftDeg: 0,
        elevationM: null,
        // No lap fraction on the frame: the sim's own metres.
        lapDistanceM: 813,
      });
    });

    it('has no heading and no drift without an orientation or a velocity', () => {
      const processor = start();
      processor.onFrame(frame(100));

      expect(processor.snapshot()).toMatchObject({
        available: true,
        headingDeg: null,
        driftDeg: null,
        elevationM: null,
        lapDistanceM: null,
      });
    });

    it('shows a height below the datum as it is', () => {
      const processor = start();
      processor.onFrame(frame(100, { height: -15.4 }));

      expect(processor.snapshot().elevationM).toBe(-15);
    });

    it('says when the player is not in a car', () => {
      const processor = start();
      processor.onFrame(frame(100, { onTrack: false }));

      expect(processor.snapshot().available).toBe(false);
    });

    it('moves the channel only when a printed figure moves', () => {
      const processor = start();
      const reading = { yawNorth: 1, velocityX: 0, velocityY: 0, speed: 0 };
      processor.onFrame(frame(100, reading));
      const version = processor.snapshot().version;

      // A hundredth of a degree: still 57.
      processor.onFrame(frame(100.1, { ...reading, yawNorth: 1.0002 }));
      expect(processor.snapshot().version).toBe(version);

      processor.onFrame(frame(100.2, { ...reading, yawNorth: 1.02 }));
      expect(processor.snapshot().headingDeg).toBe(58);
      expect(processor.snapshot().version).toBe(version + 1);
    });
  });

  describe('what is driven', () => {
    it('adds the speed up over the session clock', () => {
      const processor = start();
      driveTenFrames(processor);

      expect(processor.snapshot().sessionMetres).toBeCloseTo(8, 6);
      expect(processor.snapshot().sessionSeconds).toBeCloseTo(0.16, 6);
    });

    it('adds nothing across a gap', () => {
      const processor = start();
      driveTenFrames(processor);
      // Two seconds on: a pause, a jump or a restart, not driving.
      processor.onFrame(frame(102.16));
      processor.onFrame(frame(102.176));

      expect(processor.snapshot().sessionMetres).toBeCloseTo(8.8, 6);
      expect(processor.snapshot().sessionSeconds).toBeCloseTo(0.176, 6);
    });

    it('takes half a second between two frames, and no more', () => {
      const processor = start();
      processor.onFrame(frame(100));
      processor.onFrame(frame(100.5));
      expect(processor.snapshot().sessionMetres).toBeCloseTo(25, 6);

      processor.onFrame(frame(101.01));
      expect(processor.snapshot().sessionMetres).toBeCloseTo(25, 6);
    });

    it('adds nothing when the clock steps back', () => {
      const processor = start();
      driveTenFrames(processor);
      processor.onFrame(frame(50));

      expect(processor.snapshot().sessionMetres).toBeCloseTo(8, 6);
    });

    it('counts the metres of a car that is crawling, and not the time', () => {
      const processor = start();
      for (let index = 0; index <= 10; index += 1) {
        processor.onFrame(frame(100 + index * 0.016, { speed: 0.5 }));
      }

      expect(processor.snapshot().sessionMetres).toBeCloseTo(0.08, 6);
      expect(processor.snapshot().sessionSeconds).toBe(0);
    });

    it('counts nothing out of the car', () => {
      const processor = start();
      for (let index = 0; index <= 10; index += 1) {
        processor.onFrame(frame(100 + index * 0.016, { onTrack: false }));
      }

      expect(processor.snapshot().sessionMetres).toBe(0);
      expect(processor.snapshot().sessionSeconds).toBe(0);
    });

    it('counts nothing in a replay', () => {
      const processor = new CruiseProcessor();
      processor.onLifecycle({ type: 'enter', replay: true });
      processor.init(session());
      driveTenFrames(processor);
      expect(processor.snapshot().sessionMetres).toBe(0);

      // Back to the player's own driving.
      processor.onLifecycle({ type: 'enter', replay: false });
      driveTenFrames(processor, 200);
      expect(processor.snapshot().sessionMetres).toBeCloseTo(8, 6);
    });

    it('does not count the step over a pause of the channel', () => {
      const processor = start();
      driveTenFrames(processor);
      // No window wants the channel for a while.
      processor.pause();
      processor.onFrame(frame(100.3));
      processor.onFrame(frame(100.316));

      expect(processor.snapshot().sessionMetres).toBeCloseTo(8.8, 6);
    });
  });

  describe('the all-time totals', () => {
    it('are what was stored plus what this session has driven', () => {
      const { store } = persistence({ metres: 1000, seconds: 60 });
      const processor = start(store);
      driveTenFrames(processor);

      expect(store.load).toHaveBeenCalledWith('lmu', TRACK_ID, CAR);
      expect(processor.snapshot().totalMetres).toBeCloseTo(1008, 6);
      expect(processor.snapshot().totalSeconds).toBeCloseTo(60.16, 6);
      expect(processor.snapshot().sessionMetres).toBeCloseTo(8, 6);
    });

    it('are handed over after thirty seconds of driving, and again at the end, each metre once', () => {
      const { store, added } = persistence({ metres: 1000, seconds: 60 });
      const processor = start(store);
      // 30.5 s at 50 m/s, eight frames a second.
      for (let index = 0; index <= 244; index += 1) {
        processor.onFrame(frame(100 + index * 0.125));
      }

      expect(added).toHaveLength(1);
      expect(added[0].key).toBe(KEY);
      expect(added[0].metres).toBeCloseTo(1500, 3);
      expect(added[0].seconds).toBeCloseTo(30, 3);

      processor.onLifecycle({ type: 'disconnect' });
      expect(added).toHaveLength(2);
      expect(added[1].metres).toBeCloseTo(25, 3);
      expect(added[1].seconds).toBeCloseTo(0.5, 3);
      // Everything driven, and nothing twice.
      expect(added[0].metres + added[1].metres).toBeCloseTo(1525, 3);

      // Nothing more to hand over.
      processor.onLifecycle({ type: 'disconnect' });
      processor.dispose();
      expect(added).toHaveLength(2);
    });

    it('do not jump when what was driven is handed over', () => {
      const { store } = persistence({ metres: 1000, seconds: 60 });
      const processor = start(store);
      for (let index = 0; index <= 239; index += 1) {
        processor.onFrame(frame(100 + index * 0.125));
      }
      const before = processor.snapshot().totalMetres ?? 0;
      expect(store.add).not.toHaveBeenCalled();

      // The frame that reaches thirty seconds, and the hand-over with it.
      processor.onFrame(frame(130));
      expect(store.add).toHaveBeenCalledTimes(1);
      expect(processor.snapshot().totalMetres).toBeCloseTo(before + 6.25, 6);
    });

    it('are handed over when the session changes, and the session starts again', () => {
      const { store, added } = persistence({ metres: 1000, seconds: 60 });
      const processor = start(store);
      driveTenFrames(processor);
      processor.onLifecycle({ type: 'sessionNumChange' });

      expect(added).toHaveLength(1);
      expect(added[0].metres).toBeCloseTo(8, 6);
      expect(processor.snapshot().sessionMetres).toBe(0);
      expect(processor.snapshot().sessionSeconds).toBe(0);
      // The totals are of every session.
      expect(processor.snapshot().totalMetres).toBeCloseTo(1008, 6);

      driveTenFrames(processor, 300);
      expect(processor.snapshot().sessionMetres).toBeCloseTo(8, 6);
      expect(processor.snapshot().totalMetres).toBeCloseTo(1016, 6);
    });

    it('are handed over when no window wants the channel', () => {
      const { store, added } = persistence();
      const processor = start(store);
      driveTenFrames(processor);
      processor.pause();

      expect(added).toHaveLength(1);
      expect(added[0].metres).toBeCloseTo(8, 6);
    });

    it('are handed over when the host drops the processor', () => {
      const { store, added } = persistence();
      const processor = start(store);
      driveTenFrames(processor);
      processor.dispose();

      expect(added).toHaveLength(1);
    });

    it('are not known until the store has answered', () => {
      const { store, state, totals, added } = persistence(null);
      const processor = start(store);
      driveTenFrames(processor);

      expect(processor.snapshot().totalMetres).toBeNull();
      expect(processor.snapshot().totalSeconds).toBeNull();
      expect(processor.snapshot().sessionMetres).toBeCloseTo(8, 6);

      // What was driven is handed over all the same, and the store has it
      // on top of what its file held by the time it answers.
      processor.pause();
      expect(added).toHaveLength(1);
      totals.set(KEY, { metres: 5008, seconds: 300.16 });
      state.known = true;
      driveTenFrames(processor, 200);

      expect(processor.snapshot().totalMetres).toBeCloseTo(5016, 6);
      expect(processor.snapshot().totalSeconds).toBeCloseTo(300.32, 6);
    });

    it('belong to one track and one car', () => {
      const { store, totals, added } = persistence({
        metres: 1000,
        seconds: 60,
      });
      totals.set(`lmu|${TRACK_ID}|Oreca 07`, { metres: 20, seconds: 2 });
      const processor = start(store);
      driveTenFrames(processor);

      // Another car on the same track.
      processor.init(session({ car: 'Oreca 07' }));
      expect(added).toHaveLength(1);
      expect(added[0].key).toBe(KEY);
      expect(store.load).toHaveBeenLastCalledWith('lmu', TRACK_ID, 'Oreca 07');
      expect(processor.snapshot().totalMetres).toBeCloseTo(20, 6);

      driveTenFrames(processor, 200);
      processor.dispose();
      expect(added).toHaveLength(2);
      expect(added[1].key).toBe(`lmu|${TRACK_ID}|Oreca 07`);
      expect(added[1].metres).toBeCloseTo(8, 6);
      expect(totals.get(KEY)?.metres).toBeCloseTo(1008, 6);
    });

    it('carry on under the same key while the sim names no player', () => {
      const { store, added } = persistence({ metres: 1000, seconds: 60 });
      const processor = start(store);
      driveTenFrames(processor);
      // At the monitor: no player, and no car model.
      processor.init(session({ playerCarIdx: -1 }));
      processor.init(session({ car: null }));

      expect(added).toHaveLength(0);
      driveTenFrames(processor, 200);
      expect(processor.snapshot().totalMetres).toBeCloseTo(1016, 6);
    });

    it('are filed under the car path where iRacing names no model', () => {
      const { store } = persistence();
      const processor = new CruiseProcessor(store, 'iracing');
      processor.init(session({ car: null }));

      expect(store.load).toHaveBeenCalledWith(
        'iracing',
        TRACK_ID,
        'liveries/51'
      );
    });

    it('are those of the run where nothing is stored', () => {
      const processor = start();
      driveTenFrames(processor);

      expect(processor.snapshot().totalMetres).toBeCloseTo(8, 6);
      expect(processor.snapshot().totalSeconds).toBeCloseTo(0.16, 6);
    });
  });

  describe('when the sim goes away', () => {
    it('clears everything', () => {
      const { store } = persistence({ metres: 1000, seconds: 60 });
      const processor = start(store);
      processor.onFrame(
        frame(100, { yawNorth: 1, velocityX: 30, velocityY: 0, height: 12 })
      );
      driveTenFrames(processor, 100.1);
      const version = processor.snapshot().version;
      processor.onLifecycle({ type: 'disconnect' });

      expect(processor.snapshot()).toEqual({
        available: false,
        headingDeg: null,
        driftDeg: null,
        elevationM: null,
        lapDistanceM: null,
        sessionMetres: 0,
        sessionSeconds: 0,
        totalMetres: null,
        totalSeconds: null,
        sessionNum: null,
        version: version + 1,
      });
    });

    it('asks the store again for the next session', () => {
      const { store } = persistence({ metres: 1000, seconds: 60 });
      const processor = start(store);
      driveTenFrames(processor);
      processor.onLifecycle({ type: 'disconnect' });
      processor.onLifecycle({ type: 'enter', replay: false });
      processor.init(session());

      // What the store was handed at the disconnect is in its answer.
      expect(processor.snapshot().totalMetres).toBeCloseTo(1008, 6);
      expect(processor.snapshot().sessionMetres).toBe(0);
    });
  });
});
