import { describe, expect, it } from 'vitest';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
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
const available = lmuTapeAvailable();

/**
 * The recording through the shared tape player, which reads every frame of
 * it however busy the machine is. This used to be a loop of its own on the
 * addon, with a minute on the wall clock to finish in: on a loaded machine
 * the minute ran out first, and the level at the end was the level somewhere
 * in the second lap.
 */
const playTape = async () => {
  const processor = new FuelProjectionProcessor();
  processor.onLifecycle({ type: 'enter', replay: false });
  let lastTick = Number.NEGATIVE_INFINITY;
  let firstBudget: string | undefined;
  let lastEnergy = -1;
  let lastLitres = -1;
  const { frames } = await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    onFrame: ({ telemetry, session, sessionChanged, sessionTime }) => {
      // The bridge rebuilds the session twice a second, and publishes it
      // when it has moved.
      if (sessionChanged) processor.init(session);
      // The processor is declared at 5 Hz; the host would feed it so.
      if (sessionTime - lastTick < 0.2) return;
      lastTick = sessionTime;
      processor.onFrame(telemetry);
      firstBudget ??= processor.snapshot().budget ?? 'fuel';
      const playerIdx = telemetry.PlayerCarIdx?.value?.[0] as number;
      lastEnergy = telemetry.LmuCarIdxEnergyRemaining?.value?.[
        playerIdx
      ] as number;
      lastLitres = telemetry.FuelLevel?.value?.[0] as number;
    },
  });
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

/**
 * The same recording through the shared tape player, for what the processor
 * makes of it when it is not there from the first frame, and for how its
 * estimate of the race's length moves as the race goes on.
 */
const projectTape = async ({
  joinAt = 0,
  extraSeconds = 0,
  trackFrom,
}: {
  /** Session time the processor is created at, as on a late subscription. */
  joinAt?: number;
  /** Added to the race's clock, to make a 15-minute race a long one. */
  extraSeconds?: number;
  /** Scoring time from which the sim names another track. */
  trackFrom?: { at: number; name: string };
} = {}) => {
  let processor: FuelProjectionProcessor | undefined;
  let lastTick = Number.NEGATIVE_INFINITY;
  const totals: number[] = [];
  let frames = 0;
  await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    speed: 40,
    // Session snapshots pass through here as well, so the session the
    // processor is given agrees with the frames.
    transformRaw: (raw) => ({
      ...raw,
      sessionTimeRemaining: raw.sessionTimeRemaining + extraSeconds,
      endET: raw.endET + extraSeconds,
      trackName:
        trackFrom && raw.currentET >= trackFrom.at
          ? trackFrom.name
          : raw.trackName,
    }),
    onFrame: ({ telemetry, session, sessionChanged, sessionTime }) => {
      frames += 1;
      if (sessionTime < joinAt) return;
      if (!processor) {
        // What the host does for a processor it has just activated.
        processor = new FuelProjectionProcessor();
        processor.init(session);
        processor.onLifecycle({ type: 'enter', replay: false });
      } else if (sessionChanged) {
        processor.init(session);
      }
      // The processor is declared at 5 Hz; the host would feed it so.
      if (sessionTime - lastTick < 0.2) return;
      lastTick = sessionTime;
      processor.onFrame(telemetry);
      const snapshot = processor.snapshot();
      if (
        snapshot.hasValidRaceEstimate &&
        snapshot.calculatedTotalRaceLaps !== totals.at(-1)
      ) {
        totals.push(snapshot.calculatedTotalRaceLaps);
      }
    },
  });
  if (!processor) throw new Error('The tape ended before the processor began');
  return { frames, totals, snapshot: processor.snapshot() };
};

describe.skipIf(!lmuTapeAvailable())(
  'fuel projection joining a recorded LMU race',
  () => {
    it('does not record the rest of the lap it joined on', async () => {
      // Created 275 s in, half-way round the second lap, as when the widget
      // is shown or the app started in mid-race. The rest of that lap is
      // 1.15 % of energy in 45 s, where the lap was 2.33 % in 87, and it
      // used to be recorded as a lap fit to average.
      const { frames, snapshot } = await projectTape({ joinAt: 275 });

      expect(frames).toBeGreaterThan(5_000);
      // The third lap is under way when the recording ends, so the second
      // was finished in front of the processor.
      expect(snapshot.currentLap).toBe(3);
      expect(snapshot.budget).toBe('virtualEnergy');
      expect(snapshot.completedLaps).toEqual([]);
      expect(snapshot.lastLapUsage).toBe(0);
      expect(snapshot.tank?.perLap).toBe(0);
    }, 90_000);

    it('does not carry its laps to another track', async () => {
      // The sim naming another track from 330 s on, which is all a change of
      // event is to the processor: Le Mans Ultimate does not disconnect.
      const { snapshot } = await projectTape({
        trackFrom: { at: 330, name: 'Sebring International Raceway' },
      });

      expect(snapshot.trackId).toBe('Sebring International Raceway');
      // Two laps were recorded at Laguna Seca. None of them is here to be
      // stored under Sebring, nor is the lap that was under way.
      expect(snapshot.completedLaps).toEqual([]);
    }, 90_000);
  }
);

describe.skipIf(!lmuTapeAvailable())(
  'race distance on a recorded LMU race',
  () => {
    it('does not move from update to update', async () => {
      // Fifteen minutes to run from the green flag, the leader a prototype
      // lapping in 77 s and the player a GT in 87. It read 11, 12, 10, 11,
      // 10, 11, 10 and 11 laps over these four minutes: a lap either way
      // as each class's lap from the start came in as its pace, and again
      // each time the finish landed on a line.
      const { totals } = await projectTape();

      expect(totals.at(-1)).toBe(11);
      expect(totals.length).toBeLessThanOrEqual(2);
    }, 90_000);

    it('corrects a long race once, when the pace is known', async () => {
      // The same race with eight hours on the clock. It read 342, then 301
      // on the GT leader's lap from the start, then 332.
      const { totals } = await projectTape({ extraSeconds: 27_765 });

      const settled = totals.at(-1) ?? 0;
      expect(settled).toBeGreaterThan(325);
      expect(settled).toBeLessThan(337);
      expect(totals.length).toBeLessThanOrEqual(3);
      // Never further out than the sim's own estimate of a lap puts it,
      // which is all there is to go on before a lap at speed.
      for (const total of totals) {
        expect(Math.abs(total - settled) / settled).toBeLessThan(0.05);
      }
    }, 90_000);
  }
);
