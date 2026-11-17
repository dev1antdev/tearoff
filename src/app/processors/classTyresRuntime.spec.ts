import { describe, expect, it, vi } from 'vitest';
import type { ClassTyresSnapshot, Session } from '@irdashies/types';
import { TYRE_SET_AT_LEAST, TYRE_SET_SEEN } from '@irdashies/types';
import { ChannelBus, type RendererTarget } from '../bridge/channelBus';
import { createSessionLifecycle } from '../sessionLifecycle';
import { ClassTyresRuntime } from './classTyresRuntime';
import { drive, driveLaps, Field, recorded } from './raceHistoryFixture';

/**
 * The runtime around the tracker: when it reads frames, and what reaches a
 * window. The figures themselves are ClassTyresTracker.spec.ts's. Staged
 * frames throughout: a small field lapping a circuit.
 */

const CHANNEL = 'class-tyres.snapshot';
const T0 = Date.UTC(2026, 10, 16, 12, 0, 0);

const start = () => {
  const field = new Field({ cars: 3, lmu: true });
  const state = { wall: T0, recording: true };
  const bus = new ChannelBus({
    now: () => state.wall,
    // Nothing is held back for later here: the runtime itself publishes no
    // more than once a second, which is this channel's rate.
    schedule: () => ({ cancel: () => undefined }),
  });
  const lifecycle = createSessionLifecycle();
  const metrics = { markStart: vi.fn(), markEnd: vi.fn() };
  const { recorder } = recorded({ simulator: () => 'lmu' });
  const runtime = new ClassTyresRuntime(
    bus,
    lifecycle,
    metrics,
    {
      recording: () => state.recording,
      history: {
        raceToken: () => recorder.currentRace()?.token ?? '',
        revision: (carIdx) => recorder.carRevision(carIdx),
        laps: (carIdx) => recorder.carLaps(carIdx),
        stints: (carIdx) => recorder.carStints(carIdx),
      },
      own: () => undefined,
      tuning: () => ({ tyreChangeSeconds: 0 }),
    },
    { now: () => state.wall }
  );
  const session = {
    ...field.session(),
    DriverInfo: { ...field.session().DriverInfo, DriverCarIdx: 0 },
  } as unknown as Session;
  recorder.onSession(session);
  runtime.onSession(session);

  /** Every snapshot delivered to the window, as it then was. */
  const delivered: ClassTyresSnapshot[] = [];
  const target: RendererTarget = {
    id: 1,
    isDestroyed: () => false,
    isVisible: () => true,
    send: (_channel, _name, payload) =>
      delivered.push(structuredClone(payload as ClassTyresSnapshot)),
  };
  const sink = {
    onFrame: (frame: Parameters<ClassTyresRuntime['onFrame']>[0]) => {
      state.wall = T0 + field.time * 1000;
      // The race history first, as the app wires them.
      if (state.recording) recorder.onFrame(frame);
      runtime.onFrame(frame);
    },
  };
  return {
    field,
    state,
    runtime,
    lifecycle,
    metrics,
    delivered,
    subscribe: () => bus.subscribe(target, CHANNEL),
    unsubscribe: () => bus.unsubscribe(target.id, CHANNEL),
    run: (seconds: number) => drive(field, sink, seconds),
    laps: (carIdx: number, laps: number) =>
      driveLaps(field, sink, carIdx, laps),
  };
};

describe('ClassTyresRuntime', () => {
  it('hands a window the figures, and again when one has moved', () => {
    const running = start();
    running.subscribe();
    running.laps(2, 2);
    running.run(3);

    const last = running.delivered[running.delivered.length - 1];
    expect(last).toMatchObject({
      ownCarIdx: 0,
      setLaps: [2, 2, 2],
      sure: [TYRE_SET_SEEN, TYRE_SET_SEEN, TYRE_SET_SEEN],
    });
    // Three cars over two laps: a figure moves at each line crossing, and
    // nothing is sent in the half-minutes between.
    expect(running.delivered.length).toBeGreaterThanOrEqual(3);
    expect(running.delivered.length).toBeLessThanOrEqual(10);
    const versions = running.delivered.map((snapshot) => snapshot.version);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it('sends no more than one snapshot a second', () => {
    const running = start();
    running.subscribe();
    running.laps(2, 3);
    running.run(3);

    // Each delivery is at least a second of the wall clock after the last.
    const seconds = Math.round(running.field.time - 100);
    expect(running.delivered.length).toBeLessThanOrEqual(seconds);
  });

  it('sends a window that arrives later what there is', () => {
    const running = start();
    running.laps(2, 2);
    running.run(3);
    expect(running.delivered).toEqual([]);

    running.subscribe();

    expect(running.delivered).toHaveLength(1);
    expect(running.delivered[0].setLaps).toEqual([2, 2, 2]);
  });

  it('works the figures out with no window looking', () => {
    // The sets are counted, and the wear watched, for as long as the race
    // is recorded: a window is only what they are sent to.
    const running = start();
    running.laps(2, 1);

    expect(running.metrics.markStart).toHaveBeenCalledWith(
      'classTyresProcessing'
    );
  });

  it('reads no frame while the race history is not recording', () => {
    const running = start();
    running.subscribe();
    running.laps(2, 1);
    running.run(3);
    const sent = running.delivered.length;
    const measured = running.metrics.markStart.mock.calls.length;

    running.state.recording = false;
    running.laps(2, 2);

    expect(running.metrics.markStart.mock.calls.length).toBe(measured);
    expect(running.delivered.length).toBe(sent);

    // Back on: what the cars did on the laps nobody recorded was not
    // seen, so their sets are at least as old as the laps since, which is
    // none yet.
    running.state.recording = true;
    running.run(3);
    expect(running.delivered[running.delivered.length - 1]).toMatchObject({
      setLaps: [0, 0, 0],
      sure: [TYRE_SET_AT_LEAST, TYRE_SET_AT_LEAST, TYRE_SET_AT_LEAST],
    });
  });

  it('is empty once the sim has gone, and says so', () => {
    const running = start();
    running.subscribe();
    running.laps(2, 1);
    running.run(3);

    running.lifecycle._onDisconnect();

    expect(running.delivered[running.delivered.length - 1]).toMatchObject({
      ownCarIdx: -1,
      setLaps: [],
      sure: [],
      compounds: [],
      sessionNum: null,
    });
  });

  it('stops hearing of windows and sessions once it is let go', () => {
    const running = start();
    running.runtime.dispose();

    running.subscribe();
    running.lifecycle._onDisconnect();

    expect(running.delivered).toEqual([]);
  });
});
