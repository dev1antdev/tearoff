import { beforeAll, describe, expect, it } from 'vitest';
import type {
  PlayerLedgerSnapshot,
  PlayerStintSnapshot,
} from '@irdashies/types';
import { LEDGER_LAP_FROM_START } from '@irdashies/types';
import recorded from '../../../test-data/fixtures/lmu-session-ledger.json';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { ChannelBus } from '../bridge/channelBus';
import { createSessionLifecycle } from '../sessionLifecycle';
import { PlayerLedgerRuntime } from './playerLedgerRuntime';

/**
 * The two ledger snapshots of the recorded Le Mans Ultimate race, kept as a
 * fixture: `test-data/fixtures/lmu-session-ledger.json` is what the real
 * runtime publishes at the end of the recording -- two laps and one stint,
 * still open.
 *
 * The widgets that draw the ledger are renderer code, and the recording can
 * only be played in the main process's test project, so neither side's spec
 * can do both. The fixture is the hand-over: this spec holds it to what the
 * runtime gives on the tape, and `recordedRace.spec.ts` beside the renderer's
 * selectors holds the widgets to what they show for it. When this one fails
 * after a deliberate change to the ledger, write the snapshots out again.
 *
 * Windows only, like the replay addon, and skipped where the tape is the
 * Git LFS pointer left in its place.
 */
interface Ledger {
  ledger: PlayerLedgerSnapshot;
  stint: PlayerStintSnapshot;
}

const fixture = recorded as unknown as Ledger;

const play = async (): Promise<Ledger & { frames: number }> => {
  let clock = Date.UTC(2026, 9, 7, 20, 0, 0);
  const runtime = new PlayerLedgerRuntime(
    new ChannelBus(),
    createSessionLifecycle(),
    { markStart: () => undefined, markEnd: () => undefined },
    {
      recordLap: () => Promise.resolve(null),
      upsertStint: () => undefined,
      recentLedgerLaps: () => Promise.resolve([]),
    },
    { simulator: 'lmu', bootId: 'tape', now: () => (clock += 1000) }
  );
  // A tape is measured and published, and nothing of it is stored.
  runtime.setPersisting(false);
  const { frames } = await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    // Fast enough to finish in seconds, slow enough that every recorded
    // frame is read.
    speed: 40,
    onFrame: ({ telemetry, session, sessionChanged }) => {
      // As the bridge does: the frame first, then the session it came with.
      runtime.onFrame(telemetry);
      if (sessionChanged) runtime.onSession(session);
    },
  });
  return {
    frames,
    ledger: runtime.ledgerSnapshot(),
    stint: runtime.stintSnapshot(),
  };
};

/**
 * How far a figure may sit from the fixture's, by where it is. The replay
 * runs against the wall clock: on a busy machine it reads fewer of the
 * frames, which moves a line crossing by milliseconds, and may end a moment
 * early, which moves what the stint under way has reached. The sim's own
 * figures -- its lap and sector times -- do not move at all.
 */
const TOLERANCES: readonly (readonly [RegExp, number])[] = [
  [/\.version$/, Number.POSITIVE_INFINITY],
  // The stint and the lap under way, as they stand when the recording ends.
  [/^stint\.stint\.endTime$/, 3],
  [/^stint\.stint\.endFuel$/, 0.1],
  [/^stint\.stint\.endEnergy$/, 0.002],
  [/^stint\.stint\.endTread\./, 0.002],
  [/^stint\.lap\.fuelUsed$/, 0.1],
  [/^stint\.lap\.(energyUsed|treadUsed\.\d)$/, 0.002],
  [/^stint\.budgetLapsLeft$/, 0.3],
  // Where the app joined, and where the car crossed the line.
  [/\.startTime$/, 0.5],
  [/\.(endTime|lapTime|bestLap|avgLap)$/, 0.05],
  [/\.(startFuel|fuelAtLine|fuelUsed|fuel)$/, 0.02],
  [/[eE]nergy|[tT]read/, 0.0005],
  [/Temp$/, 0.1],
];

const toleranceAt = (path: string): number =>
  TOLERANCES.find(([pattern]) => pattern.test(path))?.[1] ?? 1e-6;

/**
 * Every place the runtime's snapshots differ from the fixture's by more
 * than is allowed there. What the fixture holds has to be there and agree;
 * a field the runtime has gained since is none of the fixture's business,
 * and no reader of it knows the field.
 */
const differences = (
  actual: unknown,
  expected: unknown,
  path = ''
): string[] => {
  if (typeof actual === 'number' && typeof expected === 'number') {
    return Math.abs(actual - expected) <= toleranceAt(path)
      ? []
      : [`${path}: ${actual}, not ${expected}`];
  }
  if (
    actual !== null &&
    expected !== null &&
    typeof actual === 'object' &&
    typeof expected === 'object'
  ) {
    if (
      Array.isArray(expected) &&
      (!Array.isArray(actual) || actual.length !== expected.length)
    ) {
      return [`${path}: not a list of ${expected.length}`];
    }
    return Object.keys(expected).flatMap((key) =>
      differences(
        (actual as Record<string, unknown>)[key],
        (expected as Record<string, unknown>)[key],
        path === '' ? key : `${path}.${key}`
      )
    );
  }
  return actual === expected
    ? []
    : [`${path}: ${String(actual)}, not ${String(expected)}`];
};

describe.skipIf(!lmuTapeAvailable())(
  'the ledger of a recorded LMU race, and the fixture kept of it',
  () => {
    let race: Ledger & { frames: number };
    beforeAll(async () => {
      race = await play();
      // Six seconds on a quiet machine. The replay runs against the wall
      // clock, so a machine busy with every other spec takes far longer.
    }, 300_000);

    it('reads the whole recording', () => {
      expect(race.frames).toBeGreaterThan(10_000);
    });

    it('rows two laps, the first from the rolling start', () => {
      const [second, first] = race.ledger.laps;

      expect(race.ledger.laps).toHaveLength(2);
      expect(first).toMatchObject({
        lapNumber: 1,
        stintLap: 1,
        flags: LEDGER_LAP_FROM_START,
      });
      // The sim times it from the green flag, eight seconds before the car
      // is let go at the line.
      expect(first.simLapTime).toBeCloseTo(97.823, 3);
      expect(second).toMatchObject({ lapNumber: 2, stintLap: 2, flags: 0 });
      expect(second.simLapTime).toBeCloseTo(86.66, 3);
      expect(second.stintId).toBe(first.stintId);
    });

    it('has one stint, still open, and none finished', () => {
      expect(race.ledger.stints).toEqual([]);
      expect(race.stint).toMatchObject({
        available: true,
        state: 'running',
        budget: 'virtualEnergy',
        lap: { lapNumber: 3, stintLap: 3, flags: 0 },
      });
      expect(race.stint.stint).toMatchObject({
        ordinal: 1,
        own: true,
        openedBy: 'joined',
        closedBy: null,
        laps: 2,
        stop: null,
      });
      expect(race.stint.stint?.id).toBe(race.ledger.laps[0].stintId);
    });

    it('carries the tread the third lap has worn so far', () => {
      // Two thirds of the way round when the recording ends.
      const worn = race.stint.lap.treadUsed ?? [];

      expect(worn).toHaveLength(4);
      for (const wheel of worn) {
        expect(wheel).toBeGreaterThanOrEqual(0.002);
        expect(wheel).toBeLessThanOrEqual(0.005);
      }
    });

    it('gives what the fixture holds', () => {
      expect(
        differences(
          { ledger: race.ledger, stint: race.stint },
          { ledger: fixture.ledger, stint: fixture.stint }
        )
      ).toEqual([]);
    });
  }
);
