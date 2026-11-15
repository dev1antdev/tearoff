import { describe, expect, it } from 'vitest';
import {
  LMU_DIAL_KEYS,
  type CarSystemAdjustment,
  type CarSystemsSnapshot,
  type Telemetry,
} from '@irdashies/types';
import type { LmuRawTelemetry } from '../lmu/native';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { CarSystemsProcessor } from './CarSystemsProcessor';

/** The processor ticks ten times a second. */
const TICK_S = 0.1;

interface Tick {
  snapshot: CarSystemsSnapshot;
  telemetry: Telemetry;
  raw: LmuRawTelemetry;
  sessionTime: number;
}

/**
 * Plays the curated tape through the mapper and the car-systems processor,
 * and hands every tick to `onTick` and every frame to `onFrame`.
 */
const playCarSystems = async (
  onTick: (tick: Tick) => void,
  onFrame?: (telemetry: Telemetry) => void
): Promise<number> => {
  const processor = new CarSystemsProcessor();
  let started = false;
  let lastTick = Number.NEGATIVE_INFINITY;
  let ticks = 0;
  await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    speed: 20,
    onFrame: ({ raw, telemetry, session, sessionTime }) => {
      if (!started) {
        started = true;
        processor.init(session);
        processor.onLifecycle({ type: 'enter', replay: false });
      }
      onFrame?.(telemetry);
      if (sessionTime - lastTick < TICK_S) return;
      lastTick = sessionTime;
      processor.onFrame(telemetry);
      ticks += 1;
      onTick({ snapshot: processor.snapshot(), telemetry, raw, sessionTime });
    },
  });
  return ticks;
};

const row = (
  snapshot: CarSystemsSnapshot,
  key: string
): CarSystemAdjustment | undefined =>
  snapshot.adjustments.find((adjustment) => adjustment.key === key);

/**
 * The car systems on the recorded Le Mans Ultimate race: four minutes in a
 * Ferrari 296 LMGT3 in which the driver touches no dial.
 *
 * So this pins the static picture, what the car has and where each dial sits
 * on its scale, and the two lights, which do come on. What a dial that moves
 * looks like is left to the unit spec: the recording has none.
 *
 * Windows only, like the other tape specs.
 */
describe.skipIf(!lmuTapeAvailable())(
  'the car systems on a recorded LMU race',
  () => {
    it('reads every dial the LMGT3 has, with the top of its scale', async () => {
      const columns = new Set<string>();
      let first = Number.POSITIVE_INFINITY;
      let last = 0;
      const ticks = await playCarSystems(({ snapshot, sessionTime }) => {
        first = Math.min(first, sessionTime);
        last = sessionTime;
        columns.add(snapshot.adjustments.map(({ key }) => key).join(' '));

        expect(snapshot.discovered).toBe(true);
        // 51.75, which the widget shows as 51.8% and the garage as
        // "51.8:48.2". The bias has no scale to state.
        const bias = row(snapshot, 'dcBrakeBias');
        expect(bias?.value).toBeCloseTo(51.75, 6);
        expect(bias?.value.toFixed(bias.precision)).toBe('51.8');
        expect(bias?.max).toBeUndefined();

        const dials = LMU_DIAL_KEYS.map((key) => {
          const dial = row(snapshot, key);
          return [key, dial?.value, dial?.max, dial?.isOff];
        });
        expect(dials).toEqual([
          ['dcABS', 9, 9, false],
          ['dcTractionControl', 6, 11, false],
          ['LmuTcSlip', 7, 11, false],
          ['LmuTcCut', 7, 11, false],
          // No brake migration on this car: the top of its scale is 0.
          ['LmuBrakeMigration', undefined, undefined, undefined],
          // Two positions, and it sits on the upper one.
          ['LmuMotorMap', 1, 1, false],
          ['dcAntiRollFront', 3, 7, false],
          ['dcAntiRollRear', 1, 7, false],
        ]);

        // On auto, by TinyPedal's reading of the values, in a dry race.
        expect(row(snapshot, 'LmuWiper')?.value).toBe(1);
        expect(row(snapshot, 'LmuWiper')?.isOff).toBe(false);

        // No dial is reported as moved, and the bias is where it started:
        // the car never stops, so its baseline is the first reading.
        expect(snapshot.lastChange).toBeNull();
        expect(bias?.baselineDelta).toBe(0);
      });

      // The whole recording: 139.9 s to 379.9 s on the session clock.
      expect(ticks).toBeGreaterThan(2_000);
      expect(first).toBeLessThan(141);
      expect(last).toBeGreaterThan(378);
      // The same columns in the same order from the first tick to the last,
      // none of them under one of iRacing's generic names.
      expect([...columns]).toEqual([
        'dcBrakeBias dcABS dcTractionControl LmuTcSlip LmuTcCut LmuMotorMap dcAntiRollFront dcAntiRollRear LmuWiper',
      ]);
    }, 120_000);

    it('lights ABS and traction control while each is working', async () => {
      let absLit = 0;
      let tcLit = 0;
      let bothLit = 0;
      let lastVersion = -1;
      let publishes = 0;
      const maxima = new Set<Telemetry['LmuDialMax']>();
      const onTick = ({ snapshot, raw }: Tick) => {
        const abs = row(snapshot, 'dcABS')?.active;
        const tc = row(snapshot, 'dcTractionControl')?.active;
        // Each light is the sim's own flag on the tick it was read.
        expect(abs).toBe(Boolean(raw.absActive));
        expect(tc).toBe(Boolean(raw.tcActive));
        if (abs) absLit += 1;
        if (tc) tcLit += 1;
        if (abs && tc) bothLit += 1;
        if (snapshot.version !== lastVersion) publishes += 1;
        lastVersion = snapshot.version;
        // No other row has a light.
        for (const adjustment of snapshot.adjustments) {
          if (adjustment.key === 'dcABS') continue;
          if (adjustment.key === 'dcTractionControl') continue;
          expect(adjustment.active).toBeUndefined();
        }
      };
      const ticks = await playCarSystems(onTick, (telemetry) =>
        maxima.add(telemetry.LmuDialMax)
      );

      // About eleven seconds of ABS and twelve of traction control in the
      // four minutes, never on the same tick.
      expect(absLit).toBeGreaterThan(90);
      expect(absLit).toBeLessThan(130);
      expect(tcLit).toBeGreaterThan(100);
      expect(tcLit).toBeLessThan(150);
      expect(bothLit).toBe(0);
      // The lights are all that moves, so they are all that is published:
      // a snapshot each time one comes on or goes out, about 150 of them in
      // more than 2,000 ticks, and nothing in between.
      expect(publishes).toBeGreaterThan(100);
      expect(publishes).toBeLessThan(ticks / 5);

      // The top of every scale, in one cell for the whole recording: the
      // mapper allocates it once per car, not once per frame.
      expect(maxima.size).toBe(1);
      expect([...maxima][0]?.value).toEqual([9, 11, 11, 11, 0, 1, 7, 7]);
    }, 120_000);
  }
);
