import { beforeEach, describe, expect, it } from 'vitest';
import type { Session, Telemetry } from '@irdashies/types';
import { GForceProcessor } from './GForceProcessor';

const G = 9.80665;

interface FrameInput {
  t: number;
  /** g; positive in a left-hand corner. */
  lat?: number;
  /** g; positive accelerating forwards. */
  long?: number;
  isOnTrack?: boolean;
  isInGarage?: boolean;
  sessionNum?: number;
  /** Le Mans Ultimate's time of the last impact. */
  impactAt?: number;
  /** iRacing's incident count. */
  incidents?: number;
  /** Leaves the two accelerations out of the frame. */
  withoutAccel?: boolean;
}

const frame = ({
  t,
  lat = 0,
  long = 0,
  isOnTrack = true,
  isInGarage = false,
  sessionNum = 0,
  impactAt,
  incidents,
  withoutAccel = false,
}: FrameInput): Telemetry => {
  const out: Record<string, { value: unknown[] }> = {
    SessionTime: { value: [t] },
    SessionNum: { value: [sessionNum] },
    IsOnTrack: { value: [isOnTrack] },
    IsInGarage: { value: [isInGarage] },
  };
  if (!withoutAccel) {
    out.LatAccel = { value: [lat * G] };
    out.LongAccel = { value: [long * G] };
  }
  if (impactAt !== undefined) out.LmuLastImpactTime = { value: [impactAt] };
  if (incidents !== undefined) {
    out.PlayerCarMyIncidentCount = { value: [incidents] };
  }
  return out as unknown as Telemetry;
};

const start = () => {
  const processor = new GForceProcessor();
  processor.init({} as Session);
  processor.onLifecycle({ type: 'enter', replay: false });
  return processor;
};

/** Frames a hundredth of a second apart, from `from` up to and including `to`. */
const run = (
  processor: GForceProcessor,
  from: number,
  to: number,
  input: (t: number) => Omit<FrameInput, 't'>
) => {
  const steps = Math.round((to - from) * 100);
  for (let step = 0; step <= steps; step += 1) {
    const t = from + step / 100;
    processor.onFrame(frame({ t, ...input(t) }));
  }
};

describe('GForceProcessor', () => {
  let processor: GForceProcessor;

  beforeEach(() => {
    processor = start();
  });

  it('starts with nothing to show', () => {
    expect(processor.snapshot()).toEqual({
      available: false,
      latG: 0,
      longG: 0,
      maxLatG: 0,
      maxLongG: 0,
      sustainedLatG: 0,
      sessionNum: null,
      version: 0,
    });
  });

  it('reads both accelerations in g, with their signs', () => {
    processor.onFrame(
      frame({ t: 10, lat: 1, long: -2 }) // 9.80665 and -19.6133 m/s2
    );
    const snapshot = processor.snapshot();

    expect(snapshot.available).toBe(true);
    expect(snapshot.latG).toBe(1);
    expect(snapshot.longG).toBe(-2);
    expect(snapshot.maxLatG).toBe(1);
    expect(snapshot.maxLongG).toBe(2);
    expect(snapshot.sessionNum).toBe(0);
  });

  it('rounds to the hundredth the widget prints', () => {
    processor.onFrame(frame({ t: 10, lat: 1.23456, long: -0.98765 }));

    expect(processor.snapshot().latG).toBe(1.23);
    expect(processor.snapshot().longG).toBe(-0.99);
  });

  it('keeps one longitudinal maximum for braking and accelerating', () => {
    processor.onFrame(frame({ t: 10, long: 0.8 }));
    expect(processor.snapshot().maxLongG).toBe(0.8);

    processor.onFrame(frame({ t: 10.01, long: -1.9 }));
    expect(processor.snapshot().maxLongG).toBe(1.9);

    processor.onFrame(frame({ t: 10.02, long: 1.1 }));
    expect(processor.snapshot().maxLongG).toBe(1.9);
  });

  it('holds a lateral maximum for five seconds, then restarts from the reading', () => {
    processor.onFrame(frame({ t: 10, lat: -2 }));
    run(processor, 10.01, 14.99, () => ({ lat: 1 }));
    // Five seconds on, the one frame at 2 g still stands.
    expect(processor.snapshot().maxLatG).toBe(2);
    expect(processor.snapshot().latG).toBe(1);

    // The first frame after reads the current sample, not 0.
    processor.onFrame(frame({ t: 15.01, lat: 1 }));
    expect(processor.snapshot().maxLatG).toBe(1);
  });

  describe('the sustained lateral grip', () => {
    it('reaches a corner held for two seconds', () => {
      run(processor, 10, 12, () => ({ lat: 2 }));

      expect(processor.snapshot().sustainedLatG).toBeGreaterThanOrEqual(1.99);
      expect(processor.snapshot().sustainedLatG).toBeLessThanOrEqual(2.01);
    });

    it('is the same for a right-hand corner', () => {
      run(processor, 10, 12, () => ({ lat: -2 }));

      expect(processor.snapshot().sustainedLatG).toBeGreaterThanOrEqual(1.99);
      expect(processor.snapshot().latG).toBe(-2);
    });

    it('is not lifted by a single spike', () => {
      run(processor, 10, 12, (t) => ({ lat: t === 11 ? 6 : 2 }));
      const sustained = processor.snapshot().sustainedLatG;

      expect(sustained).toBeGreaterThanOrEqual(1.99);
      expect(sustained).toBeLessThan(2.1);
      // The plain maximum does take the spike: it is not an impact.
      expect(processor.snapshot().maxLatG).toBe(6);
    });

    it('still stands twenty-nine seconds after the corner', () => {
      run(processor, 10, 12, () => ({ lat: 2 }));
      run(processor, 12.01, 41, () => ({ lat: 0 }));

      expect(processor.snapshot().sustainedLatG).toBe(2);
      // The five-second maximum went long ago.
      expect(processor.snapshot().maxLatG).toBe(0);
    });

    it('is let go in the end', () => {
      run(processor, 10, 12, () => ({ lat: 2 }));
      run(processor, 12.01, 80, () => ({ lat: 0 }));

      expect(processor.snapshot().sustainedLatG).toBe(0);
    });

    it('takes time to build: a flick is not grip', () => {
      run(processor, 10, 10.05, () => ({ lat: 2 }));

      expect(processor.snapshot().maxLatG).toBe(2);
      expect(processor.snapshot().sustainedLatG).toBeLessThan(0.5);
    });
  });

  describe('after an impact', () => {
    it('leaves both maxima alone under Le Mans Ultimate', () => {
      run(processor, 10, 12, () => ({ lat: 1.5, long: -1, impactAt: 0 }));
      const before = { ...processor.snapshot() };

      // The sim stamps the impact; half a second later the car reads 11 g.
      processor.onFrame(frame({ t: 12.5, lat: 11, long: -11, impactAt: 12 }));
      const snapshot = processor.snapshot();

      expect(snapshot.maxLatG).toBe(before.maxLatG);
      expect(snapshot.maxLongG).toBe(before.maxLongG);
      expect(snapshot.sustainedLatG).toBe(before.sustainedLatG);
      // The dot still shows it.
      expect(snapshot.latG).toBe(11);
      expect(snapshot.longG).toBe(-11);
    });

    it('leaves both maxima alone under iRacing', () => {
      run(processor, 10, 12, () => ({ lat: 1.5, long: -1, incidents: 3 }));
      const before = { ...processor.snapshot() };

      processor.onFrame(frame({ t: 12.01, lat: 1.5, long: -1, incidents: 4 }));
      processor.onFrame(frame({ t: 12.5, lat: 11, long: -11, incidents: 4 }));

      expect(processor.snapshot().maxLatG).toBe(before.maxLatG);
      expect(processor.snapshot().maxLongG).toBe(before.maxLongG);
    });

    it('takes readings again two seconds later', () => {
      run(processor, 10, 12, () => ({ lat: 1.5, impactAt: 0 }));
      run(processor, 12.01, 13.95, () => ({ lat: 2.5, impactAt: 12 }));
      expect(processor.snapshot().maxLatG).toBe(1.5);

      processor.onFrame(frame({ t: 14.05, lat: 2.5, impactAt: 12 }));
      expect(processor.snapshot().maxLatG).toBe(2.5);
    });
  });

  it('does not republish for a car standing still', () => {
    processor.onFrame(frame({ t: 10 }));
    const { version } = processor.snapshot();

    run(processor, 10.01, 20, () => ({}));

    expect(processor.snapshot().version).toBe(version);
  });

  it('does not republish for noise below the hundredth', () => {
    // Long enough for the smoothed lateral reading to settle as well.
    run(processor, 10, 12, () => ({ lat: 1.2, long: -0.5 }));
    const { version } = processor.snapshot();

    processor.onFrame(frame({ t: 12.01, lat: 1.2004, long: -0.5003 }));

    expect(processor.snapshot().version).toBe(version);
  });

  it('gives the same snapshot for an iRacing frame and an LMU frame', () => {
    const iracing = start();
    const lmu = start();
    for (let step = 0; step <= 200; step += 1) {
      const t = 10 + step / 100;
      const lat = 2 * Math.sin(step / 30);
      const long = -1.5 * Math.cos(step / 45);
      // iRacing: an incident count that never moves. LMU: an impact time
      // of 0, and the count it always publishes as 0.
      iracing.onFrame(frame({ t, lat, long, incidents: 7 }));
      lmu.onFrame(frame({ t, lat, long, impactAt: 0, incidents: 0 }));
    }

    expect(lmu.snapshot()).toEqual(iracing.snapshot());
    expect(lmu.snapshot().maxLatG).toBeGreaterThan(1.9);
  });

  describe('out of the car', () => {
    it('is unavailable without both accelerations', () => {
      processor.onFrame(frame({ t: 10, withoutAccel: true }));

      expect(processor.snapshot().available).toBe(false);
    });

    it('is unavailable while the player is not driving', () => {
      processor.onFrame(frame({ t: 10, lat: 1, long: 1, isOnTrack: false }));
      const snapshot = processor.snapshot();

      expect(snapshot.available).toBe(false);
      expect(snapshot.latG).toBe(0);
      expect(snapshot.longG).toBe(0);
      expect(snapshot.maxLatG).toBe(0);
    });

    it('drops the reading with the flag, and lets the maxima run out', () => {
      run(processor, 10, 12, () => ({ lat: 2 }));

      processor.onFrame(frame({ t: 12.01, lat: 2, isOnTrack: false }));
      expect(processor.snapshot().available).toBe(false);
      expect(processor.snapshot().latG).toBe(0);
      expect(processor.snapshot().maxLatG).toBe(2);

      run(processor, 12.02, 17.5, () => ({ isOnTrack: false }));
      expect(processor.snapshot().maxLatG).toBe(0);
    });
  });

  describe('resets', () => {
    const drive = () => run(processor, 10, 12, () => ({ lat: 2, long: -1.5 }));

    it('zeroes the fields on a session change', () => {
      drive();
      const { version } = processor.snapshot();

      processor.onLifecycle({ type: 'sessionNumChange' });
      const snapshot = processor.snapshot();

      expect(snapshot).toMatchObject({
        latG: 0,
        longG: 0,
        maxLatG: 0,
        maxLongG: 0,
        sustainedLatG: 0,
      });
      expect(snapshot.version).toBeGreaterThan(version);
    });

    it('zeroes the fields and the flag on disconnect', () => {
      drive();

      processor.onLifecycle({ type: 'disconnect' });

      expect(processor.snapshot()).toMatchObject({
        available: false,
        latG: 0,
        longG: 0,
        maxLatG: 0,
        maxLongG: 0,
        sustainedLatG: 0,
        sessionNum: null,
      });
    });

    it('zeroes the maxima when the car goes back to the garage', () => {
      drive();

      processor.onFrame(frame({ t: 12.01, isInGarage: true }));
      expect(processor.snapshot()).toMatchObject({
        maxLatG: 0,
        maxLongG: 0,
        sustainedLatG: 0,
      });

      // Only on the frame it turns true: what is driven from the garage
      // stall onwards is kept.
      processor.onFrame(frame({ t: 12.02, lat: 0.4, isInGarage: true }));
      processor.onFrame(frame({ t: 12.03, lat: 0.4, isInGarage: true }));
      expect(processor.snapshot().maxLatG).toBe(0.4);
    });

    it('keeps the maxima through an enter', () => {
      drive();

      processor.onLifecycle({ type: 'enter', replay: false });

      expect(processor.snapshot().maxLatG).toBe(2);
    });
  });

  describe('the clock', () => {
    it('ignores a frame without one', () => {
      processor.onFrame({
        LatAccel: { value: [G] },
        LongAccel: { value: [G] },
        IsOnTrack: { value: [true] },
      } as unknown as Telemetry);

      expect(processor.snapshot().version).toBe(0);
    });

    it('does not take a gap for a step', () => {
      // A corner held, with frames a second apart: each step is capped at a
      // quarter of a second, so the average still only builds 0.2 g a frame.
      processor.onFrame(frame({ t: 10, lat: 2 }));
      processor.onFrame(frame({ t: 11, lat: 2 }));

      expect(processor.snapshot().sustainedLatG).toBeLessThanOrEqual(0.2);
    });

    it('keeps the maxima while paused, and starts the clock again after', () => {
      run(processor, 10, 12, () => ({ lat: 2 }));

      processor.pause();
      processor.onFrame(frame({ t: 13, lat: 2 }));

      expect(processor.snapshot().maxLatG).toBe(2);
      expect(processor.snapshot().sustainedLatG).toBe(2);
    });
  });
});
