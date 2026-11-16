import { describe, expect, it } from 'vitest';
import type { LapInput, LapSessionInput, ReferenceLap } from '@irdashies/types';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { isEligibleLap } from '../storage/lapLibrary/LapLibraryDatabase';
import { ReferenceLapProcessor } from './ReferenceLapProcessor';
import { LapDeltaProcessor } from './LapDeltaProcessor';
import { PlayerLapRecorder } from './PlayerLapRecorder';

/**
 * The lap library's recorder, the reference recorder and the delta, end to
 * end on a recorded Le Mans Ultimate session: a four-minute race at Laguna
 * Seca in a Ferrari 296 LMGT3, joined as the field rolls up to the start.
 *
 * The sim publishes its own delta to the player's best lap. It is not what
 * the widget shows -- there is no all-time variant of it, and iRacing's is a
 * different quantity -- but on a lap where both are measured against the same
 * reference it is an independent answer to check this one against.
 *
 * Windows only, like the other tape specs: the replay addon is a gyp target
 * gated on OS=='win'.
 */
const available = lmuTapeAvailable();

interface Sample {
  sessionTime: number;
  delta: number | null;
  allTimeDelta: number | null;
  stintBestDelta: number | null;
  lastLapDelta: number | null;
  simDelta: number | null;
}

/**
 * The recording through the shared tape player, which reads every frame of
 * it however busy the machine is. This used to be a loop of its own on the
 * addon, which lost frames to its session reads and gave up after a minute
 * on the wall clock, whether or not the tape had ended.
 */
const playTape = async () => {
  // A lap library in miniature: every lap the recorder passes on, and the
  // quickest eligible one as the all-time reference, with a revision that
  // moves when that changes. The real one keeps them in a database.
  const recorded: { session: LapSessionInput; lap: LapInput }[] = [];
  let allTime: ReferenceLap | null = null;
  let revision = 0;
  let clock = Date.UTC(2026, 9, 7, 20, 0, 0);
  const recorder = new PlayerLapRecorder(
    {
      record: (session, lap) => {
        recorded.push({ session, lap });
        if (!isEligibleLap(lap) || !lap.curve) return;
        if (allTime && lap.lapTime >= allTime.finishTime) return;
        const pointsCount = lap.curve.pointPos.length;
        allTime = {
          pointPos: lap.curve.pointPos,
          times: lap.curve.times,
          tangents: new Float32Array(pointsCount),
          interval: lap.curve.interval,
          pointsCount,
          startTime: 0,
          finishTime: lap.lapTime,
          lastTrackedPct: 0,
          isCleanLap: true,
        };
        revision += 1;
      },
    },
    { simulator: 'lmu', bootId: 'tape', now: () => (clock += 1000) }
  );
  recorder.onEnter();
  const reference = new ReferenceLapProcessor(
    { load: () => null, save: () => undefined },
    { load: () => allTime, revision: () => revision }
  );
  const delta = new LapDeltaProcessor(reference);
  reference.onLifecycle({ type: 'enter', replay: false });
  delta.onLifecycle({ type: 'enter', replay: false });

  const samples: Sample[] = [];
  /** When the player's session best first appeared, and each time it moved. */
  const bestLapEvents: { sessionTime: number; lapTime: number }[] = [];
  let simBestLap = -1;
  let playerCarIdx = -1;
  let lastTick = Number.NEGATIVE_INFINITY;
  const { frames } = await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    onFrame: ({ raw, telemetry, session, sessionChanged, sessionTime }) => {
      // The bridge rebuilds the session twice a second, and publishes it
      // when it has moved.
      if (sessionChanged) {
        recorder.onSession(session);
        reference.init(session);
        delta.init(session);
      }
      const playerIdx = telemetry.PlayerCarIdx?.value?.[0] as number;
      playerCarIdx = playerIdx;
      const versionBefore = reference.snapshot().version;
      recorder.onFrame(telemetry);
      reference.onFrame(telemetry);
      if (reference.snapshot().version !== versionBefore) {
        const best = reference
          .snapshot()
          .bestLaps.find(([carIdx]) => carIdx === playerIdx)?.[1];
        const lapTime = best ? best.finishTime - best.startTime : null;
        if (lapTime !== null && bestLapEvents.at(-1)?.lapTime !== lapTime) {
          bestLapEvents.push({
            sessionTime: raw.elapsedTime ?? sessionTime,
            lapTime,
          });
        }
      }
      simBestLap = raw.vehBestLapTime?.[raw.playerVehicleIdx ?? -1] ?? -1;
      // The delta processor is declared at 25 Hz; the host would feed it so.
      if (sessionTime - lastTick < 0.04) return;
      lastTick = sessionTime;
      delta.onFrame(telemetry);
      const snapshot = delta.snapshot();
      samples.push({
        sessionTime,
        delta: snapshot.sessionBest.delta,
        allTimeDelta: snapshot.allTime.delta,
        stintBestDelta: snapshot.stintBest.delta,
        lastLapDelta: snapshot.lastLap.delta,
        simDelta: telemetry.LapDeltaToSessionBestLap_OK?.value?.[0]
          ? (telemetry.LapDeltaToSessionBestLap?.value?.[0] as number)
          : null,
      });
    },
  });
  return {
    frames,
    samples,
    bestLapEvents,
    recorded,
    simBestLap,
    playerCarIdx,
    delta,
    reference,
  };
};

describe.skipIf(!available)('lap delta on a recorded LMU session', () => {
  it('times laps from the line and agrees with the delta the sim reports', async () => {
    const {
      frames,
      samples,
      bestLapEvents,
      recorded,
      simBestLap,
      playerCarIdx,
      delta,
      reference,
    } = await playTape();

    // The whole recording was read, not a prefix of it.
    expect(frames).toBeGreaterThan(10_000);
    expect(samples.at(-1)?.sessionTime).toBeGreaterThan(370);

    // The recording opens with the car rolling up to the start, the sim
    // holding its lap fraction at 0. That is not a lap start: timed from
    // there the "lap" came out at 92.9 s with three seconds of it spent
    // short of the line. So the only reference is the first lap driven from
    // line to line, which ends 319.5 s in.
    expect(bestLapEvents).toHaveLength(1);
    expect(bestLapEvents[0].sessionTime).toBeGreaterThan(319);
    expect(bestLapEvents[0].sessionTime).toBeLessThan(320);

    // The sim timed that lap at 86.660 s. The two clocks stop at different
    // lines a couple of metres apart, so they agree to hundredths, not
    // thousandths.
    expect(simBestLap).toBeCloseTo(86.66, 2);
    expect(Math.abs(bestLapEvents[0].lapTime - simBestLap)).toBeLessThan(0.03);

    // The library's recorder passed on two laps; the recording ends part-way
    // round the third. The first is the one from the rolling start: it
    // opens when the sim lets the car go at the line, is kept without a
    // curve, and so can never be the reference.
    expect(recorded).toHaveLength(2);
    expect(recorded[0].lap).toMatchObject({ complete: false, curve: null });
    expect(isEligibleLap(recorded[0].lap)).toBe(false);
    // The second is that same lap, driven from line to line. Filed under
    // the car's model rather than the livery file LMU puts in CarPath, and
    // fit to be a reference.
    recorded.shift();
    expect(recorded[0].session).toMatchObject({
      simulator: 'lmu',
      sessionKey: '',
      trackName: 'WeatherTech Raceway Laguna Seca',
      carKey: 'Ferrari 296 LMGT3 Evo',
      sessionType: 'Race',
    });
    expect(recorded[0].lap.lapTime).toBeCloseTo(bestLapEvents[0].lapTime, 6);
    expect(recorded[0].lap).toMatchObject({
      complete: true,
      pit: false,
      voided: false,
      own: true,
    });
    expect(isEligibleLap(recorded[0].lap)).toBe(true);
    // An LMGT3 runs on virtual energy; a lap costs it about a twentieth.
    expect(recorded[0].lap.energyUsed).toBeGreaterThan(0.02);
    expect(recorded[0].lap.energyUsed).toBeLessThan(0.08);
    expect(recorded[0].lap.fuelUsed).toBeGreaterThan(1);
    expect(recorded[0].lap.fuelUsed).toBeLessThan(5);

    // No delta until there is a reference and a lap timed from its start.
    const firstDelta = samples.find((sample) => sample.delta !== null);
    expect(firstDelta?.sessionTime).toBeGreaterThan(319);
    expect(firstDelta?.sessionTime).toBeLessThan(320);
    expect(Math.abs(firstDelta?.delta ?? 1)).toBeLessThan(0.01);

    // From there both deltas are against the same lap. Skip the first second,
    // where the sim's own reading is still switching references.
    const compared = samples.filter(
      (sample) =>
        sample.sessionTime > 321 &&
        sample.delta !== null &&
        sample.simDelta !== null
    );
    expect(compared.length).toBeGreaterThan(1000);
    const differences = compared.map(
      (sample) => (sample.delta as number) - (sample.simDelta as number)
    );
    const mean =
      differences.reduce((sum, value) => sum + value, 0) / differences.length;
    // About -0.011 s: the 11 ms by which the two lap times differ.
    expect(Math.abs(mean)).toBeLessThan(0.03);
    for (const difference of differences) {
      // The worst single frame sits in a braking zone, where 40 ms between
      // samples is the most distance.
      expect(Math.abs(difference)).toBeLessThan(0.15);
    }

    // The session best and the all-time reference are the same lap here,
    // recorded twice: once by the reference recorder, once by the library's.
    // Their curves are sampled a frame apart at the line, so the two deltas
    // agree to a thousandth or two rather than exactly.
    for (const sample of compared) {
      expect(
        Math.abs((sample.allTimeDelta as number) - (sample.delta as number))
      ).toBeLessThan(0.003);
    }

    // The player ends the recording 0.94 s up on that lap, by both accounts.
    const last = compared.at(-1);
    expect(last?.delta).toBeCloseTo(last?.simDelta ?? 0, 1);
    expect(delta.snapshot().sessionBest.lapTime).toBeCloseTo(86.671, 2);

    // That one flying lap is the last lap and the best of the stint as well
    // as of the session: the same lap, held once. The lap from the rolling
    // start is none of them, and with no stop in the recording the stint is
    // still the first.
    const laps = reference.snapshot();
    const sessionBest = laps.bestLaps.find(
      ([carIdx]) => carIdx === playerCarIdx
    )?.[1];
    expect(sessionBest).toBeDefined();
    expect(laps.playerLastLap).toBe(sessionBest);
    expect(laps.playerStintBestLap).toBe(sessionBest);
    expect(laps.playerStintId).toBe(0);

    // So on the third lap the delta to the stint best and to the last lap
    // are the delta to the session best, frame for frame, and before the
    // second crossing there is none to either.
    const timed = samples.filter((sample) => sample.delta !== null);
    expect(timed.length).toBeGreaterThan(1000);
    for (const sample of samples) {
      expect(sample.stintBestDelta).toBe(sample.delta);
      expect(sample.lastLapDelta).toBe(sample.delta);
    }
    const snapshot = delta.snapshot();
    expect(snapshot.stintBest.lapTime).toBe(snapshot.sessionBest.lapTime);
    expect(snapshot.lastLap.lapTime).toBe(snapshot.sessionBest.lapTime);
    expect(snapshot.stintId).toBe(0);

    // The result of that lap at the line: its time by this clock, and no
    // gap to anything, because no reference existed before the crossing --
    // not even the lap itself, which the recorder held from that frame on.
    const final = snapshot.lastLapFinal;
    expect(final?.lapTime).toBeCloseTo(86.671, 2);
    expect(final?.lapTime).toBe(snapshot.sessionBest.lapTime);
    expect(final?.completedAt).toBeGreaterThan(319);
    expect(final?.completedAt).toBeLessThan(320);
    expect(final).toMatchObject({
      sessionBest: null,
      allTime: null,
      stintBest: null,
      lastLap: null,
    });
  }, 90_000);
});
