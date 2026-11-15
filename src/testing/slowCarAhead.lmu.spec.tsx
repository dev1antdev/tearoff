import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ChannelBridge,
  ChannelName,
  ChannelPayloads,
} from '@irdashies/types';
import { useDashboard, useSessionStore } from '@irdashies/context';
import { CarSpeedsProcessor } from '../app/processors/CarSpeedsProcessor';
import { useSlowCarAhead } from '../frontend/components/SlowCarAhead/hooks/useSlowCarAhead';
import { mountFixture } from './renderWithFixture';
import { toSession, toTelemetry, type ReplayFixture } from './replayFixture';
import lmuRace from '../../test-data/fixtures/lmu-race-laguna-seca.json';

/**
 * Slow Car Ahead on a recorded Le Mans Ultimate race, cut from the curated
 * tape: Laguna Seca, early in the player's third lap. The frames go through
 * the real processors, the car speeds among them, which the fixture harness
 * does not publish: this spec runs that processor itself, which is why it
 * lives here and not beside the widget.
 *
 * Nobody is slow on the recording, so the widget never shows on it as it
 * stands. The stopped car is STAGED on its frames, and says so.
 */
const race = lmuRace as unknown as ReplayFixture;

const PLAYER = 0;
/** A GT3 at the back of the field, borrowed to stand on the track. */
const STOPPED = 27;
const TRACK_M = 3590.35;
const AHEAD_M = 150;

type Frame = ReplayFixture['frames'][number];

const numbers = (frame: Frame, key: string): number[] => frame[key] as number[];

type SlowCar = ReturnType<typeof useSlowCarAhead>;

/** Reads the hook and hands what it returns to the spec. */
const Probe = ({ onResult }: { onResult: (result: SlowCar) => void }) => {
  onResult(useSlowCarAhead());
  return null;
};

/**
 * The overlay mounts a widget from the dashboard, so the widget's settings
 * are there before its hooks run. The same here: nothing is read until the
 * dashboard has arrived.
 */
const WhenDashboardLoaded = ({
  onResult,
}: {
  onResult: (result: SlowCar) => void;
}) => {
  const { currentDashboard } = useDashboard();
  return currentDashboard ? <Probe onResult={onResult} /> : null;
};

/**
 * STAGED: one car stands still, in every frame, 150 m beyond where the
 * player is in the last one.
 */
const withStoppedCar = (fixture: ReplayFixture): ReplayFixture => {
  const last = fixture.frames[fixture.frames.length - 1];
  const where = numbers(last, 'CarIdxLapDistPct')[PLAYER] + AHEAD_M / TRACK_M;
  return {
    ...fixture,
    frames: fixture.frames.map((frame) => {
      const pcts = [...numbers(frame, 'CarIdxLapDistPct')];
      pcts[STOPPED] = where;
      return { ...frame, CarIdxLapDistPct: pcts };
    }),
  };
};

describe('Slow Car Ahead on a recorded LMU race', () => {
  const previousBridge = window.channelBridge;

  beforeEach(() => {
    useSessionStore.getState().resetSession();
  });
  afterEach(() => {
    // Unmount first: the hook reads the bridge and the session it is about
    // to lose.
    cleanup();
    if (previousBridge === undefined) {
      Reflect.deleteProperty(window, 'channelBridge');
    } else {
      window.channelBridge = previousBridge as ChannelBridge;
    }
    useSessionStore.getState().resetSession();
  });

  const slowCarAhead = (fixture: ReplayFixture) => {
    const harness = mountFixture(fixture);
    // The speeds every car's lap fraction moves at, as the app works them
    // out, put on the harness's bridge beside its own channels.
    const speeds = new CarSpeedsProcessor();
    speeds.init(toSession(fixture));
    speeds.onLifecycle({ type: 'enter', replay: false });
    for (const frame of fixture.frames) speeds.onFrame(toTelemetry(frame));
    const inner = window.channelBridge;
    const withSpeeds: ChannelBridge = {
      subscribe: <K extends ChannelName>(
        channel: K,
        callback: (payload: ChannelPayloads[K]) => void,
        rate?: number
      ) => {
        if (channel !== 'car-speeds.snapshot') {
          return inner.subscribe(channel, callback, rate);
        }
        callback(speeds.snapshot() as ChannelPayloads[K]);
        return () => undefined;
      },
    };
    window.channelBridge = withSpeeds;
    let result: SlowCar | undefined;
    render(
      <WhenDashboardLoaded
        onResult={(latest) => {
          result = latest;
        }}
      />,
      { wrapper: harness.wrapper }
    );
    return { result, speeds: speeds.snapshot().carSpeeds };
  };

  it('as recorded shows nothing: every car is at racing speed', () => {
    const { result, speeds } = slowCarAhead(race);

    expect(result).toBeNull();
    // The speeds are there to be judged: the player's car and the slowest
    // car on the track are both well over the 50 km/h a slow car is under.
    expect(speeds).toHaveLength(38);
    expect(speeds[PLAYER]).toBeGreaterThan(100);
    expect(Math.min(...speeds)).toBeGreaterThan(50);
  });

  it('staged: finds a car stopped on the track 150 m ahead', () => {
    const { result, speeds } = slowCarAhead(withStoppedCar(race));

    expect(speeds[STOPPED]).toBe(0);
    expect(result).not.toBeNull();
    expect(result?.driver.CarIdx).toBe(STOPPED);
    expect(result?.isStopped).toBe(true);
    // Lap fractions reach the widget to three decimals: 3.6 m here.
    expect(Math.abs((result?.distance ?? 0) - AHEAD_M)).toBeLessThan(4);
    // LMU never reports a rival off the road.
    expect(result?.isOffTrack).toBe(false);
  });
});
