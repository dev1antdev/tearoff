import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LMU_FINISH_STATUS,
  SessionState,
  TrackLocation,
  type ChannelBridge,
  type Driver,
  type Session,
  type StandingsSnapshot,
} from '@irdashies/types';
import { useSessionStore } from '@irdashies/context';
import { mountFixture } from '../../../testing/renderWithFixture';
import type { ReplayFixture } from '../../../testing/replayFixture';
import lmuRace from '../../../../test-data/fixtures/lmu-race-laguna-seca.json';
import {
  classFieldsEqual,
  limitClassFields,
  summariseClassFields,
  useClassFields,
  type ClassFieldsSnapshot,
} from './classFields';

const HYPERCAR = 10;
const LMP2 = 20;
const GT3 = 30;

const car = (
  carIdx: number,
  classId: number,
  overrides: Partial<Driver> = {}
): Driver =>
  ({
    CarIdx: carIdx,
    CarClassID: classId,
    CarClassShortName:
      classId === HYPERCAR ? 'Hypercar' : classId === LMP2 ? 'LMP2' : 'LMGT3',
    CarClassColor: classId,
    CarClassRelSpeed: 100 - classId,
    CarIsPaceCar: 0,
    IsSpectator: 0,
    ...overrides,
  }) as Driver;

/** Three classes of 3, 2 and 1 cars, in slot order. */
const grid: Driver[] = [
  car(0, HYPERCAR),
  car(1, HYPERCAR),
  car(2, HYPERCAR),
  car(3, LMP2),
  car(4, LMP2),
  car(5, GT3),
];

const snapshot = (
  overrides: Partial<ClassFieldsSnapshot> = {}
): ClassFieldsSnapshot => ({
  carIdxPosition: [1, 2, 4, 3, 5, 6],
  carIdxTrackSurface: grid.map(() => TrackLocation.OnTrack),
  carIdxOnPitRoad: grid.map(() => false),
  carIdxFinishStatus: [],
  carIdxInGarage: grid.map(() => false),
  focusCarIdx: 5,
  sessionState: SessionState.Racing,
  ...overrides,
});

const counts = (fields: ReturnType<typeof summariseClassFields>) =>
  fields.map((field) => `${field.name} ${field.active}/${field.total}`);

describe('summariseClassFields', () => {
  it('counts each class and orders them by their leader’s place', () => {
    const fields = summariseClassFields(grid, snapshot());

    expect(counts(fields)).toEqual(['Hypercar 3/3', 'LMP2 2/2', 'LMGT3 1/1']);
    expect(fields.map((field) => field.leaderPosition)).toEqual([1, 3, 6]);
    expect(fields.map((field) => field.inPitLane)).toEqual([0, 0, 0]);
    expect(fields.map((field) => field.color)).toEqual([HYPERCAR, LMP2, GT3]);
  });

  it('follows the order on the road, not the class speed', () => {
    // An LMP2 leads overall after the Hypercars have stopped.
    const fields = summariseClassFields(
      grid,
      snapshot({ carIdxPosition: [2, 3, 4, 1, 5, 6] })
    );

    expect(fields.map((field) => field.name)).toEqual([
      'LMP2',
      'Hypercar',
      'LMGT3',
    ]);
  });

  it('keeps the standings’ order when asked for class speed', () => {
    const fields = summariseClassFields(
      grid,
      snapshot({ carIdxPosition: [2, 3, 4, 1, 5, 6] }),
      'classSpeed'
    );

    expect(fields.map((field) => field.name)).toEqual([
      'Hypercar',
      'LMP2',
      'LMGT3',
    ]);
  });

  it('takes a car in its garage out of the running, not out of the entry', () => {
    const inGarage = grid.map((driver) => driver.CarIdx === 1);
    const fields = summariseClassFields(
      grid,
      snapshot({
        carIdxInGarage: inGarage,
        // As LMU maps it: the garage reads as a pit stall.
        carIdxTrackSurface: grid.map((driver) =>
          driver.CarIdx === 1 ? TrackLocation.InPitStall : TrackLocation.OnTrack
        ),
      })
    );

    expect(counts(fields)[0]).toBe('Hypercar 2/3');
    // Out of the running, so not one of the cars in the pit lane either.
    expect(fields[0].inPitLane).toBe(0);
  });

  it('keeps a car stopped at its box running, and counts it in the pits', () => {
    const fields = summariseClassFields(
      grid,
      snapshot({
        carIdxTrackSurface: grid.map((driver) =>
          driver.CarIdx === 3 ? TrackLocation.InPitStall : TrackLocation.OnTrack
        ),
      })
    );

    expect(counts(fields)[1]).toBe('LMP2 2/2');
    expect(fields[1].inPitLane).toBe(1);
  });

  it('counts a car driving down the pit lane', () => {
    const fields = summariseClassFields(
      grid,
      snapshot({
        carIdxOnPitRoad: grid.map((driver) => driver.CarIdx === 0),
        carIdxTrackSurface: grid.map((driver) =>
          driver.CarIdx === 0
            ? TrackLocation.ApproachingPits
            : TrackLocation.OnTrack
        ),
      })
    );

    expect(fields[0].inPitLane).toBe(1);
    expect(counts(fields)[0]).toBe('Hypercar 3/3');
  });

  it('takes a retired or disqualified car out, wherever it stands', () => {
    const finish = grid.map(() => LMU_FINISH_STATUS.none as number);
    finish[0] = LMU_FINISH_STATUS.dnf;
    finish[3] = LMU_FINISH_STATUS.dq;
    // Both still on the road, as a car is in the lap it retires on.
    const fields = summariseClassFields(
      grid,
      snapshot({ carIdxFinishStatus: finish })
    );

    expect(counts(fields)).toEqual(['Hypercar 2/3', 'LMP2 1/2', 'LMGT3 1/1']);
  });

  it('keeps a car that has taken the flag', () => {
    const finish = grid.map(() => LMU_FINISH_STATUS.finished as number);
    const fields = summariseClassFields(
      grid,
      snapshot({ carIdxFinishStatus: finish })
    );

    expect(counts(fields)).toEqual(['Hypercar 3/3', 'LMP2 2/2', 'LMGT3 1/1']);
  });

  it('reads a car that is not in the world as out, where there is no garage flag', () => {
    // The iRacing shape: no garage array, no finish status.
    const fields = summariseClassFields(
      grid,
      snapshot({
        carIdxInGarage: [],
        carIdxTrackSurface: grid.map((driver) =>
          driver.CarIdx === 4 ? TrackLocation.NotInWorld : TrackLocation.OnTrack
        ),
      })
    );

    expect(counts(fields)[1]).toBe('LMP2 1/2');
  });

  it('keeps a car that has finished running once it is parked in its garage', () => {
    // The end of an LMU race: the cars take the flag and drive to their
    // garages. One of them had retired before the flag.
    const finish = grid.map(() => LMU_FINISH_STATUS.finished as number);
    finish[4] = LMU_FINISH_STATUS.dnf;
    const fields = summariseClassFields(
      grid,
      snapshot({
        carIdxFinishStatus: finish,
        carIdxInGarage: grid.map(() => true),
        carIdxTrackSurface: grid.map(() => TrackLocation.InPitStall),
        sessionState: SessionState.Checkered,
      })
    );

    expect(counts(fields)).toEqual(['Hypercar 3/3', 'LMP2 1/2', 'LMGT3 1/1']);
  });

  it.each([SessionState.Checkered, SessionState.CoolDown])(
    'does not count a car leaving the world after the flag as out (state %i)',
    (sessionState) => {
      // The end of an iRacing race: nobody is left in the world, and nobody
      // has retired by leaving. The final classification is not 0 of 3.
      const fields = summariseClassFields(
        grid,
        snapshot({
          carIdxInGarage: [],
          carIdxTrackSurface: grid.map(() => TrackLocation.NotInWorld),
          sessionState,
        })
      );

      expect(counts(fields)).toEqual(['Hypercar 3/3', 'LMP2 2/2', 'LMGT3 1/1']);
    }
  );

  it('takes every car as running before the first snapshot has a surface', () => {
    const fields = summariseClassFields(
      grid,
      snapshot({ carIdxTrackSurface: [], carIdxPosition: [] })
    );

    expect(counts(fields)).toEqual(['Hypercar 3/3', 'LMP2 2/2', 'LMGT3 1/1']);
  });

  it('does not count the pace car or spectators', () => {
    const fields = summariseClassFields(
      [
        ...grid,
        car(6, GT3, { CarIsPaceCar: 1 }),
        car(7, GT3, { IsSpectator: 1 }),
        car(8, 99, { CarIsPaceCar: 1, CarClassShortName: 'Safety' }),
      ],
      snapshot()
    );

    expect(counts(fields)).toEqual(['Hypercar 3/3', 'LMP2 2/2', 'LMGT3 1/1']);
  });

  it('sorts a class with no placed car last, then by class id', () => {
    const fields = summariseClassFields(
      grid,
      // No Hypercar has a place yet; neither has the LMGT3.
      snapshot({ carIdxPosition: [0, 0, 0, 2, 1, 0] })
    );

    expect(fields.map((field) => field.name)).toEqual([
      'LMP2',
      'Hypercar',
      'LMGT3',
    ]);
    expect(fields.map((field) => field.leaderPosition)).toEqual([1, 0, 0]);
  });

  it('flags the class of the focus car, which is the car being watched', () => {
    const own = summariseClassFields(grid, snapshot({ focusCarIdx: 5 }));
    expect(own.map((field) => field.isFocusClass)).toEqual([
      false,
      false,
      true,
    ]);

    // The camera moves to a Hypercar: the summary is about its class now.
    const watched = summariseClassFields(grid, snapshot({ focusCarIdx: 1 }));
    expect(watched.map((field) => field.isFocusClass)).toEqual([
      true,
      false,
      false,
    ]);

    const nobody = summariseClassFields(grid, snapshot({ focusCarIdx: null }));
    expect(nobody.some((field) => field.isFocusClass)).toBe(false);
  });

  it('is empty without drivers', () => {
    expect(summariseClassFields([], snapshot())).toEqual([]);
  });
});

describe('limitClassFields', () => {
  const fields = summariseClassFields(grid, snapshot());

  it('shows every class when they fit', () => {
    expect(limitClassFields(fields, 5)).toEqual(fields);
    expect(limitClassFields(fields, 3)).toEqual(fields);
  });

  it('puts the focus class in the last place shown when it would fall off', () => {
    // LMGT3 is third by order and only two chips fit.
    expect(limitClassFields(fields, 2).map((field) => field.name)).toEqual([
      'Hypercar',
      'LMGT3',
    ]);
  });

  it('cuts from the end when the focus class is already shown', () => {
    const watching = summariseClassFields(grid, snapshot({ focusCarIdx: 0 }));

    expect(limitClassFields(watching, 2).map((field) => field.name)).toEqual([
      'Hypercar',
      'LMP2',
    ]);
  });
});

describe('classFieldsEqual', () => {
  it('is structural', () => {
    expect(
      classFieldsEqual(
        summariseClassFields(grid, snapshot()),
        summariseClassFields(grid, snapshot())
      )
    ).toBe(true);
    expect(
      classFieldsEqual(
        summariseClassFields(grid, snapshot()),
        summariseClassFields(grid, snapshot({ focusCarIdx: 0 }))
      )
    ).toBe(false);
  });
});

describe('useClassFields', () => {
  let publish: ((payload: StandingsSnapshot) => void) | undefined;
  const previousBridge = window.channelBridge;

  beforeEach(() => {
    publish = undefined;
    window.channelBridge = {
      subscribe: vi.fn(
        (_channel: string, callback: (payload: StandingsSnapshot) => void) => {
          publish = callback;
          return vi.fn();
        }
      ),
    } as unknown as ChannelBridge;
    useSessionStore.getState().resetSession();
    act(() =>
      useSessionStore.getState().setSession({
        DriverInfo: { Drivers: grid },
      } as unknown as Session)
    );
  });

  afterEach(() => {
    // Unmount first: taking the bridge away and resetting the session under
    // a hook that is still mounted re-renders it with no bridge to read.
    cleanup();
    if (previousBridge === undefined) {
      Reflect.deleteProperty(window, 'channelBridge');
    } else {
      window.channelBridge = previousBridge;
    }
    useSessionStore.getState().resetSession();
  });

  const frame = (
    version: number,
    overrides: Partial<ClassFieldsSnapshot> = {}
  ) => ({ ...snapshot(overrides), version }) as unknown as StandingsSnapshot;

  it('lists the classes from the session before a snapshot arrives', () => {
    const { result } = renderHook(() => useClassFields());

    expect(counts(result.current)).toEqual([
      'Hypercar 3/3',
      'LMP2 2/2',
      'LMGT3 1/1',
    ]);
  });

  it('re-renders only when a count or the order changes', () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useClassFields();
    });

    act(() => publish?.(frame(1)));
    const first = result.current;
    const rendersAfterFirst = renders;

    // Five more snapshots in which nothing the summary shows has moved.
    for (let version = 2; version <= 6; version += 1) {
      act(() => publish?.(frame(version)));
    }
    expect(renders).toBe(rendersAfterFirst);
    expect(result.current).toBe(first);

    const garage = grid.map((driver) => driver.CarIdx === 2);
    act(() => publish?.(frame(7, { carIdxInGarage: garage })));
    expect(renders).toBe(rendersAfterFirst + 1);
    expect(counts(result.current)[0]).toBe('Hypercar 2/3');
  });
});

/**
 * The class summary on a recorded Le Mans Ultimate race, cut from the curated
 * tape: 38 cars in three classes at Laguna Seca, early in the third lap, the
 * player in an LMGT3. The frames go through the real StandingsProcessor.
 *
 * Every car is running throughout the recording, so the cars-out cases are
 * staged on its frames and say so.
 */
describe('class fields on a recorded LMU race', () => {
  const race = lmuRace as unknown as ReplayFixture;
  /** The class the player's LMGT3 runs in, by the id the addon gives it. */
  const GT_CLASS = 1;

  const fieldsOf = (fixture: ReplayFixture) => {
    const harness = mountFixture(fixture);
    const { result } = renderHook(() => useClassFields(), {
      wrapper: harness.wrapper,
    });
    return result.current;
  };

  const gtSlots = (fixture: ReplayFixture): number[] =>
    (fixture.session?.DriverInfo?.Drivers ?? [])
      .filter((driver) => driver.CarClassID === GT_CLASS)
      .map((driver) => driver.CarIdx);

  /** The same frames with something changed for the given slots. */
  const staged = (
    fixture: ReplayFixture,
    change: (
      frame: ReplayFixture['frames'][number]
    ) => ReplayFixture['frames'][number]
  ): ReplayFixture => ({ ...fixture, frames: fixture.frames.map(change) });

  it('counts 14 LMP2, 10 LMP3 and 14 LMGT3, all running, leaders’ order', () => {
    const fields = fieldsOf(race);

    expect(counts(fields)).toEqual(['LMP2 14/14', 'LMP3 10/10', 'LMGT3 14/14']);
    // The overall leader is an LMP2; the best LMP3 is ahead of the best GT.
    expect(fields.map((field) => field.leaderPosition)).toEqual([1, 15, 25]);
    expect(fields.map((field) => field.inPitLane)).toEqual([0, 0, 0]);
  });

  it('flags the LMGT3 class, the player’s own', () => {
    expect(fieldsOf(race).map((field) => field.isFocusClass)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('follows the camera to the class of a car being watched', () => {
    // Staged: the camera on the overall leader, as while watching it.
    const frames = race.frames;
    const leader = (
      frames[frames.length - 1].CarIdxPosition as number[]
    ).indexOf(1);
    const watching = staged(race, (frame) => ({ ...frame, CamCarIdx: leader }));

    expect(fieldsOf(watching).map((field) => field.isFocusClass)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('counts two LMGT3 cars in their garages out: 12/14 (staged)', () => {
    // Staged: nobody is in a garage on the recording. The flag is the one
    // LMU's mapper publishes; the surface reads "in pit stall" as it would.
    const [first, second] = gtSlots(race);
    const garaged = staged(race, (frame) => ({
      ...frame,
      LmuCarIdxInGarage: (frame.CarIdxTrackSurface as number[]).map(
        (_, carIdx) => carIdx === first || carIdx === second
      ),
      CarIdxTrackSurface: (frame.CarIdxTrackSurface as number[]).map(
        (surface, carIdx) =>
          carIdx === first || carIdx === second
            ? TrackLocation.InPitStall
            : surface
      ),
    }));

    expect(counts(fieldsOf(garaged))).toEqual([
      'LMP2 14/14',
      'LMP3 10/10',
      'LMGT3 12/14',
    ]);
  });

  it('counts a retired LMP3 out while it is still on the road (staged)', () => {
    // Staged: the recording has no retirement.
    const lmp3 = (race.session?.DriverInfo?.Drivers ?? []).find(
      (driver) => driver.CarClassShortName === 'LMP3'
    )?.CarIdx;
    const retired = staged(race, (frame) => ({
      ...frame,
      LmuCarIdxFinishStatus: (frame.LmuCarIdxFinishStatus as number[]).map(
        (status, carIdx) => (carIdx === lmp3 ? LMU_FINISH_STATUS.dnf : status)
      ),
    }));

    expect(counts(fieldsOf(retired))).toEqual([
      'LMP2 14/14',
      'LMP3 9/10',
      'LMGT3 14/14',
    ]);
  });
});
