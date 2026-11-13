import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import type { LmuRawSession, LmuRawTelemetry } from '../lmu/native';
import { mapLmuSession } from '../lmu/mapSession';
import { mapLmuTelemetry } from '../lmu/mapTelemetry';
import { createLmuLapDistanceState } from '../lmu/lapDistance';
import { createLmuOpponentLapDistanceState } from '../lmu/opponentLapDistance';
import type { LapInput, LapSessionInput, ReferenceLap } from '@irdashies/types';
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
const addonPath = path.resolve('build/Release/lmu_tape_node.node');
const tapePath = path.resolve('test-data/telemetry/lmu-session.lmudt');
const available =
  fs.existsSync(addonPath) &&
  fs.existsSync(tapePath) &&
  fs.statSync(tapePath).size > 1024;

interface Sample {
  sessionTime: number;
  delta: number | null;
  allTimeDelta: number | null;
  simDelta: number | null;
}

const playTape = async () => {
  vi.stubEnv('IRDASHIES_LMU_REPLAY', tapePath);
  // Fast enough to finish in seconds, slow enough that the loop below reads
  // every recorded frame rather than a timing-dependent subset of them.
  vi.stubEnv('IRDASHIES_LMU_REPLAY_SPEED', '40');
  vi.stubEnv('IRDASHIES_LMU_REPLAY_LOOP', '0');
  const { LmuSdkNode } = createRequire(import.meta.url)(addonPath) as {
    LmuSdkNode: new () => {
      start(): boolean;
      stop(): boolean;
      read(): LmuRawTelemetry & { running: boolean };
      readSession(): LmuRawSession;
    };
  };
  const sdk = new LmuSdkNode();
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

  const lapDistanceState = createLmuLapDistanceState();
  const opponentState = createLmuOpponentLapDistanceState();
  const samples: Sample[] = [];
  /** When the player's session best first appeared, and each time it moved. */
  const bestLapEvents: { sessionTime: number; lapTime: number }[] = [];
  let simBestLap = -1;
  let lastElapsed = -1;
  let lastSessionAt = Number.NEGATIVE_INFINITY;
  let lastTick = Number.NEGATIVE_INFINITY;
  let frames = 0;
  let ended = false;
  try {
    sdk.start();
    const deadline = performance.now() + 60_000;
    while (performance.now() < deadline && !ended) {
      const raw = sdk.read();
      if (!raw?.running) {
        if (frames > 0) ended = true;
        else await new Promise((resolve) => setTimeout(resolve, 2));
        continue;
      }
      const elapsed = raw.elapsedTime ?? 0;
      if (elapsed === lastElapsed) continue;
      lastElapsed = elapsed;
      frames += 1;
      // The bridge rebuilds the session twice a second; so does this.
      if (elapsed - lastSessionAt >= 0.5) {
        const session = mapLmuSession(sdk.readSession());
        recorder.onSession(session);
        reference.init(session);
        delta.init(session);
        lastSessionAt = elapsed;
      }
      const telemetry = mapLmuTelemetry(raw, lapDistanceState, opponentState);
      const playerIdx = telemetry.PlayerCarIdx?.value?.[0] as number;
      const versionBefore = reference.snapshot().version;
      recorder.onFrame(telemetry);
      reference.onFrame(telemetry);
      if (reference.snapshot().version !== versionBefore) {
        const best = reference
          .snapshot()
          .bestLaps.find(([carIdx]) => carIdx === playerIdx)?.[1];
        const lapTime = best ? best.finishTime - best.startTime : null;
        if (lapTime !== null && bestLapEvents.at(-1)?.lapTime !== lapTime) {
          bestLapEvents.push({ sessionTime: elapsed, lapTime });
        }
      }
      simBestLap = raw.vehBestLapTime?.[raw.playerVehicleIdx ?? -1] ?? -1;
      // SessionTime is one of the generated keys typed as undefined[]; the
      // mapper writes a number there.
      const sessionTime = telemetry.SessionTime
        ?.value?.[0] as unknown as number;
      // The delta processor is declared at 25 Hz; the host would feed it so.
      if (sessionTime - lastTick < 0.04) continue;
      lastTick = sessionTime;
      delta.onFrame(telemetry);
      const snapshot = delta.snapshot();
      samples.push({
        sessionTime,
        delta: snapshot.sessionBest.delta,
        allTimeDelta: snapshot.allTime.delta,
        simDelta: telemetry.LapDeltaToSessionBestLap_OK?.value?.[0]
          ? (telemetry.LapDeltaToSessionBestLap?.value?.[0] as number)
          : null,
      });
    }
  } finally {
    sdk.stop();
    vi.unstubAllEnvs();
  }
  return { frames, samples, bestLapEvents, recorded, simBestLap, delta };
};

describe.skipIf(!available)('lap delta on a recorded LMU session', () => {
  it('times laps from the line and agrees with the delta the sim reports', async () => {
    const { frames, samples, bestLapEvents, recorded, simBestLap, delta } =
      await playTape();

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

    // The library's recorder passed on that same lap and no other: the
    // opening stretch is not a lap, and the recording ends part-way round
    // the next. Filed under the car's model rather than the livery file LMU
    // puts in CarPath, and fit to be a reference.
    expect(recorded).toHaveLength(1);
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
  }, 90_000);
});
