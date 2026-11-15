import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createLmuRestPoller } from './poller';
import { createLmuRestData, type LmuRestData } from './state';
import { createLmuTapeRestTransport } from './tapeTransport';
import { at, LMU_PIT_STOP_PARTS, LMU_REST_TASKS } from './tasks';
import {
  carSetupOverviewFixture,
  pitstopEstimateFixture,
  pitstopEstimateLateFixture,
  repairAndRefuelDamagedFixture,
  repairAndRefuelFixture,
  sessionsFixture,
  weatherFixture,
} from './restFixture';

/**
 * What the curated recording says, read through the parsers.
 *
 * `test-data/telemetry/lmu-session.lmudt` is four minutes of an offline race
 * in an LMGT3 and holds the answers of five REST paths. The cases below pin
 * the figures the parsers were written against, so that a parser changed
 * later is held to what the sim sent rather than to a fixture, and the
 * fixtures themselves are held to the recording.
 *
 * A file of its own, beside tapeReplay.spec.ts and its synthetic tape,
 * because a process plays one tape only: a second tape named in the same
 * spec file is never opened, and the first is played again in its place.
 * The replay addon reads IRDASHIES_LMU_REPLAY through the C runtime, whose
 * copy of the environment is made the first time it is asked for and does
 * not follow what `process.env` is set to after that.
 *
 * Windows only, like the addon, and skipped where the tape is the Git LFS
 * pointer left in its place, as in CI.
 */
const addonPath = path.resolve(
  process.cwd(),
  'build',
  'Release',
  'lmu_tape_node.node'
);
const curatedTape = path.resolve(
  process.cwd(),
  'test-data',
  'telemetry',
  'lmu-session.lmudt'
);
const curated =
  fs.existsSync(addonPath) &&
  fs.existsSync(curatedTape) &&
  fs.statSync(curatedTape).size > 1024;

const ESTIMATE = '/rest/strategy/pitstop-estimate';
const REPAIR = '/rest/garage/UIScreen/RepairAndRefuel';
const SETUP = '/rest/garage/UIScreen/CarSetupOverview';
const SESSIONS = '/rest/sessions';
const WEATHER = '/rest/sessions/weather';
const RECORDED_PATHS = [ESTIMATE, REPAIR, SETUP, SESSIONS, WEATHER];

type Bodies = Record<string, string>;

interface CuratedSdk {
  start(): boolean;
  stop(): boolean;
  read(): {
    running?: boolean;
    playerHasVehicle?: boolean;
    playerVehicleIdx?: number;
    vehTotalLaps?: number[];
  };
  readRest(p: string): string | null;
}

/** Disc thickness per wheel in millimetres, as the task parses a body. */
const thicknessOf = (body: string): number[] => {
  const output = LMU_REST_TASKS.find(
    (task) => task.path === REPAIR
  )?.outputs.find((candidate) => candidate.id === 'brakeThickness');
  return (output?.parse(JSON.parse(body)) as number[] | undefined) ?? [];
};

/**
 * Holds a fixture to a recorded body: everything the fixture has must be in
 * the body, with the same value. Keys the fixture leaves out are the trim.
 *
 * A list is compared whole, except a list of named entries -- the pit menu --
 * which may leave entries out and is matched by name.
 */
const expectTrimmedCopy = (
  fixture: unknown,
  recorded: unknown,
  where: string
): void => {
  if (Array.isArray(fixture)) {
    expect(Array.isArray(recorded), where).toBe(true);
    const list = recorded as unknown[];
    const named =
      fixture.length > 0 &&
      fixture.every((entry) => typeof at(entry, ['name']) === 'string');
    if (named) {
      fixture.forEach((entry) => {
        const name = String(at(entry, ['name']));
        const match = list.find(
          (candidate) => at(candidate, ['name']) === name
        );
        expect(match, `${where}[${name}]`).toBeDefined();
        expectTrimmedCopy(entry, match, `${where}[${name}]`);
      });
      return;
    }
    expect(list.length, `${where}.length`).toBe(fixture.length);
    fixture.forEach((entry, index) =>
      expectTrimmedCopy(entry, list[index], `${where}[${index}]`)
    );
    return;
  }
  if (fixture !== null && typeof fixture === 'object') {
    expect(recorded !== null && typeof recorded === 'object', where).toBe(true);
    Object.entries(fixture).forEach(([key, value]) =>
      expectTrimmedCopy(
        value,
        (recorded as Record<string, unknown>)[key],
        `${where}.${key}`
      )
    );
    return;
  }
  expect(recorded, where).toBe(fixture);
};

/**
 * Runs the real poller, over the tape transport, against one moment of the
 * recording, and returns what landed.
 */
const pollOnce = async (bodies: Bodies): Promise<LmuRestData> => {
  const data = createLmuRestData();
  const poller = createLmuRestPoller({
    data,
    transport: createLmuTapeRestTransport({
      readRest: (restPath) => bodies[restPath] ?? null,
    }),
    tasks: LMU_REST_TASKS,
  });
  poller.setActive(true);
  await new Promise((resolve) => setTimeout(resolve, 100));
  poller.stop();
  return data;
};

describe.skipIf(!curated)('REST on the curated tape', () => {
  /** The first answer the recording holds for each path. */
  let first: Bodies = {};
  /** The last, four minutes on. */
  let last: Bodies = {};
  /** The first repair-screen answers, in order, each one a different body. */
  const repairAnswers: string[] = [];
  /** Disc thickness when the player crossed the line, once per lap. */
  const thicknessAtLapLines: number[][] = [];
  /** Across every repair-screen answer of the recording. */
  const stopLength = { compared: 0, worst: 0 };

  beforeAll(() => {
    process.env.IRDASHIES_LMU_REPLAY = curatedTape;
    process.env.IRDASHIES_LMU_REPLAY_SPEED = '100';
    process.env.IRDASHIES_LMU_REPLAY_LOOP = '0';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module_ = require(addonPath) as {
      LmuSdkNode: new () => CuratedSdk;
    };
    const sdk = new module_.LmuSdkNode();
    const bodies = (): Bodies =>
      Object.fromEntries(
        RECORDED_PATHS.map((restPath) => [
          restPath,
          sdk.readRest(restPath),
        ]).filter((entry): entry is [string, string] => entry[1] !== null)
      );
    const deadline = Date.now() + 240_000;
    sdk.start();

    // The tape moves only when it is read, and a REST record is taken up as
    // the reader passes it. So reading until the last of the five paths has
    // a body, and no further, leaves the first answer of each: the five
    // arrive within 45 ms of tape, and the second of any of them a quarter
    // of a second in.
    while (
      Date.now() < deadline &&
      RECORDED_PATHS.some((restPath) => sdk.readRest(restPath) === null)
    ) {
      sdk.read();
    }
    first = bodies();

    // Then to the end, noting what the recording says on the way.
    let repair = first[REPAIR];
    if (repair) repairAnswers.push(repair);
    let laps: number | undefined;
    let frames = 0;
    while (Date.now() < deadline) {
      const raw = sdk.read();
      if (!raw.running) {
        if (frames > 0) break;
        continue;
      }
      frames += 1;

      const body = sdk.readRest(REPAIR);
      if (body !== null && body !== repair) {
        repair = body;
        if (repairAnswers.length < 60) repairAnswers.push(body);
        // The estimate as it stood when the repair screen answered: the
        // answer just before it on the tape.
        const estimate = sdk.readRest(ESTIMATE);
        const length = at(JSON.parse(body), ['pitStopLength', 'timeInSeconds']);
        const total =
          estimate === null ? undefined : at(JSON.parse(estimate), ['total']);
        if (typeof length === 'number' && typeof total === 'number') {
          stopLength.compared += 1;
          stopLength.worst = Math.max(
            stopLength.worst,
            Math.abs(length - total)
          );
        }
      }

      const playerLaps =
        raw.playerHasVehicle && (raw.playerVehicleIdx ?? -1) >= 0
          ? raw.vehTotalLaps?.[raw.playerVehicleIdx ?? -1]
          : undefined;
      if (playerLaps === undefined) continue;
      if (laps !== undefined && playerLaps > laps && repair) {
        thicknessAtLapLines.push(thicknessOf(repair));
      }
      laps = playerLaps;
    }
    last = bodies();
    sdk.stop();
  }, 300_000);

  it('holds an answer for each of the five recorded paths', () => {
    expect(Object.keys(first).sort()).toEqual([...RECORDED_PATHS].sort());
    expect(Object.keys(last).sort()).toEqual([...RECORDED_PATHS].sort());
  });

  it('is what the fixtures were trimmed from', () => {
    // A fixture that drifted from the recording would test the parsers
    // against something the sim never sent.
    const recorded = (bodies: Bodies, restPath: string): unknown =>
      JSON.parse(bodies[restPath]);

    expectTrimmedCopy(
      pitstopEstimateFixture(),
      recorded(first, ESTIMATE),
      'estimate'
    );
    expectTrimmedCopy(
      pitstopEstimateLateFixture(),
      recorded(last, ESTIMATE),
      'estimate, late'
    );
    expectTrimmedCopy(
      repairAndRefuelFixture(),
      recorded(first, REPAIR),
      'repair'
    );
    expectTrimmedCopy(
      repairAndRefuelDamagedFixture(),
      recorded(last, REPAIR),
      'repair, damaged'
    );
    expectTrimmedCopy(
      carSetupOverviewFixture(),
      recorded(first, SETUP),
      'setup'
    );
    expectTrimmedCopy(sessionsFixture(), recorded(first, SESSIONS), 'sessions');
    expectTrimmedCopy(weatherFixture(), recorded(first, WEATHER), 'weather');
  });

  it('lands the pit stop the recording starts with', async () => {
    const { cells } = await pollOnce(first);

    // A splash of fuel and nothing else: the car is at the energy level the
    // menu asks for, so no energy goes in yet.
    expect(cells.pitStopTime?.value[0]).toBeCloseTo(2.4207, 4);
    expect(cells.pitStopParts?.value).toHaveLength(LMU_PIT_STOP_PARTS.length);
    expect(cells.pitStopParts?.value[0]).toBe(cells.pitStopTime?.value[0]);
    expect(cells.pitStopParts?.value.slice(1)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(cells.repairTime?.value).toEqual([0]);
    expect(cells.penaltySeconds?.value).toEqual([0]);
    // The repair screen's figure for the same stop, asked 15 ms later.
    expect(
      Math.abs(
        (cells.pitStopLength?.value[0] ?? 0) -
          (cells.pitStopTime?.value[0] ?? 0)
      )
    ).toBeLessThan(0.001);
    // A level of 45 %, at 1.03 litres to the percent.
    expect(cells.refuelTarget?.value).toEqual([45]);
    expect(cells.refuelTargetIsVirtualEnergy?.value).toEqual([true]);
    expect(cells.refuelRatio?.value).toEqual([1.03]);
  });

  it('lands an undamaged car on new discs', async () => {
    const { cells } = await pollOnce(first);
    const thickness = cells.brakeThickness?.value ?? [];

    // The 3.60 and 3.20 cm of the setup, less a fraction of a micrometre.
    [36, 36, 32, 32].forEach((mm, wheel) =>
      expect(thickness[wheel]).toBeCloseTo(mm, 3)
    );
    expect(cells.wearablesSeq?.value).toEqual([1]);
    expect(cells.suspensionDamage?.value).toEqual([0, 0, 0, 0]);
    expect(cells.aeroDamage?.value).toEqual([0]);
    // "N/A" in the menu: nothing to repair, so no choice.
    expect(cells.repairChoice).toBeUndefined();
  });

  it('lands the setup: new discs, the steering lock and no regeneration', async () => {
    const { cells, session } = await pollOnce(first);

    expect(session.brakeDiscNewMm).toEqual([36, 36, 32, 32]);
    expect(cells.steerLockDeg?.value).toEqual([476]);
    // An LMGT3 has no regeneration: the setting is listed with one position.
    expect(session.garage).toBeUndefined();
    expect(session.fuelRatio).toBe(1.03);
    expect(session.fuelLevelMax).toBe(120);
  });

  it('lands what pit work costs this car', async () => {
    const { session } = await pollOnce(first);
    const service = session.pitService ?? {};

    expect(Object.keys(service)).toHaveLength(22);
    // Litres a second, and a share of the energy budget a second.
    expect(service.fuelFillRate).toBeCloseTo(3.4, 6);
    expect(service.virtualEnergyFillRate).toBeCloseTo(0.025, 6);
    expect(service).toMatchObject({
      fuelInsert: 1,
      fuelRemove: 1,
      virtualEnergyInsert: 0,
      virtualEnergyRemove: 0,
      fourTireChange: 12,
      twoTireChange: 4.5,
      driverChange: 25,
      fixAeroDamage: 30,
      fixAllDamage: 30,
      brakeChange: 120,
      // What may run alongside other work.
      fuelTimeConcurrent: 1,
      virtualEnergyTimeConcurrent: 1,
      driverConcurrent: 1,
      tireTimeConcurrent: 0,
      fixTimeConcurrent: 0,
      brakeTimeConcurrent: 0,
      fuelRandomDelay: 2,
      randomTireDelay: 1,
      fixRandomDelay: 5,
      driverRandom: 2,
    });
    expect(session.maxFuel).toBe(120);
    expect(session.maxVirtualEnergy).toBe(775000000);
  });

  it('lands the session settings and the forecast with its humidity and wind', async () => {
    const { session, revision } = await pollOnce(first);
    const race = session.forecast?.race ?? [];

    expect(session.timeScale).toBe(1);
    expect(session.privateQualifying).toBe(true);
    expect(race.map((node) => node.skyType)).toEqual([0, 1, 1, 1, 2]);
    expect(race.map((node) => node.temperature)).toEqual([18, 17, 16, 16, 16]);
    expect(race.map((node) => node.rainChance)).toEqual([0, 0, 0, 0, 0]);
    expect(race.map((node) => node.humidity)).toEqual([
      0.56, 0.6, 0.62, 0.54, 0.57,
    ]);
    expect(race.map((node) => node.windSpeed)).toEqual([17, 17, 17, 14, 11]);
    expect(race.map((node) => node.windDirection)).toEqual([6, 7, 7, 7, 7]);
    [session.forecast?.practice, session.forecast?.qualify].forEach((nodes) => {
      expect(nodes).toHaveLength(5);
      nodes?.forEach((node) => {
        expect(node.humidity).toBeGreaterThan(0);
        expect(node.windSpeed).toBeGreaterThan(0);
        expect([6, 7]).toContain(node.windDirection);
      });
    });
    expect(revision).toBeGreaterThan(0);
  });

  it('lands the car as the recording leaves it, after a knock at the nose', async () => {
    const { cells, session } = await pollOnce(last);
    const thickness = cells.brakeThickness?.value ?? [];

    expect(cells.aeroDamage?.value[0]).toBeCloseTo(0.0268, 4);
    expect(cells.suspensionDamage?.value).toEqual([0, 0, 0, 0]);
    // The menu now offers a body repair and sits on leaving it.
    expect(cells.repairChoice?.value).toEqual(['Do Not Repair']);
    // Five and six micrometres off the fronts in four minutes.
    [35.995, 35.994, 31.998, 31.998].forEach((mm, wheel) =>
      expect(thickness[wheel]).toBeCloseTo(mm, 3)
    );
    // Fuel and energy both go in now, side by side: the stop is as long as
    // the longer of the two, not their sum.
    expect(cells.pitStopParts?.value[0]).toBeCloseTo(4.2705, 4);
    expect(cells.pitStopParts?.value[1]).toBeCloseTo(2.4992, 4);
    expect(cells.pitStopParts?.value.slice(2)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(cells.pitStopTime?.value[0]).toBe(cells.pitStopParts?.value[0]);
    expect(
      Math.abs(
        (cells.pitStopLength?.value[0] ?? 0) -
          (cells.pitStopTime?.value[0] ?? 0)
      )
    ).toBeLessThan(0.001);
    // The constants are the ones the recording started with.
    expect(session.pitService).toEqual(
      (await pollOnce(first)).session.pitService
    );
    expect(session.brakeDiscNewMm).toEqual([36, 36, 32, 32]);
    expect(cells.steerLockDeg?.value).toEqual([476]);
    expect(cells.refuelRatio?.value).toEqual([1.03]);
  });

  it('states the same stop on the repair screen as in the estimate, all the way through', () => {
    // Every answer of the repair screen against the estimate as it stood.
    expect(stopLength.compared).toBeGreaterThan(900);
    expect(stopLength.worst).toBeLessThan(0.001);
  });

  it('wears the discs as measured at the two lap lines', () => {
    const expected = [
      [35.9986, 35.9986, 31.9995, 31.9994],
      [35.9968, 35.9959, 31.9987, 31.9984],
    ];

    expect(thicknessAtLapLines).toHaveLength(expected.length);
    expected.forEach((line, lap) =>
      line.forEach((mm, wheel) =>
        expect(
          Math.abs(thicknessAtLapLines[lap][wheel] - mm),
          `lap ${lap + 1}, wheel ${wheel}`
        ).toBeLessThan(0.001)
      )
    );
  });

  it('marks every answer of the repair screen, though most repeat the thickness', async () => {
    // Sixty answers in a row, as the sim sent them, through the real poller
    // and the real task. The body moves on every one of them and the discs
    // on fewer than half, which is the case the mark is for; and the session
    // is left alone after the first, for all that the body moves.
    const repair = LMU_REST_TASKS.find((task) => task.path === REPAIR);
    if (!repair) throw new Error('no repair task');
    expect(repairAnswers).toHaveLength(60);
    const repeats = repairAnswers.filter(
      (body, index) =>
        index > 0 &&
        thicknessOf(body).join() ===
          thicknessOf(repairAnswers[index - 1]).join()
    ).length;

    vi.useFakeTimers();
    try {
      let served = 0;
      const data = createLmuRestData();
      const poller = createLmuRestPoller({
        data,
        transport: () =>
          Promise.resolve({ ok: true, body: repairAnswers[served++] }),
        tasks: [repair],
      });
      poller.setActive(true);
      await vi.advanceTimersByTimeAsync(0);
      const revision = data.revision;
      for (let answer = 1; answer < repairAnswers.length; answer += 1) {
        await vi.advanceTimersByTimeAsync(repair.baseIntervalMs);
      }
      poller.stop();

      expect(served).toBe(60);
      expect(repeats).toBeGreaterThan(30);
      expect(data.cells.wearablesSeq?.value).toEqual([60]);
      expect(data.revision).toBe(revision);
    } finally {
      vi.useRealTimers();
    }
  });
});
