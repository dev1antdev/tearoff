import { describe, expect, it, vi } from 'vitest';
import type {
  BrakingSnapshot,
  GForceSnapshot,
  Telemetry,
} from '@irdashies/types';
import { CHANNEL_DELIVERY, ChannelBus } from '../bridge/channelBridge';
import { BrakingProcessor } from './BrakingProcessor';
import { GForceProcessor } from './GForceProcessor';
import {
  createDefaultProcessorHost,
  createProcessorDefinitions,
} from './processorRegistry';

/**
 * The braking and g-force processors as the host runs them: registered so
 * that the braking one sees every frame, and so that neither loses what it
 * holds while the overlay is hidden.
 */

const G = 9.80665;

interface FrameInput {
  t: number;
  speed: number;
  pedal?: number;
  /** g; negative under braking. */
  long?: number;
  /** g; positive in a left-hand corner. */
  lat?: number;
}

const frame = ({
  t,
  speed,
  pedal = 0,
  long = 0,
  lat = 0,
}: FrameInput): Telemetry =>
  ({
    SessionTime: { value: [t] },
    SessionNum: { value: [0] },
    Speed: { value: [speed] },
    BrakeRaw: { value: [pedal] },
    LongAccel: { value: [long * G] },
    LatAccel: { value: [lat * G] },
    BrakeABSactive: { value: [false] },
    IsOnTrack: { value: [true] },
    OnPitRoad: { value: [false] },
    IsInGarage: { value: [false] },
    LapCompleted: { value: [1] },
  }) as unknown as Telemetry;

const definitions = () =>
  createProcessorDefinitions({
    referenceLapPersistence: { load: () => null, save: () => undefined },
  });

const start = () => {
  const bus = new ChannelBus();
  let visible = true;
  const send = vi.fn();
  const target = {
    id: 1,
    isDestroyed: () => false,
    isVisible: () => visible,
    send,
  };
  bus.subscribe(target, 'braking.snapshot');
  bus.subscribe(target, 'g-force.snapshot');
  const host = createDefaultProcessorHost({
    bus,
    metrics: { markStart: vi.fn(), markEnd: vi.fn() },
    referenceLapPersistence: { load: () => null, save: () => undefined },
    // The session clock, as under Le Mans Ultimate.
    frameClock: (telemetry) =>
      telemetry.SessionTime?.value?.[0] as number | undefined,
  });

  let steps = 0;
  let speed = 60;
  const time = () => 10 + steps / 100;
  /** `seconds` of frames a hundredth apart at a pedal and a deceleration. */
  const drive = (seconds: number, pedal: number, decelG: number, lat = 0) => {
    const frames = Math.round(seconds * 100);
    for (let index = 0; index < frames; index += 1) {
      host.onFrame(frame({ t: time(), speed, pedal, long: -decelG, lat }));
      steps += 1;
      speed -= decelG * G * 0.01;
    }
  };
  const cruise = (seconds: number) => {
    speed = 60;
    drive(seconds, 0, 0);
  };

  return {
    host,
    drive,
    cruise,
    time,
    braking: () => host.snapshot('braking.snapshot') as BrakingSnapshot,
    gForce: () => host.snapshot('g-force.snapshot') as GForceSnapshot,
    hide: () => {
      visible = false;
      bus.rendererBecameHidden(target.id);
    },
    show: () => {
      visible = true;
      bus.rendererBecameVisible(target.id);
    },
    /** The last snapshot delivered to the window on a channel. */
    delivered: <S>(channel: string): S | undefined =>
      send.mock.calls
        .filter(
          ([delivery, name]) =>
            delivery === CHANNEL_DELIVERY && name === channel
        )
        .at(-1)?.[2] as S | undefined,
  };
};

describe('the driving dynamics processors in the registry', () => {
  it('registers the braking processor to see every frame', () => {
    const definition = definitions().find(
      ({ channel }) => channel === 'braking.snapshot'
    );
    const processor = definition?.create({
      aggregateReplay: false,
      sourceReplay: false,
      snapshot: () => undefined,
    });

    expect(processor).toBeInstanceOf(BrakingProcessor);
    expect(processor?.tickRateHz).toBe('event');
    expect(definition?.retainWhenInactive).toBe(true);
    expect(definition?.dependencies ?? []).toEqual([]);
  });

  it('registers the g-force processor at the input rate', () => {
    const definition = definitions().find(
      ({ channel }) => channel === 'g-force.snapshot'
    );
    const processor = definition?.create({
      aggregateReplay: false,
      sourceReplay: false,
      snapshot: () => undefined,
    });

    expect(processor).toBeInstanceOf(GForceProcessor);
    expect(processor?.tickRateHz).toBe(60);
    expect(definition?.retainWhenInactive).toBe(true);
  });
});

describe('the driving dynamics processors under the host', () => {
  it('measures a zone from every frame, not sixty of each hundred', () => {
    const { drive, braking } = start();
    drive(0.5, 1, 1.5);
    // One frame of 2.4 g among a hundred a second: a sample would miss it.
    drive(0.01, 1, 2.4);
    drive(0.49, 1, 1.5);
    drive(0.3, 0, 0);

    expect(braking().last).toMatchObject({
      peakG: 2.4,
      durationS: 1,
      entrySpeed: 60,
    });
    expect(braking().zoneCount).toBe(1);
  });

  it('delivers the zone to the window', () => {
    const { drive, delivered } = start();
    drive(1, 1, 2);
    drive(0.3, 0, 0);

    const snapshot = delivered<BrakingSnapshot>('braking.snapshot');
    expect(snapshot?.last?.peakG).toBe(2);
    expect(snapshot?.live).toBeNull();
    expect(snapshot?.referenceG).toBe(2);
  });

  it('keeps the bests while the overlay is hidden, and drops the open zone', () => {
    const { drive, cruise, braking, hide, show, delivered } = start();
    drive(1, 1, 2);
    drive(0.3, 0, 0);
    cruise(1);
    // Hidden in the middle of the next stop.
    drive(0.5, 1, 1.2);
    expect(braking().live).not.toBeNull();

    hide();
    // The rest of that stop, a harder one, and ten seconds of driving,
    // none of which reaches the processor.
    drive(0.5, 1, 1.2);
    drive(0.3, 0, 0);
    cruise(2);
    drive(1, 1, 2.6);
    drive(0.3, 0, 0);
    cruise(6);
    expect(braking()).toMatchObject({
      live: null,
      zoneCount: 1,
      referenceG: 2,
      sessionBestG: 2,
    });
    expect(braking().last?.peakG).toBe(2);

    show();
    // Shown again: the window is sent what was kept, at once.
    expect(delivered<BrakingSnapshot>('braking.snapshot')).toMatchObject({
      live: null,
      zoneCount: 1,
      referenceG: 2,
      sessionBestG: 2,
    });

    // And the next stop is measured from its own first frame.
    cruise(1);
    drive(1, 1, 1.5);
    drive(0.3, 0, 0);
    expect(braking().zoneCount).toBe(2);
    expect(braking().last).toMatchObject({
      peakG: 1.5,
      durationS: 1,
      deltaG: -0.5,
    });
  });

  it('keeps the g-force maxima while the overlay is hidden', () => {
    const { drive, gForce, hide, show, delivered } = start();
    drive(2, 0, 0, 2);
    expect(gForce()).toMatchObject({ maxLatG: 2, sustainedLatG: 2 });

    hide();
    drive(1, 0, 0, 3);
    show();

    expect(delivered<GForceSnapshot>('g-force.snapshot')).toMatchObject({
      maxLatG: 2,
      sustainedLatG: 2,
    });
  });
});
