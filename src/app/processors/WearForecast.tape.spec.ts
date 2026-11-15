import { beforeAll, describe, expect, it } from 'vitest';
import type { LedgerLap, Session, WearSnapshot } from '@irdashies/types';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { ChannelBus } from '../bridge/channelBus';
import { LMU_REST_TASKS } from '../lmu/rest/tasks';
import { createSessionLifecycle } from '../sessionLifecycle';
import { PlayerLedgerRuntime } from './playerLedgerRuntime';

/**
 * The wear forecast on the recorded Le Mans Ultimate race: four minutes at
 * Laguna Seca in a Ferrari 296 LMGT3 on mediums, joined as the field rolls
 * up to the start. Two laps are completed. The first is driven from the
 * rolling start and is not a clean one, so the forecast has one measured
 * lap to go by, and the recording shows each step on the way to it: no
 * rate, the lap under way projected, and the measured lap.
 *
 * The disc thickness and the new-disc thickness come from the REST answers
 * the recording holds, read here as the bridge's poller would: looked at
 * four times a second, the thickness replaced only when it moves, and a
 * counter that moves with every answer.
 *
 * Windows only, like the replay addon, and skipped where the tape is the
 * Git LFS pointer left in its place.
 */
const REPAIR = '/rest/garage/UIScreen/RepairAndRefuel';
const SETUP = '/rest/garage/UIScreen/CarSetupOverview';

const outputOf = (path: string, id: string) =>
  LMU_REST_TASKS.find((task) => task.path === path)?.outputs.find(
    (output) => output.id === id
  );
const brakeThickness = outputOf(REPAIR, 'brakeThickness');
const brakeDiscNew = outputOf(SETUP, 'brakeDiscNewMm');

/** What the forecast said when a lap closed, with what the sim then held. */
interface AtLine {
  row: LedgerLap;
  wear: WearSnapshot;
  /** `wearables.tires` of the REST answer in hand at the line. */
  restTires: number[] | undefined;
}

interface Played {
  frames: number;
  /** The forecast at a session time, the first frame at or after it. */
  at: Map<number, WearSnapshot>;
  lines: AtLine[];
  end: WearSnapshot;
  /** How many times the forecast moved, looked at five times a second. */
  versions: number;
  discNew: number[] | undefined;
}

/** Session times the forecast is kept at: see the cases below. */
const MOMENTS = [150, 200, 280] as const;

const play = async (): Promise<Played> => {
  const runtime = new PlayerLedgerRuntime(
    new ChannelBus(),
    createSessionLifecycle(),
    { markStart: () => undefined, markEnd: () => undefined },
    {
      recordLap: () => Promise.resolve(null),
      upsertStint: () => undefined,
      recentLedgerLaps: () => Promise.resolve([]),
    },
    { simulator: 'lmu', bootId: 'tape', now: () => 0 }
  );
  runtime.setPersisting(false);

  let restBody: string | null = null;
  let restTires: number[] | undefined;
  let discs: { value: number[] } | undefined;
  let polledAt = Number.NEGATIVE_INFINITY;
  let seq = 0;
  let seqCell = { value: [seq] };
  let discNew: number[] | undefined;
  let session: Session | null = null;
  const sendSession = () => {
    if (!session) return;
    runtime.onSession(
      discNew
        ? {
            ...session,
            LmuRest: { ...session.LmuRest, brakeDiscNewMm: discNew },
          }
        : session
    );
  };

  const at = new Map<number, WearSnapshot>();
  const lines: AtLine[] = [];
  let rows = 0;
  let lookedAt = Number.NEGATIVE_INFINITY;
  let lastVersion = -1;
  let versions = 0;

  const { frames } = await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    // Fast enough to finish in seconds, slow enough that every recorded
    // frame is read.
    speed: 40,
    restCells: (raw, readRest) => {
      const now = raw.elapsedTime ?? raw.currentET;
      const body = readRest(REPAIR);
      if (body !== null && body !== restBody) {
        restBody = body;
        const payload: unknown = JSON.parse(body);
        restTires = (payload as { wearables?: { tires?: number[] } }).wearables
          ?.tires;
        const parsed = brakeThickness?.parse(payload) as number[] | undefined;
        if (
          parsed &&
          !parsed.every((value, wheel) => value === discs?.value[wheel])
        ) {
          discs = { value: parsed };
        }
      }
      // An answer four times a second, the same thickness or not.
      if (discs && (now - polledAt >= 0.25 || now < polledAt)) {
        polledAt = now;
        seq += 1;
        seqCell = { value: [seq] };
      }
      if (!discNew) {
        const setup = readRest(SETUP);
        discNew =
          setup === null
            ? undefined
            : (brakeDiscNew?.parse(JSON.parse(setup)) as number[] | undefined);
        if (discNew) sendSession();
      }
      return discs
        ? { brakeThickness: discs, wearablesSeq: seqCell }
        : undefined;
    },
    onFrame: ({ telemetry, session: mapped, sessionChanged, sessionTime }) => {
      // As the bridge does: the frame first, then the session it came with.
      runtime.onFrame(telemetry);
      if (sessionChanged) {
        session = mapped;
        sendSession();
      }
      for (const moment of MOMENTS) {
        if (sessionTime >= moment && !at.has(moment)) {
          at.set(moment, runtime.wearSnapshot());
        }
      }
      const { laps } = runtime.ledgerSnapshot();
      if (laps.length > rows) {
        rows = laps.length;
        lines.push({ row: laps[0], wear: runtime.wearSnapshot(), restTires });
      }
      if (sessionTime - lookedAt >= 0.2) {
        lookedAt = sessionTime;
        const { version } = runtime.wearSnapshot();
        if (version !== lastVersion) versions += 1;
        lastVersion = version;
      }
    },
  });
  return {
    frames,
    at,
    lines,
    end: runtime.wearSnapshot(),
    versions,
    discNew,
  };
};

const wheels = <K extends keyof WearSnapshot['wheels'][number]>(
  wear: WearSnapshot | undefined,
  key: K
) => (wear?.wheels ?? []).map((wheel) => wheel[key]);

const near = (
  values: readonly unknown[],
  expected: readonly number[],
  within: number
) => {
  expect(values).toHaveLength(expected.length);
  expected.forEach((value, index) =>
    expect(Math.abs((values[index] as number) - value)).toBeLessThan(within)
  );
};

describe.skipIf(!lmuTapeAvailable())(
  'the wear forecast on a recorded LMU race',
  () => {
    let race: Played;
    beforeAll(async () => {
      race = await play();
      // Twenty seconds on a quiet machine. The replay runs against the wall
      // clock, so a machine busy with every other spec takes far longer.
    }, 300_000);

    it('reads the whole recording, and two laps of it', () => {
      expect(race.frames).toBeGreaterThan(10_000);
      expect(race.lines).toHaveLength(2);
    });

    describe('before there is a measured lap', () => {
      it('shows tread and discs and no forecast, a few corners into the first lap', () => {
        const wear = race.at.get(150);

        expect(wear?.available).toBe(true);
        near(wheels(wear, 'treadPct'), [98.4, 98.4, 98.3, 98.3], 0.11);
        expect(wheels(wear, 'brakeMm')).toEqual([36, 36, 32, 32]);
        // Seven seconds past the line: under a quarter of the lap.
        expect(wheels(wear, 'treadPerLapPct')).toEqual([
          null,
          null,
          null,
          null,
        ]);
        expect(wheels(wear, 'treadLapsLeft')).toEqual([null, null, null, null]);
        expect(wheels(wear, 'brakePerLapMm')).toEqual([null, null, null, null]);
        expect(wheels(wear, 'brakeLapsLeft')).toEqual([null, null, null, null]);
        expect(wear?.paceLapTime).toBeNull();
        expect(wear?.budgetLapsLeft).toBeNull();
      });

      it('projects the first lap to its end once a quarter of it is driven', () => {
        const wear = race.at.get(200);

        expect(wheels(wear, 'treadRateSource')).toEqual([
          'projected',
          'projected',
          'projected',
          'projected',
        ]);
        // What has gone so far over the share of the lap done. The lap then
        // came to 0.27, 0.38, 0.47 and 0.60: a lap from a rolling start
        // wears little in its first third, which a share of the lap cannot
        // know. It is an estimate, and the snapshot says so.
        near(wheels(wear, 'treadPerLapPct'), [0.19, 0.27, 0.35, 0.37], 0.03);
        const [first] = race.lines;
        near(
          first.row.treadUsed.map((used) => (used ?? 0) * 100),
          [0.27, 0.38, 0.47, 0.6],
          0.02
        );
        wheels(wear, 'treadLapsLeft').forEach((laps) => {
          expect(laps).toBeGreaterThan(230);
          expect(laps).toBeLessThan(620);
        });
        expect(wheels(wear, 'brakeRateSource')).toEqual([
          'projected',
          'projected',
          'projected',
          'projected',
        ]);
        // No clean lap: no pace, and no end of stint to forecast.
        expect(wear?.paceLapTime).toBeNull();
        expect(wheels(wear, 'treadEndOfStintPct')).toEqual([
          null,
          null,
          null,
          null,
        ]);
      });

      it('leaves the lap from the start out, and measures the second against it', () => {
        // The first line: a lap is finished, but not a clean one.
        const [first] = race.lines;
        expect(wheels(first.wear, 'treadRateSource')).toEqual([
          'projected',
          'projected',
          'projected',
          'projected',
        ]);

        // Half-way round the second lap, against the first as a reference.
        const wear = race.at.get(280);
        expect(wheels(wear, 'treadRateSource')).toEqual([
          'projected',
          'projected',
          'projected',
          'projected',
        ]);
        // The second lap came to 0.49, 0.53, 0.50 and 0.48. The right rear
        // is forecast high: the lap it is measured against wore it most.
        near(wheels(wear, 'treadProjectedPct'), [0.46, 0.54, 0.53, 0.63], 0.04);
        const [, second] = race.lines;
        wheels(wear, 'treadProjectedPct').forEach((projected, wheel) => {
          const lap = (second.row.treadUsed[wheel] ?? 0) * 100;
          expect(Math.abs((projected ?? 0) - lap)).toBeLessThan(0.2);
        });
      });
    });

    describe('tyres, with one clean lap driven', () => {
      it('has the tread the sim reads at the end of the recording', () => {
        near(wheels(race.end, 'treadPct'), [97.4, 97.1, 97.0, 96.9], 0.11);
        expect(wheels(race.end, 'compound')).toEqual([0, 0, 0, 0]);
        expect(wheels(race.end, 'flat')).toEqual([false, false, false, false]);
      });

      it('takes the wear a lap from that lap: about half a percent a corner', () => {
        near(wheels(race.end, 'treadPerLapPct'), [0.49, 0.53, 0.5, 0.48], 0.03);
        expect(wheels(race.end, 'treadRateSource')).toEqual([
          'tyre',
          'tyre',
          'tyre',
          'tyre',
        ]);
      });

      it('makes that 180 to 205 laps to a tyre with no tread', () => {
        wheels(race.end, 'treadLapsLeft').forEach((laps) => {
          expect(laps).toBeGreaterThanOrEqual(180);
          expect(laps).toBeLessThanOrEqual(205);
        });
        // 197, 181, 193 and 201 when the recording is read to its last
        // frame: the right front goes first.
        const laps = wheels(race.end, 'treadLapsLeft') as number[];
        expect(Math.min(...laps)).toBe(laps[1]);
        expect(Math.max(...laps)).toBe(laps[3]);
      });

      it('forecasts the tread left when the energy runs out', () => {
        // 16.6 laps of virtual energy at a lap of 86.7 s.
        expect(race.end.budgetLapsLeft).toBeCloseTo(16.6, 1);
        expect(race.end.paceLapTime).toBeCloseTo(86.7, 1);
        near(
          wheels(race.end, 'treadEndOfStintPct'),
          [89.2, 88.3, 88.6, 88.8],
          0.3
        );
      });

      it('agrees with the tread the REST API states at each line', () => {
        for (const { row, restTires } of race.lines) {
          expect(restTires).toHaveLength(4);
          row.treadAtLine.forEach((tread, wheel) =>
            expect(
              Math.abs((tread ?? 0) - (restTires?.[wheel] ?? 0))
            ).toBeLessThan(0.0001)
          );
        }
      });
    });

    describe('brakes', () => {
      it('reads discs of 36 and 32 mm that have barely worn', () => {
        expect(race.discNew).toEqual([36, 36, 32, 32]);
        expect(race.end.brakeNewMm).toEqual([36, 32]);
        // 36.00, 35.99, 32.00 and 32.00 at the last frame: the right front
        // is the one that has lost five micrometres.
        near(wheels(race.end, 'brakeMm'), [36, 36, 32, 32], 0.011);
        const [first, second] = race.lines;
        near(
          first.row.brakeAtLine,
          [35.9986, 35.9986, 31.9995, 31.9994],
          0.001
        );
        near(
          second.row.brakeAtLine,
          [35.9968, 35.9959, 31.9987, 31.9984],
          0.001
        );
      });

      it('takes the wear a lap from the one clean lap: micrometres', () => {
        near(
          wheels(race.end, 'brakePerLapMm'),
          [0.0018, 0.0026, 0.0008, 0.001],
          0.0003
        );
        expect(wheels(race.end, 'brakeRateSource')).toEqual([
          'stint',
          'stint',
          'stint',
          'stint',
        ]);
      });

      it('counts life and laps to the 30 mm of an LMGT3, which puts them at the cap', () => {
        const [, second] = race.lines;
        expect(second.wear.brakeFailureMm).toEqual([30, 30]);
        expect(second.wear.brakeFailureSource).toEqual(['class', 'class']);
        // Above 99.9 percent of the usable disc on every wheel, which the
        // snapshot states to one decimal.
        expect(wheels(second.wear, 'brakeLifePct')).toEqual([
          99.9, 99.9, 99.9, 99.9,
        ]);
        second.row.brakeAtLine.forEach((disc, wheel) => {
          const fresh = race.discNew?.[wheel] ?? 0;
          expect(((disc ?? 0) - 30) / (fresh - 30)).toBeGreaterThan(0.999);
        });
        expect(wheels(second.wear, 'brakeLapsLeft')).toEqual([
          999, 999, 999, 999,
        ]);
        expect(wheels(race.end, 'brakeLapsLeft')).toEqual([999, 999, 999, 999]);
      });

      it('fails no brake, and never takes the readings for stale', () => {
        const all = [
          ...race.at.values(),
          ...race.lines.map((line) => line.wear),
        ];
        for (const wear of [...all, race.end]) {
          expect(wheels(wear, 'brakeFailed')).toEqual([
            false,
            false,
            false,
            false,
          ]);
          expect(wear.brakeStale).toBe(false);
        }
      });
    });

    it('moves about three times a second while driving, not at every look', () => {
      // Four minutes looked at five times a second is 1200 looks; 719 of
      // them found a figure moved, and the bus hands on two a second.
      expect(race.versions).toBeGreaterThan(300);
      expect(race.versions).toBeLessThan(1000);
    });
  }
);
