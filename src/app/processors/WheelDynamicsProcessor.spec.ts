import { beforeEach, describe, expect, it } from 'vitest';
import type { Session, Telemetry } from '@irdashies/types';
import { WheelDynamicsProcessor } from './WheelDynamicsProcessor';

interface WheelInput {
  time?: number;
  sessionNum?: number;
  rideHeight?: number[];
  travel?: number[];
  force?: number[];
  load?: number[];
  deflection?: number[];
  camber?: number[];
  toe?: number[];
}

/**
 * A frame as the LMU mapper publishes it, in the frame's units: millimetres,
 * newtons and degrees. A key the sim did not provide is absent from the frame
 * entirely, which is how tyre load arrives from the recorded sim.
 */
const frame = ({
  time,
  sessionNum = 0,
  rideHeight = [50, 54, 60, 64],
  travel = [65, 66, 77, 78],
  force = [6000, 2000, 7000, 3000],
  load,
  deflection = [16, 17, 19, 20],
  camber = [-2, -2.2, -1.7, -1.6],
  toe = [-0.05, 0.05, 0.1, -0.1],
}: WheelInput = {}): Telemetry => {
  const out: Record<string, { value: unknown[] }> = {
    SessionNum: { value: [sessionNum] },
    LmuWheelRideHeight: { value: rideHeight },
    LmuSuspensionPosition: { value: travel },
    LmuSuspensionForce: { value: force },
    LmuTyreDeflection: { value: deflection },
    LmuWheelCamber: { value: camber },
    LmuWheelToe: { value: toe },
  };
  if (time !== undefined) out.SessionTime = { value: [time] };
  if (load) out.LmuTyreLoad = { value: load };
  return out as unknown as Telemetry;
};

/** A frame from a sim, or a moment, with no wheel data at all. */
const emptyFrame = (time = 0, sessionNum = 0): Telemetry =>
  ({
    SessionNum: { value: [sessionNum] },
    SessionTime: { value: [time] },
  }) as unknown as Telemetry;

const start = () => {
  const processor = new WheelDynamicsProcessor();
  processor.init({} as Session);
  processor.onLifecycle({ type: 'enter', replay: false });
  return processor;
};

/** Feeds the same readings at the processor's own rate for `seconds`. */
const hold = (
  processor: WheelDynamicsProcessor,
  input: WheelInput,
  from: number,
  seconds: number
): number => {
  const ticks = Math.round(seconds * 25);
  for (let tick = 1; tick <= ticks; tick += 1) {
    processor.onFrame(frame({ ...input, time: from + tick / 25 }));
  }
  return from + ticks / 25;
};

describe('WheelDynamicsProcessor', () => {
  let processor: WheelDynamicsProcessor;

  beforeEach(() => {
    processor = start();
  });

  it('declares its channel and the positional tick rate', () => {
    expect(processor.channel).toBe('wheel-dynamics.snapshot');
    expect(processor.tickRateHz).toBe(25);
  });

  it('starts with nothing to show', () => {
    expect(processor.snapshot()).toEqual({
      available: false,
      rideHeightMm: null,
      suspensionPositionMm: null,
      loadShare: null,
      loadSource: null,
      loadTotalN: null,
      tyreDeflectionMm: null,
      camberDeg: null,
      toeDeg: null,
      toeTotalDeg: null,
      rakeMm: null,
      rollMm: null,
      rollShareFront: null,
      sessionNum: null,
      version: 0,
    });
  });

  it('publishes the readings of the tick in LF, RF, LR, RR order', () => {
    processor.onFrame(
      frame({
        time: 10,
        rideHeight: [50.04, 54.06, 60.01, 63.96],
        travel: [64.83, 65.57, 76.61, 77.94],
        deflection: [15.94, 17.06, 0, 20.11],
      })
    );
    const snapshot = processor.snapshot();

    expect(snapshot.available).toBe(true);
    expect(snapshot.rideHeightMm).toEqual([50, 54.1, 60, 64]);
    expect(snapshot.suspensionPositionMm).toEqual([64.8, 65.6, 76.6, 77.9]);
    // Zero is a reading: the wheel is off the ground.
    expect(snapshot.tyreDeflectionMm).toEqual([15.9, 17.1, 0, 20.1]);
    expect(snapshot.sessionNum).toBe(0);
  });

  describe('the attitude of the chassis', () => {
    it('gives rake and roll in millimetres from the four ride heights', () => {
      hold(processor, { rideHeight: [50, 54, 60, 64] }, 0, 1);
      const snapshot = processor.snapshot();

      // (60 + 64 - 50 - 54) / 2, and right minus left on each axle.
      expect(snapshot.rakeMm).toBe(10);
      expect(snapshot.rollMm).toEqual([4, 4]);
      expect(snapshot.rollShareFront).toBe(0.5);
    });

    it('gives the front axle its part of the roll', () => {
      // The front leans by 6 mm and the rear by 2.
      hold(processor, { rideHeight: [50, 56, 60, 62] }, 0, 1);

      expect(processor.snapshot().rollMm).toEqual([6, 2]);
      expect(processor.snapshot().rollShareFront).toBe(0.75);
    });

    it('states no share while the axles lean opposite ways', () => {
      hold(processor, { rideHeight: [50, 54, 64, 60] }, 0, 1);

      expect(processor.snapshot().rollMm).toEqual([4, -4]);
      expect(processor.snapshot().rollShareFront).toBe(0.5);
    });

    it('states no share for a car sitting level', () => {
      hold(processor, { rideHeight: [50, 50, 60, 60] }, 0, 1);

      expect(processor.snapshot().rollMm).toEqual([0, 0]);
      expect(processor.snapshot().rollShareFront).toBe(0.5);
    });

    it('reads a nose-up car as a negative rake', () => {
      processor.onFrame(frame({ time: 0, rideHeight: [60, 60, 55, 55] }));

      expect(processor.snapshot().rakeMm).toBe(-5);
    });

    it('smooths rake and roll over a tenth of a second', () => {
      processor.onFrame(frame({ time: 0, rideHeight: [50, 50, 60, 60] }));
      // The rear rises by 10 mm and the right front by 10 mm, at once.
      processor.onFrame(frame({ time: 0.1, rideHeight: [50, 60, 70, 70] }));
      const snapshot = processor.snapshot();

      // 63.2 % of the way after one time constant: the rake goes from 10
      // toward 15, the front roll from 0 toward 10.
      expect(snapshot.rakeMm).toBe(13.2);
      expect(snapshot.rollMm).toEqual([6.3, 0]);
      // The ride heights themselves are the tick's readings.
      expect(snapshot.rideHeightMm).toEqual([50, 60, 70, 70]);
    });

    it('moves the roll share slowly, with half a second as its time constant', () => {
      const at = hold(processor, { rideHeight: [50, 54, 60, 64] }, 0, 1);
      // Front 6, rear 2: the share heads from 0.5 to 0.75, and a second is
      // two time constants, which is 86.5 % of the way.
      hold(processor, { rideHeight: [50, 56, 60, 62] }, at, 1);

      expect(processor.snapshot().rollShareFront).toBe(0.716);
      // The roll itself has long since arrived.
      expect(processor.snapshot().rollMm).toEqual([6, 2]);
    });
  });

  describe('the load on each wheel', () => {
    it('takes each share from suspension force when no tyre load is published', () => {
      processor.onFrame(frame({ time: 0, force: [6000, 2000, 7000, 3000] }));
      const snapshot = processor.snapshot();

      expect(snapshot.loadShare).toEqual([0.333, 0.111, 0.389, 0.167]);
      expect(snapshot.loadTotalN).toBe(18_000);
      expect(snapshot.loadSource).toBe('suspensionForce');
    });

    it('prefers tyre load where the sim publishes it', () => {
      processor.onFrame(
        frame({
          time: 0,
          force: [6000, 2000, 7000, 3000],
          load: [5000, 5000, 6000, 4000],
        })
      );
      const snapshot = processor.snapshot();

      expect(snapshot.loadShare).toEqual([0.25, 0.25, 0.3, 0.2]);
      expect(snapshot.loadTotalN).toBe(20_000);
      expect(snapshot.loadSource).toBe('tyreLoad');
    });

    it('counts a drooping wheel as carrying nothing', () => {
      processor.onFrame(frame({ time: 0, force: [6000, -500, 7000, 3000] }));
      const snapshot = processor.snapshot();

      expect(snapshot.loadShare).toEqual([0.375, 0, 0.438, 0.188]);
      expect(snapshot.loadTotalN).toBe(16_000);
    });

    it('rounds the total to ten newtons', () => {
      processor.onFrame(frame({ time: 0, force: [4733, 4737, 4731, 4737] }));

      expect(processor.snapshot().loadTotalN).toBe(18_940);
    });

    it('states no share for a car carrying next to nothing', () => {
      // On its jacks: the four together are under a thousand newtons.
      processor.onFrame(frame({ time: 0, force: [300, 300, 200, 200] }));
      const snapshot = processor.snapshot();

      expect(snapshot.loadShare).toBeNull();
      expect(snapshot.loadSource).toBeNull();
      expect(snapshot.loadTotalN).toBeNull();
      // The wheels themselves are still read.
      expect(snapshot.available).toBe(true);
    });

    it('falls back to suspension force when the tyre loads carry nothing', () => {
      processor.onFrame(
        frame({
          time: 0,
          force: [6000, 2000, 7000, 3000],
          load: [0, 0, 0, 0],
        })
      );

      expect(processor.snapshot().loadSource).toBe('suspensionForce');
    });

    it('drops the share when the source goes', () => {
      processor.onFrame(frame({ time: 0 }));
      processor.onFrame(frame({ time: 0.04, force: [100, 100, 100, 100] }));

      expect(processor.snapshot().loadShare).toBeNull();
    });
  });

  describe('camber and toe', () => {
    it('gives camber with the sim sign, negative leaning in', () => {
      processor.onFrame(
        frame({ time: 0, camber: [-2.014, -2.176, -1.704, -1.613] })
      );

      expect(processor.snapshot().camberDeg).toEqual([
        -2.01, -2.18, -1.7, -1.61,
      ]);
    });

    it('smooths camber over a tenth of a second', () => {
      processor.onFrame(frame({ time: 0, camber: [-2, -2, -2, -2] }));
      processor.onFrame(frame({ time: 0.1, camber: [-3, -3, -3, -3] }));

      expect(processor.snapshot().camberDeg).toEqual([
        -2.63, -2.63, -2.63, -2.63,
      ]);
    });

    it('reads the same after a fifth of a second however many ticks it took', () => {
      processor.onFrame(frame({ time: 0, camber: [-2, -2, -2, -2] }));
      hold(processor, { camber: [-3, -3, -3, -3] }, 0, 0.2);
      const fine = processor.snapshot().camberDeg;

      const coarse = start();
      coarse.onFrame(frame({ time: 0, camber: [-2, -2, -2, -2] }));
      coarse.onFrame(frame({ time: 0.2, camber: [-3, -3, -3, -3] }));

      expect(fine).toEqual(coarse.snapshot().camberDeg);
      expect(fine).toEqual([-2.86, -2.86, -2.86, -2.86]);
    });

    it('turns the right-hand wheels round, so toe-in is positive on both sides', () => {
      // The sim's toe is positive for a wheel pointing right: these rears
      // both point inwards.
      processor.onFrame(frame({ time: 0, toe: [0, 0, 0.1, -0.1] }));
      const snapshot = processor.snapshot();

      expect(snapshot.toeDeg).toEqual([0, 0, 0.1, 0.1]);
      expect(snapshot.toeTotalDeg).toEqual([0, 0.2]);
    });

    it('reads toe-out as negative, per wheel and per axle', () => {
      processor.onFrame(frame({ time: 0, toe: [-0.05, 0.05, 0.1, -0.1] }));
      const snapshot = processor.snapshot();

      expect(snapshot.toeDeg).toEqual([-0.05, -0.05, 0.1, 0.1]);
      expect(snapshot.toeTotalDeg).toEqual([-0.1, 0.2]);
    });

    it('cancels the steering angle out of the front total', () => {
      // Both fronts steered 5 degrees to the right, with 0.1 of toe-out.
      processor.onFrame(frame({ time: 0, toe: [4.95, 5.05, 0.1, -0.1] }));
      const snapshot = processor.snapshot();

      expect(snapshot.toeTotalDeg).toEqual([-0.1, 0.2]);
      // Per wheel the steering is still in the figure.
      expect(snapshot.toeDeg?.[0]).toBe(4.95);
      expect(snapshot.toeDeg?.[1]).toBe(-5.05);
    });

    it('smooths the total toe more slowly than the wheels', () => {
      processor.onFrame(frame({ time: 0, toe: [0, 0, 0, 0] }));
      processor.onFrame(frame({ time: 0.2, toe: [0, 0, 1, -1] }));
      const snapshot = processor.snapshot();

      // Two time constants for the wheels, one for the axle.
      expect(snapshot.toeDeg).toEqual([0, 0, 0.86, 0.86]);
      expect(snapshot.toeTotalDeg).toEqual([0, 1.26]);
    });
  });

  describe('the clock', () => {
    it('moves no average while the sim is paused', () => {
      processor.onFrame(frame({ time: 5, camber: [-2, -2, -2, -2] }));
      const { version } = processor.snapshot();

      // Same clock, different readings: a paused sim does not publish these,
      // but if it did the averages have no time to move in.
      processor.onFrame(frame({ time: 5, camber: [-3, -3, -3, -3] }));

      expect(processor.snapshot().camberDeg).toEqual([-2, -2, -2, -2]);
      expect(processor.snapshot().version).toBe(version);
    });

    it('starts every average again when the clock goes backwards', () => {
      hold(processor, { camber: [-2, -2, -2, -2] }, 100, 1);

      processor.onFrame(
        frame({
          time: 20,
          camber: [-3, -3, -3, -3],
          rideHeight: [40, 40, 60, 60],
          toe: [0, 0, 0.3, -0.3],
        })
      );
      const snapshot = processor.snapshot();

      expect(snapshot.camberDeg).toEqual([-3, -3, -3, -3]);
      expect(snapshot.rakeMm).toBe(20);
      expect(snapshot.toeTotalDeg).toEqual([0, 0.6]);
    });

    it('treats a long gap as a quarter of a second', () => {
      processor.onFrame(frame({ time: 0, rideHeight: [50, 50, 60, 60] }));
      // Front 6, rear 2, after a minute away.
      processor.onFrame(frame({ time: 60, rideHeight: [50, 56, 60, 62] }));

      // 0.5 toward 0.75 by 1 - exp(-0.25 / 0.5), not all the way.
      expect(processor.snapshot().rollShareFront).toBe(0.598);
    });

    it('counts a tick without a clock for its nominal length', () => {
      processor.onFrame(frame({ camber: [-2, -2, -2, -2] }));
      processor.onFrame(frame({ camber: [-3, -3, -3, -3] }));

      // 1 - exp(-0.04 / 0.1) of the way.
      expect(processor.snapshot().camberDeg).toEqual([
        -2.33, -2.33, -2.33, -2.33,
      ]);
    });
  });

  describe('what the sim withholds', () => {
    it('says nothing is available on a frame without the wheel keys', () => {
      processor.onFrame(emptyFrame());
      const snapshot = processor.snapshot();

      expect(snapshot.available).toBe(false);
      expect(snapshot.rideHeightMm).toBeNull();
      expect(snapshot.suspensionPositionMm).toBeNull();
      expect(snapshot.loadShare).toBeNull();
      expect(snapshot.tyreDeflectionMm).toBeNull();
      expect(snapshot.camberDeg).toBeNull();
      expect(snapshot.toeDeg).toBeNull();
      expect(snapshot.toeTotalDeg).toBeNull();
      expect(snapshot.rakeMm).toBeNull();
      expect(snapshot.rollMm).toBeNull();
      expect(snapshot.rollShareFront).toBeNull();
    });

    it('leaves each field null on its own', () => {
      // A car the sim gives no camber or toe for, as it does for every car
      // but the player's.
      const withoutAngles = frame({ time: 0 });
      delete (withoutAngles as Record<string, unknown>).LmuWheelCamber;
      delete (withoutAngles as Record<string, unknown>).LmuWheelToe;
      processor.onFrame(withoutAngles);
      const snapshot = processor.snapshot();

      expect(snapshot.available).toBe(true);
      expect(snapshot.camberDeg).toBeNull();
      expect(snapshot.toeDeg).toBeNull();
      expect(snapshot.toeTotalDeg).toBeNull();
      expect(snapshot.rideHeightMm).toEqual([50, 54, 60, 64]);
      expect(snapshot.rakeMm).toBe(10);
    });

    it('is not available without suspension travel, whatever else reads', () => {
      const withoutTravel = frame({ time: 0 });
      delete (withoutTravel as Record<string, unknown>).LmuSuspensionPosition;
      processor.onFrame(withoutTravel);

      expect(processor.snapshot().available).toBe(false);
      expect(processor.snapshot().suspensionPositionMm).toBeNull();
    });

    it('ignores a reading with fewer than four wheels', () => {
      processor.onFrame(frame({ time: 0, rideHeight: [50, 54, 60] }));

      expect(processor.snapshot().rideHeightMm).toBeNull();
      expect(processor.snapshot().rakeMm).toBeNull();
    });

    it('ignores a reading with a wheel that is not a number', () => {
      processor.onFrame(
        frame({ time: 0, camber: [-2, Number.NaN, -1.7, -1.6] })
      );

      expect(processor.snapshot().camberDeg).toBeNull();
    });

    it('drops the readings when the player leaves the car', () => {
      hold(processor, {}, 0, 1);
      const { version } = processor.snapshot();

      processor.onFrame(emptyFrame(1.04));
      const snapshot = processor.snapshot();

      expect(snapshot.available).toBe(false);
      expect(snapshot.rideHeightMm).toBeNull();
      expect(snapshot.loadSource).toBeNull();
      expect(snapshot.version).toBe(version + 1);
    });

    it('starts the averages again when a reading comes back', () => {
      processor.onFrame(frame({ time: 0, camber: [-2, -2, -2, -2] }));
      processor.onFrame(emptyFrame(0.04));

      processor.onFrame(frame({ time: 0.08, camber: [-3, -3, -3, -3] }));

      expect(processor.snapshot().camberDeg).toEqual([-3, -3, -3, -3]);
    });
  });

  describe('what it publishes', () => {
    it('does not move the version for an unchanged frame', () => {
      const at = hold(processor, {}, 0, 1);
      const { version } = processor.snapshot();

      processor.onFrame(frame({ time: at + 0.04 }));

      expect(processor.snapshot().version).toBe(version);
    });

    it('does not move the version for noise below what is shown', () => {
      const at = hold(processor, {}, 0, 1);
      const { version } = processor.snapshot();

      processor.onFrame(
        frame({
          time: at + 0.04,
          rideHeight: [50.01, 54.02, 59.98, 64.04],
          force: [6001, 2000, 7000, 3001],
          camber: [-2.001, -2.2, -1.7, -1.6],
        })
      );

      expect(processor.snapshot().version).toBe(version);
    });

    it('moves the version once when a reading moves', () => {
      const at = hold(processor, {}, 0, 1);
      const { version } = processor.snapshot();

      processor.onFrame(
        frame({ time: at + 0.04, deflection: [16, 17, 19, 25] })
      );

      expect(processor.snapshot().version).toBe(version + 1);
      expect(processor.snapshot().tyreDeflectionMm).toEqual([16, 17, 19, 25]);
    });

    it('writes each array in place rather than allocating one a tick', () => {
      processor.onFrame(frame({ time: 0 }));
      const first = processor.snapshot();
      const rideHeight = first.rideHeightMm;
      const camber = first.camberDeg;
      const share = first.loadShare;

      processor.onFrame(
        frame({
          time: 0.04,
          rideHeight: [40, 44, 50, 54],
          camber: [-3, -3, -3, -3],
          force: [5000, 5000, 5000, 5000],
        })
      );
      const second = processor.snapshot();

      expect(second).toBe(first);
      expect(second.rideHeightMm).toBe(rideHeight);
      expect(second.camberDeg).toBe(camber);
      expect(second.loadShare).toBe(share);
      expect(second.rideHeightMm).toEqual([40, 44, 50, 54]);
    });

    it('never publishes a negative zero', () => {
      processor.onFrame(
        frame({
          time: 0,
          toe: [-0.001, 0.001, 0.1, -0.1],
          camber: [0, 0, 0, 0],
        })
      );
      const snapshot = processor.snapshot();

      expect(Object.is(snapshot.toeDeg?.[0], 0)).toBe(true);
      expect(Object.is(snapshot.toeDeg?.[1], 0)).toBe(true);
      expect(Object.is(snapshot.toeTotalDeg?.[0], 0)).toBe(true);
    });

    it('follows the session number', () => {
      processor.onFrame(frame({ time: 0, sessionNum: 2 }));

      expect(processor.snapshot().sessionNum).toBe(2);
    });
  });

  describe('the session lifecycle', () => {
    it.each(['sessionNumChange', 'disconnect'] as const)(
      'clears every field on %s',
      (type) => {
        hold(processor, {}, 0, 1);
        const { version } = processor.snapshot();

        processor.onLifecycle({ type });

        expect(processor.snapshot()).toEqual({
          available: false,
          rideHeightMm: null,
          suspensionPositionMm: null,
          loadShare: null,
          loadSource: null,
          loadTotalN: null,
          tyreDeflectionMm: null,
          camberDeg: null,
          toeDeg: null,
          toeTotalDeg: null,
          rakeMm: null,
          rollMm: null,
          rollShareFront: null,
          sessionNum: null,
          version: version + 1,
        });
      }
    );

    it('starts the averages again after a new session', () => {
      hold(processor, { camber: [-2, -2, -2, -2] }, 0, 1);
      processor.onLifecycle({ type: 'sessionNumChange' });

      processor.onFrame(frame({ time: 1.04, camber: [-3, -3, -3, -3] }));

      expect(processor.snapshot().camberDeg).toEqual([-3, -3, -3, -3]);
    });

    it('changes nothing on enter', () => {
      hold(processor, {}, 0, 1);
      const before = structuredClone(processor.snapshot());

      processor.onLifecycle({ type: 'enter', replay: false });

      expect(processor.snapshot()).toEqual(before);
    });

    it('stays quiet when there was nothing to clear', () => {
      processor.onLifecycle({ type: 'disconnect' });

      expect(processor.snapshot().version).toBe(0);
    });
  });
});
