import { describe, expect, it } from 'vitest';
import type { Telemetry } from '@irdashies/types';
import { mapLmuTelemetry } from '../lmu/mapTelemetry';
import { fixture } from '../lmu/rawFixture';
import { lmuRawWithoutPlayerVehicle } from '../../testing/lmuTape';
import {
  isAwayFromWheel,
  isWatchingAnotherCar,
  isWatchingOwnCar,
  isWatchingOwnCarTelemetry,
} from './watchedCar';

const frame = (values: Record<string, unknown>): Telemetry =>
  Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, { value: [value] }])
  ) as unknown as Telemetry;

describe('which car the user is watching', () => {
  it('is the own car while the camera is on the user’s own entry', () => {
    const stint = frame({ LmuWatching: true, CamCarIdx: 7, PlayerCarIdx: 7 });

    expect(isWatchingOwnCar(stint)).toBe(true);
    expect(isWatchingAnotherCar(stint)).toBe(false);
  });

  it('is another car while the camera is on a rival', () => {
    const rival = frame({ LmuWatching: true, CamCarIdx: 3, PlayerCarIdx: 7 });

    expect(isWatchingOwnCar(rival)).toBe(false);
    expect(isWatchingAnotherCar(rival)).toBe(true);
  });

  it('is another car when the user has no entry at all', () => {
    // Joined as a spectator: whatever is watched is somebody else's.
    const spectating = frame({
      LmuWatching: true,
      CamCarIdx: 3,
      PlayerCarIdx: -1,
    });

    expect(isWatchingOwnCar(spectating)).toBe(false);
    expect(isWatchingAnotherCar(spectating)).toBe(true);
  });

  it('is neither while the user is not watching', () => {
    // At the wheel, or in the garage: the same car either way, not watched.
    for (const notWatching of [
      frame({ LmuWatching: false, CamCarIdx: 7, PlayerCarIdx: 7 }),
      frame({ LmuWatching: false, CamCarIdx: 3, PlayerCarIdx: 7 }),
    ]) {
      expect(isWatchingOwnCar(notWatching)).toBe(false);
      expect(isWatchingAnotherCar(notWatching)).toBe(false);
    }
  });

  it('is neither under iRacing, whose frames do not say', () => {
    const spectating = frame({ CamCarIdx: 3, PlayerCarIdx: 7 });

    expect(isWatchingOwnCar(spectating)).toBe(false);
    expect(isWatchingAnotherCar(spectating)).toBe(false);
  });

  describe('on the frames the Le Mans Ultimate mapper writes', () => {
    /** The fixture's player is in slot 1; slot 0 is another car. */
    const map = (focus: number | undefined) =>
      mapLmuTelemetry(
        lmuRawWithoutPlayerVehicle(fixture()),
        undefined,
        undefined,
        focus === undefined ? undefined : { focusCarIdx: { value: [focus] } },
        undefined,
        undefined,
        undefined,
        'monitor',
        undefined,
        undefined,
        undefined,
        1
      );

    it('is the own car through a team-mate’s stint with nothing focused', () => {
      expect(isWatchingOwnCar(map(undefined))).toBe(true);
      expect(isWatchingOwnCar(map(-1))).toBe(true);
      // And with the sim's camera on the team car itself.
      expect(isWatchingOwnCar(map(1))).toBe(true);
    });

    it('is another car once the camera moves to a rival', () => {
      expect(isWatchingOwnCar(map(0))).toBe(false);
      expect(isWatchingAnotherCar(map(0))).toBe(true);
    });

    it('is the own car at the monitor with the car left in the pit lane', () => {
      // The player still has a vehicle: handed to the AI, say.
      const raw = fixture();
      raw.vehInPits[1] = 1;
      const t = mapLmuTelemetry(
        raw,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'monitor'
      );

      expect(isWatchingOwnCar(t)).toBe(true);
    });
  });
});

describe('whether the own car’s pedals and revs are being read while it is watched', () => {
  const stint = { LmuWatching: true, CamCarIdx: 7, PlayerCarIdx: 7 };

  it('is so while the own entry is watched and the sim fills in its block', () => {
    expect(
      isWatchingOwnCarTelemetry(frame({ ...stint, LmuOwnEntryTelemetry: true }))
    ).toBe(true);
  });

  it('is not so where the sim sends no block for the car', () => {
    // Watched all the same: the lap and the lap times are still there.
    expect(isWatchingOwnCarTelemetry(frame(stint))).toBe(false);
    expect(isWatchingOwnCar(frame(stint))).toBe(true);
  });

  it('is not so with the camera on another car, whose pedals they are not', () => {
    expect(
      isWatchingOwnCarTelemetry(
        frame({ ...stint, CamCarIdx: 3, LmuOwnEntryTelemetry: true })
      )
    ).toBe(false);
  });

  it('is not so while the user is not watching', () => {
    expect(
      isWatchingOwnCarTelemetry(
        frame({ ...stint, LmuWatching: false, LmuOwnEntryTelemetry: true })
      )
    ).toBe(false);
  });

  describe('on the frames the Le Mans Ultimate mapper writes', () => {
    /** The fixture's player is in slot 1, read by slot for a team-mate. */
    const map = (blockSlot: number, focus?: number) =>
      mapLmuTelemetry(
        {
          ...fixture(),
          playerHasVehicle: false,
          playerVehicleIdx: -1,
          blockSlot,
          vehControl: [1, 2, 1],
        },
        undefined,
        undefined,
        focus === undefined ? undefined : { focusCarIdx: { value: [focus] } },
        undefined,
        undefined,
        undefined,
        'monitor',
        undefined,
        undefined,
        undefined,
        1
      );

    it('is so with the own entry’s block read', () => {
      expect(isWatchingOwnCarTelemetry(map(1))).toBe(true);
    });

    it('is not so with no block, nor with the camera on a rival', () => {
      expect(isWatchingOwnCarTelemetry(map(-1))).toBe(false);
      expect(isWatchingOwnCar(map(-1))).toBe(true);
      expect(isWatchingOwnCarTelemetry(map(1, 0))).toBe(false);
    });
  });
});

describe('whether the user is away from the wheel', () => {
  it('is so on a Le Mans Ultimate frame without the user in the car', () => {
    expect(
      isAwayFromWheel(frame({ LmuWatching: true, IsOnTrack: false }))
    ).toBe(true);
    // Out of the car with nothing to watch: in the garage, in the menus.
    expect(
      isAwayFromWheel(frame({ LmuWatching: false, IsOnTrack: false }))
    ).toBe(true);
  });

  it('is not so with the user in the car', () => {
    expect(
      isAwayFromWheel(frame({ LmuWatching: false, IsOnTrack: true }))
    ).toBe(false);
  });

  it('is not so under iRacing, whatever IsOnTrack says', () => {
    expect(isAwayFromWheel(frame({ IsOnTrack: false }))).toBe(false);
    expect(isAwayFromWheel(frame({}))).toBe(false);
  });
});
