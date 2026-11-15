import { describe, expect, it } from 'vitest';
import { CarLeftRight, TIMED_SESSION_LAPS } from '@irdashies/types';
import { lmuRawWithoutPlayerVehicle } from '../../testing/lmuTape';
import type { LmuGameState } from './gameState';
import { mapLmuTelemetry } from './mapTelemetry';
import { createLmuOpponentLapDistanceState } from './opponentLapDistance';
import type { LmuRawTelemetry } from './native';
import { lmuWatchedOwnEntryIdx } from './ownEntryKeys';
import { fixture } from './rawFixture';

/**
 * The keys that describe one car, while the user watches their own entry
 * with a team-mate at the wheel.
 *
 * The fixture is three cars in slots 0, 1 and 2, all out of their garages,
 * with the player in slot 1 and the car in slot 2 standing in its pit box.
 * A team-mate's stint is the same frame as the sim writes it with no player
 * vehicle -- the slot -1 and every single-car field gone -- and the bridge
 * saying which slot the user's own entry holds.
 */
const OWN = 1;
const RIVAL = 0;
const IN_PIT_BOX = 2;

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

/**
 * The fixture with a team-mate in the car, and each car's telemetry block
 * as the per-car arrays carry it: speed, clock and lap counter.
 */
const teamMateDriving = (): LmuRawTelemetry => ({
  ...lmuRawWithoutPlayerVehicle(fixture()),
  vehSpeed: [48.5, 61.5, 0],
  vehElapsedTime: [1250.6, 1160.25, 1250.6],
  vehLapNumber: [2, 3, 1],
  vehVirtualEnergy: [0.42, 0.37, 0],
});

const scalar = (frame: unknown, key: string): unknown =>
  (frame as Record<string, { value: unknown[] } | undefined>)[key]?.value[0];

const has = (frame: unknown, key: string): boolean =>
  (frame as Record<string, unknown>)[key] !== undefined;

describe('the single-car keys through a team-mate’s stint', () => {
  it('names the own entry as the player’s car', () => {
    const t = map(teamMateDriving());

    expect(scalar(t, 'PlayerCarIdx')).toBe(OWN);
    expect(scalar(t, 'PlayerCarPosition')).toBe(1);
    expect(scalar(t, 'PlayerCarClass')).toBe(0);
    // The front left of slot 1, which runs a wet front in the fixture.
    expect(scalar(t, 'PlayerTireCompound')).toBe(3);
    expect(scalar(t, 'PlayerTrackSurface')).toBe(3);
    expect(scalar(t, 'PlayerCarInPitStall')).toBe(false);
    expect(scalar(t, 'OnPitRoad')).toBe(false);
  });

  it('says where an own entry in the pits is', () => {
    const t = map(teamMateDriving(), { ownEntrySlot: IN_PIT_BOX });

    expect(scalar(t, 'PlayerCarIdx')).toBe(IN_PIT_BOX);
    expect(scalar(t, 'PlayerCarInPitStall')).toBe(true);
    expect(scalar(t, 'OnPitRoad')).toBe(true);
    expect(scalar(t, 'PlayerTrackSurface')).toBe(1);
  });

  it('carries its lap and its place on it, as published for its slot', () => {
    const t = map(teamMateDriving());

    // Three laps completed, so the fourth is being driven.
    expect(scalar(t, 'LapCompleted')).toBe(3);
    expect(scalar(t, 'Lap')).toBe(4);
    expect(scalar(t, 'LapDistPct')).toBe(0.6);
    expect(scalar(t, 'Lap')).toBe(t.CarIdxLap.value[OWN]);
    expect(scalar(t, 'LapDistPct')).toBe(t.CarIdxLapDistPct.value[OWN]);
  });

  it('carries the lap fraction the per-car integrator lifted to the poll rate', () => {
    const opponents = createLmuOpponentLapDistanceState();
    const frame = (elapsed: number): LmuRawTelemetry => ({
      ...teamMateDriving(),
      vehElapsedTime: [elapsed, elapsed, elapsed],
    });
    const at = (elapsed: number) =>
      mapLmuTelemetry(
        frame(elapsed),
        undefined,
        opponents,
        undefined,
        undefined,
        undefined,
        undefined,
        'monitor',
        undefined,
        undefined,
        undefined,
        OWN
      );

    at(1160);
    // A tenth of a second on, with scoring still on its last update: 6.15 m
    // at 61.5 m/s, on a lap of 7004 m.
    const t = at(1160.1);

    expect(scalar(t, 'LapDistPct')).toBeCloseTo(0.6 + 6.15 / 7004, 6);
    expect(scalar(t, 'LapDistPct')).toBe(t.CarIdxLapDistPct.value[OWN]);
    expect(scalar(t, 'Lap')).toBe(4);
  });

  it('carries its lap times and its sectors', () => {
    const t = map(teamMateDriving());

    expect(scalar(t, 'LapBestLapTime')).toBe(132.8);
    expect(scalar(t, 'LapLastLapTime')).toBe(133.4);
    const sectors = (key: string) =>
      (t as unknown as Record<string, { value: (number | null)[] }>)[key].value;
    expect(sectors('LmuCurrentSectorTimes')[0]).toBe(32.8);
    expect(sectors('LmuCurrentSectorTimes')[1]).toBeCloseTo(41.4);
    expect(sectors('LmuCurrentSectorTimes')[2]).toBeNull();
    expect(sectors('LmuLastSectorTimes')[0]).toBe(32.4);
    expect(sectors('LmuLastSectorTimes')[1]).toBeCloseTo(41);
    expect(sectors('LmuLastSectorTimes')[2]).toBeCloseTo(60);
    expect(sectors('LmuBestSectorTimes')[0]).toBe(32.1);
    // The sim's 2 is the second sector.
    expect(scalar(t, 'LmuSectorIdx')).toBe(1);
  });

  it('gives no lap time where the car has none', () => {
    const raw = teamMateDriving();
    raw.vehBestLapTime[OWN] = 0;
    raw.vehLastLapTime[OWN] = 0;

    const t = map(raw);

    expect(scalar(t, 'LapBestLapTime')).toBe(-1);
    expect(scalar(t, 'LapLastLapTime')).toBe(-1);
  });

  it('takes speed, energy and the lap clock from the car’s telemetry block', () => {
    const t = map(teamMateDriving());

    expect(scalar(t, 'Speed')).toBe(61.5);
    expect(scalar(t, 'LmuVirtualEnergy')).toBe(0.37);
    // The block's clock against the start of the lap: 1160.25 - 1100.
    expect(scalar(t, 'LapCurrentLapTime')).toBeCloseTo(60.25);
  });

  it('leaves speed and energy out where the sim sent the car no block', () => {
    const raw = teamMateDriving();
    raw.vehTelemetryAvailable[OWN] = 0;

    const t = map(raw);

    // Not 0: a car at speed that reads 0 is a lie, and so is an empty
    // budget.
    expect(has(t, 'Speed')).toBe(false);
    expect(has(t, 'LmuVirtualEnergy')).toBe(false);
    // The lap is still timed, by scoring's clock: 1250.5 - 1100.
    expect(scalar(t, 'LapCurrentLapTime')).toBeCloseTo(150.5);
    // And everything scoring writes is there as before.
    expect(scalar(t, 'Lap')).toBe(4);
    expect(scalar(t, 'LapLastLapTime')).toBe(133.4);
  });

  it('leaves energy out for a block that reports none', () => {
    const raw = teamMateDriving();
    // The addon's own word for a car with no reading.
    (raw.vehVirtualEnergy as number[])[OWN] = -1;

    expect(has(map(raw), 'LmuVirtualEnergy')).toBe(false);
  });

  it('counts down a lap-limited race from the own entry’s laps', () => {
    const race = { ...teamMateDriving(), session: 10, maxLaps: 12 };

    expect(scalar(map(race), 'SessionLapsRemain')).toBe(9);
    // A race against the clock has no laps to count down.
    expect(
      scalar(map({ ...race, maxLaps: 2147483647 }), 'SessionLapsRemain')
    ).toBe(TIMED_SESSION_LAPS);
  });

  it('leaves what only the player’s own telemetry block holds as it was', () => {
    const t = map(teamMateDriving());

    for (const key of [
      'FuelLevel',
      'dcBrakeBias',
      'dcABS',
      'LmuTyreSurfaceTemp',
      'LmuBrakeTemp',
      'LFwearM',
      'LmuStateOfCharge',
      'LatAccel',
    ]) {
      expect(has(t, key)).toBe(false);
    }
    // Neutral, as they always were with no player vehicle.
    expect(scalar(t, 'Throttle')).toBe(0);
    expect(scalar(t, 'Brake')).toBe(0);
    expect(scalar(t, 'Gear')).toBe(0);
    expect(scalar(t, 'RPM')).toBe(0);
    expect(scalar(t, 'LmuLapInvalidated')).toBe(false);
    expect(scalar(t, 'LapDeltaToSessionBestLap_OK')).toBe(false);
  });

  it('never has the user at the wheel, in the garage or paused', () => {
    const parked = teamMateDriving();
    parked.vehInGarageStall[OWN] = 1;

    for (const raw of [teamMateDriving(), parked]) {
      const t = map(raw);
      expect(scalar(t, 'IsOnTrack')).toBe(false);
      // The garage keys are the user's own car parked with them in it, and
      // the garage cover reads them: a team car in its stall is not that.
      expect(scalar(t, 'IsInGarage')).toBe(false);
      expect(scalar(t, 'IsGarageVisible')).toBe(false);
      expect(scalar(t, 'LmuGamePaused')).toBe(false);
      expect(scalar(t, 'CarLeftRight')).toBe(CarLeftRight.Off);
    }
  });

  it('says the user is out of the car, whatever the game state says', () => {
    // The pit flags are the team car's now, and the tests for driving OR
    // them with IsOnTrack.
    const inPits = { ownEntrySlot: IN_PIT_BOX };

    // At the monitor: the sim's own word.
    expect(scalar(map(teamMateDriving(), inPits), 'LmuOutOfCar')).toBe(true);
    // The second after a driver change in which it still says driving.
    expect(
      scalar(
        map(teamMateDriving(), { ...inPits, gameState: 'driving' }),
        'LmuOutOfCar'
      )
    ).toBe(true);
    // And with LMU's REST API not answering, where it says nothing.
    const silent = mapLmuTelemetry(
      teamMateDriving(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      IN_PIT_BOX
    );
    expect(scalar(silent, 'OnPitRoad')).toBe(true);
    expect(scalar(silent, 'LmuOutOfCar')).toBe(true);
    expect(scalar(silent, 'IsOnTrack')).toBe(false);
  });

  it('describes the own entry and never the car the camera is on', () => {
    const t = map(teamMateDriving(), { focus: RIVAL });

    expect(scalar(t, 'CamCarIdx')).toBe(RIVAL);
    expect(scalar(t, 'PlayerCarIdx')).toBe(OWN);
    expect(scalar(t, 'Lap')).toBe(4);
    expect(scalar(t, 'LapDistPct')).toBe(0.6);
    expect(scalar(t, 'LapLastLapTime')).toBe(133.4);
    expect(scalar(t, 'Speed')).toBe(61.5);
    expect(scalar(t, 'PlayerCarPosition')).toBe(1);
  });
});

describe('the single-car keys when they are not the own entry’s to fill', () => {
  it('are the player’s own while the player has a vehicle', () => {
    // An entry remembered from another slot: the sim's word comes first.
    const withVehicle = map(fixture(), {
      gameState: 'driving',
      ownEntrySlot: RIVAL,
    });
    const asBefore = mapLmuTelemetry(fixture());

    expect(scalar(withVehicle, 'PlayerCarIdx')).toBe(OWN);
    for (const key of [
      'Lap',
      'LapCompleted',
      'LapDistPct',
      'LapBestLapTime',
      'LapLastLapTime',
      'LapCurrentLapTime',
      'Speed',
      'LmuSectorIdx',
      'OnPitRoad',
      'PlayerCarInPitStall',
      'PlayerCarPosition',
      'LmuVirtualEnergy',
    ]) {
      expect(scalar(withVehicle, key)).toEqual(scalar(asBefore, key));
    }
    expect(scalar(withVehicle, 'LmuOutOfCar')).toBe(false);
  });

  it('are empty with no own entry, as they were', () => {
    const t = map(teamMateDriving(), { ownEntrySlot: -1 });

    expect(scalar(t, 'PlayerCarIdx')).toBe(-1);
    expect(scalar(t, 'Lap')).toBe(0);
    expect(scalar(t, 'LapDistPct')).toBe(0);
    expect(scalar(t, 'LapLastLapTime')).toBe(-1);
    expect(scalar(t, 'Speed')).toBe(0);
    expect(scalar(t, 'OnPitRoad')).toBe(false);
  });

  it('are empty once the own entry has left the grid', () => {
    // Resolved on a session snapshot, up to half a second before the frame.
    const raw = teamMateDriving();
    raw.vehLapDistPct[OWN] = -1;

    const t = map(raw);

    expect(scalar(t, 'PlayerCarIdx')).toBe(-1);
    expect(scalar(t, 'Lap')).toBe(0);
    expect(scalar(t, 'OnPitRoad')).toBe(false);
  });

  it('take a slot only from a frame that holds a car there', () => {
    const raw = teamMateDriving();

    expect(lmuWatchedOwnEntryIdx(raw, -1, OWN)).toBe(OWN);
    expect(lmuWatchedOwnEntryIdx(raw, -1, -1)).toBe(-1);
    expect(lmuWatchedOwnEntryIdx(raw, -1, 40)).toBe(-1);
    expect(lmuWatchedOwnEntryIdx(raw, -1, 1.5)).toBe(-1);
    // The player's vehicle is the mapper's own to describe.
    expect(lmuWatchedOwnEntryIdx(raw, OWN, OWN)).toBe(-1);
  });
});
