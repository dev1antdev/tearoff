import { describe, expect, it } from 'vitest';
import { lmuRawWithoutPlayerVehicle } from '../../testing/lmuTape';
import type { LmuGameState } from './gameState';
import { mapLmuTelemetry } from './mapTelemetry';
import type { LmuRawTelemetry } from './native';
import { fixture } from './rawFixture';

/**
 * The frame while the user watches a car rather than drives one: which car
 * the overlays are about (CamCarIdx), and whether that counts as watching
 * (LmuWatching).
 *
 * The fixture is three cars in slots 0, 1 and 2, all out of their garages,
 * with the player in slot 1 and the car in slot 2 standing in its pit box.
 */
const PLAYER = 1;
const RIVAL = 0;
const IN_PIT_BOX = 2;

interface Scene {
  gameState?: LmuGameState;
  /** What LMU's focus endpoint says; absent when it has not answered. */
  focus?: number;
  /** The own entry the bridge remembered; -1 when it has none. */
  ownEntrySlot?: number;
  dataFrozen?: boolean;
}

const map = (
  raw: LmuRawTelemetry,
  { gameState, focus, ownEntrySlot, dataFrozen }: Scene = {}
) =>
  mapLmuTelemetry(
    raw,
    undefined,
    undefined,
    focus === undefined ? undefined : { focusCarIdx: { value: [focus] } },
    undefined,
    dataFrozen,
    undefined,
    gameState,
    undefined,
    undefined,
    undefined,
    ownEntrySlot
  );

/** The fixture as the sim writes it with a team-mate in the car. */
const noPlayerVehicle = (): LmuRawTelemetry =>
  lmuRawWithoutPlayerVehicle(fixture());

const inGarage = (raw: LmuRawTelemetry, slot: number): LmuRawTelemetry => {
  raw.vehInGarageStall[slot] = 1;
  return raw;
};

const camCarIdx = (raw: LmuRawTelemetry, scene: Scene = {}) =>
  map(raw, scene).CamCarIdx?.value[0];

const watching = (raw: LmuRawTelemetry, scene: Scene = {}) =>
  map(raw, scene).LmuWatching?.value[0];

describe('the car the overlays are about under Le Mans Ultimate', () => {
  describe('with the player in a car', () => {
    it('is the player’s car when the sim’s camera names none', () => {
      expect(camCarIdx(fixture())).toBe(PLAYER);
      expect(camCarIdx(fixture(), { focus: -1 })).toBe(PLAYER);
    });

    it('is the car the camera is on when it names one', () => {
      expect(camCarIdx(fixture(), { focus: IN_PIT_BOX })).toBe(IN_PIT_BOX);
      expect(camCarIdx(fixture(), { focus: 0 })).toBe(0);
    });

    it('never falls back to a remembered entry', () => {
      // Remembered from a different car, say; the sim's word comes first.
      expect(camCarIdx(fixture(), { ownEntrySlot: RIVAL })).toBe(PLAYER);
    });
  });

  describe('with no player vehicle', () => {
    it('is the user’s own entry when the camera names none', () => {
      expect(camCarIdx(noPlayerVehicle(), { ownEntrySlot: PLAYER })).toBe(
        PLAYER
      );
      expect(
        camCarIdx(noPlayerVehicle(), { focus: -1, ownEntrySlot: PLAYER })
      ).toBe(PLAYER);
    });

    it('is the car the camera is on when it names one', () => {
      expect(
        camCarIdx(noPlayerVehicle(), { focus: RIVAL, ownEntrySlot: PLAYER })
      ).toBe(RIVAL);
    });

    it('is no car when nothing says which', () => {
      expect(camCarIdx(noPlayerVehicle())).toBe(-1);
      expect(camCarIdx(noPlayerVehicle(), { focus: -1 })).toBe(-1);
      expect(camCarIdx(noPlayerVehicle(), { ownEntrySlot: -1 })).toBe(-1);
    });

    it('leaves the player’s own slot empty: the car is watched, not driven', () => {
      const t = map(noPlayerVehicle(), {
        gameState: 'monitor',
        ownEntrySlot: PLAYER,
      });

      expect(t.CamCarIdx?.value[0]).toBe(PLAYER);
      expect(t.PlayerCarIdx?.value[0]).toBe(-1);
      expect(t.IsOnTrack.value[0]).toBe(false);
    });
  });
});

describe('watching a car under Le Mans Ultimate', () => {
  /** A team-mate's stint: no player vehicle, the own entry remembered. */
  const teamMate = (scene: Scene = {}): Scene => ({
    gameState: 'monitor',
    ownEntrySlot: PLAYER,
    ...scene,
  });

  it.each(['driving', 'paused'] as const)(
    'is not what being in the car is (%s)',
    (gameState) => {
      const t = map(fixture(), { gameState });

      expect(t.LmuWatching?.value[0]).toBe(false);
      expect(t.IsOnTrack.value[0]).toBe(true);
    }
  );

  it('holds through a team-mate’s stint, at the monitor with no vehicle', () => {
    expect(watching(noPlayerVehicle(), teamMate())).toBe(true);
    expect(watching(noPlayerVehicle(), teamMate({ focus: -1 }))).toBe(true);
  });

  it('holds for any car the camera is on', () => {
    expect(watching(noPlayerVehicle(), teamMate({ focus: RIVAL }))).toBe(true);
    // And with nothing remembered at all: joined as a spectator.
    expect(
      watching(noPlayerVehicle(), { gameState: 'monitor', focus: RIVAL })
    ).toBe(true);
  });

  it('counts a car standing in its pit box, as driving does', () => {
    expect(watching(noPlayerVehicle(), teamMate({ focus: IN_PIT_BOX }))).toBe(
      true
    );
  });

  it('does not hold while the watched car is in its garage stall', () => {
    expect(watching(inGarage(noPlayerVehicle(), PLAYER), teamMate())).toBe(
      false
    );
  });

  it('does not hold at the monitor with one’s own car parked in the garage', () => {
    // What sitting at the monitor before a stint looks like: the player
    // still has a vehicle, and it is in its garage stall.
    const parked = inGarage(fixture(), PLAYER);

    expect(watching(parked, { gameState: 'monitor' })).toBe(false);
    expect(watching(parked, { gameState: 'monitor', focus: -1 })).toBe(false);
  });

  it('holds there once the camera is on a car that is out', () => {
    const parked = inGarage(fixture(), PLAYER);

    expect(watching(parked, { gameState: 'monitor', focus: RIVAL })).toBe(true);
  });

  it('holds at the monitor with one’s own car left in the pit lane', () => {
    const raw = fixture();
    raw.vehInPits[PLAYER] = 1;

    const t = map(raw, { gameState: 'monitor' });

    expect(t.LmuWatching?.value[0]).toBe(true);
    expect(t.IsOnTrack.value[0]).toBe(false);
  });

  describe('across a driver change, where the game state trails by a second', () => {
    it('holds while the sim still says driving and the vehicle has gone', () => {
      const t = map(noPlayerVehicle(), teamMate({ gameState: 'driving' }));

      expect(t.LmuWatching?.value[0]).toBe(true);
      expect(t.IsOnTrack.value[0]).toBe(false);
    });

    it('holds while the sim still says monitor and the vehicle is back', () => {
      const t = map(fixture(), teamMate());

      expect(t.LmuWatching?.value[0]).toBe(true);
      expect(t.IsOnTrack.value[0]).toBe(false);
    });
  });

  it('does not hold on a frame the sim has stopped writing', () => {
    // The monitor against the AI: the block freezes there.
    expect(watching(noPlayerVehicle(), teamMate({ dataFrozen: true }))).toBe(
      false
    );
  });

  it.each(['notInSession', 'notInGame'] as const)(
    'does not hold outside a session (%s)',
    (gameState) => {
      expect(watching(noPlayerVehicle(), teamMate({ gameState }))).toBe(false);
    }
  );

  it('does not hold without the sim’s word on where the user is', () => {
    // REST not answering: a block alone cannot tell the monitor from a menu.
    expect(watching(noPlayerVehicle(), { ownEntrySlot: PLAYER })).toBe(false);
    expect(watching(fixture())).toBe(false);
  });

  it('does not hold with no car to watch', () => {
    expect(watching(noPlayerVehicle(), { gameState: 'monitor' })).toBe(false);
    // A slot that holds no car: the entry has left the grid.
    const left = noPlayerVehicle();
    left.vehLapDistPct[PLAYER] = -1;
    expect(watching(left, teamMate())).toBe(false);
    expect(watching(noPlayerVehicle(), teamMate({ focus: 40 }))).toBe(false);
  });

  it('never has the user at the wheel while it holds', () => {
    const scenes: [LmuRawTelemetry, Scene][] = [
      [noPlayerVehicle(), teamMate()],
      [noPlayerVehicle(), teamMate({ focus: RIVAL })],
      [noPlayerVehicle(), teamMate({ gameState: 'driving' })],
      [fixture(), teamMate()],
      [inGarage(fixture(), PLAYER), { gameState: 'monitor', focus: RIVAL }],
    ];

    for (const [raw, scene] of scenes) {
      const t = map(raw, scene);
      expect(t.LmuWatching?.value[0]).toBe(true);
      expect(t.IsOnTrack.value[0]).toBe(false);
    }
  });
});

describe('a frame staged without a player vehicle', () => {
  it('keeps the session and every per-car array and drops the rest', () => {
    const raw = fixture();
    const staged = lmuRawWithoutPlayerVehicle(raw);

    expect(staged.playerHasVehicle).toBe(false);
    expect(staged.playerVehicleIdx).toBe(-1);
    expect(staged.trackName).toBe(raw.trackName);
    expect(staged.currentET).toBe(raw.currentET);
    expect(staged.vehLapDistPct).toBe(raw.vehLapDistPct);
    expect(staged.vehInGarageStall).toBe(raw.vehInGarageStall);
    expect(staged.vehWheelCompounds).toBe(raw.vehWheelCompounds);
    // The single-car fields the addon writes only for a player vehicle.
    for (const key of [
      'gear',
      'engineRPM',
      'filteredThrottle',
      'fuel',
      'elapsedTime',
      'lapStartET',
      'speed',
      'tyreWear',
      'vehicleName',
    ] as const) {
      expect(raw[key]).toBeDefined();
      expect(staged[key]).toBeUndefined();
    }
  });

  it('maps to a frame with the player’s own channels empty', () => {
    const t = map(noPlayerVehicle(), { gameState: 'monitor' });

    expect(t.PlayerCarIdx?.value[0]).toBe(-1);
    expect(t.FuelLevel).toBeUndefined();
    expect(t.Speed.value[0]).toBe(0);
    // Every car is still there.
    expect(t.CarIdxLapDistPct.value).toEqual([0.4, 0.6, 0.2]);
  });
});
