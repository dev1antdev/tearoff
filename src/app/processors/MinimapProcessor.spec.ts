import { beforeEach, describe, expect, it } from 'vitest';
import type { Session, Telemetry } from '@irdashies/types';
import { MinimapProcessor } from './MinimapProcessor';

interface FrameInput {
  lapDistPct?: number[];
  onPitRoad?: boolean[];
  position?: number[];
  classPosition?: number[];
  camCarIdx?: number;
  playerCarIdx?: number;
  sessionNum?: number;
}

const frame = ({
  lapDistPct = [0.1, 0.25, -1],
  onPitRoad = [false, true, false],
  position = [2, 1, 0],
  classPosition = [1, 1, 0],
  camCarIdx,
  playerCarIdx = 0,
  sessionNum = 0,
}: FrameInput = {}): Telemetry => {
  const out: Record<string, { value: unknown[] }> = {
    CarIdxLapDistPct: { value: lapDistPct },
    CarIdxOnPitRoad: { value: onPitRoad },
    CarIdxPosition: { value: position },
    CarIdxClassPosition: { value: classPosition },
    PlayerCarIdx: { value: [playerCarIdx] },
    SessionNum: { value: [sessionNum] },
  };
  if (camCarIdx !== undefined) out.CamCarIdx = { value: [camCarIdx] };
  return out as unknown as Telemetry;
};

const start = () => {
  const processor = new MinimapProcessor();
  processor.init({} as Session);
  processor.onLifecycle({ type: 'enter', replay: false });
  return processor;
};

describe('MinimapProcessor', () => {
  let processor: MinimapProcessor;

  beforeEach(() => {
    processor = start();
  });

  it('publishes each car slot as the sim reports it', () => {
    processor.onFrame(frame());
    const snapshot = processor.snapshot();

    expect(snapshot.carIdxLapDistPct).toEqual([0.1, 0.25, -1]);
    expect(snapshot.carIdxOnPitRoad).toEqual([false, true, false]);
    expect(snapshot.carIdxPosition).toEqual([2, 1, 0]);
    expect(snapshot.carIdxClassPosition).toEqual([1, 1, 0]);
    expect(snapshot.sessionNum).toBe(0);
  });

  it('keeps five decimals of the lap, where the track map keeps three', () => {
    // Three decimals is a 14 m step at Le Mans, which is visible once the map
    // shows only a few hundred metres.
    processor.onFrame(frame({ lapDistPct: [0.123456789, 0.5, -1] }));

    expect(processor.snapshot().carIdxLapDistPct[0]).toBe(0.12346);
  });

  it('marks a slot with no usable position as off track', () => {
    processor.onFrame(
      frame({ lapDistPct: [Number.NaN, -0.5, 0.4] as number[] })
    );

    expect(processor.snapshot().carIdxLapDistPct).toEqual([-1, -1, 0.4]);
  });

  it('centres on the car the camera follows', () => {
    processor.onFrame(frame({ camCarIdx: 2, playerCarIdx: 0 }));

    expect(processor.snapshot().focusCarIdx).toBe(2);
  });

  it('centres on the player when the sim names no camera car', () => {
    processor.onFrame(frame({ camCarIdx: -1, playerCarIdx: 1 }));
    expect(processor.snapshot().focusCarIdx).toBe(1);

    processor.onFrame(frame({ playerCarIdx: 0 }));
    expect(processor.snapshot().focusCarIdx).toBe(0);
  });

  it('does not republish while nothing moves', () => {
    processor.onFrame(frame());
    const { version } = processor.snapshot();

    // Below the fifth decimal: a parked car with sensor noise.
    processor.onFrame(frame({ lapDistPct: [0.1000001, 0.25, -1] }));

    expect(processor.snapshot().version).toBe(version);
  });

  it('republishes when a car moves', () => {
    processor.onFrame(frame());
    const { version } = processor.snapshot();

    processor.onFrame(frame({ lapDistPct: [0.1001, 0.25, -1] }));

    expect(processor.snapshot().version).toBe(version + 1);
    expect(processor.snapshot().carIdxLapDistPct[0]).toBe(0.1001);
  });

  it('follows a field that grows or shrinks', () => {
    processor.onFrame(frame());
    processor.onFrame(
      frame({
        lapDistPct: [0.1, 0.25],
        onPitRoad: [false, false],
        position: [1, 2],
        classPosition: [1, 2],
      })
    );

    expect(processor.snapshot().carIdxLapDistPct).toEqual([0.1, 0.25]);
    expect(processor.snapshot().carIdxOnPitRoad).toEqual([false, false]);
  });

  it('clears the field on disconnect', () => {
    processor.onFrame(frame({ camCarIdx: 1 }));

    processor.onLifecycle({ type: 'disconnect' });
    const snapshot = processor.snapshot();

    expect(snapshot.carIdxLapDistPct).toEqual([]);
    expect(snapshot.carIdxPosition).toEqual([]);
    expect(snapshot.focusCarIdx).toBeNull();
    expect(snapshot.sessionNum).toBeNull();
  });

  it('keeps the field when a session is entered', () => {
    processor.onFrame(frame());

    processor.onLifecycle({ type: 'enter', replay: false });

    expect(processor.snapshot().carIdxLapDistPct).toEqual([0.1, 0.25, -1]);
  });
});
