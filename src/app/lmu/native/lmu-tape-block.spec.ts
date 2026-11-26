import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { LmuRawSession, LmuRawTelemetry } from './index';
import { lmuPublishedBlock } from '../ownEntryBlock';
import { lmuRawWithoutPlayerVehicle } from '../../../testing/lmuTape';

/**
 * Pins the slot argument of the addon's `read` and `readSession` on the
 * recorded Le Mans Ultimate race: which telemetry block the single-car
 * fields come from, what the result says about it, and what a block holds
 * for a car the player is not in.
 *
 * The replay addon is the production lmu_node.cc over a tape, so this is the
 * argument handling and the block lookup themselves being checked.
 *
 * The recording is four minutes of an offline race: 38 cars in slots 0 to
 * 37, the player in slot 0 in an LMGT3, every other car the AI's. Slots 1
 * and 5 are LMP2s, which run on fuel alone; slot 20 is another LMGT3, on
 * virtual energy. So what a block holds for "another car" is, here, what it
 * holds for a car the AI is driving on this machine. What the sim sends for
 * a car a person is driving on another machine is not on this recording.
 *
 * The replay hands each recorded frame out once, in order, so the reads
 * below take turns over the recording: every kind of read sees a frame in
 * every dozen or so, from the first second to the last.
 *
 * Windows only, like the other tape specs.
 */

const addonPath = path.resolve('build/Release/lmu_tape_node.node');
const tapePath = path.resolve('test-data/telemetry/lmu-session.lmudt');
const available =
  fs.existsSync(addonPath) &&
  fs.existsSync(tapePath) &&
  fs.statSync(tapePath).size > 1024;

const PLAYER_SLOT = 0;
/** Two LMP2s and an LMGT3, each driven by the AI. */
const AI_SLOTS = [1, 5, 20] as const;
/** No car holds it: the grid ends at slot 37. */
const EMPTY_SLOT = 50;

interface Sdk {
  start(): boolean;
  stop(): boolean;
  read(...args: unknown[]): LmuRawTelemetry;
  readSession(...args: unknown[]): LmuRawSession;
}

/**
 * The reads that take turns, in this order, each with the name the cases
 * know it under and the arguments it is made with.
 */
const READS: readonly (readonly [string, readonly unknown[]])[] = [
  ['no argument', []],
  ['undefined', [undefined]],
  ['null', [null]],
  ['the player’s slot', [PLAYER_SLOT]],
  ['slot 1', [1]],
  ['slot 5', [5]],
  ['slot 20', [20]],
  ['an empty slot', [EMPTY_SLOT]],
  ['-1', [-1]],
  ['the slot past the last', [104]],
  ['1000', [1000]],
  ['1.5', [1.5]],
  ['NaN', [Number.NaN]],
  ['Infinity', [Number.POSITIVE_INFINITY]],
  ['a string', ['1']],
  ['an object', [{}]],
  ['true', [true]],
];
const READ_NAMES = READS.map(([name]) => name);
const PLAYER_READS = READ_NAMES.slice(0, 4);
const NO_BLOCK_READS = READ_NAMES.slice(7);

/** A snapshot with a block in it: the fields the cases below read. */
type BlockFrame = LmuRawTelemetry &
  Required<
    Pick<
      LmuRawTelemetry,
      | 'blockSlot'
      | 'gear'
      | 'maxGears'
      | 'engineRPM'
      | 'engineMaxRPM'
      | 'engineWaterTemp'
      | 'engineOilTemp'
      | 'filteredThrottle'
      | 'filteredSteering'
      | 'fuel'
      | 'fuelCapacity'
      | 'virtualEnergy'
      | 'lapNumber'
      | 'elapsedTime'
      | 'speed'
      | 'pos'
      | 'vehicleName'
      | 'absMax'
      | 'tcMax'
      | 'tcSlipMax'
      | 'tcCutMax'
      | 'motorMapMax'
      | 'migrationMax'
      | 'frontAntiSwayMax'
      | 'rearAntiSwayMax'
      | 'wiperState'
      | 'physicalSteeringWheelRange'
      | 'visualSteeringWheelRange'
      | 'tyrePressure'
      | 'tyreWear'
      | 'brakePressure'
      | 'tyreSurfaceTemperatureRaw'
      | 'tyreInnerLayerTemperatureRaw'
      | 'tyreCarcassTemperatureRaw'
      | 'brakeTemperatureRaw'
      | 'tyreStaticRadius'
      | 'vehSpeed'
      | 'vehLapNumber'
      | 'vehElapsedTime'
      | 'vehVirtualEnergy'
      | 'vehControl'
    >
  >;

interface Range {
  min: number;
  max: number;
}

const emptyRange = (): Range => ({ min: Infinity, max: -Infinity });

const widen = (range: Range, value: number) => {
  range.min = Math.min(range.min, value);
  range.max = Math.max(range.max, value);
};

const widenAll = (range: Range, values: Iterable<number>) => {
  for (const value of values) widen(range, value);
};

/** What one kind of read came back with, over the whole recording. */
interface Seen {
  frames: number;
  /** The last snapshot, for the cases that look at its keys. */
  last: LmuRawTelemetry | undefined;
  blockSlots: Set<number | undefined>;
  /** Frames on which the sim's own word about the player was not as recorded. */
  playerMisreported: number;
  /** Frames carrying any of the single-car fields. */
  withBlockFields: number;
  /** Frames whose per-car arrays did not cover the grid of 38. */
  shortArrays: number;
  keyCounts: Set<number>;
  /** Frames whose block disagreed with the per-car arrays for its slot. */
  disagreed: number;
  names: Set<string>;
  staticRadii: Set<string>;
  firstClock: number;
  clock: Range;
  gear: Range;
  maxGears: Range;
  /** Speed in each gear, m/s. */
  speedInGear: Record<number, Range>;
  /** For the correlation of gear with speed. */
  sums: { x: number; y: number; xx: number; yy: number; xy: number };
  revs: Range;
  revLimit: Range;
  water: Range;
  oil: Range;
  throttle: Range;
  steering: Range;
  fuel: Range;
  tank: Range;
  virtualEnergy: Range;
  wear: Range;
  brakeTemperature: Range;
  tyreTemperature: Range;
  tyrePressure: Range;
  brakePressure: Range;
  dialMaxima: Range;
  wiper: Range;
  physicalRange: Range;
  visualRange: Range;
  control: Set<number>;
}

const emptySeen = (): Seen => ({
  frames: 0,
  last: undefined,
  blockSlots: new Set(),
  playerMisreported: 0,
  withBlockFields: 0,
  shortArrays: 0,
  keyCounts: new Set(),
  disagreed: 0,
  names: new Set(),
  staticRadii: new Set(),
  firstClock: Number.NaN,
  clock: emptyRange(),
  gear: emptyRange(),
  maxGears: emptyRange(),
  speedInGear: {},
  sums: { x: 0, y: 0, xx: 0, yy: 0, xy: 0 },
  revs: emptyRange(),
  revLimit: emptyRange(),
  water: emptyRange(),
  oil: emptyRange(),
  throttle: emptyRange(),
  steering: emptyRange(),
  fuel: emptyRange(),
  tank: emptyRange(),
  virtualEnergy: emptyRange(),
  wear: emptyRange(),
  brakeTemperature: emptyRange(),
  tyreTemperature: emptyRange(),
  tyrePressure: emptyRange(),
  brakePressure: emptyRange(),
  dialMaxima: emptyRange(),
  wiper: emptyRange(),
  physicalRange: emptyRange(),
  visualRange: emptyRange(),
  control: new Set(),
});

const hasBlock = (frame: LmuRawTelemetry): frame is BlockFrame =>
  frame.gear !== undefined && frame.pos !== undefined;

const observe = (seen: Seen, frame: LmuRawTelemetry) => {
  seen.frames += 1;
  seen.last = frame;
  seen.blockSlots.add(frame.blockSlot);
  seen.keyCounts.add(Object.keys(frame).length);
  if (!frame.playerHasVehicle || frame.playerVehicleIdx !== PLAYER_SLOT) {
    seen.playerMisreported += 1;
  }
  if (frame.vehSpeed?.length !== 38 || frame.vehLapDistPct.length !== 38) {
    seen.shortArrays += 1;
  }
  if (!hasBlock(frame)) {
    if (frame.engineRPM !== undefined || frame.speed !== undefined) {
      seen.withBlockFields += 1;
    }
    return;
  }
  seen.withBlockFields += 1;

  const slot = frame.blockSlot;
  // The same block, read a second way: the per-car arrays take these five
  // from each car's telemetry block as well.
  if (
    frame.speed !== frame.vehSpeed[slot] ||
    frame.lapNumber !== frame.vehLapNumber[slot] ||
    frame.elapsedTime !== frame.vehElapsedTime[slot] ||
    frame.pos[0] !== frame.vehPosX[slot] ||
    frame.pos[2] !== frame.vehPosZ[slot] ||
    frame.virtualEnergy !== frame.vehVirtualEnergy[slot]
  ) {
    seen.disagreed += 1;
  }
  seen.control.add(frame.vehControl[slot]);
  seen.names.add(frame.vehicleName);
  seen.staticRadii.add(Array.from(frame.tyreStaticRadius).join(','));
  if (Number.isNaN(seen.firstClock)) seen.firstClock = frame.elapsedTime;
  widen(seen.clock, frame.elapsedTime);
  widen(seen.gear, frame.gear);
  widen(seen.maxGears, frame.maxGears);
  widen((seen.speedInGear[frame.gear] ??= emptyRange()), frame.speed);
  seen.sums.x += frame.speed;
  seen.sums.y += frame.gear;
  seen.sums.xx += frame.speed * frame.speed;
  seen.sums.yy += frame.gear * frame.gear;
  seen.sums.xy += frame.speed * frame.gear;
  widen(seen.revs, frame.engineRPM);
  widen(seen.revLimit, frame.engineMaxRPM);
  widen(seen.water, frame.engineWaterTemp);
  widen(seen.oil, frame.engineOilTemp);
  widen(seen.throttle, frame.filteredThrottle);
  widen(seen.steering, frame.filteredSteering);
  widen(seen.fuel, frame.fuel);
  widen(seen.tank, frame.fuelCapacity);
  widen(seen.virtualEnergy, frame.virtualEnergy);
  widenAll(seen.wear, frame.tyreWear);
  widenAll(seen.brakeTemperature, frame.brakeTemperatureRaw);
  widenAll(seen.tyreTemperature, frame.tyreSurfaceTemperatureRaw);
  widenAll(seen.tyreTemperature, frame.tyreInnerLayerTemperatureRaw);
  widenAll(seen.tyreTemperature, frame.tyreCarcassTemperatureRaw);
  widenAll(seen.tyrePressure, frame.tyrePressure);
  widenAll(seen.brakePressure, frame.brakePressure);
  for (const maximum of [
    frame.absMax,
    frame.tcMax,
    frame.tcSlipMax,
    frame.tcCutMax,
    frame.motorMapMax,
    frame.migrationMax,
    frame.frontAntiSwayMax,
    frame.rearAntiSwayMax,
  ]) {
    widen(seen.dialMaxima, maximum);
  }
  widen(seen.wiper, frame.wiperState);
  widen(seen.physicalRange, frame.physicalSteeringWheelRange);
  widen(seen.visualRange, frame.visualSteeringWheelRange);
};

/** How closely gear follows speed, -1 to 1. */
const gearSpeedCorrelation = ({ frames, sums }: Seen): number => {
  const covariance = sums.xy / frames - (sums.x / frames) * (sums.y / frames);
  const speedVariance = sums.xx / frames - (sums.x / frames) ** 2;
  const gearVariance = sums.yy / frames - (sums.y / frames) ** 2;
  return covariance / Math.sqrt(speedVariance * gearVariance);
};

interface Recording {
  /** False when the read stopped at its deadline rather than the tape's end. */
  complete: boolean;
  /**
   * The first two clocks the tape handed out after start(), in order.
   *
   * Taken by reading until the clock moves, because the tape repeats its last
   * snapshot until the next frame's moment comes round -- at the speed these
   * specs play at, that moment is a fifth of a millisecond away, so whether
   * one read lands before or after it says nothing about the tape.
   */
  firstTwo: number[];
  seen: Record<string, Seen>;
  /** Session reads taken part-way through, by the argument they were given. */
  sessions: Record<string, LmuRawSession>;
}

const emptyRecording = (): Recording => ({
  complete: false,
  firstTwo: [],
  seen: Object.fromEntries(READ_NAMES.map((name) => [name, emptySeen()])),
  sessions: {},
});

/** Reads the whole tape once, the kinds of read taking turns. */
const readRecording = async (): Promise<Recording> => {
  vi.stubEnv('IRDASHIES_LMU_REPLAY', tapePath);
  vi.stubEnv('IRDASHIES_LMU_REPLAY_SPEED', '100');
  vi.stubEnv('IRDASHIES_LMU_REPLAY_LOOP', '0');
  const { LmuSdkNode } = createRequire(import.meta.url)(addonPath) as {
    LmuSdkNode: new () => Sdk;
  };
  const sdk = new LmuSdkNode();
  const tape = emptyRecording();
  try {
    if (!sdk.start()) return tape;
    // The recording's first two frames, by reading until the clock moves
    // rather than by trusting how long the first read takes.
    const probeDeadline = performance.now() + 10_000;
    while (tape.firstTwo.length < 2 && performance.now() < probeDeadline) {
      const frame = sdk.read();
      const clock = frame.elapsedTime;
      if (!frame.running || clock === undefined) continue;
      if (tape.firstTwo.length === 0 || clock !== tape.firstTwo[0]) {
        tape.firstTwo.push(clock);
      }
    }
    const deadline = performance.now() + 100_000;
    let reads = 0;
    while (!tape.complete && performance.now() < deadline) {
      const [name, args] = READS[reads % READS.length];
      const frame = sdk.read(...args);
      if (!frame.running) {
        // Not running before the first frame is the tape still opening;
        // after it, the tape has run out.
        if (reads > 0) tape.complete = true;
        else await new Promise((resolve) => setTimeout(resolve, 2));
        continue;
      }
      reads += 1;
      observe(tape.seen[name], frame);
      // The session reads, once the tape is well under way.
      if (reads === 2_000) {
        tape.sessions.none = sdk.readSession();
        tape.sessions.ai = sdk.readSession(AI_SLOTS[1]);
        tape.sessions.empty = sdk.readSession(EMPTY_SLOT);
      }
    }
  } finally {
    sdk.stop();
    vi.unstubAllEnvs();
  }
  return tape;
};

const keysOf = (snapshot: object | undefined): string[] =>
  Object.keys(snapshot ?? {}).sort();

describe.skipIf(!available)(
  'LMU telemetry blocks by slot on a recorded race',
  () => {
    let tape = emptyRecording();
    const seen = (name: string) => tape.seen[name];

    beforeAll(async () => {
      tape = await readRecording();
    }, 120_000);

    it('reads the recording to its end, every kind of read throughout', () => {
      expect(tape.complete).toBe(true);
      for (const name of READ_NAMES) {
        expect(seen(name).frames, name).toBeGreaterThan(300);
      }
    });

    describe('with no slot asked for', () => {
      it.each(PLAYER_READS)('gives the player’s block for %s', (name) => {
        const read = seen(name);

        expect([...read.blockSlots]).toEqual([PLAYER_SLOT]);
        expect(read.withBlockFields).toBe(read.frames);
        expect(read.disagreed).toBe(0);
        expect([...read.control]).toEqual([0]);
        // The player's own LMGT3, as the other native specs have it: its
        // entry, its wheels at 34 and 36 cm, the wipers at 1, no physical
        // wheel range, and the dials and temperatures only the player's
        // car is given.
        expect([...read.names]).toEqual(['Kessel Racing 2026 #74:ELMS']);
        expect([...read.staticRadii]).toEqual(['34,34,36,36']);
        expect(read.wiper).toEqual({ min: 1, max: 1 });
        expect(read.physicalRange).toEqual({ min: 0, max: 0 });
        expect(read.visualRange).toEqual({ min: 719, max: 719 });
        expect(read.tank).toEqual({ min: 120, max: 120 });
        expect(read.revLimit).toEqual({ min: 8000, max: 8000 });
        expect(read.water.min).toBeGreaterThan(70);
        expect(read.tyreTemperature.min).toBeGreaterThan(300);
        expect(read.tyrePressure.min).toBeGreaterThan(160);
        // ABS to 9 and traction control to 11, with the smaller dials.
        expect(read.dialMaxima.max).toBe(11);
      });

      it('starts at the recording’s first frame and carries on from there', () => {
        // start() takes the first recorded frame and the tape repeats it
        // until the second one is due, so the pair below is the recording's
        // own beginning: no frame before it, and the next one a frame later.
        // lmu-tape-exports.spec.ts pins the same clock. Reading until the
        // clock moves, rather than trusting the first read's timing, is what
        // keeps a loaded machine from choosing which frame the read sees.
        expect(tape.firstTwo).toHaveLength(2);
        expect(tape.firstTwo[0]).toBeCloseTo(139.9125, 3);
        expect(tape.firstTwo[1]).toBeCloseTo(139.9325, 3);
        expect(seen('no argument').clock.max).toBeGreaterThan(379);
      });

      it('gives a snapshot of one shape however the absence is spelt', () => {
        const keys = keysOf(seen('no argument').last);

        expect(keys).toContain('blockSlot');
        expect(keysOf(seen('undefined').last)).toEqual(keys);
        expect(keysOf(seen('null').last)).toEqual(keys);
        expect(keysOf(seen('the player’s slot').last)).toEqual(keys);
        for (const name of PLAYER_READS) {
          expect(seen(name).keyCounts.size, name).toBe(1);
        }
      });
    });

    describe.each(AI_SLOTS)(
      'asked for slot %i, a car the AI drives',
      (slot) => {
        const name = `slot ${slot}`;

        it('gives that car’s block, and says so', () => {
          const read = seen(name);

          expect([...read.blockSlots]).toEqual([slot]);
          expect(read.withBlockFields).toBe(read.frames);
          expect([...read.control]).toEqual([1]);
          // Its speed, lap, clock, position and energy are the ones the
          // per-car arrays hold for the slot, on every frame.
          expect(read.disagreed).toBe(0);
          // One car, and not the player's.
          expect(read.names.size).toBe(1);
          expect([...read.names][0]).not.toBe('Kessel Racing 2026 #74:ELMS');
          // The same shape as the player's block.
          expect(keysOf(read.last)).toEqual(keysOf(seen('no argument').last));
        });

        it('goes on reporting the sim’s own word about the player', () => {
          expect(seen(name).playerMisreported).toBe(0);
        });

        it('carries a gear that goes with the car’s speed', () => {
          const read = seen(name);

          // No per-car array carries a gear to compare with. It is a whole
          // gear of the car's six, it follows the car's speed, first is never
          // held at 160 km/h and fourth and up never at 125.
          expect(read.gear.min).toBeGreaterThanOrEqual(0);
          expect(read.gear.max).toBeLessThanOrEqual(read.maxGears.max);
          expect(read.maxGears).toEqual({ min: 6, max: 6 });
          expect(gearSpeedCorrelation(read)).toBeGreaterThan(0.7);
          expect(read.speedInGear[1].max).toBeLessThan(45);
          for (const gear of [4, 5]) {
            expect(read.speedInGear[gear].min, `gear ${gear}`).toBeGreaterThan(
              35
            );
          }
        });

        it('carries the revs, the pedals, the steering, the fuel, the wear and the brakes', () => {
          const read = seen(name);

          expect(read.revs.min).toBeGreaterThan(3_000);
          expect(read.revs.max).toBeLessThan(read.revLimit.max);
          expect(read.revLimit.min).toBeGreaterThan(8_000);
          expect(read.throttle).toEqual({ min: 0, max: expect.any(Number) });
          expect(read.throttle.max).toBeGreaterThan(0.95);
          expect(read.steering.min).toBeLessThan(-0.3);
          expect(read.steering.max).toBeGreaterThan(0.3);
          expect(read.visualRange).toEqual({ min: 719, max: 719 });
          // Litres, falling over the four minutes, in a tank of 75 or 117.
          expect(read.fuel.min).toBeGreaterThan(20);
          expect(read.fuel.max - read.fuel.min).toBeGreaterThan(3);
          expect(read.tank.min).toBe(read.tank.max);
          expect([75, 117]).toContain(read.tank.max);
          // Tread left, a fraction.
          expect(read.wear.min).toBeGreaterThan(0.9);
          expect(read.wear.max).toBeLessThan(1);
          // Kelvin: 40 C at the coolest, 800 at the hottest.
          expect(read.brakeTemperature.min).toBeGreaterThan(300);
          expect(read.brakeTemperature.max).toBeLessThan(1_200);
        });

        it('carries no tyre temperature or pressure, no engine temperature and no dial', () => {
          const read = seen(name);
          const none = { min: 0, max: 0 };

          expect(read.tyreTemperature).toEqual(none);
          expect(read.tyrePressure).toEqual(none);
          expect(read.brakePressure).toEqual(none);
          expect(read.water).toEqual(none);
          expect(read.oil).toEqual(none);
          // The top of each dial's scale, which is how a car says it has the
          // dial: the Car Systems widget has nothing to show for this car.
          expect(read.dialMaxima).toEqual(none);
        });
      }
    );

    it('reads virtual energy for the LMGT3 and none for the LMP2s', () => {
      expect(seen('slot 1').virtualEnergy).toEqual({ min: 0, max: 0 });
      expect(seen('slot 5').virtualEnergy).toEqual({ min: 0, max: 0 });
      expect(seen('slot 20').virtualEnergy.min).toBeGreaterThan(0.3);
    });

    describe('asked for a slot it cannot read', () => {
      it.each(NO_BLOCK_READS)('gives no block for %s', (name) => {
        const read = seen(name);

        expect([...read.blockSlots]).toEqual([-1]);
        expect(read.withBlockFields).toBe(0);
        // Never the player's block in its place, and nothing else is lost:
        // the sim's word about the player, and every per-car array.
        expect(read.playerMisreported).toBe(0);
        expect(read.shortArrays).toBe(0);
        expect(read.keyCounts.size).toBe(1);
        expect(keysOf(read.last)).toEqual(keysOf(seen('an empty slot').last));
      });

      it('leaves out every single-car field, and only those', () => {
        const withBlock = keysOf(seen('no argument').last);
        const without = keysOf(seen('an empty slot').last);
        const blockFields = withBlock.filter((key) => !without.includes(key));

        expect(without.every((key) => withBlock.includes(key))).toBe(true);
        expect(blockFields.length).toBeGreaterThan(90);
        expect(blockFields).toEqual(
          expect.arrayContaining([
            'gear',
            'engineRPM',
            'filteredThrottle',
            'fuel',
            'tyreWear',
            'brakeTemperatureRaw',
            'speed',
            'pos',
            'vehicleName',
          ])
        );
        expect(blockFields.some((key) => /^veh[A-Z]/.test(key))).toBe(false);
      });
    });

    describe('on a session read', () => {
      it('takes the same argument', () => {
        const { none, ai, empty } = tape.sessions;

        expect(none.blockSlot).toBe(PLAYER_SLOT);
        expect(none.vehicleName).toBe('Kessel Racing 2026 #74:ELMS');
        expect(ai.blockSlot).toBe(AI_SLOTS[1]);
        expect(ai.vehicleName).toBe(
          ai.drivers.find((driver) => driver.id === AI_SLOTS[1])?.vehicleName
        );
        expect(ai.vehicleName).not.toBe(none.vehicleName);
        expect(empty.blockSlot).toBe(-1);
        expect(empty.vehicleName).toBeUndefined();
        expect(empty.gear).toBeUndefined();
        for (const session of [none, ai, empty]) {
          expect(session.drivers).toHaveLength(38);
          expect(session.playerHasVehicle).toBe(true);
          expect(session.playerVehicleIdx).toBe(PLAYER_SLOT);
        }
      });
    });

    describe('against what the app takes for a snapshot with no block', () => {
      /** A block that is nobody's to publish: no player, no own entry. */
      const unowned = <T extends LmuRawTelemetry>(snapshot: T): T => ({
        ...snapshot,
        playerHasVehicle: false,
        playerVehicleIdx: -1,
      });

      it('strips a block down to exactly what the addon writes without one', () => {
        // ownEntryBlock.ts keeps a list of the fields a snapshot has with or
        // without a car. The addon is the authority on it: a read that asks
        // for an empty slot comes back with those and the per-car arrays.
        const without = keysOf(seen('an empty slot').last);
        const aiBlock = seen('slot 5').last as LmuRawTelemetry;

        expect(keysOf(lmuPublishedBlock(unowned(aiBlock), -1))).toEqual(
          without
        );
        expect(
          keysOf(lmuPublishedBlock(unowned(tape.sessions.ai), -1))
        ).toEqual(keysOf(tape.sessions.empty));
      });

      it('stages a snapshot with no player vehicle the same way', () => {
        // The helper the staged specs take the player's vehicle out with.
        const player = seen('no argument').last as LmuRawTelemetry;

        expect(keysOf(lmuRawWithoutPlayerVehicle(player))).toEqual(
          keysOf(seen('an empty slot').last)
        );
        expect(keysOf(lmuRawWithoutPlayerVehicle(tape.sessions.none))).toEqual(
          keysOf(tape.sessions.empty)
        );
      });
    });
  }
);
