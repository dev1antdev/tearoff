import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import type { LmuRawSession, LmuRawTelemetry } from '../lmu/native';
import { mapLmuSession } from '../lmu/mapSession';
import { mapLmuTelemetry } from '../lmu/mapTelemetry';
import { createLmuLapDistanceState } from '../lmu/lapDistance';
import { createLmuOpponentLapDistanceState } from '../lmu/opponentLapDistance';
import { createLmuEnergyState } from '../lmu/fuelEnergy';
import { FuelProjectionProcessor } from './FuelProjectionProcessor';

/**
 * The fuel projection on a recorded Le Mans Ultimate session: a race at
 * Laguna Seca in a Ferrari 296 LMGT3, joined as the field rolls up to the
 * start with 45 % of its virtual energy and 44.9 of 120 litres aboard. The
 * pit menu in the same recording labels that energy "45% 20 laps".
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

const playTape = async () => {
  vi.stubEnv('IRDASHIES_LMU_REPLAY', tapePath);
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
  const processor = new FuelProjectionProcessor();
  processor.onLifecycle({ type: 'enter', replay: false });

  const lapDistanceState = createLmuLapDistanceState();
  const opponentState = createLmuOpponentLapDistanceState();
  // The bridge owns this, and without it a car is never known to run on
  // energy once it reads zero. Passed here as the bridge passes it.
  const energyState = createLmuEnergyState();
  let lastElapsed = -1;
  let lastSessionAt = Number.NEGATIVE_INFINITY;
  let lastTick = Number.NEGATIVE_INFINITY;
  let frames = 0;
  let ended = false;
  let firstBudget: string | undefined;
  let lastEnergy = -1;
  let lastLitres = -1;
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
        processor.init(mapLmuSession(sdk.readSession()));
        lastSessionAt = elapsed;
      }
      const telemetry = mapLmuTelemetry(
        raw,
        lapDistanceState,
        opponentState,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        energyState
      );
      // SessionTime is one of the generated keys typed as undefined[]; the
      // mapper writes a number there.
      const sessionTime = telemetry.SessionTime
        ?.value?.[0] as unknown as number;
      // The processor is declared at 5 Hz; the host would feed it so.
      if (sessionTime - lastTick < 0.2) continue;
      lastTick = sessionTime;
      processor.onFrame(telemetry);
      firstBudget ??= processor.snapshot().budget ?? 'fuel';
      const playerIdx = telemetry.PlayerCarIdx?.value?.[0] as number;
      lastEnergy = telemetry.LmuCarIdxEnergyRemaining?.value?.[
        playerIdx
      ] as number;
      lastLitres = telemetry.FuelLevel?.value?.[0] as number;
    }
  } finally {
    sdk.stop();
    vi.unstubAllEnvs();
  }
  return {
    frames,
    firstBudget,
    lastEnergy,
    lastLitres,
    snapshot: processor.snapshot(),
  };
};

describe.skipIf(!available)('fuel projection on a recorded LMU session', () => {
  it('counts an LMGT3 in virtual energy, lap by lap', async () => {
    const { frames, firstBudget, lastEnergy, lastLitres, snapshot } =
      await playTape();

    // The whole recording was read, not a prefix of it.
    expect(frames).toBeGreaterThan(10_000);

    // An energy car from the first frame it is seen in, so nothing was
    // counted in litres first and thrown away.
    expect(firstBudget).toBe('virtualEnergy');
    expect(snapshot.budget).toBe('virtualEnergy');
    expect(snapshot.fuelTankCapacity).toBe(100);
    // Under the model, not the livery file in CarPath, and apart from any
    // history the same car has in litres.
    expect(snapshot.carName).toBe('Ferrari 296 LMGT3 Evo (virtual energy)');

    // The level is the sim's own figure in percent.
    expect(snapshot.fuelLevel).toBeCloseTo(lastEnergy * 100, 6);
    expect(snapshot.fuelLevelPct).toBeCloseTo(lastEnergy, 6);
    expect(snapshot.fuelLevel).toBeGreaterThan(38);
    expect(snapshot.fuelLevel).toBeLessThan(40);

    // Two laps are complete when the recording ends, the third under way.
    // The sim counts them from zero; here the first lap is lap 1, which is
    // what gets it recorded at all.
    expect(snapshot.currentLap).toBe(3);
    expect(snapshot.completedLaps.map((lap) => lap.lapNumber)).toEqual([2, 1]);
    const [second, first] = snapshot.completedLaps;

    // The opening lap, from the line after a rolling start.
    expect(first.fuelUsed).toBeGreaterThan(2.1);
    expect(first.fuelUsed).toBeLessThan(2.4);
    expect(first.isValidForCalc).toBe(true);

    // The second, which the sim timed at 86.660 s. This clock ticks five
    // times a second, so it agrees to within a tick either side.
    expect(second.lapTime).toBeGreaterThan(86.2);
    expect(second.lapTime).toBeLessThan(87.1);
    // About 2.3 % a lap: the pit menu's "45% 20 laps" is 2.25.
    expect(second.fuelUsed).toBeGreaterThan(2.2);
    expect(second.fuelUsed).toBeLessThan(2.45);
    expect(second.isOutLap).toBe(false);

    // The tank alongside: litres aboard and litres a lap, for the one
    // question of which runs out first.
    expect(snapshot.tank?.level).toBeCloseTo(lastLitres, 6);
    expect(snapshot.tank?.perLap).toBeGreaterThan(2.2);
    expect(snapshot.tank?.perLap).toBeLessThan(2.45);
  }, 90_000);
});
