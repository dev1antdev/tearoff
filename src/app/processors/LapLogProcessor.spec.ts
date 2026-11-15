import { describe, expect, it } from 'vitest';
import { GlobalFlags, type Telemetry } from '@irdashies/types';
import { LapLogProcessor } from './LapLogProcessor';
import { mapLmuTelemetry } from '../lmu/mapTelemetry';
import { createLmuLapStartState } from '../lmu/lapStartTiming';
import { fixture as lmuFixture } from '../lmu/rawFixture';

const frame = (values: Record<string, unknown[]>): Telemetry =>
  Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, { value }])
  ) as Telemetry;

describe('LapLogProcessor', () => {
  const lapFrame = (
    lapCompleted: number,
    flags = GlobalFlags.Green,
    sessionTime = lapCompleted * 90 + 30,
    sessionNum = 1
  ) =>
    frame({
      LapCompleted: [lapCompleted],
      SessionFlags: [flags],
      SessionNum: [sessionNum],
      SessionTime: [sessionTime],
    });

  it.each([
    { gamePhase: 6, yellowFlagState: 0, caution: true },
    { gamePhase: 5, yellowFlagState: 3, caution: true },
    { gamePhase: 5, yellowFlagState: 0, caution: false },
  ])('records the normalized LMU caution state %j', (state) => {
    const processor = new LapLogProcessor();
    const raw = lmuFixture();
    const drive = (
      lapCompleted: number,
      elapsedTime: number,
      underYellow = false
    ) =>
      processor.onFrame(
        mapLmuTelemetry({
          ...raw,
          gamePhase: underYellow ? state.gamePhase : 5,
          yellowFlagState: underYellow ? state.yellowFlagState : 0,
          // A sector yellow alone must remain visible in lap history.
          sectorFlags: new Uint8Array(underYellow ? [0, 1, 0] : [0, 0, 0]),
          vehTotalLaps: new Int32Array([2, lapCompleted, 1]),
          elapsedTime,
        })
      );

    drive(0, 0);
    drive(0, 30, true);
    drive(0, 60);
    drive(1, 90);
    expect(processor.snapshot().lastLapUnderCaution).toBe(state.caution);
    drive(2, 180);
    expect(processor.snapshot().lastLapUnderCaution).toBe(false);
  });

  it.each([GlobalFlags.Caution, GlobalFlags.CautionWaving])(
    'remembers full-course caution flag %i even when it clears before scoring',
    (flag) => {
      const processor = new LapLogProcessor();
      processor.onFrame(lapFrame(0, GlobalFlags.Green));
      processor.onFrame(lapFrame(0, flag, 40));
      processor.onFrame(lapFrame(0, GlobalFlags.Green, 50));
      processor.onFrame(lapFrame(1));
      expect(processor.snapshot().lastLapUnderCaution).toBe(true);

      // Delayed official timing must still see the completed lap's result.
      processor.onFrame(lapFrame(1, GlobalFlags.Green, 121));
      expect(processor.snapshot().lastLapUnderCaution).toBe(true);

      processor.onFrame(lapFrame(2));
      expect(processor.snapshot().lastLapUnderCaution).toBe(false);
    }
  );

  it.each([
    GlobalFlags.Yellow,
    GlobalFlags.YellowWaving,
    GlobalFlags.Yellow | GlobalFlags.YellowWaving,
  ])('keeps a lap with only local yellow flags %i', (flags) => {
    const processor = new LapLogProcessor();
    processor.onFrame(lapFrame(0));
    processor.onFrame(lapFrame(0, flags, 40));
    processor.onFrame(lapFrame(0, GlobalFlags.Green, 50));
    processor.onFrame(lapFrame(1));
    expect(processor.snapshot().lastLapUnderCaution).toBe(false);
  });

  it('still marks a full-course caution when local yellow flags are also set', () => {
    const processor = new LapLogProcessor();
    processor.onFrame(
      lapFrame(0, GlobalFlags.Yellow | GlobalFlags.CautionWaving)
    );
    processor.onFrame(lapFrame(1));
    expect(processor.snapshot().lastLapUnderCaution).toBe(true);
  });

  it('assigns flags appearing on the scoring tick to the new lap', () => {
    const processor = new LapLogProcessor();
    processor.onFrame(lapFrame(0));
    processor.onFrame(lapFrame(1, GlobalFlags.Caution | GlobalFlags.Green));
    expect(processor.snapshot().lastLapUnderCaution).toBe(false);
    processor.onFrame(lapFrame(2));
    expect(processor.snapshot().lastLapUnderCaution).toBe(true);
  });

  it('does not treat unrelated flags or missing flags as a caution', () => {
    const processor = new LapLogProcessor();
    processor.onFrame(lapFrame(0, GlobalFlags.White | GlobalFlags.Blue));
    processor.onFrame(frame({ LapCompleted: [0], SessionNum: [1] }));
    processor.onFrame(lapFrame(1));
    expect(processor.snapshot().lastLapUnderCaution).toBe(false);
  });

  it.each(['session', 'rewind', 'lap reset', 'disconnect'])(
    'clears both caution results on %s',
    (reset) => {
      const processor = new LapLogProcessor();
      processor.onFrame(lapFrame(2, GlobalFlags.Caution));
      processor.onFrame(lapFrame(3, GlobalFlags.Caution));
      expect(processor.snapshot().lastLapUnderCaution).toBe(true);

      if (reset === 'disconnect') {
        processor.onLifecycle({ type: 'disconnect' });
      }
      const lap = reset === 'lap reset' ? 0 : 3;
      const time = reset === 'rewind' ? 100 : 310;
      const session = reset === 'session' ? 2 : 1;
      processor.onFrame(lapFrame(lap, GlobalFlags.Green, time, session));
      expect(processor.snapshot().lastLapUnderCaution).toBe(false);
      processor.onFrame(
        lapFrame(lap + 1, GlobalFlags.Green, time + 90, session)
      );
      expect(processor.snapshot().lastLapUnderCaution).toBe(false);
    }
  );

  it('projects lap log inputs without allocating a replacement history buffer', () => {
    const processor = new LapLogProcessor();
    processor.onFrame(
      frame({
        LapCompleted: [2],
        LapCurrentLapTime: [31.2],
        LapLastLapTime: [61.5],
        LapBestLapTime: [60.9],
        CarIdxBestLapTime: [60.9, 61.1],
        SessionNum: [1],
        SessionTime: [120.4],
        PlayerTrackSurface: [3],
        PlayerCarMyIncidentCount: [2],
        LapDistPct: [0.4],
        LapDeltaToSessionBestLap: [-0.2],
        LapDeltaToSessionBestLap_OK: [1],
      })
    );
    const snapshot = processor.snapshot();
    const bestLaps = snapshot.carIdxBestLapTime;
    expect(snapshot).toMatchObject({
      lapCompleted: 2,
      currentLapTime: 31.2,
      bestLapTime: 60.9,
      sessionNum: 1,
      incidentCount: 2,
      deltaToSessionBestLap: -0.2,
      deltaToSessionBestLapOk: true,
    });
    expect(bestLaps).toEqual([60.9, 61.1]);

    processor.onFrame(frame({ CarIdxBestLapTime: [59.8] }));
    expect(processor.snapshot().carIdxBestLapTime).toBe(bestLaps);
    expect(bestLaps).toEqual([59.8]);
  });

  it("carries LMU's lap void flag, and reads iRacing's absence as false", () => {
    const processor = new LapLogProcessor();
    processor.onFrame(frame({ LmuLapInvalidated: [true] }));
    expect(processor.snapshot().lapInvalidated).toBe(true);

    processor.onFrame(frame({ LapCompleted: [3] }));
    expect(processor.snapshot().lapInvalidated).toBe(false);
  });

  describe('a last lap the sim gave no time', () => {
    // Two cars; the player is in slot 1.
    const invalidFrame = (
      lapCompleted: number,
      flags: boolean[] | undefined,
      sessionNum = 1
    ) =>
      frame({
        PlayerCarIdx: [1],
        LapCompleted: [lapCompleted],
        SessionNum: [sessionNum],
        SessionTime: [lapCompleted * 90 + 30],
        ...(flags ? { LmuCarIdxLastLapInvalid: flags } : {}),
      });

    it('is marked when the lap ends untimed and cleared by the next timed lap', () => {
      const processor = new LapLogProcessor();
      processor.onFrame(invalidFrame(2, [false, false]));
      expect(processor.snapshot().lastLapInvalid).toBe(false);

      // The lap ends and the mapper says the sim put no time to it.
      processor.onFrame(invalidFrame(3, [false, true]));
      expect(processor.snapshot().lastLapInvalid).toBe(true);
      // It stands for as long as that lap is the last one.
      processor.onFrame(invalidFrame(3, [false, true]));
      expect(processor.snapshot().lastLapInvalid).toBe(true);

      processor.onFrame(invalidFrame(4, [false, false]));
      expect(processor.snapshot().lastLapInvalid).toBe(false);
    });

    it("reads the player's entry, not another car's", () => {
      const processor = new LapLogProcessor();
      processor.onFrame(invalidFrame(3, [true, false]));
      expect(processor.snapshot().lastLapInvalid).toBe(false);
    });

    it.each(['sessionNumChange', 'disconnect'] as const)(
      'is cleared on %s',
      (type) => {
        const processor = new LapLogProcessor();
        processor.onFrame(invalidFrame(3, [false, true]));
        expect(processor.snapshot().lastLapInvalid).toBe(true);

        processor.onLifecycle({ type });
        expect(processor.snapshot().lastLapInvalid).toBe(false);
      }
    );

    it('does not carry over into a new session number', () => {
      const processor = new LapLogProcessor();
      processor.onFrame(invalidFrame(3, [false, true]));
      // The mapper starts its lap timing again with the session.
      processor.onFrame(invalidFrame(0, [false, false], 2));
      expect(processor.snapshot().lastLapInvalid).toBe(false);
    });

    it('is false under iRacing, which publishes no such flag', () => {
      const processor = new LapLogProcessor();
      processor.onFrame(invalidFrame(3, undefined));
      expect(processor.snapshot().lastLapInvalid).toBe(false);
    });

    it('is false while LMU has no player car', () => {
      const processor = new LapLogProcessor();
      processor.onFrame(
        frame({ PlayerCarIdx: [-1], LmuCarIdxLastLapInvalid: [true, true] })
      );
      expect(processor.snapshot().lastLapInvalid).toBe(false);
    });

    it('follows the LMU mapper through a cut lap and the clean one after', () => {
      const processor = new LapLogProcessor();
      const lapStartState = createLmuLapStartState();
      const raw = lmuFixture();
      const drive = (lapStartET: number, lastLapTime: number) =>
        processor.onFrame(
          mapLmuTelemetry(
            {
              ...raw,
              vehLapStartET: new Float64Array([1000, lapStartET, 900]),
              vehLastLapTime: new Float64Array([135.6, lastLapTime, 138.9]),
            },
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            lapStartState
          )
        );

      drive(1100, 133.4);
      expect(processor.snapshot().lastLapInvalid).toBe(false);

      // A cut: the lap that began at 1100 ends at 1194.4 with no time.
      drive(1194.4, -1);
      expect(processor.snapshot()).toMatchObject({ lastLapInvalid: true });
      expect(processor.snapshot().lastLapTime).toBeCloseTo(94.4, 9);

      // The next lap is clean and the sim times it.
      drive(1287.2, 92.8);
      expect(processor.snapshot()).toMatchObject({
        lastLapInvalid: false,
        lastLapTime: 92.8,
      });
    });
  });

  it('resets session-derived state on lifecycle changes', () => {
    const processor = new LapLogProcessor();
    processor.onFrame(frame({ LapCompleted: [4], SessionNum: [2] }));
    processor.onLifecycle({ type: 'sessionNumChange' });
    expect(processor.snapshot()).toMatchObject({
      lapCompleted: 0,
      sessionNum: null,
    });
  });
});
