import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import type { LmuRawSession, LmuRawTelemetry } from '../lmu/native';
import { mapLmuSession } from '../lmu/mapSession';
import { mapLmuTelemetry } from '../lmu/mapTelemetry';
import { createLmuLapDistanceState } from '../lmu/lapDistance';
import { createLmuOpponentLapDistanceState } from '../lmu/opponentLapDistance';
import { ReferenceLapProcessor } from './ReferenceLapProcessor';
import { LapDeltaProcessor } from './LapDeltaProcessor';

/**
 * The recorder and the delta, end to end on a recorded Le Mans Ultimate
 * session: a four-minute race at Laguna Seca in a Ferrari 296 LMGT3, joined as
 * the field rolls up to the start.
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
  const saved: { trackId: number; carKey: string; lapTime: number }[] = [];
  const reference = new ReferenceLapProcessor(
    { load: () => null, save: () => undefined },
    {
      load: () => null,
      save: (trackId, carKey, lap) =>
        saved.push({
          trackId,
          carKey,
          lapTime: lap.finishTime - lap.startTime,
        }),
    }
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
        reference.init(session);
        delta.init(session);
        lastSessionAt = elapsed;
      }
      const telemetry = mapLmuTelemetry(raw, lapDistanceState, opponentState);
      const playerIdx = telemetry.PlayerCarIdx?.value?.[0] as number;
      const versionBefore = reference.snapshot().version;
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
  return { frames, samples, bestLapEvents, saved, simBestLap, delta };
};

describe.skipIf(!available)('lap delta on a recorded LMU session', () => {
  it('times laps from the line and agrees with the delta the sim reports', async () => {
    const { frames, samples, bestLapEvents, saved, simBestLap, delta } =
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

    // Kept as the player's all-time best, once, under the car's model rather
    // than the livery file LMU puts in CarPath.
    expect(saved).toHaveLength(1);
    expect(saved[0].carKey).toBe('Ferrari 296 LMGT3 Evo');
    expect(saved[0].lapTime).toBe(bestLapEvents[0].lapTime);

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

    // The session best is the all-time best here, so the two read alike.
    for (const sample of compared) {
      expect(sample.allTimeDelta).toBe(sample.delta);
    }

    // The player ends the recording 0.94 s up on that lap, by both accounts.
    const last = compared.at(-1);
    expect(last?.delta).toBeCloseTo(last?.simDelta ?? 0, 1);
    expect(delta.snapshot().sessionBest.lapTime).toBeCloseTo(86.671, 2);
  }, 90_000);
});
