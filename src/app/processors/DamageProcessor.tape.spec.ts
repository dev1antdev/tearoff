import { beforeAll, describe, expect, it } from 'vitest';
import type { DamageSnapshot, Session } from '@irdashies/types';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { createLmuRestData, type LmuRestCells } from '../lmu/rest/state';
import { LMU_REST_TASKS } from '../lmu/rest/tasks';
import {
  DAMAGE_IMPACT_HOLD_SECONDS,
  DAMAGE_MIN_IMPACT_MAGNITUDE,
  DamageProcessor,
} from './DamageProcessor';

/**
 * The damage channel on the recorded Le Mans Ultimate race: four minutes in
 * a Ferrari 296 LMGT3 that takes five impacts at the nose, the hardest of
 * which dents it.
 *
 * So this is the whole of what a recording confirms: a sound car, one light
 * dent at the front, where and when the impacts came, which of them are hard
 * enough to mark, and what the sim's repair screen and pit-stop estimate say
 * before and after. Nothing on it is detached, flat, overheating or bent, no
 * zone but the front is touched and no repair is chosen; those stand on the
 * unit spec and on TinyPedal's reading of the sim.
 *
 * The REST cells are made the way the app makes them: each answer the
 * recording holds goes through the tasks' own parsers as the replay reaches
 * it, without the poller's timers.
 *
 * The replay hands each frame out once and the session reads take a few
 * dozen of them, a different few on each run, so a moment is held to a few
 * hundredths of a second, not to the frame.
 *
 * Windows only, like the other tape specs.
 */

const REPAIR_SCREEN = '/rest/garage/UIScreen/RepairAndRefuel';
const ESTIMATE = '/rest/strategy/pitstop-estimate';
const REST_TASKS = LMU_REST_TASKS.filter(
  (task) => task.path === REPAIR_SCREEN || task.path === ESTIMATE
);

/**
 * The cells the poller would hold on each frame, from the answers the
 * recording has reached.
 */
const createTapeRestCells = () => {
  const data = createLmuRestData();
  const lastBody = new Map<string, string>();
  return (readRest: (path: string) => string | null): LmuRestCells => {
    for (const task of REST_TASKS) {
      const body = readRest(task.path);
      // As the poller does: an answer that repeats the one before is not
      // read again.
      if (body === null || body === lastBody.get(task.path)) continue;
      lastBody.set(task.path, body);
      const payload: unknown = JSON.parse(body);
      for (const output of task.outputs) {
        if (output.target !== 'telemetry') continue;
        const value = output.parse(payload);
        if (value !== undefined) output.apply(data, value);
      }
    }
    return data.cells;
  };
};

/** A snapshot as it stood when it was published. */
interface Publish {
  at: number;
  snapshot: DamageSnapshot;
}

/** One impact as the frame carried it. */
interface SeenImpact {
  at: number;
  time: number;
  magnitude: number;
}

interface Recording {
  frames: number;
  firstTime: number;
  lastTime: number;
  publishes: Publish[];
  impacts: SeenImpact[];
  final: DamageSnapshot | null;
}

const readRecording = async (): Promise<Recording> => {
  const processor = new DamageProcessor();
  const restCells = createTapeRestCells();
  const tape: Recording = {
    frames: 0,
    firstTime: Number.NaN,
    lastTime: Number.NaN,
    publishes: [],
    impacts: [],
    final: null,
  };
  let started = false;
  let lastVersion = -1;
  await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    speed: 20,
    restCells: (_raw, readRest) => restCells(readRest),
    onFrame: ({ telemetry, session, sessionTime }) => {
      if (!started) {
        started = true;
        processor.init(session as Session);
        processor.onLifecycle({ type: 'enter', replay: false });
        tape.firstTime = sessionTime;
      }
      tape.frames += 1;
      tape.lastTime = sessionTime;

      const time = telemetry.LmuLastImpactTime?.value[0];
      const magnitude = telemetry.LmuLastImpactMagnitude?.value[0];
      if (
        typeof time === 'number' &&
        typeof magnitude === 'number' &&
        time > 0 &&
        tape.impacts.at(-1)?.time !== time
      ) {
        tape.impacts.push({ at: sessionTime, time, magnitude });
      }

      // Every frame: the processor is an event one, as in the app.
      processor.onFrame(telemetry);
      const snapshot = processor.snapshot();
      if (snapshot.version !== lastVersion) {
        lastVersion = snapshot.version;
        tape.publishes.push({
          at: sessionTime,
          snapshot: structuredClone(snapshot),
        });
      }
    },
  });
  tape.final = structuredClone(processor.snapshot());
  return tape;
};

/** A moment on the session clock, give or take the frames a run may miss. */
const MOMENT = 0.06;

const expectAt = (actual: number, expected: number, tolerance = MOMENT) =>
  expect(
    Math.abs(actual - expected),
    `${actual} is not within ${tolerance} of ${expected}`
  ).toBeLessThanOrEqual(tolerance);

/** The first frame and each one on which a value changed. */
const changesOf = <T>(
  publishes: readonly Publish[],
  read: (snapshot: DamageSnapshot) => T
): { at: number; value: T }[] => {
  const changes: { at: number; value: T }[] = [];
  for (const { at, snapshot } of publishes) {
    const value = read(snapshot);
    const last = changes.at(-1);
    if (last && JSON.stringify(last.value) === JSON.stringify(value)) continue;
    changes.push({ at, value });
  }
  return changes;
};

/** The snapshot in force at a moment of the recording. */
const stateAt = (
  publishes: readonly Publish[],
  sessionTime: number
): DamageSnapshot => {
  const held = publishes.filter(({ at }) => at <= sessionTime).at(-1);
  if (!held) throw new Error(`Nothing published by ${sessionTime}`);
  return held.snapshot;
};

/** The three knocks; the recording's other two impacts are brushes. */
const FIRST_KNOCK = 147.2;
const DENTING_KNOCK = 240.72;
const THIRD_KNOCK = 278.34;

describe.skipIf(!lmuTapeAvailable())(
  'the damage channel on a recorded LMU race',
  () => {
    let tape: Recording;

    beforeAll(async () => {
      tape = await readRecording();
    }, 120_000);

    it('sees the recording from end to end, and publishes only on change', () => {
      expect(tape.frames).toBeGreaterThan(14_900);
      expectAt(tape.firstTime, 139.92);
      expectAt(tape.lastTime, 379.9);
      // Four minutes at a hundred frames a second, and a few dozen
      // snapshots: the car arriving, the REST answers, the tread wearing
      // down a per cent or two, the dent and the impact marks.
      expect(tape.publishes.length).toBeGreaterThan(6);
      expect(tape.publishes.length).toBeLessThan(40);
    });

    it('has a car to describe on every snapshot', () => {
      expect(tape.publishes.map(({ snapshot }) => snapshot.available)).toEqual(
        tape.publishes.map(() => true)
      );
      expect(tape.publishes.at(-1)?.snapshot.sessionNum).toBe(
        tape.publishes[0].snapshot.sessionNum
      );
    });

    it('is undamaged until the first impact', () => {
      const before = stateAt(tape.publishes, FIRST_KNOCK - 0.1);

      expect(before.body).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
      expect(before.bodyIntegrity).toBe(1);
      expect(before.wheels).toEqual([
        { detached: false, punctured: false, suspensionDamage: 0 },
        { detached: false, punctured: false, suspensionDamage: 0 },
        { detached: false, punctured: false, suspensionDamage: 0 },
        { detached: false, punctured: false, suspensionDamage: 0 },
      ]);
      expect(before.aeroIntegrity).toBe(1);
      expect(before.suspensionIntegrity).toBe(1);
      // Tread at 98.4 % when the recording begins, seven minutes into the
      // race.
      expect(before.tyreIntegrity).toBeGreaterThanOrEqual(0.97);
      expect(before.tyreIntegrity).toBeLessThanOrEqual(0.99);
      expect(before.overheating).toBe(false);
      // The sim holds zeros until the first impact: nothing to mark.
      expect(before.impactBearingRad).toBeNull();
      // "N/A" in the pit menu, and no repair in the estimate.
      expect(before.repairChoice).toBeNull();
      expect(before.repairSeconds).toBe(0);
    });

    it('has the REST figures within a moment of the first frame', () => {
      // The recording holds the repair screen and the estimate from 45 ms
      // in, so the first snapshot may lack them and the second does not.
      const answered = tape.publishes.find(
        ({ snapshot }) =>
          snapshot.aeroIntegrity !== null && snapshot.repairSeconds !== null
      );

      expect(answered).toBeDefined();
      expectAt(answered?.at ?? Number.NaN, tape.firstTime, 0.5);
    });

    it('dents the front zone, and only that, at 240.73 s', () => {
      expect(
        changesOf(tape.publishes, (snapshot) => snapshot.body).map(
          ({ value }) => value
        )
      ).toEqual([
        [0, 0, 0, 0, 0, 0, 0, 0],
        [1, 0, 0, 0, 0, 0, 0, 0],
      ]);
      const [, dent] = changesOf(tape.publishes, (snapshot) => snapshot.body);
      expectAt(dent.at, 240.73);
      // 1 - 1/16.
      expect(stateAt(tape.publishes, dent.at).bodyIntegrity).toBe(0.94);
      expect(tape.final?.body).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
      expect(tape.final?.bodyIntegrity).toBe(0.94);
    });

    it('carries five impacts, three of them hard enough to mark', () => {
      // The fourth stands for one frame before the fifth replaces it, and a
      // run may not see it.
      expect([4, 5]).toContain(tape.impacts.length);
      const marked = tape.impacts.filter(
        ({ magnitude }) => magnitude >= DAMAGE_MIN_IMPACT_MAGNITUDE
      );
      const brushes = tape.impacts.filter(
        ({ magnitude }) => magnitude < DAMAGE_MIN_IMPACT_MAGNITUDE
      );

      expect(marked.map(({ time }) => Number(time.toFixed(2)))).toEqual([
        FIRST_KNOCK,
        DENTING_KNOCK,
        THIRD_KNOCK,
      ]);
      expect(marked.map(({ magnitude }) => Math.round(magnitude))).toEqual([
        1423, 3017, 1233,
      ]);
      // Two brushes 20 ms apart at 285 s, of 40 and 63: a kerb or the floor.
      for (const brush of brushes) {
        expectAt(brush.time, 284.99, 0.02);
        expect(brush.magnitude).toBeLessThan(70);
      }
      expect(brushes.at(-1)?.magnitude).toBeCloseTo(63, 0);
    });

    it('marks each knock for fifteen seconds, from where it came', () => {
      const marks = changesOf(
        tape.publishes,
        (snapshot) => snapshot.impactBearingRad
      );

      expect(marks.map(({ value }) => value)).toEqual([
        null,
        // 26 degrees: the right-hand corner of the nose.
        0.46,
        null,
        // 13 degrees: the one that left the dent.
        0.23,
        null,
        // 359 degrees: square on the nose.
        6.26,
        null,
      ]);
      const [, first, firstOut, second, secondOut, third, thirdOut] = marks;
      // Each shows on the frame after the sim stamps it.
      expectAt(first.at, FIRST_KNOCK + 0.01);
      expectAt(firstOut.at, FIRST_KNOCK + DAMAGE_IMPACT_HOLD_SECONDS);
      expectAt(second.at, DENTING_KNOCK + 0.01);
      expectAt(secondOut.at, DENTING_KNOCK + DAMAGE_IMPACT_HOLD_SECONDS);
      expectAt(third.at, THIRD_KNOCK + 0.01);
      // The two brushes at 285 s neither move the mark nor restart it: it
      // goes out fifteen seconds after the knock, at 293.34 s, not at 300.
      expectAt(thirdOut.at, THIRD_KNOCK + DAMAGE_IMPACT_HOLD_SECONDS);
    });

    it('shows the dent on the frame its impact is marked', () => {
      const dent = changesOf(tape.publishes, (snapshot) => snapshot.body)[1];
      const marked = stateAt(tape.publishes, dent.at);

      expect(marked.impactBearingRad).toBe(0.23);
      // And the body is still clean under the first mark.
      expect(stateAt(tape.publishes, FIRST_KNOCK + 5).body).toEqual([
        0, 0, 0, 0, 0, 0, 0, 0,
      ]);
    });

    it('loses three per cent of aero with the dent, in the next REST answer', () => {
      const aero = changesOf(
        tape.publishes,
        (snapshot) => snapshot.aeroIntegrity
      ).filter(({ value }) => value !== null);

      // 0.0268 of damage, a quarter of a second after the impact.
      expect(aero.map(({ value }) => value)).toEqual([1, 0.97]);
      expect(aero[1].at).toBeGreaterThan(DENTING_KNOCK);
      expect(aero[1].at).toBeLessThan(DENTING_KNOCK + 1);
      // None of the three later impacts moves it.
      expect(tape.final?.aeroIntegrity).toBe(0.97);
    });

    it('is offered a body repair from then on, and is not told to make it', () => {
      const choices = changesOf(
        tape.publishes,
        (snapshot) => snapshot.repairChoice
      );

      expect(choices.map(({ value }) => value)).toEqual([
        null,
        'Do Not Repair',
      ]);
      expect(choices[1].at).toBeGreaterThan(DENTING_KNOCK);
      expect(choices[1].at).toBeLessThan(DENTING_KNOCK + 1);
      // With the menu on "Do Not Repair" the estimate spends nothing on
      // repairs, before the dent or after it.
      expect(
        changesOf(tape.publishes, (snapshot) => snapshot.repairSeconds)
          .map(({ value }) => value)
          .filter((value) => value !== null)
      ).toEqual([0]);
      expect(tape.final?.repairChoice).toBe('Do Not Repair');
      expect(tape.final?.repairSeconds).toBe(0);
    });

    it('never bends the suspension, loses a part, flattens a tyre or overheats', () => {
      for (const { snapshot } of tape.publishes) {
        expect(snapshot.overheating).toBe(false);
        expect(snapshot.suspensionIntegrity ?? 1).toBe(1);
        for (const wheel of snapshot.wheels) {
          expect(wheel.detached).toBe(false);
          expect(wheel.punctured).toBe(false);
          expect(wheel.suspensionDamage ?? 0).toBe(0);
        }
        // Level 3 is bodywork that has come off.
        expect(snapshot.body).not.toContain(3);
      }
    });

    it('ends with the dent, the aero down and the tyres a little worn', () => {
      expect(tape.final).toMatchObject({
        available: true,
        body: [1, 0, 0, 0, 0, 0, 0, 0],
        bodyIntegrity: 0.94,
        aeroIntegrity: 0.97,
        suspensionIntegrity: 1,
        overheating: false,
        impactBearingRad: null,
        repairSeconds: 0,
        repairChoice: 'Do Not Repair',
      });
      expect(tape.final?.tyreIntegrity).toBeGreaterThanOrEqual(0.95);
      expect(tape.final?.tyreIntegrity).toBeLessThanOrEqual(0.98);
    });
  }
);
