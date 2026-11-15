import { describe, expect, it } from 'vitest';
import { LMU_DIAL_KEYS } from '@irdashies/types';
import type { LmuGameState } from './gameState';
import { mapLmuSession } from './mapSession';
import { mapLmuTelemetry } from './mapTelemetry';
import type { LmuRawSession, LmuRawTelemetry } from './native';
import {
  describeLmuOwnEntryBlock,
  lmuBlockSlotToRead,
  lmuHasOwnEntryBlock,
  lmuOwnEntryBlockStatus,
  lmuPublishedBlock,
  writeLmuOwnEntryBlockKeys,
} from './ownEntryBlock';
import { fixture } from './rawFixture';
import { fixture as sessionFixture } from './rawSessionFixture';

/**
 * The telemetry block of the user's own entry while a team-mate drives it:
 * which block is asked for, what is taken from it, and what the frame and
 * the session built from it hold.
 *
 * The fixture is three cars in slots 0, 1 and 2 with the player in slot 1.
 * A team-mate's stint is that frame as the addon returns it when asked for
 * slot 1's block with no player vehicle: the slot -1, `blockSlot` 1, and the
 * single-car fields those of the car in slot 1. What a block holds for a car
 * the user is not in was measured on the recorded race, where every other
 * car is the AI's: the tyre temperatures and pressures, the brake pressures,
 * the engine temperatures, the dials and the ABS and traction control lights
 * are zero, and the rest is live.
 */
const OWN = 1;
const RIVAL = 0;

/** scoring's mControl. */
const AI = 1;
const REMOTE = 2;
const REPLAY = 3;

/** The fixture's block with what the sim leaves unwritten for another car. */
const UNWRITTEN: Partial<LmuRawTelemetry> = {
  engineWaterTemp: 0,
  engineOilTemp: 0,
  steeringShaftTorque: 0,
  absActive: false,
  tcActive: false,
  abs: 0,
  absMax: 0,
  tc: 0,
  tcMax: 0,
  tcSlip: 0,
  tcSlipMax: 0,
  tcCut: 0,
  tcCutMax: 0,
  motorMap: 0,
  motorMapMax: 0,
  migration: 0,
  migrationMax: 0,
  frontAntiSway: 0,
  frontAntiSwayMax: 0,
  rearAntiSway: 0,
  rearAntiSwayMax: 0,
  // The addon's average of three zones at 0 K, in Celsius.
  tyreTemperature: new Float64Array([-273.15, -273.15, -273.15, -273.15]),
  tyrePressure: new Float64Array(4),
  brakePressure: new Float64Array(4),
  tyreSurfaceTemperatureRaw: new Float64Array(12),
  tyreInnerLayerTemperatureRaw: new Float64Array(12),
  tyreCarcassTemperatureRaw: new Float64Array(4),
  wheelCamber: new Float64Array(4),
  wheelToe: new Float64Array(4),
};

/**
 * The fixture as read for the own entry's block with a team-mate driving,
 * the car in slot 1 driven as `control` says, or null where the snapshot
 * does not say.
 */
const teamMateBlock = (
  control: number | null = AI,
  overrides: Partial<LmuRawTelemetry> = {}
): LmuRawTelemetry => ({
  ...fixture(),
  ...UNWRITTEN,
  playerHasVehicle: false,
  playerVehicleIdx: -1,
  blockSlot: OWN,
  // The block's speed is the one the per-car array carries for the slot.
  speed: 61.5,
  vehSpeed: [48.5, 61.5, 0],
  vehElapsedTime: [1250.6, 1160.25, 1250.6],
  vehLapNumber: [2, 3, 1],
  ...(control === null ? {} : { vehControl: [AI, control, AI] }),
  ...overrides,
});

interface Scene {
  gameState?: LmuGameState;
  focus?: number;
  ownEntrySlot?: number;
}

const map = (
  raw: LmuRawTelemetry,
  { gameState = 'monitor', focus, ownEntrySlot = OWN }: Scene = {}
) =>
  mapLmuTelemetry(
    raw,
    undefined,
    undefined,
    focus === undefined ? undefined : { focusCarIdx: { value: [focus] } },
    undefined,
    undefined,
    undefined,
    gameState,
    undefined,
    undefined,
    undefined,
    ownEntrySlot
  );

const scalar = (frame: unknown, key: string): unknown =>
  (frame as Record<string, { value: unknown[] } | undefined>)[key]?.value[0];

const values = (frame: unknown, key: string): unknown[] | undefined =>
  (frame as Record<string, { value: unknown[] } | undefined>)[key]?.value;

const has = (frame: unknown, key: string): boolean =>
  (frame as Record<string, unknown>)[key] !== undefined;

const CORNERS = ['LF', 'RF', 'LR', 'RR'] as const;

/** Keys the sim gives a reading for only in the block of the player's car. */
const PLAYER_ONLY_KEYS = [
  'LmuTyreSurfaceTemp',
  'LmuTyreInnerLayerTemp',
  'LmuTyreCarcassTemp',
  'LmuTyreOptimalTemp',
  ...CORNERS.flatMap((corner) => [
    `${corner}tempCL`,
    `${corner}tempCM`,
    `${corner}tempCR`,
    `${corner}coldPressure`,
    `${corner}brakeLinePress`,
    `${corner}shockDefl`,
  ]),
  'WaterTemp',
  'OilTemp',
  ...LMU_DIAL_KEYS,
  'LmuDialMax',
  'dcBrakeBias',
  'BrakeABSactive',
  'LmuTcActive',
  'LmuWiper',
  'LmuFrontWheelAngle',
  'LmuStateOfCharge',
  'LmuRegen',
  'LatAccel',
  'LongAccel',
  'VelocityX',
  'LmuPlayerWorldPos',
  'LmuWheelRideHeight',
  'LmuWheelCamber',
  'LmuWheelToe',
  'LmuDentSeverity',
  'LmuLastImpactTime',
  'LmuMotorState',
] as const;

const WEAR_KEYS = CORNERS.flatMap((corner) => [
  `${corner}wearL`,
  `${corner}wearM`,
  `${corner}wearR`,
]);

describe('lmuBlockSlotToRead', () => {
  it('asks for the own entry’s block only while the sim names no player vehicle', () => {
    expect(lmuBlockSlotToRead(false, 7)).toBe(7);
    expect(lmuBlockSlotToRead(false, 0)).toBe(0);
    // At the wheel the read takes no argument, as it always did.
    expect(lmuBlockSlotToRead(true, 7)).toBeUndefined();
  });

  it('asks for none when no own entry is known', () => {
    expect(lmuBlockSlotToRead(false, -1)).toBeUndefined();
    expect(lmuBlockSlotToRead(false, Number.NaN)).toBeUndefined();
    expect(lmuBlockSlotToRead(false, 1.5)).toBeUndefined();
  });
});

describe('lmuPublishedBlock', () => {
  it('hands back the very snapshot when the block is the player’s own', () => {
    const atWheel = { ...fixture(), blockSlot: 1 };
    expect(lmuPublishedBlock(atWheel, OWN)).toBe(atWheel);
    // An addon from before a block could be asked for names none.
    const older = fixture();
    expect(lmuPublishedBlock(older, OWN)).toBe(older);
  });

  it('hands back the very snapshot when it carries no block', () => {
    const noBlock = { ...teamMateBlock(), blockSlot: -1 };
    expect(lmuPublishedBlock(noBlock, OWN)).toBe(noBlock);
  });

  it('keeps what the sim writes for a car the user is not driving', () => {
    const raw = teamMateBlock(AI);
    const published = lmuPublishedBlock(raw, OWN);

    expect(published.blockSlot).toBe(OWN);
    expect(lmuHasOwnEntryBlock(published)).toBe(true);
    expect(published).toMatchObject({
      gear: 5,
      maxGears: 6,
      engineRPM: 8200,
      engineMaxRPM: 9000,
      unfilteredThrottle: 0.8,
      unfilteredBrake: 0,
      unfilteredClutch: 0,
      unfilteredSteering: -0.3,
      filteredThrottle: 0.79,
      filteredBrake: 0,
      filteredClutch: 0,
      filteredSteering: -0.29,
      visualSteeringWheelRange: 480,
      physicalSteeringWheelRange: 0,
      speed: 61.5,
      fuel: 42,
      fuelCapacity: 110,
    });
    expect(published.brakeTemperatureRaw).toBe(raw.brakeTemperatureRaw);
    expect(published.tyreWear).toBe(raw.tyreWear);
  });

  it('drops every other single-car field, written or not', () => {
    // The fixture's own block, with a reading in every field: nothing is
    // passed on because it happens to be there.
    const raw = {
      ...fixture(),
      playerHasVehicle: false,
      playerVehicleIdx: -1,
      blockSlot: OWN,
      vehControl: [AI, AI, AI],
    };
    const published = lmuPublishedBlock(raw, OWN) as unknown as Record<
      string,
      unknown
    >;

    for (const field of [
      'engineWaterTemp',
      'engineOilTemp',
      'clutchRPM',
      'steeringShaftTorque',
      'rearBrakeBias',
      'lapNumber',
      'elapsedTime',
      'lapStartET',
      'currentSector',
      'lapInvalidated',
      'speedLimiter',
      'absActive',
      'tcActive',
      'ignitionStarter',
      'deltaBest',
      'vehicleName',
      'frontTireCompoundName',
      'localVel',
      'localAccel',
      'pos',
      'tyreTemperature',
      'tyrePressure',
      'brakePressure',
      'suspensionDeflection',
      'tyreSurfaceTemperatureRaw',
      'tyreInnerLayerTemperatureRaw',
      'tyreCarcassTemperatureRaw',
      'tyreOptimalTemperatureRaw',
      'wheelRideHeight',
      'wheelToe',
      'dentSeverity',
      'lastImpactET',
      'electricBoostMotorState',
      'wiperState',
    ]) {
      expect(published[field], field).toBeUndefined();
    }
  });

  it('keeps the session and every per-car array as they were', () => {
    const raw = teamMateBlock(AI);
    const published = lmuPublishedBlock(raw, OWN) as unknown as Record<
      string,
      unknown
    >;
    const source = raw as unknown as Record<string, unknown>;

    for (const key of Object.keys(source)) {
      if (/^veh[A-Z]/.test(key)) expect(published[key], key).toBe(source[key]);
    }
    for (const key of [
      'running',
      'trackName',
      'session',
      'currentET',
      'lapDist',
      'gamePhase',
      'sectorFlags',
      'wind',
      'startLight',
      'ffbTorque',
      'playerHasVehicle',
      'playerVehicleIdx',
      'activeVehicles',
    ]) {
      expect(published[key], key).toBe(source[key]);
    }
  });

  it('keeps a session read’s grid and classes', () => {
    const raw: LmuRawSession = {
      ...sessionFixture(),
      playerHasVehicle: false,
      playerVehicleIdx: -1,
      blockSlot: OWN,
      vehLapDistPct: new Float64Array([0.4, 0.6, 0.2]),
      vehControl: [AI, AI, AI],
    };
    const published = lmuPublishedBlock(raw, OWN);

    expect(published.drivers).toBe(raw.drivers);
    expect(published.classes).toBe(raw.classes);
  });

  it('does not change the snapshot it was given', () => {
    const raw = teamMateBlock(REMOTE);
    const before = { ...raw };
    lmuPublishedBlock(raw, OWN);
    expect(raw).toEqual(before);
  });

  it.each([
    ['somebody on another machine', REMOTE],
    ['a replay', REPLAY],
    ['nobody the snapshot names', null],
  ])(
    'withholds the fuel and the wear of a car driven by %s',
    (_name, control) => {
      const published = lmuPublishedBlock(teamMateBlock(control), OWN);

      expect(published.fuel).toBeUndefined();
      expect(published.fuelCapacity).toBeUndefined();
      expect(published.tyreWear).toBeUndefined();
      // The pedals, the revs and the brakes are passed on whoever drives.
      expect(published.filteredThrottle).toBe(0.79);
      expect(published.engineRPM).toBe(8200);
      expect(published.brakeTemperatureRaw).toBeDefined();
    }
  );

  it.each([
    ['the AI', AI],
    ['the player', 0],
  ])(
    'passes on the fuel and the wear of a car %s drives here',
    (_n, control) => {
      const published = lmuPublishedBlock(teamMateBlock(control), OWN);

      expect(published.fuel).toBe(42);
      expect(published.fuelCapacity).toBe(110);
      expect(published.tyreWear).toBeDefined();
    }
  );

  it('takes no fuel from a block that states no tank, and no wear from one that states none', () => {
    const published = lmuPublishedBlock(
      teamMateBlock(AI, { fuelCapacity: 0, tyreWear: new Float64Array(4) }),
      OWN
    );

    expect(published.fuel).toBeUndefined();
    expect(published.fuelCapacity).toBeUndefined();
    expect(published.tyreWear).toBeUndefined();
    expect(published.engineRPM).toBe(8200);
  });

  it('takes nothing from a block the sim has not filled in', () => {
    // A block of zeros: a car with no rev limit is a struct nobody wrote.
    const published = lmuPublishedBlock(
      teamMateBlock(AI, { engineMaxRPM: 0, engineRPM: 0, gear: 0 }),
      OWN
    );

    expect(published.blockSlot).toBe(-1);
    expect(lmuHasOwnEntryBlock(published)).toBe(false);
    expect(published.gear).toBeUndefined();
    expect(published.filteredThrottle).toBeUndefined();
    expect(published.brakeTemperatureRaw).toBeUndefined();
    expect(published.fuel).toBeUndefined();
  });

  it('takes nothing from the block of a car that is not the own entry', () => {
    // The caller never asks for one. Should one arrive -- the camera's car,
    // say -- it is not published under the own entry's keys.
    const rivals = { ...teamMateBlock(AI), blockSlot: RIVAL };
    const published = lmuPublishedBlock(rivals, OWN);

    expect(published.blockSlot).toBe(-1);
    expect(published.gear).toBeUndefined();
    expect(published.engineRPM).toBeUndefined();
    expect(published.fuel).toBeUndefined();
    expect(published.vehSpeed).toBe(rivals.vehSpeed);
  });

  it('takes nothing when no own entry is known, or its slot is empty', () => {
    expect(lmuPublishedBlock(teamMateBlock(AI), -1).gear).toBeUndefined();
    const left = teamMateBlock(AI, {
      vehLapDistPct: new Float64Array([0.4, -1, 0.2]),
    });
    expect(lmuPublishedBlock(left, OWN).gear).toBeUndefined();
  });

  it('takes nothing from another car’s block while the player has a vehicle', () => {
    // The frame the user is back in the car on, read while the last one
    // still said they were out: the bridge reads it again, and the mapper
    // does not publish the wrong car in the meantime.
    const mismatched = { ...fixture(), blockSlot: RIVAL };
    const published = lmuPublishedBlock(mismatched, RIVAL);

    expect(published.playerHasVehicle).toBe(true);
    expect(published.playerVehicleIdx).toBe(1);
    expect(published.blockSlot).toBe(-1);
    expect(published.gear).toBeUndefined();
    expect(published.fuel).toBeUndefined();
  });
});

describe('writeLmuOwnEntryBlockKeys', () => {
  const frame = () => ({
    WaterTemp: { value: [0] },
    OilTemp: { value: [0] },
    BrakeABSactive: { value: [false] },
    FuelLevelPct: { value: [0] },
    RPM: { value: [8200] },
  });

  it('marks a frame built from the own entry’s block, and takes out the zeros', () => {
    const t = frame();
    writeLmuOwnEntryBlockKeys(t, lmuPublishedBlock(teamMateBlock(REMOTE), OWN));

    expect(t).toEqual({
      RPM: { value: [8200] },
      LmuOwnEntryTelemetry: { value: [true] },
    });
  });

  it('keeps the fuel fraction where the block gave the fuel', () => {
    const t = frame();
    writeLmuOwnEntryBlockKeys(t, lmuPublishedBlock(teamMateBlock(AI), OWN));

    expect(t.FuelLevelPct).toEqual({ value: [0] });
    expect(has(t, 'LmuOwnEntryTelemetry')).toBe(true);
  });

  it.each([
    ['the player’s own block', { ...fixture(), blockSlot: 1 }],
    ['no block', { ...teamMateBlock(), blockSlot: -1 }],
    ['an addon that names no block', fixture()],
  ])('leaves a frame built from %s as it was', (_name, raw) => {
    const t = frame();
    writeLmuOwnEntryBlockKeys(t, lmuPublishedBlock(raw, OWN));
    expect(t).toEqual(frame());
  });
});

describe('the frame through a team-mate’s stint, with the own entry’s block read', () => {
  it('carries the pedals, as pressed and as the car received them', () => {
    const t = map(teamMateBlock());

    expect(scalar(t, 'Throttle')).toBe(0.79);
    expect(scalar(t, 'ThrottleRaw')).toBe(0.8);
    expect(scalar(t, 'Brake')).toBe(0);
    expect(scalar(t, 'BrakeRaw')).toBe(0);
    // LMU's clutch reads 0 with the pedal up, iRacing's key 1.
    expect(scalar(t, 'Clutch')).toBe(1);
    expect(scalar(t, 'ClutchRaw')).toBe(1);
  });

  it('carries the steering, on the range the block states', () => {
    const t = map(teamMateBlock());

    // 29 % of the way to the right-hand lock of a 480 degree wheel; iRacing's
    // key is radians, positive to the left.
    expect(scalar(t, 'SteeringWheelAngle')).toBeCloseTo(
      0.29 * ((480 * Math.PI) / 360),
      9
    );
    expect(scalar(t, 'SteeringWheelAngleMax')).toBeCloseTo(
      (480 * Math.PI) / 180,
      9
    );
  });

  it('carries the gear, the revs, the rev limit and the speed', () => {
    const t = map(teamMateBlock());

    expect(scalar(t, 'Gear')).toBe(5);
    expect(scalar(t, 'RPM')).toBe(8200);
    expect(scalar(t, 'ShiftGrindRPM')).toBe(9000);
    expect(scalar(t, 'Speed')).toBe(61.5);
  });

  it('carries the brake temperatures in Celsius', () => {
    const t = map(teamMateBlock());
    const brakes = values(t, 'LmuBrakeTemp') as number[];

    expect(brakes).toHaveLength(4);
    [400, 410, 300, 310].forEach((celsius, wheel) =>
      expect(brakes[wheel]).toBeCloseTo(celsius, 6)
    );
  });

  it('carries the wear and the fuel of a car the AI drives', () => {
    const t = map(teamMateBlock(AI));

    expect(scalar(t, 'LFwearM')).toBe(0.9);
    expect(scalar(t, 'RFwearL')).toBe(0.8);
    expect(scalar(t, 'LRwearR')).toBe(0.7);
    expect(scalar(t, 'RRwearM')).toBe(0.6);
    expect(scalar(t, 'FuelLevel')).toBe(42);
    expect(scalar(t, 'FuelLevelPct')).toBeCloseTo(42 / 110, 9);
  });

  it('leaves out the wear and the fuel of a car a person is driving elsewhere', () => {
    const t = map(teamMateBlock(REMOTE));

    for (const key of WEAR_KEYS) expect(has(t, key), key).toBe(false);
    expect(has(t, 'FuelLevel')).toBe(false);
    expect(has(t, 'FuelLevelPct')).toBe(false);
    // Not the pedals, the revs or the brakes.
    expect(scalar(t, 'Throttle')).toBe(0.79);
    expect(scalar(t, 'RPM')).toBe(8200);
    expect(has(t, 'LmuBrakeTemp')).toBe(true);
  });

  it('leaves out the fuel where the block states no tank', () => {
    const t = map(teamMateBlock(AI, { fuelCapacity: 0 }));

    expect(has(t, 'FuelLevel')).toBe(false);
    expect(has(t, 'FuelLevelPct')).toBe(false);
  });

  it.each([
    ['as the sim leaves them, at zero', teamMateBlock()],
    [
      'even with a reading in them',
      {
        ...fixture(),
        playerHasVehicle: false,
        playerVehicleIdx: -1,
        blockSlot: OWN,
        vehControl: [AI, AI, AI],
        abs: 3,
        absMax: 9,
        tc: 4,
        tcMax: 11,
      } as LmuRawTelemetry,
    ],
  ])(
    'leaves out what the sim writes for the player’s car alone, %s',
    (_name, raw) => {
      const t = map(raw);

      for (const key of PLAYER_ONLY_KEYS) expect(has(t, key), key).toBe(false);
    }
  );

  it('says the block-only keys are live for the own entry', () => {
    expect(scalar(map(teamMateBlock()), 'LmuOwnEntryTelemetry')).toBe(true);
  });

  it('stays a frame the user is watching, not driving', () => {
    const t = map(teamMateBlock());

    expect(scalar(t, 'IsOnTrack')).toBe(false);
    expect(scalar(t, 'LmuOutOfCar')).toBe(true);
    expect(scalar(t, 'LmuWatching')).toBe(true);
    expect(scalar(t, 'PlayerCarIdx')).toBe(OWN);
    expect(scalar(t, 'CamCarIdx')).toBe(OWN);
    expect(scalar(t, 'IsInGarage')).toBe(false);
    // The blind spot is about the user being in a car.
    expect(scalar(t, 'CarLeftRight')).toBe(0);
  });

  it('goes on describing the own entry with the camera on another car', () => {
    const t = map(teamMateBlock(), { focus: RIVAL });

    expect(scalar(t, 'CamCarIdx')).toBe(RIVAL);
    expect(scalar(t, 'PlayerCarIdx')).toBe(OWN);
    expect(scalar(t, 'Gear')).toBe(5);
    expect(scalar(t, 'RPM')).toBe(8200);
    expect(scalar(t, 'Speed')).toBe(61.5);
    expect(scalar(t, 'LmuOwnEntryTelemetry')).toBe(true);
  });

  it('publishes nothing of a block the sim has not filled in', () => {
    const t = map(teamMateBlock(AI, { engineMaxRPM: 0 }));

    expect(has(t, 'LmuOwnEntryTelemetry')).toBe(false);
    expect(has(t, 'LmuBrakeTemp')).toBe(false);
    expect(has(t, 'FuelLevel')).toBe(false);
    for (const key of WEAR_KEYS) expect(has(t, key), key).toBe(false);
    // The frame is the one a snapshot with no block at all gives: nothing
    // tells a widget these are live, and none shows them.
    expect(scalar(t, 'RPM')).toBe(0);
    expect(scalar(t, 'Gear')).toBe(0);
    expect(scalar(t, 'Throttle')).toBe(0);
  });

  it('publishes nothing of a block that is not the own entry’s', () => {
    const t = map({ ...teamMateBlock(AI), blockSlot: RIVAL });

    expect(has(t, 'LmuOwnEntryTelemetry')).toBe(false);
    expect(scalar(t, 'RPM')).toBe(0);
    expect(scalar(t, 'Gear')).toBe(0);
    expect(scalar(t, 'Throttle')).toBe(0);
    expect(has(t, 'FuelLevel')).toBe(false);
    expect(has(t, 'LmuBrakeTemp')).toBe(false);
  });

  it('is the frame it always was at the wheel, whatever the addon says of the block', () => {
    const plain = mapLmuTelemetry(fixture());
    const named = mapLmuTelemetry({ ...fixture(), blockSlot: 1 });

    expect(named).toEqual(plain);
    expect(has(named, 'LmuOwnEntryTelemetry')).toBe(false);
    expect(scalar(named, 'WaterTemp')).toBe(95);
    expect(has(named, 'LmuTyreSurfaceTemp')).toBe(true);
  });
});

describe('the session through a team-mate’s stint, with the own entry’s block read', () => {
  const stint = (
    control: number,
    overrides: Partial<LmuRawSession> = {}
  ): LmuRawSession => ({
    ...sessionFixture(),
    playerHasVehicle: false,
    playerVehicleIdx: -1,
    blockSlot: OWN,
    engineMaxRPM: 7800,
    maxGears: 7,
    fuel: 30,
    fuelCapacity: 75,
    vehLapDistPct: new Float64Array([0.4, 0.6, 0.2]),
    vehControl: [AI, control, AI],
    ...overrides,
  });
  const session = (raw: LmuRawSession, ownEntrySlot = OWN) =>
    mapLmuSession(raw, null, undefined, undefined, undefined, ownEntrySlot);

  it('takes the rev limit and the gear count from the own entry’s block', () => {
    const { DriverInfo } = session(stint(REMOTE));

    expect(DriverInfo.DriverCarIdx).toBe(OWN);
    expect(DriverInfo.DriverCarRedLine).toBe(7800);
    expect(DriverInfo.DriverCarGearNumForward).toBe(7);
  });

  it('takes the tank size with the fuel: only for a car simulated here', () => {
    expect(session(stint(AI)).DriverInfo.DriverCarFuelMaxLtr).toBe(75);
    expect(session(stint(REMOTE)).DriverInfo.DriverCarFuelMaxLtr).toBe(0);
  });

  it('takes none of them from another car’s block', () => {
    const { DriverInfo } = session(stint(AI, { blockSlot: RIVAL }));

    // The figures a session has with no block at all.
    expect(DriverInfo.DriverCarRedLine).not.toBe(7800);
    expect(DriverInfo.DriverCarGearNumForward).toBe(6);
    expect(DriverInfo.DriverCarFuelMaxLtr).toBe(0);
  });
});

describe('the log line about the own entry’s block', () => {
  it('tells apart no block, an unwritten one and a written one', () => {
    const none = { ...teamMateBlock(REMOTE), blockSlot: -1 };
    const unwritten = teamMateBlock(REMOTE, { engineMaxRPM: 0 });
    const written = teamMateBlock(REMOTE);

    expect(lmuOwnEntryBlockStatus(written, undefined)).toBe(-1);
    const statuses = [
      lmuOwnEntryBlockStatus(none, OWN),
      lmuOwnEntryBlockStatus(unwritten, OWN),
      lmuOwnEntryBlockStatus(written, OWN),
      lmuOwnEntryBlockStatus(teamMateBlock(AI), OWN),
      lmuOwnEntryBlockStatus(teamMateBlock(null), OWN),
      lmuOwnEntryBlockStatus({ ...written, blockSlot: 2 }, 2),
    ];
    expect(new Set(statuses).size).toBe(statuses.length);
    expect(statuses.every((status) => status >= 0)).toBe(true);
    // The same snapshot, the same number.
    expect(lmuOwnEntryBlockStatus(teamMateBlock(REMOTE), OWN)).toBe(
      statuses[2]
    );
  });

  it('says there is no block for the slot', () => {
    expect(
      describeLmuOwnEntryBlock({ ...teamMateBlock(REMOTE), blockSlot: -1 }, OWN)
    ).toBe(
      'Own entry telemetry block: none for slot 1; control=2 (another ' +
        'machine). The pedals, revs and brakes of the car are not being read'
    );
  });

  it('says what the block holds, as the sim wrote it', () => {
    expect(describeLmuOwnEntryBlock(teamMateBlock(REMOTE), OWN)).toBe(
      'Own entry telemetry block: slot 1; control=2 (another machine); ' +
        'rev limit 9000, revs 8200, gear 5, throttle 0.79, brake 0.00, ' +
        'steering -0.29; fuel 42.0 of 110.0 L; virtual energy none; ' +
        'tyre wear 0.900 0.800 0.700 0.600; brake temp 673 683 573 583; ' +
        'tyre carcass temp 0 0 0 0; tyre pressure 0 0 0 0; water 0; TC max 0'
    );
  });

  it('says a block was not filled in, and whose car it is when scoring does not', () => {
    const line = describeLmuOwnEntryBlock(
      teamMateBlock(null, { engineMaxRPM: 0 }),
      OWN
    );

    expect(line).toContain('control not stated');
    expect(line).toContain('rev limit 0 (not filled in, so not read)');
  });
});
