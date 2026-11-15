import { beforeEach, describe, expect, it } from 'vitest';
import type { Session, Telemetry } from '@irdashies/types';
import { BrakingProcessor } from './BrakingProcessor';

const G = 9.80665;

interface FrameInput {
  t: number;
  /** m/s. */
  speed: number;
  /** Raw brake pedal, 0..1. */
  pedal?: number;
  /** g; positive accelerating forwards, so braking is negative. */
  long?: number;
  abs?: boolean;
  isOnTrack?: boolean;
  onPitRoad?: boolean;
  isInGarage?: boolean;
  sessionNum?: number;
  lap?: number;
  /** Le Mans Ultimate's time of the last impact. */
  impactAt?: number;
  /** iRacing's incident count. */
  incidents?: number;
  /** Le Mans Ultimate's wheel rotation, rad/s: LF, RF, LR, RR. */
  rotation?: number[];
  /** Le Mans Ultimate's static tyre radius, m. */
  staticRadius?: number[];
  /** Publishes the pedal as `Brake` only, with no `BrakeRaw`. */
  filteredPedalOnly?: boolean;
  /** Leaves `LongAccel` out of the frame. */
  withoutAccel?: boolean;
}

const frame = ({
  t,
  speed,
  pedal = 0,
  long = 0,
  abs = false,
  isOnTrack = true,
  onPitRoad = false,
  isInGarage = false,
  sessionNum = 0,
  lap = 3,
  impactAt,
  incidents,
  rotation,
  staticRadius,
  filteredPedalOnly = false,
  withoutAccel = false,
}: FrameInput): Telemetry => {
  const out: Record<string, { value: unknown[] }> = {
    SessionTime: { value: [t] },
    SessionNum: { value: [sessionNum] },
    Speed: { value: [speed] },
    BrakeABSactive: { value: [abs] },
    IsOnTrack: { value: [isOnTrack] },
    OnPitRoad: { value: [onPitRoad] },
    IsInGarage: { value: [isInGarage] },
    LapCompleted: { value: [lap] },
    LatAccel: { value: [0] },
  };
  out[filteredPedalOnly ? 'Brake' : 'BrakeRaw'] = { value: [pedal] };
  if (!withoutAccel) out.LongAccel = { value: [long * G] };
  if (impactAt !== undefined) out.LmuLastImpactTime = { value: [impactAt] };
  if (incidents !== undefined) {
    out.PlayerCarMyIncidentCount = { value: [incidents] };
  }
  if (rotation) out.LmuWheelRotation = { value: rotation };
  if (staticRadius) out.LmuTyreStaticRadius = { value: staticRadius };
  return out as unknown as Telemetry;
};

type Extra = Partial<Omit<FrameInput, 't' | 'speed' | 'pedal' | 'long'>>;

/**
 * A car driven a hundredth of a second at a time. Each frame carries the
 * speed and the pedal at its own instant; the speed then falls by the
 * deceleration over the step to the next.
 */
class Car {
  private steps = 0;
  speed: number;

  constructor(
    private readonly processor: BrakingProcessor,
    private readonly startTime = 10,
    speed = 60,
    /** In every frame, unless a call says otherwise. */
    private readonly always: Extra = {}
  ) {
    this.speed = speed;
  }

  get t(): number {
    return this.startTime + this.steps / 100;
  }

  /** `seconds` of frames at a constant pedal and deceleration, in g. */
  drive(seconds: number, pedal: number, decelG: number, extra: Extra = {}) {
    const frames = Math.round(seconds * 100);
    for (let index = 0; index < frames; index += 1) {
      this.processor.onFrame(
        frame({
          t: this.t,
          speed: this.speed,
          pedal,
          long: -decelG,
          ...this.always,
          ...extra,
        })
      );
      this.steps += 1;
      this.speed -= decelG * G * 0.01;
    }
  }

  /** A stop at a steady deceleration, then long enough off the pedal to end it. */
  brake(seconds: number, decelG: number, extra: Extra = {}) {
    this.drive(seconds, 1, decelG, extra);
    this.drive(0.3, 0, 0, extra);
  }

  /** Off the pedal at a steady speed. */
  cruise(seconds: number, speed = 60, extra: Extra = {}) {
    this.speed = speed;
    this.drive(seconds, 0, 0, extra);
  }
}

const start = () => {
  const processor = new BrakingProcessor();
  processor.init({} as Session);
  processor.onLifecycle({ type: 'enter', replay: false });
  return processor;
};

describe('BrakingProcessor', () => {
  let processor: BrakingProcessor;
  let car: Car;

  beforeEach(() => {
    processor = start();
    car = new Car(processor);
  });

  it('starts with nothing to show', () => {
    expect(processor.snapshot()).toEqual({
      available: false,
      live: null,
      last: null,
      referenceG: 0,
      sessionBestG: 0,
      zoneCount: 0,
      lockS: null,
      sessionNum: null,
      version: 0,
    });
  });

  describe('a braking zone', () => {
    it('measures a two-second stop at 2 g from 60 m/s', () => {
      // LongAccel -19.6133 m/s2 with the pedal down from 10.00 to 11.99.
      car.drive(2, 1, 2);
      expect(processor.snapshot().live).not.toBeNull();
      expect(processor.snapshot().last).toBeNull();

      // The pedal comes off at 12.00, at 20.77 m/s.
      car.drive(0.24, 0, 0);
      expect(processor.snapshot().live).not.toBeNull();

      car.drive(0.02, 0, 0);
      const snapshot = processor.snapshot();
      expect(snapshot.live).toBeNull();
      expect(snapshot.last).toEqual({
        peakG: 2,
        averageG: 2,
        distanceM: 81,
        durationS: 2,
        entrySpeed: 60,
        exitSpeed: 20.8,
        absS: 0,
        deltaG: 2,
        endedAt: 12,
      });
      expect(snapshot.zoneCount).toBe(1);
      expect(snapshot.sessionBestG).toBe(2);
      expect(snapshot.referenceG).toBe(2);
    });

    it('shows the zone in progress', () => {
      car.drive(1, 1, 2);
      // The frame at 10.99: 0.99 s and 50 m in, at 2 g from 60 m/s.
      expect(processor.snapshot().live).toEqual({
        peakG: 2,
        distanceM: 50,
        durationS: 1,
        entrySpeed: 60,
      });
    });

    it('takes the peak, not the average', () => {
      car.drive(0.5, 1, 1.2);
      car.drive(0.2, 1, 2.31);
      car.drive(0.5, 1, 1.4);
      car.drive(0.3, 0, 0);

      const last = processor.snapshot().last;
      expect(last?.peakG).toBe(2.31);
      expect(last?.averageG).toBeGreaterThan(1.4);
      expect(last?.averageG).toBeLessThan(1.6);
    });

    it('adds up the time the ABS was working', () => {
      car.drive(0.5, 1, 2);
      car.drive(0.52, 1, 2, { abs: true });
      car.drive(0.5, 1, 2);
      car.drive(0.3, 0, 0);

      expect(processor.snapshot().last?.absS).toBe(0.5);
    });

    it('reads the filtered pedal when the sim gives no raw one', () => {
      car.brake(1, 1.5, { filteredPedalOnly: true });

      expect(processor.snapshot().zoneCount).toBe(1);
    });

    it('ignores a pedal resting at two percent', () => {
      car.drive(1, 0.02, 1.5);
      car.drive(0.3, 0, 0);

      expect(processor.snapshot().live).toBeNull();
      expect(processor.snapshot().zoneCount).toBe(0);
    });
  });

  describe('where a zone ends', () => {
    it('is one zone when the pedal comes off for a tenth of a second', () => {
      car.drive(1, 1, 1.5);
      car.drive(0.1, 0, 0);
      car.drive(1, 1, 1.5);
      car.drive(0.3, 0, 0);

      const snapshot = processor.snapshot();
      expect(snapshot.zoneCount).toBe(1);
      // From the first application to the last release.
      expect(snapshot.last?.durationS).toBe(2.1);
      expect(snapshot.last?.entrySpeed).toBe(60);
    });

    it('is two zones when it comes off for three tenths', () => {
      car.drive(1, 1, 1.5);
      car.drive(0.3, 0, 0);
      expect(processor.snapshot().zoneCount).toBe(1);
      expect(processor.snapshot().last?.durationS).toBe(1);

      car.drive(1, 1, 1.5);
      car.drive(0.3, 0, 0);
      expect(processor.snapshot().zoneCount).toBe(2);
      expect(processor.snapshot().last?.durationS).toBe(1);
      expect(processor.snapshot().last?.entrySpeed).toBeLessThan(60);
    });

    it('ends where the pedal came off, not where the wait for it ended', () => {
      car.drive(1, 1, 2);
      const speedAtRelease = car.speed;
      // Coasting down for the quarter of a second it takes to be sure.
      car.drive(0.3, 0, 0.3);

      const last = processor.snapshot().last;
      expect(last?.endedAt).toBe(11);
      expect(last?.durationS).toBe(1);
      expect(last?.exitSpeed).toBe(Math.round(speedAtRelease * 10) / 10);
      // 60 m/s for a second, less half of 2 g.
      expect(last?.distanceM).toBe(50);
    });

    it('ends on the frame the car is slower than 3 m/s, brake still on', () => {
      const slow = new Car(processor, 10, 20);
      // 20 m/s at 1.5 g: under 3 m/s after 1.16 s.
      slow.drive(1.3, 1, 1.5);

      const snapshot = processor.snapshot();
      expect(snapshot.live).toBeNull();
      expect(snapshot.zoneCount).toBe(1);
      expect(snapshot.last?.exitSpeed).toBeLessThan(3);
      expect(snapshot.last?.exitSpeed).toBeGreaterThan(2.8);
      expect(snapshot.last?.durationS).toBe(1.16);
    });

    it('does not start another while the car stands on the brake', () => {
      const slow = new Car(processor, 10, 20);
      slow.drive(1.3, 1, 1.5);
      slow.cruise(3, 0, { abs: false });
      slow.drive(2, 1, 0);

      expect(processor.snapshot().zoneCount).toBe(1);
      expect(processor.snapshot().live).toBeNull();
    });

    it('ends when the car turns into the pit lane', () => {
      car.drive(1, 1, 1.5);
      car.drive(0.5, 1, 1.5, { onPitRoad: true });

      const snapshot = processor.snapshot();
      expect(snapshot.live).toBeNull();
      expect(snapshot.zoneCount).toBe(1);
      expect(snapshot.last?.endedAt).toBe(11);
    });

    it('ends when the player leaves the car', () => {
      car.drive(1, 1, 1.5);
      car.drive(0.1, 1, 1.5, { isOnTrack: false });

      expect(processor.snapshot().live).toBeNull();
      expect(processor.snapshot().zoneCount).toBe(1);
      expect(processor.snapshot().available).toBe(false);
    });
  });

  describe('what counts as a zone', () => {
    beforeEach(() => {
      car.brake(1, 1.5);
      car.cruise(2);
    });

    it('drops a stop that peaks at 0.4 g', () => {
      const before = { ...processor.snapshot() };

      car.brake(1, 0.4);

      expect(processor.snapshot().last).toBe(before.last);
      expect(processor.snapshot().zoneCount).toBe(1);
    });

    it('drops a stop that lasts two tenths of a second', () => {
      const before = { ...processor.snapshot() };

      car.brake(0.2, 2);

      expect(processor.snapshot().last).toBe(before.last);
      expect(processor.snapshot().zoneCount).toBe(1);
    });

    it('keeps one of three tenths at half a g', () => {
      car.brake(0.3, 0.5);

      expect(processor.snapshot().zoneCount).toBe(2);
      expect(processor.snapshot().last?.peakG).toBe(0.5);
    });

    it('makes nothing of braking under power', () => {
      // LongAccel +5 m/s2 with the pedal half down.
      car.drive(1, 0.5, -5 / G);
      car.drive(0.3, 0, 0);

      expect(processor.snapshot().zoneCount).toBe(1);
      expect(processor.snapshot().last?.peakG).toBe(1.5);
    });
  });

  describe('where a zone cannot start', () => {
    it('does not start in the pit lane', () => {
      car.brake(1, 1.5, { onPitRoad: true });

      expect(processor.snapshot().zoneCount).toBe(0);
    });

    it('does not start while the player is not driving', () => {
      car.brake(1, 1.5, { isOnTrack: false });

      expect(processor.snapshot().zoneCount).toBe(0);
      expect(processor.snapshot().available).toBe(false);
    });

    it('does not start below 10 m/s', () => {
      const slow = new Car(processor, 10, 9.9);
      slow.brake(0.5, 1);

      expect(processor.snapshot().zoneCount).toBe(0);
    });

    it('does not start without an acceleration reading', () => {
      car.brake(1, 1.5, { withoutAccel: true });

      expect(processor.snapshot().zoneCount).toBe(0);
      expect(processor.snapshot().available).toBe(false);
    });
  });

  describe('an impact', () => {
    it('discards the zone it lands in, under Le Mans Ultimate', () => {
      const fast = new Car(processor, 10, 80, { impactAt: 0 });
      fast.drive(0.5, 1, 1.5);
      expect(processor.snapshot().live).not.toBeNull();

      // The sim stamps the impact with the time it happened.
      fast.drive(0.01, 1, 6, { impactAt: 10.5 });
      expect(processor.snapshot().live).toBeNull();

      // Still braking, and nothing starts for the two seconds after it.
      fast.drive(1.95, 1, 1.5, { impactAt: 10.5 });
      expect(processor.snapshot().live).toBeNull();
      expect(processor.snapshot().zoneCount).toBe(0);
      expect(processor.snapshot().last).toBeNull();
      expect(processor.snapshot().sessionBestG).toBe(0);

      // After that the pedal counts again.
      fast.drive(0.1, 1, 1.5, { impactAt: 10.5 });
      expect(processor.snapshot().live).not.toBeNull();
      expect(processor.snapshot().live?.peakG).toBe(1.5);
    });

    it('discards the zone it lands in, under iRacing', () => {
      const fast = new Car(processor, 10, 80, { incidents: 3 });
      fast.drive(0.5, 1, 1.5);
      expect(processor.snapshot().live).not.toBeNull();

      fast.drive(0.01, 1, 6, { incidents: 4 });
      expect(processor.snapshot().live).toBeNull();

      fast.drive(1.95, 1, 1.5, { incidents: 4 });
      expect(processor.snapshot().live).toBeNull();
      expect(processor.snapshot().zoneCount).toBe(0);

      fast.drive(0.1, 1, 1.5, { incidents: 4 });
      expect(processor.snapshot().live).not.toBeNull();
    });

    it('leaves the bests and the last zone as they were', () => {
      car.brake(1, 2);
      car.cruise(2);
      const before = { ...processor.snapshot() };

      car.drive(0.5, 1, 1.5);
      car.drive(0.5, 1, 9, { impactAt: car.t });
      car.cruise(3, 30);

      const snapshot = processor.snapshot();
      expect(snapshot.last).toBe(before.last);
      expect(snapshot.zoneCount).toBe(1);
      expect(snapshot.referenceG).toBe(2);
      expect(snapshot.sessionBestG).toBe(2);
    });
  });

  describe('the rolling best', () => {
    /** A one-second stop and the wait for it to end: 1.3 s. */
    const zone = (peakG: number) => car.brake(1, peakG);

    it('follows peaks of 1.6, 2.3 and 2.2, ten seconds apart', () => {
      zone(1.6);
      expect(processor.snapshot().last?.deltaG).toBe(1.6);
      expect(processor.snapshot().referenceG).toBe(1.6);

      car.cruise(8.7);
      zone(2.3);
      expect(processor.snapshot().last?.deltaG).toBe(0.7);
      expect(processor.snapshot().referenceG).toBe(2.3);

      car.cruise(8.7);
      zone(2.2);
      expect(processor.snapshot().last?.deltaG).toBe(-0.1);
      expect(processor.snapshot().referenceG).toBe(2.3);

      // Sixty-one seconds after the third, with no braking: the runner-up.
      car.cruise(60.7);
      expect(processor.snapshot().referenceG).toBe(2.2);
      expect(processor.snapshot().sessionBestG).toBe(2.3);

      // And sixty-one after that, nothing.
      car.cruise(61);
      expect(processor.snapshot().referenceG).toBe(0);
      expect(processor.snapshot().sessionBestG).toBe(2.3);
      expect(processor.snapshot().zoneCount).toBe(3);
    });

    it('is frozen in the snapshot while a zone is live', () => {
      zone(2);
      // The best is 59.5 s old when the next brake application comes.
      car.cruise(59.2);
      expect(processor.snapshot().referenceG).toBe(2);

      // The sixty seconds run out a second into this stop.
      car.drive(2, 1, 1);
      expect(processor.snapshot().live).not.toBeNull();
      expect(processor.snapshot().referenceG).toBe(2);

      car.drive(0.3, 0, 0);
      const snapshot = processor.snapshot();
      expect(snapshot.live).toBeNull();
      // Measured against the best as it stood when the brake went on.
      expect(snapshot.last?.deltaG).toBe(-1);
      // The old best has gone, and this stop is what is left.
      expect(snapshot.referenceG).toBe(1);
      expect(snapshot.sessionBestG).toBe(2);
    });

    it('does not count a dropped stop', () => {
      zone(1.6);
      car.cruise(5);
      zone(0.4);

      expect(processor.snapshot().referenceG).toBe(1.6);
    });
  });

  describe('wheel lock under Le Mans Ultimate', () => {
    const STATIC_RADIUS = [0.34, 0.34, 0.36, 0.36];
    /** 34 m/s on a 0.34 m front and a 0.36 m rear. */
    const ROLLING = [-100, -100, -34 / 0.36, -34 / 0.36];
    const lmu = (rotation: number[] = ROLLING): Extra => ({
      rotation,
      staticRadius: STATIC_RADIUS,
    });
    /** Holds 34 m/s with the pedal half down, the way a test bench would. */
    const hold = (seconds: number, pedal: number, extra: Extra) => {
      const steady = new Car(processor, car.t, 34);
      steady.drive(seconds, pedal, 0, extra);
      return steady;
    };

    it('is null when the sim publishes no wheel rotation', () => {
      car.brake(1, 1.5);

      expect(processor.snapshot().lockS).toBeNull();
    });

    it('reads zero for wheels that keep turning', () => {
      hold(1, 0.5, lmu());

      expect(processor.snapshot().lockS).toEqual([0, 0]);
    });

    it('adds up a locked front wheel', () => {
      // The left front at a tenth of the speed of the other three, for the
      // frames from 10.00 to 11.00.
      hold(1.01, 0.5, lmu([-10, -100, -100, -100]));

      expect(processor.snapshot().lockS).toEqual([1, 0]);
    });

    it('takes the worse wheel of each axle', () => {
      hold(0.51, 0.5, lmu([-10, -100, -100, -100]));
      const next = new Car(processor, 10.51, 34);
      next.drive(0.3, 0.5, 0, lmu([-100, -10, -100, -5]));

      // Half a second on the left front, three tenths on the right front
      // and on the right rear.
      expect(processor.snapshot().lockS).toEqual([0.5, 0.3]);
    });

    it('does not count a slow wheel with the brake off', () => {
      hold(1, 0, lmu([-10, -100, -100, -100]));

      expect(processor.snapshot().lockS).toEqual([0, 0]);
    });

    it('does not count a wheel that is only slipping', () => {
      // A fifth slower than the road: under the 0.3 it takes to be a lock.
      hold(1, 0.5, lmu([-80, -100, -100, -100]));

      expect(processor.snapshot().lockS).toEqual([0, 0]);
    });

    it('books nothing against an axle with no radius yet', () => {
      // No static radius, and the fronts never agree, so only the rear
      // axle learns one.
      hold(1, 0.5, { rotation: [-10, -100, -100, -100] });

      expect(processor.snapshot().lockS).toEqual([0, 0]);
    });

    it('is zeroed by the first brake application of a new lap', () => {
      const first = hold(1.01, 0.5, lmu([-10, -100, -100, -100]));
      expect(processor.snapshot().lockS).toEqual([1, 0]);

      // Over the line off the brakes: the lap's figure stands.
      const second = new Car(processor, first.t, 34);
      second.drive(1, 0, 0, { ...lmu(), lap: 4 });
      expect(processor.snapshot().lockS).toEqual([1, 0]);

      second.drive(0.1, 0.5, 0, { ...lmu(), lap: 4 });
      expect(processor.snapshot().lockS).toEqual([0, 0]);
    });

    it('goes back to null when the wheels stop being published', () => {
      const first = hold(1.01, 0.5, lmu([-10, -100, -100, -100]));
      const second = new Car(processor, first.t, 34);
      second.drive(0.1, 0, 0);

      expect(processor.snapshot().lockS).toBeNull();
    });
  });

  describe('resets', () => {
    const STATIC_RADIUS = [0.34, 0.34, 0.36, 0.36];
    /** The left front all but stopped, whatever the car is doing. */
    const locked: Extra = {
      rotation: [-10, -150, -150, -150],
      staticRadius: STATIC_RADIUS,
    };
    const drive = () => {
      car.brake(1, 2, locked);
      car.cruise(1, 60, locked);
      // Left in a zone, so that there is a live one to clear.
      car.drive(0.5, 1, 1, locked);
    };
    const cleared = {
      live: null,
      last: null,
      referenceG: 0,
      sessionBestG: 0,
      zoneCount: 0,
    };

    it('has something to clear', () => {
      drive();
      const snapshot = processor.snapshot();

      expect(snapshot.live).not.toBeNull();
      expect(snapshot.last?.peakG).toBe(2);
      expect(snapshot.referenceG).toBe(2);
      expect(snapshot.lockS?.[0]).toBeGreaterThan(1);
    });

    it('clears everything on a session change', () => {
      drive();
      const { version } = processor.snapshot();

      processor.onLifecycle({ type: 'sessionNumChange' });

      expect(processor.snapshot()).toMatchObject({
        ...cleared,
        lockS: [0, 0],
        available: true,
      });
      expect(processor.snapshot().version).toBeGreaterThan(version);
    });

    it('clears everything and the flag on disconnect', () => {
      drive();

      processor.onLifecycle({ type: 'disconnect' });

      expect(processor.snapshot()).toMatchObject({
        ...cleared,
        lockS: null,
        available: false,
        sessionNum: null,
      });
    });

    it('clears everything when the car goes back to the garage', () => {
      drive();

      car.drive(0.01, 0, 0, { ...locked, isInGarage: true });

      expect(processor.snapshot()).toMatchObject({ ...cleared, lockS: [0, 0] });
    });

    it('clears only on the frame the garage flag turns true', () => {
      car.drive(0.01, 0, 0, { isInGarage: true });
      car.brake(1, 2, { isInGarage: true });

      expect(processor.snapshot().zoneCount).toBe(1);
    });

    it('keeps everything through an enter', () => {
      drive();

      processor.onLifecycle({ type: 'enter', replay: false });

      expect(processor.snapshot().last?.peakG).toBe(2);
      expect(processor.snapshot().referenceG).toBe(2);
    });

    it('clears only the live zone when the clock goes back', () => {
      drive();

      const rewound = new Car(processor, 5, 60, locked);
      rewound.drive(0.01, 0, 0);

      const snapshot = processor.snapshot();
      expect(snapshot.live).toBeNull();
      expect(snapshot.last?.peakG).toBe(2);
      expect(snapshot.referenceG).toBe(2);
      expect(snapshot.sessionBestG).toBe(2);
      expect(snapshot.zoneCount).toBe(1);
    });
  });

  describe('while no window shows it', () => {
    it('drops the zone in progress and keeps the bests', () => {
      car.brake(1, 2);
      car.cruise(1);
      car.drive(0.5, 1, 1);
      expect(processor.snapshot().live).not.toBeNull();

      processor.pause();

      const snapshot = processor.snapshot();
      expect(snapshot.live).toBeNull();
      expect(snapshot.last?.peakG).toBe(2);
      expect(snapshot.referenceG).toBe(2);
      expect(snapshot.sessionBestG).toBe(2);
      expect(snapshot.zoneCount).toBe(1);
    });

    it('measures the next zone from its own first frame', () => {
      car.brake(1, 2);
      processor.pause();

      // Twenty seconds later, in the middle of a stop.
      const later = new Car(processor, 40, 50);
      later.brake(1, 1.5);

      expect(processor.snapshot().zoneCount).toBe(2);
      expect(processor.snapshot().last?.entrySpeed).toBe(50);
      expect(processor.snapshot().last?.durationS).toBe(1);
    });
  });

  describe('the clock', () => {
    it('ignores a frame without one', () => {
      processor.onFrame({
        Speed: { value: [60] },
        BrakeRaw: { value: [1] },
        LongAccel: { value: [-20] },
        IsOnTrack: { value: [true] },
      } as unknown as Telemetry);

      expect(processor.snapshot().version).toBe(0);
    });

    it('adds no distance for a gap longer than a fifth of a second', () => {
      processor.onFrame(frame({ t: 10, speed: 60, pedal: 1, long: -2 }));
      processor.onFrame(frame({ t: 10.1, speed: 58, pedal: 1, long: -2 }));
      processor.onFrame(frame({ t: 11.1, speed: 40, pedal: 1, long: -2 }));
      processor.onFrame(frame({ t: 11.2, speed: 38, pedal: 1, long: -2 }));

      // 5.9 m and 3.9 m either side of the gap, and nothing for it.
      expect(processor.snapshot().live?.distanceM).toBe(10);
    });

    it('adds nothing for a frame that repeats the time before', () => {
      processor.onFrame(frame({ t: 10, speed: 60, pedal: 1, long: -2 }));
      processor.onFrame(frame({ t: 10.1, speed: 58, pedal: 1, long: -2 }));
      processor.onFrame(frame({ t: 10.1, speed: 58, pedal: 1, long: -2 }));

      expect(processor.snapshot().live?.distanceM).toBe(6);
    });

    it('ends a stop whose pedal came back after a gap, and starts another', () => {
      car.drive(1, 1, 1.5);
      const released = car.t;
      processor.onFrame(frame({ t: released, speed: 45, pedal: 0 }));
      // Nothing for 0.4 s, then the brake is on again.
      processor.onFrame(
        frame({ t: released + 0.4, speed: 44, pedal: 1, long: -1 })
      );

      const snapshot = processor.snapshot();
      expect(snapshot.zoneCount).toBe(1);
      expect(snapshot.last?.endedAt).toBe(released);
      expect(snapshot.live?.entrySpeed).toBe(44);
    });
  });

  describe('what is published', () => {
    it('says whether there is a reading', () => {
      car.cruise(0.1);
      expect(processor.snapshot().available).toBe(true);
      expect(processor.snapshot().sessionNum).toBe(0);
    });

    it('does not republish between zones', () => {
      car.brake(1, 2);
      car.cruise(1);
      const { version } = processor.snapshot();

      car.cruise(20);

      expect(processor.snapshot().version).toBe(version);
    });

    it('republishes a live zone only when a figure it rounds has moved', () => {
      car.cruise(0.1);
      const { version } = processor.snapshot();

      // A second of braking: about 55 m and ten tenths, 100 frames.
      car.drive(1, 1, 1);
      const published = processor.snapshot().version - version;

      expect(published).toBeGreaterThan(40);
      expect(published).toBeLessThan(75);
    });

    it('gives each zone that qualifies its own object', () => {
      car.brake(1, 2);
      const first = processor.snapshot().last;
      car.cruise(2);
      car.brake(1, 2);

      expect(processor.snapshot().last).not.toBe(first);
      expect(first?.endedAt).toBe(11);
    });
  });
});
