import type {
  LmuGarageSetting,
  LmuPitService,
  LmuWeatherNode,
} from '@irdashies/types';
import {
  parseLmuGameState,
  readLmuGameStateFailure,
  type ParsedLmuGameState,
} from '../gameState';
import { readTeamNationalities, type UnknownNationality } from '../nationality';
import type { LmuRestData } from './state';

/**
 * What to fetch from LMU's REST API, and how to read it.
 *
 * Every piece of knowledge about LMU's JSON shapes lives in this file, and
 * nothing in it does IO or owns a timer -- which is what makes the shapes
 * testable against recorded payloads with no server and no sim. The structure
 * mirrors TinyPedal's RestAPITask/ResOutput, since that is the only
 * documentation of these endpoints that exists.
 *
 * Hard rule: **a parser never throws.** It returns undefined for anything it
 * does not recognise, and the caller keeps the previous value. LMU's payloads
 * change between builds, and a surprise there must cost one missing property,
 * not a dead poller.
 */

/** Where a value lands, which decides whether it forces a session republish. */
export type LmuRestTarget = 'telemetry' | 'session';

export interface LmuRestOutput {
  /** Identifies the value for logging and for the apply step. */
  readonly id: string;
  readonly target: LmuRestTarget;
  /** Returns undefined to leave the current value alone. */
  readonly parse: (payload: unknown) => unknown;
  /** Writes a parsed value into the data object. */
  readonly apply: (data: LmuRestData, value: unknown) => void;
  /**
   * True when the parsed value is already what the data holds, so neither the
   * write nor the republish is needed.
   *
   * Only matters for a `session` target: those bump `revision`, which costs a
   * full snapshot rebuild and a whole-object IPC broadcast. An output whose
   * *body* changes on every poll -- `/rest/watch/standings` carries live
   * positions -- would otherwise force one every poll however static the
   * field it actually reads.
   *
   * Absent for every other output, which means the same as "always changed"
   * and is exactly how they behaved before this existed.
   */
  readonly unchanged?: (data: LmuRestData, value: unknown) => boolean;
  /**
   * Drops the value when an optional task stops answering.
   *
   * For a value that only means something while the path answers. Left in
   * place, the last answer outlives the state that produced it -- the
   * spectator camera's car stays focused after the viewer leaves the
   * spectator view. Absent, the value is kept, as it always was.
   */
  readonly clear?: (data: LmuRestData) => void;
  /**
   * A line for the log about a value just parsed, or undefined for nothing
   * to say. Logged by the poller, which owns the IO, so parsers stay pure;
   * and only for a changed body, so a value is reported once, not per poll.
   *
   * `previous` is what this output parsed last in the activation, undefined
   * at first, so a report can name only what is new.
   */
  readonly report?: (value: unknown, previous: unknown) => string | undefined;
  /**
   * Marks that an answer carried this output's value, new or not.
   *
   * `apply` cannot say that. A body identical to the one before is never
   * parsed, and a value that reads the same in a body that moved is written
   * again as it was -- so a cell that has not changed looks the same whether
   * the sim answered with the same value or stopped answering. For a reading
   * that barely moves, the difference matters: a brake disc that has stopped
   * wearing is a failed brake, and an answer that has stopped arriving is
   * not.
   *
   * Called by the poller on every answer whose body this output read a value
   * from: the body just parsed, or an identical one after it. Not called for
   * an answer that failed, nor for a body this output found nothing in.
   * `count` is how many such answers there have been; it only ever rises, for
   * as long as the poller lives, so two marks are never the same. Written
   * into a cell of its own, which reaches a processor on the telemetry frame.
   */
  readonly refreshed?: (data: LmuRestData, count: number) => void;
}

export interface LmuRestTask {
  readonly id: string;
  readonly path: string;
  /**
   * `once` runs a single time per session -- session settings cannot change
   * mid-session. `repeat` polls, backing off while the
   * response is unchanged. `burst` polls only when the bridge asks, through
   * `LmuRestPoller.burst`: every `baseIntervalMs` until the bridge's own
   * check passes or `burstMs` has gone by.
   */
  readonly mode: 'once' | 'repeat' | 'burst';
  readonly baseIntervalMs: number;
  /** How long one burst may poll for. Read only for a `burst` task. */
  readonly burstMs?: number;
  /**
   * Reads a failed request as an answer, for a path whose errors mean
   * something; returns true when it was one.
   *
   * The poller then treats the failure as a poll that answered: no retry is
   * spent, nothing is reported absent, and the task polls on at its base
   * interval.
   */
  readonly answerFailure?: (
    data: LmuRestData,
    failure: { readonly status?: number; readonly body?: string }
  ) => boolean;
  /**
   * The ceiling this task's interval backs off to, if not REST_MAX_INTERVAL_MS.
   *
   * Lower for a task where noticing a change promptly *is* the feature,
   * rather than one reading a value that sits still for a stint; higher for
   * one whose base interval is already longer than the shared ceiling.
   */
  readonly maxIntervalMs?: number;
  /**
   * True when an error response is an ordinary state rather than a fault.
   *
   * Every other path here is one LMU serves for the whole of a session, so
   * three failures in a row mean something is wrong and the task is given up
   * on until the next session begins or the player arrives in one (see
   * `LmuRestPoller.beginSession`). That is exactly wrong for a path whose
   * availability depends on what the viewer is *doing* inside a session: an
   * endpoint that only answers from the spectator view would be given up on
   * seconds after the session began and not asked again until the next one
   * -- so the feature would appear to do nothing at all.
   *
   * An optional task therefore never latches off. A failure costs no retry and
   * is rescheduled on the same backing-off interval an unchanged body gets, so
   * a path that is absent all session is one cheap loopback probe per ceiling
   * and one log line.
   */
  readonly optional?: boolean;
  /**
   * How many failures in a row an optional task takes before it reports
   * itself absent and clears its outputs. One if unset: the last answer goes
   * the moment the path stops answering.
   */
  readonly clearAfterFailures?: number;
  readonly outputs: readonly LmuRestOutput[];
}

/** Walks a key path, giving up rather than throwing on anything unexpected. */
export const at = (payload: unknown, keys: readonly string[]): unknown => {
  let current = payload;
  for (const key of keys) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
};

/** LMU's scoring array length, which bounds a slot id. See lmu_struct.h. */
const LMU_MAX_VEHICLES = 104;

/** A finite number, or undefined. Rejects NaN, Infinity, and numeric strings. */
export const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const cell = <T>(value: T): { readonly value: readonly T[] } => ({
  value: [value],
});

/** Reads a plain number at a key path and lands it in a telemetry cell. */
const numberCell = (
  id: string,
  keys: readonly string[],
  set: (data: LmuRestData, value: { readonly value: readonly number[] }) => void
): LmuRestOutput => ({
  id,
  target: 'telemetry',
  parse: (payload) => finiteNumber(at(payload, keys)),
  apply: (data, value) => set(data, cell(value as number)),
});

/** Litres in one US gallon, which is how LMU words a gallon pit-menu entry. */
const LITRES_PER_GALLON = 3.7854118;

/** First number in a string, or undefined. Pit-menu text is "+12.5 gal". */
const firstNumber = (text: unknown): number | undefined => {
  if (typeof text !== 'string') return undefined;
  const match = /-?\d+(?:\.\d+)?/.exec(text);
  return match ? Number(match[0]) : undefined;
};

/**
 * Exactly four finite numbers, in LMU's corner order.
 *
 * LMU reports FL, FR, RL, RR, which is the same order as this repo's own
 * corner loop in mapTelemetry.ts -- so there is no remapping to do here, and
 * nobody should add one. A shorter array is rejected rather than published
 * short, because a consumer indexing corner 3 would read undefined.
 */
const fourCorners = (value: unknown): number[] | undefined => {
  if (!Array.isArray(value) || value.length !== 4) return undefined;
  const corners = value.map(finiteNumber);
  return corners.every((corner): corner is number => corner !== undefined)
    ? (corners as number[])
    : undefined;
};

/** Whether a list already held is, number for number, the one just parsed. */
const sameNumbers = (
  current: readonly number[] | undefined,
  next: readonly number[]
): boolean =>
  current !== undefined &&
  current.length === next.length &&
  next.every((value, index) => current[index] === value);

/**
 * The entries of the pit menu, or undefined when the payload has no menu.
 *
 * `pitMenu.pitMenu` is a list of entries, each a `name` ("FUEL RATIO:"), the
 * `settings` it can be put on and `currentSetting`, the index of the one it
 * is on.
 */
const pitMenuEntries = (payload: unknown): readonly unknown[] | undefined => {
  const menu = at(payload, ['pitMenu', 'pitMenu']);
  return Array.isArray(menu) ? menu : undefined;
};

/** The text of the setting a pit-menu entry is on, or undefined. */
const selectedText = (entry: unknown): string | undefined => {
  const index = at(entry, ['currentSetting']);
  const settings = at(entry, ['settings']);
  if (typeof index !== 'number' || !Array.isArray(settings)) return undefined;
  const text = at(settings[index], ['text']);
  return typeof text === 'string' ? text : undefined;
};

/**
 * Litres of fuel per percent of virtual energy, as the pit menu is set to add
 * them: the text of the setting the `FUEL RATIO:` entry is on ("1.03").
 *
 * A recorded LMGT3, which runs on virtual energy, has the entry; whether the
 * menu of a fuel-limited car does is not known. A menu without it returns
 * undefined, like anything else unrecognised, and the session's end is what
 * takes the last value down.
 */
const refuelRatio = (payload: unknown): number | undefined => {
  const entry = pitMenuEntries(payload)?.find(
    (candidate) => at(candidate, ['name']) === 'FUEL RATIO:'
  );
  const ratio = firstNumber(selectedText(entry));
  return ratio !== undefined && ratio > 0 ? ratio : undefined;
};

/** What `repairChoice` parses: the choice, or none where nothing is offered. */
interface ParsedRepairChoice {
  choice: string | undefined;
}

/**
 * What the pit menu is set to repair, from its `DAMAGE:` entry.
 *
 * An undamaged car's entry has the single setting "N/A"; once there is
 * something to repair the sim replaces it with the choices -- a recorded GT3
 * went from "N/A" to "Do Not Repair" / "Repair Body" on its first contact.
 * The text is kept as the sim words it, since the full set of choices is not
 * known.
 *
 * "N/A", an empty text and a menu with no such entry all read as no choice,
 * which is a value: it takes the cell down, where returning undefined would
 * leave "Repair Body" standing after the repair was made. Undefined is for
 * a payload with no menu at all, or an entry whose setting cannot be read.
 */
const repairChoice = (payload: unknown): ParsedRepairChoice | undefined => {
  const menu = pitMenuEntries(payload);
  if (!menu) return undefined;
  const entry = menu.find((candidate) => at(candidate, ['name']) === 'DAMAGE:');
  if (entry === undefined) return { choice: undefined };
  const text = selectedText(entry)?.trim();
  if (text === undefined) return undefined;
  const offered = text.length > 0 && text.toUpperCase() !== 'N/A';
  return { choice: offered ? text : undefined };
};

/**
 * The parts of a pit stop, in the order `pitStopParts` holds them.
 *
 * These are the keys of `/rest/strategy/pitstop-estimate` beside `total`,
 * each in seconds. Exported so that a reader indexes the cell by name rather
 * than by a number repeated from here.
 */
export const LMU_PIT_STOP_PARTS = [
  'fuel',
  've',
  'tires',
  'damage',
  'driverSwap',
  'brakes',
  'brakeDucts',
  'penalties',
] as const;

/**
 * All eight parts or nothing, for the reason `fourCorners` gives: the cell is
 * read by position, and a part published short would be read as another.
 * The sim writes every key on every answer, zero for work the stop does not
 * include.
 */
const pitStopParts = (payload: unknown): number[] | undefined => {
  const parts: number[] = [];
  for (const key of LMU_PIT_STOP_PARTS) {
    const seconds = finiteNumber(at(payload, [key]));
    if (seconds === undefined) return undefined;
    parts.push(seconds);
  }
  return parts;
};

/**
 * Where each `pitStopTimes.times` key lands on LmuPitService.
 *
 * The sim's group holds more than this -- wing, radiator and pressure changes
 * among them -- and only what a stop's length is worked out from is taken.
 */
const PIT_SERVICE_KEYS: readonly (readonly [keyof LmuPitService, string])[] = [
  ['fuelFillRate', 'FuelFillRate'],
  ['fuelInsert', 'FuelInsert'],
  ['fuelRemove', 'FuelRemove'],
  ['fuelTimeConcurrent', 'FuelTimeConcurrent'],
  ['fuelRandomDelay', 'FuelRandomDelay'],
  ['virtualEnergyFillRate', 'virtualEnergyFillRate'],
  ['virtualEnergyInsert', 'virtualEnergyInsert'],
  ['virtualEnergyRemove', 'virtualEnergyRemove'],
  ['virtualEnergyTimeConcurrent', 'virtualEnergyTimeConcurrent'],
  ['fourTireChange', 'FourTireChange'],
  ['twoTireChange', 'TwoTireChange'],
  ['tireTimeConcurrent', 'TireTimeConcurrent'],
  ['randomTireDelay', 'RandomTireDelay'],
  ['driverChange', 'DriverChange'],
  ['driverConcurrent', 'DriverConcurrent'],
  ['driverRandom', 'DriverRandom'],
  ['fixAeroDamage', 'FixAeroDamage'],
  ['fixAllDamage', 'FixAllDamage'],
  ['fixTimeConcurrent', 'FixTimeConcurrent'],
  ['fixRandomDelay', 'FixRandomDelay'],
  ['brakeChange', 'BrakeChange'],
  ['brakeTimeConcurrent', 'BrakeTimeConcurrent'],
];

/**
 * What each kind of pit work costs, from the repair screen's `pitStopTimes`.
 *
 * Member by member rather than all or nothing: nothing reads these by
 * position, so a key a build drops or renames costs that one member. With
 * none of them readable there is nothing to land.
 */
const pitService = (payload: unknown): LmuPitService | undefined => {
  const times = at(payload, ['pitStopTimes', 'times']);
  const service: LmuPitService = {};
  let found = false;
  for (const [member, key] of PIT_SERVICE_KEYS) {
    const value = finiteNumber(at(times, [key]));
    if (value === undefined) continue;
    service[member] = value;
    found = true;
  }
  return found ? service : undefined;
};

const samePitService = (
  current: LmuPitService | undefined,
  next: LmuPitService
): boolean =>
  current !== undefined &&
  PIT_SERVICE_KEYS.every(([member]) => current[member] === next[member]);

/**
 * What the next pit stop will put in, from the pit menu.
 *
 * Two units share this one field, which is why the flag travels with it. A
 * Hypercar, an LMDh or an LMGT3 is energy-limited, so its menu offers VIRTUAL
 * ENERGY as a percentage; everything else offers FUEL, as a volume that LMU
 * words in either litres or gallons depending on the player's units. A number
 * that is sometimes a percentage and sometimes litres, with nothing saying
 * which, is a bug waiting to be written downstream.
 *
 * The energy entry lists every whole percent from 0 to 100, so its selected
 * index is the percentage and no text has to be parsed: a recorded LMGT3 at
 * 45 % read index 45 with the label "45% 20 laps". It is the level the stop
 * fills to, not an amount added on top.
 */
const refuelTarget = (
  payload: unknown
): { amount: number; isVirtualEnergy: boolean } | undefined => {
  const menu = at(payload, ['pitMenu', 'pitMenu']);
  if (!Array.isArray(menu)) return undefined;

  for (const entry of menu) {
    const name = at(entry, ['name']);

    if (name === 'VIRTUAL ENERGY:') {
      const amount = finiteNumber(Number(at(entry, ['currentSetting'])));
      return amount === undefined
        ? undefined
        : { amount, isVirtualEnergy: true };
    }

    if (name === 'FUEL:') {
      const index = at(entry, ['currentSetting']);
      const settings = at(entry, ['settings']);
      if (typeof index !== 'number' || !Array.isArray(settings)) {
        return undefined;
      }
      const text = at(settings[index], ['text']);
      const amount = firstNumber(text);
      if (amount === undefined) return undefined;
      const isGallons =
        typeof text === 'string' && text.toLowerCase().includes('gal');
      return {
        amount: isGallons ? amount * LITRES_PER_GALLON : amount,
        isVirtualEnergy: false,
      };
    }
  }
  return undefined;
};

/**
 * One session's forecast, as five points across its length.
 *
 * LMU names the points START, NODE_25, NODE_50, NODE_75, FINISH, so `start` is
 * just the index scaled to a fraction of the session. Rain chance arrives as a
 * percentage and is normalised to a 0..1 fraction here, clamped, so a
 * consumer never has to know which convention it came in.
 *
 * All five or nothing: a partial forecast would render as a cliff rather than
 * a gap. That rule is tied to sky, temperature and rain chance. Humidity and
 * wind ride along where a point states them and are left off where it does
 * not, so a build without them still has a forecast.
 */
const FORECAST_NODES = ['START', 'NODE_25', 'NODE_50', 'NODE_75', 'FINISH'];

/** LMU's wind directions are an index, 0 to this. */
const WIND_DIRECTION_MAX = 7;

const forecast = (payload: unknown): LmuWeatherNode[] | undefined => {
  const nodes: LmuWeatherNode[] = [];
  for (let index = 0; index < FORECAST_NODES.length; index += 1) {
    const node = at(payload, [FORECAST_NODES[index]]);
    const skyType = finiteNumber(at(node, ['WNV_SKY', 'currentValue']));
    const temperature = finiteNumber(
      at(node, ['WNV_TEMPERATURE', 'currentValue'])
    );
    const rawChance = finiteNumber(
      at(node, ['WNV_RAIN_CHANCE', 'currentValue'])
    );
    if (
      skyType === undefined ||
      temperature === undefined ||
      rawChance === undefined
    ) {
      return undefined;
    }
    const parsed: LmuWeatherNode = {
      start: Math.round(index * 0.2 * 10) / 10,
      skyType: Math.trunc(skyType),
      temperature,
      rainChance: Math.min(Math.max(rawChance * 0.01, 0), 1),
    };
    // A percentage, like the rain chance, and published as a fraction too.
    const humidity = finiteNumber(at(node, ['WNV_HUMIDITY', 'currentValue']));
    if (humidity !== undefined) {
      parsed.humidity = Math.min(Math.max(humidity / 100, 0), 1);
    }
    // Metres per second already: the sim words 17 as "61.2 kph".
    const windSpeed = finiteNumber(at(node, ['WNV_WINDSPEED', 'currentValue']));
    if (windSpeed !== undefined && windSpeed >= 0) parsed.windSpeed = windSpeed;
    // Kept as the sim's index. What compass point each one is belongs to
    // whoever draws it; anything that is not one of them is left off.
    const windDirection = finiteNumber(
      at(node, ['WNV_WINDDIRECTION', 'currentValue'])
    );
    if (
      windDirection !== undefined &&
      Number.isInteger(windDirection) &&
      windDirection >= 0 &&
      windDirection <= WIND_DIRECTION_MAX
    ) {
      parsed.windDirection = windDirection;
    }
    nodes.push(parsed);
  }
  return nodes;
};

/** Whether a forecast already held says what the one just parsed does. */
const sameForecast = (
  current: readonly LmuWeatherNode[] | undefined,
  next: readonly LmuWeatherNode[]
): boolean =>
  current !== undefined &&
  current.length === next.length &&
  next.every((node, index) => {
    const held = current[index];
    return (
      held.start === node.start &&
      held.skyType === node.skyType &&
      held.temperature === node.temperature &&
      held.rainChance === node.rainChance &&
      held.humidity === node.humidity &&
      held.windSpeed === node.windSpeed &&
      held.windDirection === node.windDirection
    );
  });

/** A forecast for one session type, landed under LmuRest.forecast. */
const forecastFor = (
  id: string,
  key: string,
  slot: 'practice' | 'qualify' | 'race'
): LmuRestOutput => ({
  id,
  target: 'session',
  parse: (payload) => forecast(at(payload, [key])),
  // The task repeats, and a forecast that reads as it did must not rebuild
  // the session: a body can move for a reason this output does not read.
  unchanged: (data, value) =>
    sameForecast(data.session.forecast?.[slot], value as LmuWeatherNode[]),
  apply: (data, value) => {
    data.session.forecast = {
      ...data.session.forecast,
      [slot]: value as LmuWeatherNode[],
    };
  },
});

/** A session setting, which LMU nests under `currentValue`. */
const sessionSetting = (
  id: string,
  key: string,
  apply: (data: LmuRestData, value: number) => void
): LmuRestOutput => ({
  id,
  target: 'session',
  parse: (payload) => finiteNumber(at(payload, [key, 'currentValue'])),
  apply: (data, value) => apply(data, value as number),
});

/**
 * A garage setup value, which LMU nests under `stringValue`.
 *
 * These are display strings rather than numbers -- "0.83", "19.1L (7.8 laps)",
 * "23% (7.7 laps)" -- so the leading number is what carries the data. The
 * sibling `value` field is the slider index, not the quantity, and is no use
 * here.
 */
const garageNumber = (payload: unknown, key: string): number | undefined =>
  firstNumber(at(payload, ['carSetup', 'garageValues', key, 'stringValue']));

/**
 * Millimetres in each unit a garage length may be worded in.
 *
 * Centimetres is the one seen: a recorded setup reads "3.60 cm". The other
 * two are here because a length in them converts without a guess, and a unit
 * that is none of the three is rejected rather than taken for centimetres.
 */
const MM_PER_UNIT: Readonly<Record<string, number>> = {
  mm: 1,
  cm: 10,
  in: 25.4,
};

/** A garage length such as "3.60 cm", in millimetres, or undefined. */
const lengthMm = (text: unknown): number | undefined => {
  if (typeof text !== 'string') return undefined;
  const match = /^\s*(\d+(?:\.\d+)?)\s*([a-z]+)/i.exec(text);
  if (!match) return undefined;
  const factor = MM_PER_UNIT[match[2].toLowerCase()];
  if (factor === undefined) return undefined;
  // To the micrometre, which drops the binary tail a multiplication leaves
  // and is far finer than the two decimals of a centimetre the sim words.
  const mm = Math.round(Number(match[1]) * factor * 1000) / 1000;
  return mm > 0 ? mm : undefined;
};

/** The setup's brake disc keys, in corner order: LF, RF, LR, RR. */
const BRAKE_DISC_KEYS = [
  'WM_BRAKEDISC-W_FL',
  'WM_BRAKEDISC-W_FR',
  'WM_BRAKEDISC-W_RL',
  'WM_BRAKEDISC-W_RR',
];

/**
 * The thickness of a new brake disc on each wheel, millimetres.
 *
 * What the setup fits, so it is the figure a worn disc is measured against;
 * the thickness now is `wearables.brakes` on the repair screen. All four or
 * nothing, as `fourCorners` has it.
 */
const brakeDiscNewMm = (payload: unknown): number[] | undefined => {
  const discs: number[] = [];
  for (const key of BRAKE_DISC_KEYS) {
    const mm = lengthMm(
      at(payload, ['carSetup', 'garageValues', key, 'stringValue'])
    );
    if (mm === undefined) return undefined;
    discs.push(mm);
  }
  return discs;
};

/**
 * The garage's regeneration level, or null for a car that has none.
 *
 * How to read a garage value, as a recording has it: `stringValue` carries
 * the quantity as text, `value` is the position of the slider and `maxValue`
 * the number of positions. The sim lists the setting for every car, and a
 * car without it has a single position -- a recorded LMGT3 reads "0%" with a
 * `maxValue` of 1. That is null rather than undefined: it is an answer, and
 * it takes down a level held from before.
 */
const regenLevel = (payload: unknown): LmuGarageSetting | null | undefined => {
  const setting = at(payload, ['carSetup', 'garageValues', 'VM_REGEN_LEVEL']);
  const positions = finiteNumber(at(setting, ['maxValue']));
  if (positions === undefined) return undefined;
  if (positions <= 1) return null;
  const text = at(setting, ['stringValue']);
  const value = finiteNumber(at(setting, ['value']));
  if (typeof text !== 'string' || value === undefined) return undefined;
  return { text, value, positions };
};

interface ParsedNationalities {
  codes: Record<string, string>;
  unknown: UnknownNationality[];
}

/** Whether two flag maps name the same code for the same drivers. */
const sameCodes = (
  current: Readonly<Record<string, string>> | undefined,
  next: Readonly<Record<string, string>>
): boolean => {
  if (!current) return false;
  const names = Object.keys(next);
  if (names.length !== Object.keys(current).length) return false;
  return names.every((name) => current[name] === next[name]);
};

/**
 * Driver nationalities, which only multiplayer reports.
 *
 * A payload with no flag at all leaves any previous value alone instead of
 * wiping the flags -- the same contract every other output here follows --
 * but is still reported: the drivers it names without a usable country are
 * logged, with what the sim sent, since otherwise a missing flag says nothing
 * about why.
 */
const nationalities: LmuRestOutput = {
  id: 'nationalities',
  target: 'session',
  /** The flags found and the drivers without one; nothing if neither. */
  parse: (payload): ParsedNationalities | undefined => {
    const { found, unknown } = readTeamNationalities(payload);
    if (found.size === 0 && unknown.length === 0) return undefined;
    return { codes: Object.fromEntries(found), unknown };
  },
  /**
   * The body moves on nearly every poll -- each driver's isConnected flips
   * constantly -- while the flags move only when the grid does. Republishing
   * on the body would rebuild and broadcast the whole session every poll of a
   * burst; this republishes only when a flag is gained, lost or changed.
   */
  unchanged: (data, value) => {
    const { codes } = value as ParsedNationalities;
    return (
      Object.keys(codes).length === 0 ||
      sameCodes(data.session.nationalities, codes)
    );
  },
  apply: (data, value) => {
    data.session.nationalities = (value as ParsedNationalities).codes;
  },
  /**
   * Only the drivers who were not already without a flag in the last body, so
   * a burst names each one once rather than on every poll.
   */
  report: (value, previous) => {
    const { codes, unknown } = value as ParsedNationalities;
    const already = new Set(
      (previous as ParsedNationalities | undefined)?.unknown.map(
        ({ name }) => name
      )
    );
    const newly = unknown.filter(({ name }) => !already.has(name));
    if (newly.length === 0) return undefined;
    const total = Object.keys(codes).length + unknown.length;
    const drivers = newly
      .map(
        ({ name, nationality }) =>
          `${JSON.stringify(name)} (${nationality ? nationality : 'empty'})`
      )
      .join(', ');
    return (
      `[lmuRest] No country flag for ${drivers}; ` +
      `${unknown.length} of ${total} drivers have none`
    );
  },
};

/**
 * Where the player is: in the car, at the monitor, or out of any session.
 *
 * A telemetry target only so that it forces no republish -- it is not a
 * channel. The bridge reads it on every frame. See ../gameState.ts.
 */
const gameState: LmuRestOutput = {
  id: 'gameState',
  target: 'telemetry',
  parse: parseLmuGameState,
  apply: (data, value) => {
    data.gameState = (value as ParsedLmuGameState).state;
  },
  // Unknown again once the path stops answering, so the bridge goes back to
  // shared memory rather than trusting the last answer for ever.
  clear: (data) => {
    data.gameState = undefined;
  },
  /** Logs an unrecognised answer when it first appears, not every poll. */
  report: (value, previous) => {
    const { unrecognised } = value as ParsedLmuGameState;
    if (
      !unrecognised ||
      unrecognised ===
        (previous as ParsedLmuGameState | undefined)?.unrecognised
    ) {
      return undefined;
    }
    return (
      `[lmuRest] Unrecognised GetGameState ${unrecognised}; ` +
      'reading in-car and in-session from shared memory'
    );
  },
};

/** The teams task, which the bridge starts bursts of by this id. */
export const LMU_TEAMS_TASK_ID = 'multiplayer-teams';

/**
 * The session's tyre compounds, in the order the sim indexes them.
 *
 * `optimalCompoundConditions.compounds` is a list, and a compound's position
 * in it is the index per-wheel telemetry reports -- which makes this the
 * catalogue that turns an index into a name. Each entry also carries an
 * optimal temperature; only the type is taken, since nothing reads the rest.
 *
 * More complete than what the grid states, because it includes compounds
 * nobody has fitted, and less authoritative for the same reason: what a car is
 * actually on comes from its own telemetry block. `lmuDriverTires` merges the
 * grid over this.
 *
 * Returns undefined rather than [] when nothing parses, so a payload this
 * build does not recognise leaves the previous catalogue alone.
 */
const compoundCatalogue: LmuRestOutput = {
  id: 'compoundCatalogue',
  // Session, not telemetry: the catalogue is fixed for a session, and a
  // telemetry target would rebuild the session on every poll.
  target: 'session',
  parse: (payload) => {
    const compounds = at(payload, ['optimalCompoundConditions', 'compounds']);
    if (!Array.isArray(compounds)) return undefined;
    const names = compounds.map((entry) => {
      const type = at(entry, ['type']);
      return typeof type === 'string' ? type : '';
    });
    // Holes are kept rather than filtered: position in this array *is* the
    // compound index, so dropping an unparseable entry would renumber every
    // compound after it.
    return names.some((name) => name.length > 0) ? names : undefined;
  },
  apply: (data, value) => {
    data.session.tireCompounds = value as string[];
  },
};

/**
 * The slot the spectator camera is on, or -1 for none.
 *
 * LMU's shared memory has no camera field at all -- `LMUTelemetryData` carries
 * `playerVehicleIdx` and nothing else, and while spectating `playerHasVehicle`
 * is false, so the player index is -1 and there is nothing for the focus to
 * fall back to. This endpoint is the only route to the watched car.
 *
 * Found in LMUTraceHUB, which reads `/rest/watch/focus` alongside
 * `focusForward` and `focusBackward` and keeps the result in a `CameraInfo`
 * carrying a `FocusSlot`. The literal `mID` sits next to the path in its
 * string table, which matters: `mID` is the scoring slot id, and that is this
 * app's CarIdx (lmu_node.cc indexes every per-vehicle array by `v.mID`). So
 * the answer needs no join -- it drops straight into CamCarIdx.
 *
 * doX reaches the same fact the long way round, from the `focus` flag on each
 * `/rest/watch/standings` entry, then matching driver names. That works and is
 * confirmed by two implementations, but it pays for the whole field to learn
 * one integer.
 *
 * Several spellings are accepted because the response shape is known from a
 * string table rather than a schema, and a bare number is accepted too.
 *
 * -1 is a value, not a failure: it means nothing is focused, and the mapper
 * falls back to the player, or with no player vehicle to the user's own
 * entry (see ../ownEntry.ts). Anything unrecognised returns undefined so the
 * previous value stands, which is the contract every parser here follows --
 * a hiccup must not drop the camera back to the player's empty slot mid-lap.
 */
const FOCUS_KEYS = ['mID', 'mid', 'id', 'slot', 'focusSlot', 'carIdx', 'index'];

const focusSlot = (payload: unknown): number | undefined => {
  let found: unknown = typeof payload === 'number' ? payload : undefined;
  if (found === undefined && payload !== null && typeof payload === 'object') {
    const node = payload as Record<string, unknown>;
    const keys = Object.keys(node);
    for (const name of FOCUS_KEYS) {
      const key = keys.find(
        (candidate) => candidate.toLowerCase() === name.toLowerCase()
      );
      if (key !== undefined) {
        found = node[key];
        break;
      }
    }
  }

  const slot = typeof found === 'string' ? Number(found) : found;
  if (typeof slot !== 'number' || !Number.isInteger(slot)) return undefined;
  return slot >= -1 && slot < LMU_MAX_VEHICLES ? slot : undefined;
};

/**
 * The entrant each car is run by, from `/rest/watch/standings`.
 *
 * `fullTeamName` is the only authoritative source. Shared memory has no team
 * field at all, and the fallback -- parsing the prefix of the entry name --
 * carries the season with it: an entry named "Proton Competition 2026 #77:LM"
 * parses as "Proton Competition 2026" where this endpoint states "Proton
 * Competition".
 *
 * Keyed by `slotID`, which is the scoring slot id and so this app's CarIdx --
 * confirmed by the spectator camera, whose `/rest/watch/focus` answer is a
 * slotID and lands on the right car when published as CamCarIdx.
 *
 * By slot rather than by driver name, unlike `nationalities` next door, and
 * the difference is not arbitrary: a team runs a *car*, while the driver in it
 * changes at every stop of an endurance race. A name key would go stale on
 * each swap until the next poll, and would collide between two AI given the
 * same name. The slot is the thing the team belongs to.
 *
 * Returns undefined rather than an empty map when nothing parses, so a build
 * whose payload this does not recognise keeps the previous answer instead of
 * clearing every team name.
 */
const teamNames = (payload: unknown): Record<number, string> | undefined => {
  if (!Array.isArray(payload)) return undefined;

  const found: Record<number, string> = {};
  for (const entry of payload) {
    const slot = at(entry, ['slotID']);
    const team = at(entry, ['fullTeamName']);
    if (typeof team !== 'string') continue;
    // Bounded like the focus slot, and for the same reason: anything outside
    // the scoring array cannot be a car, and would key an entry nothing reads.
    if (typeof slot !== 'number' || !Number.isInteger(slot)) continue;
    if (slot < 0 || slot >= LMU_MAX_VEHICLES) continue;
    const value = team.trim();
    if (value.length === 0) continue;
    found[slot] = value;
  }
  return Object.keys(found).length > 0 ? found : undefined;
};

/** Whether two slot->team maps say the same thing. */
const sameTeams = (
  a: Record<number, string> | undefined,
  b: Record<number, string>
): boolean => {
  if (!a) return false;
  const keys = Object.keys(a);
  // The count as well as the values: every slot already held still matches
  // when a car joins, so only the count says one has appeared.
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => a[Number(key)] === b[Number(key)]);
};

export const LMU_REST_TASKS: readonly LmuRestTask[] = [
  {
    id: 'repair-and-refuel',
    path: '/rest/garage/UIScreen/RepairAndRefuel',
    mode: 'repeat',
    // The pit menu is static for most of a stint, so the backoff carries this
    // out to the cap; the base rate is for when the driver is actually in it.
    baseIntervalMs: 200,
    outputs: [
      {
        id: 'refuelTarget',
        target: 'telemetry',
        parse: refuelTarget,
        apply: (data, value) => {
          const { amount, isVirtualEnergy } = value as {
            amount: number;
            isVirtualEnergy: boolean;
          };
          data.cells.refuelTarget = { value: [amount] };
          data.cells.refuelTargetIsVirtualEnergy = {
            value: [isVirtualEnergy],
          };
        },
      },
      {
        id: 'refuelRatio',
        // Telemetry, unlike the garage's ratio on the session: this is the
        // pit menu's entry, which the driver can move on track.
        target: 'telemetry',
        parse: refuelRatio,
        apply: (data, value) => {
          data.cells.refuelRatio = cell(value as number);
        },
      },
      {
        id: 'repairChoice',
        target: 'telemetry',
        parse: repairChoice,
        apply: (data, value) => {
          const { choice } = value as ParsedRepairChoice;
          if (choice === undefined) delete data.cells.repairChoice;
          else data.cells.repairChoice = cell(choice);
        },
      },
      // The standing time of the next stop as this screen states it. The
      // estimate path's `total` is the same figure and the one published;
      // the mapper falls back to this while that path has not answered.
      numberCell(
        'pitStopLength',
        ['pitStopLength', 'timeInSeconds'],
        (data, value) => {
          data.cells.pitStopLength = value;
        }
      ),
      {
        id: 'maxVirtualEnergy',
        // Session, not telemetry: it is a per-car constant, and a telemetry
        // target here would force a session rebuild on every poll.
        target: 'session',
        parse: (payload) =>
          finiteNumber(at(payload, ['fuelInfo', 'maxVirtualEnergy'])),
        // And compared, for the same reason. This body carries the fuel
        // aboard and the time of day, so it differs on every poll of a car
        // that is running; without the comparison each of those polls
        // rebuilt the session to say what it already said.
        unchanged: (data, value) => data.session.maxVirtualEnergy === value,
        apply: (data, value) => {
          data.session.maxVirtualEnergy = value as number;
        },
      },
      {
        id: 'maxFuel',
        target: 'session',
        // The tank, in litres, stated outright. Every other route to it is an
        // inference: the garage slider's bound has to be read as litres, and
        // mFuelCapacity is shared memory's word for it. A GT3 capture has all
        // three agreeing at 120, and this is the one that says so directly.
        parse: (payload) => finiteNumber(at(payload, ['fuelInfo', 'maxFuel'])),
        unchanged: (data, value) => data.session.maxFuel === value,
        apply: (data, value) => {
          data.session.maxFuel = value as number;
        },
      },
      {
        id: 'pitService',
        // Session: constants of a car in a session, which nothing reads at
        // the frame rate.
        target: 'session',
        parse: pitService,
        unchanged: (data, value) =>
          samePitService(data.session.pitService, value as LmuPitService),
        apply: (data, value) => {
          data.session.pitService = value as LmuPitService;
        },
      },
      numberCell('aeroDamage', ['wearables', 'body', 'aero'], (data, value) => {
        data.cells.aeroDamage = value;
      }),
      {
        id: 'brakeThickness',
        target: 'telemetry',
        // Disc thickness, which the sim states in metres: a recorded GT3
        // starts at 0.0360 front and 0.0320 rear, the 3.60 and 3.20 cm of
        // its setup. Converted here, once, so everything after this reads
        // millimetres. Not a 0..1 share of anything, which is what this was
        // first taken for.
        parse: (payload) =>
          fourCorners(at(payload, ['wearables', 'brakes']))?.map(
            (metres) => metres * 1000
          ),
        apply: (data, value) => {
          data.cells.brakeThickness = { value: value as number[] };
        },
        // A disc wears micrometres a lap, so most answers repeat the reading
        // before. This is what says they are still arriving.
        refreshed: (data, count) => {
          data.cells.wearablesSeq = cell(count);
        },
      },
      {
        id: 'suspensionDamage',
        target: 'telemetry',
        // Four zeros on an undamaged car.
        parse: (payload) =>
          fourCorners(at(payload, ['wearables', 'suspension'])),
        apply: (data, value) => {
          data.cells.suspensionDamage = { value: value as number[] };
        },
      },
    ],
  },
  {
    id: 'car-setup-overview',
    path: '/rest/garage/UIScreen/CarSetupOverview',
    // Repeating, because a setup can be edited mid-session and a one-shot
    // would go stale. The payload is the largest in the set, and the hash
    // compare does not spare it: beside the setup the body carries the time
    // of day, the weather now and the gaps in class, so in a running session
    // it differs on every poll and is parsed on every poll. What the session
    // targets below are spared, by their comparators, is the session rebuild
    // that used to follow each one.
    mode: 'repeat',
    baseIntervalMs: 1000,
    outputs: [
      {
        id: 'fuelRatio',
        target: 'session',
        parse: (payload) => garageNumber(payload, 'VM_FUEL_LEVEL'),
        unchanged: (data, value) => data.session.fuelRatio === value,
        apply: (data, value) => {
          data.session.fuelRatio = value as number;
        },
      },
      {
        id: 'fuelLevelMax',
        target: 'session',
        // maxValue, not stringValue: the top step of the fuel-ratio slider.
        //
        // The ratio is litres per percent of virtual energy, so at the top
        // step a full energy load fills the tank exactly -- which makes this
        // bound the tank in litres. A GT3 capture reads 120 here against a
        // 120 L tank, while the slider's current position reads 1.03.
        parse: (payload) =>
          finiteNumber(
            at(payload, [
              'carSetup',
              'garageValues',
              'VM_FUEL_LEVEL',
              'maxValue',
            ])
          ),
        unchanged: (data, value) => data.session.fuelLevelMax === value,
        apply: (data, value) => {
          data.session.fuelLevelMax = value as number;
        },
      },
      {
        id: 'brakeDiscNewMm',
        target: 'session',
        parse: brakeDiscNewMm,
        unchanged: (data, value) =>
          sameNumbers(data.session.brakeDiscNewMm, value as number[]),
        apply: (data, value) => {
          data.session.brakeDiscNewMm = value as number[];
        },
      },
      {
        id: 'steerLockDeg',
        // A cell, though it moves no more often than the setup does: the
        // telemetry mapper is what wants it, as the wheel's range where
        // shared memory states none, and the mapper is handed the cells and
        // not the session.
        target: 'telemetry',
        // The first number of "476 (17.2) deg": the wheel's range, where the
        // bracket is the angle at the road wheels.
        parse: (payload) => {
          const lock = garageNumber(payload, 'VM_STEER_LOCK');
          return lock !== undefined && lock > 0 ? lock : undefined;
        },
        apply: (data, value) => {
          data.cells.steerLockDeg = cell(value as number);
        },
      },
      {
        id: 'regenLevel',
        target: 'session',
        parse: regenLevel,
        unchanged: (data, value) => {
          const held = data.session.garage?.regenLevel;
          const next = value as LmuGarageSetting | null;
          if (next === null) return held === undefined;
          return (
            held !== undefined &&
            held.text === next.text &&
            held.value === next.value &&
            held.positions === next.positions
          );
        },
        apply: (data, value) => {
          // A copy, never the object already on the session: a snapshot
          // built from it keeps what it was built from.
          const garage = { ...data.session.garage };
          if (value === null) delete garage.regenLevel;
          else garage.regenLevel = value as LmuGarageSetting;
          if (Object.keys(garage).length > 0) data.session.garage = garage;
          else delete data.session.garage;
        },
      },
    ],
  },
  {
    id: 'sessions',
    path: '/rest/sessions',
    // Session settings cannot change mid-session, so this is fetched once per
    // session.
    mode: 'once',
    baseIntervalMs: 1000,
    outputs: [
      sessionSetting('timeScale', 'SESSSET_race_timescale', (data, value) => {
        data.session.timeScale = value;
      }),
      // Minutes in the sim, seconds here like every other time. Nothing is a
      // race of no length, so 0 is the sim stating none.
      sessionSetting('raceTime', 'SESSSET_race_time', (data, value) => {
        data.session.raceTime = value > 0 ? value * 60 : undefined;
      }),
      sessionSetting(
        'privateQualifying',
        'SESSSET_private_qual',
        (data, value) => {
          data.session.privateQualifying = value !== 0;
        }
      ),
    ],
  },
  {
    id: 'sessions-weather',
    path: '/rest/sessions/weather',
    // Repeating, in case a forecast can change during a session. It was
    // fetched once, on the reasoning that it cannot; that holds for scripted
    // weather and is unverified for the kinds the sim generates. Asked for
    // twice a minute, and once a minute while the answer is the one before,
    // which the hash compare rejects unparsed -- so being wrong about this
    // costs a loopback request a minute, and being right about it without
    // asking would cost a forecast that is out of date for the whole race.
    mode: 'repeat',
    baseIntervalMs: 30_000,
    maxIntervalMs: 60_000,
    outputs: [
      forecastFor('forecastPractice', 'PRACTICE', 'practice'),
      forecastFor('forecastQualify', 'QUALIFY', 'qualify'),
      forecastFor('forecastRace', 'RACE', 'race'),
    ],
  },
  {
    id: LMU_TEAMS_TASK_ID,
    path: '/rest/multiplayer/teams',
    // Polled in bursts, never on a timer of its own. The sim lists a driver
    // here before it has their country -- the nationality arrives empty and
    // is filled in a little later -- so the single fetch per activation this
    // used to be caught most of a grid before its flags existed and never
    // asked again. The bridge starts a burst a second after a new driver
    // appears in an online session, and it runs until every driver on the
    // grid has a flag or sixteen seconds have gone by. Offline sessions have
    // no nationalities and never start one.
    mode: 'burst',
    baseIntervalMs: 2000,
    burstMs: 16_000,
    outputs: [nationalities],
  },
  {
    id: 'game-state',
    path: '/rest/sessions/GetGameState',
    mode: 'repeat',
    // Once a second, with no backoff: this decides whether the player is in
    // the car, so a change has to show promptly, and the body moves every
    // poll in any case -- it carries the time of day.
    baseIntervalMs: 1000,
    maxIntervalMs: 1000,
    // Never given up on. Its errors are answers -- 404 outside a game -- and
    // anything else just means the bridge reads shared memory until it
    // answers again.
    optional: true,
    // But not after one miss. A request that times out behind another on the
    // single socket says nothing about the player, and dropping to shared
    // memory for it would flicker a paused player out of the car -- the
    // frozen block reads as out. Three in a row, about three seconds.
    clearAfterFailures: 3,
    /** A 404 or an `unavailable` body still says where the player is. */
    answerFailure: (data, failure) => {
      const parsed = readLmuGameStateFailure(failure);
      if (!parsed) return false;
      data.gameState = parsed.state;
      return true;
    },
    outputs: [gameState],
  },
  {
    id: 'tire-management',
    path: '/rest/garage/UIScreen/TireManagement',
    // Once per session, like the other session-fixed payloads: the
    // compounds a car can run do not change inside a session.
    mode: 'once',
    baseIntervalMs: 2000,
    outputs: [compoundCatalogue],
  },
  {
    id: 'watch-standings',
    path: '/rest/watch/standings',
    mode: 'repeat',
    // Ten seconds, which is far slower than anything else here, and
    // deliberately so. This payload is the whole field with live positions,
    // velocities and lap fractions in it, so its body differs on every poll
    // however static the team names are -- the hash compare that makes the
    // other repeating tasks nearly free can never match, and the backoff can
    // never climb. Every poll therefore pays for a JSON.parse of tens of
    // kilobytes, and the only lever left is how often.
    //
    // Ten seconds is also enough to pick up a driver swap, which is the one
    // thing a `once` task would miss: the team is fixed per entry, but which
    // driver is in the car is not.
    baseIntervalMs: 10_000,
    // LMU serves this only once a session is live.
    optional: true,
    outputs: [
      {
        id: 'teamNames',
        target: 'session',
        parse: teamNames,
        // Almost always true: the teams are static for a session while the
        // body around them moves constantly. Without this, a session target
        // on such a body would rebuild the whole snapshot and broadcast it
        // every ten seconds, which is the hitch this endpoint is known for.
        unchanged: (data, value) =>
          sameTeams(data.session.teamNames, value as Record<number, string>),
        apply: (data, value) => {
          data.session.teamNames = value as Record<number, string>;
        },
      },
    ],
  },
  {
    id: 'watch-focus',
    path: '/rest/watch/focus',
    mode: 'repeat',
    // Fast, because this is the only channel that says which car the overlays
    // are about and it changes the instant the viewer presses a key. Cheap
    // enough to afford: the payload is one integer and the hash compare
    // rejects an unchanged body before any parsing.
    baseIntervalMs: 250,
    // A second, not the usual five. The backoff exists to stop re-reading a
    // pit menu nobody is touching; here, noticing the change promptly is the
    // whole feature, and taking five seconds to follow the camera would read
    // as not following it.
    maxIntervalMs: 1000,
    // LMU answers this in every in-session state -- driving, paused and at
    // the monitor alike -- and with an HTTP error outside a session: through
    // an eight-hour race with two long spells at the monitor it never once
    // stopped, and it stopped the moment the session was left. It is not a
    // spectator-view endpoint, as this comment used to say. Optional all the
    // same: the app runs in the menus too, where failing is the ordinary
    // state and not a fault to give up over, and only an optional task
    // drops its value when the path stops answering. What it answers in
    // each state has not been recorded; the bridge logs it when it changes.
    optional: true,
    outputs: [
      {
        id: 'focusCarIdx',
        // Telemetry, not session: the camera moves during a session, and a
        // session target would rebuild the whole snapshot on every change.
        target: 'telemetry',
        parse: focusSlot,
        apply: (data, value) => {
          data.cells.focusCarIdx = { value: [value as number] };
        },
        // The path stops answering when the session is left, and the last
        // slot it named belongs to that session. Kept, it would put every
        // overlay on whatever car holds that slot in the next one.
        clear: (data) => {
          delete data.cells.focusCarIdx;
        },
      },
    ],
  },
  {
    id: 'pitstop-estimate',
    path: '/rest/strategy/pitstop-estimate',
    mode: 'repeat',
    // A second is plenty: the estimate only moves when damage or the pit menu
    // changes, and the backoff takes it further out while it is static.
    baseIntervalMs: 1000,
    outputs: [
      numberCell('pitStopTime', ['total'], (data, value) => {
        data.cells.pitStopTime = value;
      }),
      numberCell('repairTime', ['damage'], (data, value) => {
        data.cells.repairTime = value;
      }),
      numberCell('penaltySeconds', ['penalties'], (data, value) => {
        data.cells.penaltySeconds = value;
      }),
      {
        id: 'pitStopParts',
        // The whole breakdown as one cell. Repairs and penalties are in it
        // as well as in cells of their own above, which came first and are
        // read by what was written against them.
        target: 'telemetry',
        parse: pitStopParts,
        apply: (data, value) => {
          data.cells.pitStopParts = { value: value as number[] };
        },
      },
    ],
  },
];
