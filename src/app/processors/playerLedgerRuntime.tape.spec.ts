import { beforeAll, describe, expect, it } from 'vitest';
import type {
  LapInput,
  LapSessionInput,
  LedgerLap,
  PlayerLedgerSnapshot,
  PlayerStintSnapshot,
  StintInput,
} from '@irdashies/types';
import {
  LEDGER_LAP_FROM_START,
  LEDGER_LAP_IN_LAP,
  LEDGER_LAP_SERVICED,
} from '@irdashies/types';
import { isCleanLap } from '../../shared/lapValidity';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { ChannelBus } from '../bridge/channelBus';
import type { LmuRawTelemetry } from '../lmu/native';
import { LMU_REST_TASKS } from '../lmu/rest/tasks';
import { createSessionLifecycle } from '../sessionLifecycle';
import { isEligibleLap } from '../storage/lapLibrary/LapLibraryDatabase';
import { PlayerLedgerRuntime } from './playerLedgerRuntime';

/**
 * The ledger on the recorded Le Mans Ultimate race: four minutes at Laguna
 * Seca in a Ferrari 296 LMGT3, joined as the field rolls up to the start.
 * The car runs on virtual energy. It completes two laps and never stops, so
 * the recording holds one stint, still open when it ends.
 *
 * The recording has no pit stop in it. The second case stages one over the
 * same driving, to see a stint close and the next open on the sim's own
 * frames; what it shows is the rule, not how a real stop reads.
 *
 * Windows only, like the replay addon, and skipped where the tape is the
 * Git LFS pointer left in its place.
 */
const REPAIR = '/rest/garage/UIScreen/RepairAndRefuel';

const brakeThickness = LMU_REST_TASKS.find(
  (task) => task.path === REPAIR
)?.outputs.find((output) => output.id === 'brakeThickness');

interface Played {
  frames: number;
  ledger: PlayerLedgerSnapshot;
  stint: PlayerStintSnapshot;
  /** The rows oldest first. */
  rows: LedgerLap[];
  storedLaps: { session: LapSessionInput; lap: LapInput }[];
  storedStints: StintInput[];
  logs: string[];
  endFuel: number;
  endEnergy: number;
}

const play = async (
  transformRaw?: <T extends LmuRawTelemetry>(raw: T) => T
): Promise<Played> => {
  const storedLaps: Played['storedLaps'] = [];
  const storedStints: StintInput[] = [];
  const logs: string[] = [];
  let clock = Date.UTC(2026, 9, 7, 20, 0, 0);
  const runtime = new PlayerLedgerRuntime(
    new ChannelBus(),
    createSessionLifecycle(),
    { markStart: () => undefined, markEnd: () => undefined },
    {
      recordLap: (session, lap) => {
        storedLaps.push({ session, lap });
        return Promise.resolve(storedLaps.length);
      },
      upsertStint: (_session, input) => {
        storedStints.push(input);
      },
      recentLedgerLaps: () => Promise.resolve([]),
    },
    {
      simulator: 'lmu',
      bootId: 'tape',
      now: () => (clock += 1000),
      log: (message) => logs.push(message),
    }
  );

  // The disc thickness comes from the repair screen's REST answers, which
  // the recording holds; looked at four times a second, as nothing in them
  // moves faster.
  let restAt = Number.NEGATIVE_INFINITY;
  let restBody: string | null = null;
  let discs: number[] | undefined;
  let endFuel = 0;
  let endEnergy = 0;
  const { frames } = await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    // Fast enough to finish in seconds, slow enough that every recorded
    // frame is read.
    speed: 40,
    transformRaw,
    restCells: (raw, readRest) => {
      const now = raw.elapsedTime ?? raw.currentET;
      if (now - restAt >= 0.25 || now < restAt) {
        restAt = now;
        const body = readRest(REPAIR);
        if (body !== null && body !== restBody) {
          restBody = body;
          discs = brakeThickness?.parse(JSON.parse(body)) as
            number[] | undefined;
        }
      }
      return discs ? { brakeThickness: { value: discs } } : undefined;
    },
    onFrame: ({ telemetry, session, sessionChanged }) => {
      // As the bridge does: the frame first, then the session it came with.
      runtime.onFrame(telemetry);
      if (sessionChanged) runtime.onSession(session);
      const fuel = telemetry.FuelLevel?.value?.[0];
      if (typeof fuel === 'number') endFuel = fuel;
      const energy =
        telemetry.LmuCarIdxEnergyRemaining?.value?.[
          telemetry.PlayerCarIdx?.value?.[0] as number
        ];
      if (typeof energy === 'number') endEnergy = energy;
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const ledger = runtime.ledgerSnapshot();
  return {
    frames,
    ledger,
    stint: runtime.stintSnapshot(),
    rows: [...ledger.laps].reverse(),
    storedLaps,
    storedStints,
    logs,
    endFuel,
    endEnergy,
  };
};

/** The staged stop, on the session clock: in lap two of the recording. */
const STOP = {
  pitEntry: 250,
  standFrom: 255,
  tyresAt: 266,
  standTo: 277,
  pitExit: 290,
  litres: 40,
} as const;

/**
 * Stages a pit stop over the recorded driving: the player's car reads as in
 * the pit lane for forty seconds of its second lap, as standing still for
 * twenty-two of them, burning nothing, while forty litres go into the tank,
 * and as fitted with new front tyres half-way through. Everything else is
 * as recorded: the car goes on lapping, so the lap fraction, the burn
 * outside those twenty-two seconds and the wear are the recording's own.
 */
const stageStop = () => {
  let tyreOffset: number[] | null = null;
  /** The recorded level when the car comes to rest, and when it leaves. */
  let fuelAtRest: number | null = null;
  let fuelAfterRest: number | null = null;
  return <T extends LmuRawTelemetry>(raw: T): T => {
    const now = raw.elapsedTime;
    const player = raw.playerVehicleIdx;
    if (typeof now !== 'number' || raw.fuel === undefined || player < 0) {
      return raw;
    }
    if (now < STOP.pitEntry) return raw;
    const staged: T = { ...raw };
    if (now >= STOP.standFrom) {
      fuelAtRest ??= raw.fuel;
      if (now < STOP.standTo) {
        // At rest: the level only rises, by what the hose puts in.
        const filled = (now - STOP.standFrom) / (STOP.standTo - STOP.standFrom);
        staged.fuel = fuelAtRest + filled * STOP.litres;
        staged.speed = 0;
      } else {
        // Away again: the recorded burn, from the level the stop left.
        fuelAfterRest ??= raw.fuel;
        staged.fuel = raw.fuel + (fuelAtRest - fuelAfterRest) + STOP.litres;
      }
    }
    if (now < STOP.pitExit) {
      staged.vehInPits = Uint8Array.from(raw.vehInPits);
      staged.vehInPits[player] = 1;
    }
    if (now >= STOP.tyresAt && raw.tyreWear) {
      // New fronts: full tread at the change, wearing as recorded after it.
      tyreOffset ??= [1 - raw.tyreWear[0], 1 - raw.tyreWear[1]];
      staged.tyreWear = Float64Array.from(raw.tyreWear);
      staged.tyreWear[0] += tyreOffset[0];
      staged.tyreWear[1] += tyreOffset[1];
    }
    return staged;
  };
};

describe.skipIf(!lmuTapeAvailable())(
  'the player ledger on a recorded LMU race',
  () => {
    let race: Played;
    let staged: Played;
    beforeAll(async () => {
      race = await play();
      staged = await play(stageStop());
      // Twelve seconds on a quiet machine. The replay runs against the wall
      // clock, so a machine busy with every other spec takes far longer.
    }, 300_000);

    it('reads the whole recording', () => {
      expect(race.frames).toBeGreaterThan(10_000);
      expect(staged.frames).toBeGreaterThan(10_000);
    });

    it('makes a row of each of the two laps, the first from the rolling start', () => {
      expect(race.rows).toHaveLength(2);
      const [first, second] = race.rows;

      // Let go from the line at 143.0 s: the sim times this lap from the
      // green flag, eight seconds earlier, and the app from the line.
      expect(first.flags).toBe(LEDGER_LAP_FROM_START);
      expect(isCleanLap(first.flags)).toBe(false);
      expect(first.startTime).toBeCloseTo(143.0, 1);
      expect(first.lapTime).toBeCloseTo(89.83, 1);
      expect(first.simLapTime).toBeCloseTo(97.823, 3);
      expect(first.energyUsed).toBeCloseTo(0.0224, 3);
      expect(first.fuelUsed).toBeCloseTo(2.21, 1);
      expect(first).toMatchObject({ lapNumber: 1, stintLap: 1 });

      expect(second.flags).toBe(0);
      expect(second).toMatchObject({
        lapNumber: 2,
        stintLap: 2,
        sessionNum: race.ledger.sessionNum,
        incidents: null,
        fuelAdded: 0,
        energyAdded: 0,
        compounds: ['Medium', 'Medium', 'Medium', 'Medium'],
        wetness: 1,
        rain: 0,
        position: 26,
        classPosition: 2,
        // An LMGT3 has no hybrid battery.
        batteryDrainPct: null,
        batteryRegenPct: null,
      });
      expect(second.startTime).toBe(first.endTime);
      expect(second.endTime).toBeCloseTo(319.5, 1);
      // Line to line by the app's clock, and as the sim timed it: the two
      // lines are a couple of metres apart.
      expect(second.lapTime).toBeCloseTo(86.671, 2);
      expect(second.simLapTime).toBeCloseTo(86.66, 3);
    });

    it('measures what the second lap cost', () => {
      const [, lap] = race.rows;

      // 2.33 % of the virtual energy and 2.3 litres.
      expect(lap.energyUsed).toBeGreaterThan(0.0225);
      expect(lap.energyUsed).toBeLessThan(0.024);
      expect(lap.energyUsed).toBeCloseTo(0.02328, 4);
      expect(lap.fuelUsed).toBeGreaterThan(2.25);
      expect(lap.fuelUsed).toBeLessThan(2.36);
      expect(lap.fuelUsed).toBeCloseTo(2.303, 2);
      expect(lap.fuelAtLine).toBeCloseTo(40.285, 2);
      expect(lap.energyAtLine).toBeCloseTo(0.40433, 4);
      [0.97622, 0.97453, 0.97315, 0.97225].forEach((tread, wheel) =>
        expect(Math.abs((lap.treadAtLine[wheel] ?? 0) - tread)).toBeLessThan(
          0.0005
        )
      );
      // About half a percent of tread a lap, each corner.
      [0.00492, 0.00534, 0.00501, 0.00482].forEach((used, wheel) =>
        expect(Math.abs((lap.treadUsed[wheel] ?? 0) - used)).toBeLessThan(
          0.0003
        )
      );
      [35.9968, 35.9959, 31.9987, 31.9984].forEach((disc, wheel) =>
        expect(Math.abs((lap.brakeAtLine[wheel] ?? 0) - disc)).toBeLessThan(
          0.001
        )
      );
      // Two micrometres off the fronts and one off the rears.
      [0.0018, 0.0026, 0.0008, 0.001].forEach((used, wheel) =>
        expect(Math.abs((lap.brakeUsed[wheel] ?? 0) - used)).toBeLessThan(
          0.0003
        )
      );
      // The sim's own sectors, which add up to its lap time.
      expect(lap.sectors[0]).toBeCloseTo(32.739, 2);
      expect(lap.sectors[1]).toBeCloseTo(35.07, 2);
      expect(lap.sectors[2]).toBeCloseTo(18.851, 2);
    });

    it('keeps one stint, opened as the app joined, and still open at the end', () => {
      expect(race.ledger.stints).toEqual([]);
      const { stint } = race.stint;
      expect(race.stint).toMatchObject({
        available: true,
        state: 'running',
        budget: 'virtualEnergy',
      });
      expect(stint).toMatchObject({
        ordinal: 1,
        openedBy: 'joined',
        closedBy: null,
        own: true,
        startLap: 0,
        endLap: 2,
        laps: 2,
        // The lap from the rolling start is not a clean one.
        cleanLaps: 1,
        compounds: ['Medium', 'Medium', 'Medium', 'Medium'],
        passes: [],
        stop: null,
      });
      // The first frame the replay hands over, a moment into the recording.
      expect(stint?.startTime).toBeGreaterThan(139.9);
      expect(stint?.startTime).toBeLessThan(140.5);
      expect(stint?.startEnergy).toBeCloseTo(0.45, 3);
      expect(stint?.startFuel).toBeCloseTo(44.92, 1);
      expect(stint?.bestLap).toBeCloseTo(86.671, 2);
      // The discs are read from the sim's REST API, which answers a moment
      // after the stint opens: the start is the first answer.
      expect(stint?.startBrake[0]).toBeCloseTo(35.9998, 3);
      expect(stint?.startBrake[2]).toBeCloseTo(31.9999, 3);

      // Level against level, not the sum of the rows: the stretch after the
      // second lap counts.
      const energyUsed = (stint?.startEnergy ?? 0) - (stint?.endEnergy ?? 0);
      const fuelUsed = (stint?.startFuel ?? 0) - (stint?.endFuel ?? 0);
      expect(Math.abs(energyUsed - 0.0626)).toBeLessThan(0.002);
      expect(Math.abs(fuelUsed - 6.3)).toBeLessThan(0.1);
      expect(stint?.endFuel).toBeCloseTo(race.endFuel, 2);
      expect(stint?.endEnergy).toBeCloseTo(race.endEnergy, 4);

      // The one clean lap is the rate, and the energy runs out first.
      expect(race.stint.rates).toMatchObject({ source: 'stint' });
      expect(race.stint.rates.energy).toBeCloseTo(0.02328, 4);
      expect(race.stint.rates.fuel).toBeCloseTo(2.303, 2);
      expect(race.stint.budgetLapsLeft).toBeCloseTo(16.6, 1);
      expect(race.stint.lap).toMatchObject({ lapNumber: 3, stintLap: 3 });
      expect(race.logs).toHaveLength(1);
      expect(race.logs[0]).toMatch(
        /^\[Ledger\] Stint 1 opened \(joined\) at 1[34]\d\.\d s, lap 0: fuel 44\.9\d L, energy 45\.0 %, own$/
      );
    });

    it('hands both laps to the library with their ledger and stint', () => {
      expect(race.storedLaps).toHaveLength(2);
      const [first, second] = race.storedLaps;

      expect(first.session).toMatchObject({
        simulator: 'lmu',
        trackName: 'WeatherTech Raceway Laguna Seca',
        carKey: 'Ferrari 296 LMGT3 Evo',
        sessionType: 'Race',
      });
      // The lap from the start is kept, without a curve to be measured by.
      expect(first.lap).toMatchObject({
        complete: false,
        curve: null,
        own: true,
      });
      expect(first.lap.ledger?.flags).toBe(LEDGER_LAP_FROM_START);
      // So the library never takes it for a reference: only the lap driven
      // from line to line is fit to be one.
      expect(race.storedLaps.map(({ lap }) => isEligibleLap(lap))).toEqual([
        false,
        true,
      ]);
      expect(second.lap).toMatchObject({
        complete: true,
        pit: false,
        voided: false,
        own: true,
      });
      expect(second.lap.curve).not.toBeNull();
      expect(second.lap.fuelUsed).toBeCloseTo(2.303, 2);
      expect(second.lap.energyUsed).toBeCloseTo(0.02328, 4);
      expect(second.lap.ledger?.simLapTime).toBeCloseTo(86.66, 3);
      expect(second.lap.ledger?.stint?.stint).toMatchObject({
        id: race.rows[1].stintId,
        closedBy: null,
        laps: 2,
      });
      expect(race.rows.map((row) => row.id)).toEqual([1, 2]);
    });

    describe('with a pit stop staged over the same driving', () => {
      it('closes the stint at the pit entry and opens the next at the exit', () => {
        const { stints } = staged.ledger;
        expect(stints).toHaveLength(1);
        const [first] = stints;

        expect(first).toMatchObject({
          ordinal: 1,
          openedBy: 'joined',
          closedBy: 'service',
          startLap: 0,
          endLap: 1,
          laps: 1,
          cleanLaps: 0,
        });
        expect(first.endTime).toBeCloseTo(STOP.pitEntry, 1);
        // What it had on the way in, not what it left with.
        expect(first.endFuel).toBeCloseTo(42.14, 1);
        expect(first.endEnergy).toBeCloseTo(0.4231, 3);
        expect(first.endTread[0]).toBeCloseTo(0.9801, 3);
        expect(first.stop).toMatchObject({
          energyAdded: 0,
          tyresChanged: 0b0011,
          brakesChanged: false,
          driverChanged: false,
        });
        expect(first.stop?.fuelAdded).toBeCloseTo(STOP.litres, 1);
        expect(first.stop?.stationaryTime).toBeCloseTo(
          STOP.standTo - STOP.standFrom,
          1
        );
        expect(first.stop?.pitLaneTime).toBeCloseTo(
          STOP.pitExit - STOP.pitEntry,
          1
        );

        const open = staged.stint.stint;
        expect(open).toMatchObject({
          ordinal: 2,
          openedBy: 'pitExit',
          closedBy: null,
          startLap: 1,
          laps: 1,
        });
        expect(open?.startTime).toBeCloseTo(STOP.pitExit, 1);
        expect(open?.startFuel).toBeGreaterThan((first.endFuel ?? 0) + 39);
        // New fronts, a few corners old; the rears as they were.
        expect(open?.startTread[0]).toBeGreaterThan(0.998);
        expect(open?.startTread[2]).toBeCloseTo(0.9753, 3);
        expect(staged.logs).toHaveLength(3);
        expect(staged.logs[0]).toContain('Stint 1 opened (joined)');
        expect(staged.logs[1]).toMatch(
          /Stint 1 closed \(service\): 1 lap in 110 s; used fuel 2\.\d\d L, energy 2\.7 %; stop 22\.0 s standing: fuel (39\.9|40\.0)\d L, energy 0\.0 % added, tyres LF RF$/
        );
        expect(staged.logs[2]).toMatch(
          /Stint 2 opened \(pitExit\) at 290\.0 s, lap 1: fuel 8\d\.\d\d L/
        );
      });

      it('gives the lap with the stop in it to the new stint, with what went in', () => {
        const [first, second] = staged.rows;
        const plain = race.rows[1];

        expect(staged.rows).toHaveLength(2);
        expect(first.stintId).toBe(staged.ledger.stints[0].id);
        expect(first.flags).toBe(LEDGER_LAP_FROM_START);
        // It went onto pit road during the lap and closed after the exit.
        expect(second.stintId).toBe(staged.stint.stint?.id);
        expect(second.stintLap).toBe(1);
        expect(second.flags).toBe(LEDGER_LAP_IN_LAP | LEDGER_LAP_SERVICED);
        expect(second.fuelAdded).toBeCloseTo(STOP.litres, 1);
        // The recorded burn, less the 22 s it is staged as standing for.
        expect(second.fuelUsed).toBeGreaterThan(1.5);
        expect(second.fuelUsed).toBeLessThan(1.75);
        expect(second.energyUsed).toBeCloseTo(plain.energyUsed ?? 0, 6);
        // The fronts wore only what they drove on track; the change itself
        // is no wear. The rears are untouched by any of it.
        expect(second.treadUsed[0]).toBeGreaterThan(0.002);
        expect(second.treadUsed[0]).toBeLessThan(0.003);
        expect(second.treadAtLine[0]).toBeGreaterThan(0.997);
        expect(second.treadAtLine[2]).toBeCloseTo(plain.treadAtLine[2] ?? 0, 9);
        expect(
          staged.storedStints.map((input) => input.stint.closedBy)
        ).toEqual([null, 'service', null]);
      });
    });
  }
);
