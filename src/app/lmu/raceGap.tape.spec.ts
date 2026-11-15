import { describe, expect, it } from 'vitest';
import type { LmuRawTelemetry } from './native';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';

/**
 * The race gaps on a recorded Le Mans Ultimate race: four minutes from the
 * green flag at Laguna Seca, 38 cars in three classes, nobody lapped.
 *
 * Windows only, like the other tape specs: the replay addon is a gyp target
 * gated on OS=='win'.
 *
 * The sim's own time behind the leader is the yardstick. It is not perfectly
 * consistent with itself: in one scoring update of this recording two cars'
 * figures are 0.22 s away from the times into the lap published beside them.
 * So the comparison allows a rare frame its disagreement and holds every
 * other one to two hundredths.
 */
const numbers = (value: unknown): number[] => value as number[];

const CLOSE_SECONDS = 0.02;
const WORST_SECONDS = 0.5;
/** At most one comparison in a thousand may miss CLOSE_SECONDS. */
const STRAY_SHARE = 0.001;

/** The class the player's LMGT3 runs in, by the id the addon gives it. */
const GT_CLASS = 1;

describe.skipIf(!lmuTapeAvailable())('race gaps on a recorded LMU race', () => {
  it('agrees with the sim for every car while nobody is lapped', async () => {
    let frames = 0;
    let compared = 0;
    let strays = 0;
    let worst = 0;
    let furthestBehind = 0;
    await playLmuTape({
      tapePath: LMU_CURATED_TAPE_PATH,
      speed: 40,
      onFrame: ({ raw, telemetry }) => {
        frames += 1;
        const computed = numbers(telemetry.CarIdxF2Time?.value);
        for (let carIdx = 0; carIdx < raw.vehLapDistPct.length; carIdx += 1) {
          if (raw.vehLapDistPct[carIdx] < 0) continue;
          const sim = raw.vehTimeBehindLeader[carIdx];
          const off = Math.abs(computed[carIdx] - sim);
          compared += 1;
          if (off > CLOSE_SECONDS) strays += 1;
          worst = Math.max(worst, off);
          furthestBehind = Math.max(furthestBehind, sim);
        }
      },
    });

    // The whole recording, and a field spread far enough to mean something:
    // the last car is most of a lap behind by the end.
    expect(frames).toBeGreaterThan(5_000);
    expect(compared).toBeGreaterThan(190_000);
    expect(furthestBehind).toBeGreaterThan(40);
    expect(strays / compared).toBeLessThan(STRAY_SHARE);
    expect(worst).toBeLessThan(WORST_SECONDS);
  }, 90_000);

  it('keeps a lapped class its gaps when the sim has none for it', async () => {
    // The same race with every prototype two laps further on, so the whole
    // GT class is more than a lap behind the leader, and with the sim's time
    // behind the leader taken away from those cars as rFactor 2 takes it. The
    // gaps inside the class must still be what the sim said they were while
    // it was still saying.
    let original: LmuRawTelemetry | null = null;
    let frames = 0;
    let compared = 0;
    let strays = 0;
    let worst = 0;
    let widest = 0;
    await playLmuTape({
      tapePath: LMU_CURATED_TAPE_PATH,
      speed: 40,
      transformRaw: (raw) => {
        // Session snapshots pass through here too; only a frame is kept to
        // compare against, so the two are the same instant.
        if (!('drivers' in raw)) original = raw;
        return {
          ...raw,
          vehTotalLaps: Int32Array.from(raw.vehTotalLaps, (laps, carIdx) =>
            raw.vehClass[carIdx] === GT_CLASS ? laps : laps + 2
          ),
          vehTimeBehindLeader: Float64Array.from(
            raw.vehTimeBehindLeader,
            (time, carIdx) => (raw.vehClass[carIdx] === GT_CLASS ? 0 : time)
          ),
        };
      },
      onFrame: ({ raw, telemetry }) => {
        frames += 1;
        if (!original) return;
        const computed = numbers(telemetry.CarIdxF2Time?.value);
        const classPositions = numbers(telemetry.CarIdxClassPosition?.value);
        const head = classPositions.findIndex(
          (position, carIdx) =>
            position === 1 && raw.vehClass[carIdx] === GT_CLASS
        );
        if (head < 0) return;
        for (let carIdx = 0; carIdx < raw.vehLapDistPct.length; carIdx += 1) {
          if (raw.vehClass[carIdx] !== GT_CLASS || carIdx === head) continue;
          if (raw.vehLapDistPct[carIdx] < 0) continue;
          const expected =
            original.vehTimeBehindLeader[carIdx] -
            original.vehTimeBehindLeader[head];
          const off = Math.abs(computed[carIdx] - computed[head] - expected);
          if (off > CLOSE_SECONDS) strays += 1;
          worst = Math.max(worst, off);
          widest = Math.max(widest, expected);
          compared += 1;
        }
        // Two laps and more behind the leader, in seconds.
        expect(computed[head]).toBeGreaterThan(150);
      },
    });

    expect(frames).toBeGreaterThan(5_000);
    expect(compared).toBeGreaterThan(50_000);
    expect(widest).toBeGreaterThan(8);
    expect(strays / compared).toBeLessThan(STRAY_SHARE);
    expect(worst).toBeLessThan(WORST_SECONDS);
  }, 90_000);
});
