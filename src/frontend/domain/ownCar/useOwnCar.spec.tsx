import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useOwnCar } from './useOwnCar';

const mocks = vi.hoisted(() => ({
  barCarIdx: undefined as number | null | undefined,
  sessionCarIdx: undefined as number | undefined,
  drivers: undefined as { CarIdx: number; CarClassID?: number }[] | undefined,
}));

vi.mock('@irdashies/context', () => ({
  useSessionBarSelector: (
    select: (snapshot: { playerCarIdx: number | null }) => unknown
  ) =>
    mocks.barCarIdx === undefined
      ? undefined
      : select({ playerCarIdx: mocks.barCarIdx }),
  useDriverCarIdx: () => mocks.sessionCarIdx,
  useSessionDrivers: () => mocks.drivers,
}));

const own = () => renderHook(() => useOwnCar()).result.current;

beforeEach(() => {
  mocks.barCarIdx = undefined;
  mocks.sessionCarIdx = undefined;
  mocks.drivers = [
    { CarIdx: 3, CarClassID: 10 },
    { CarIdx: 13, CarClassID: 30 },
    { CarIdx: 20 },
  ];
});

describe('useOwnCar', () => {
  it('is the session bar’s own car, with its class from the session', () => {
    mocks.barCarIdx = 13;
    // The session's own slot is not asked while the bar has one: under Le
    // Mans Ultimate the bar's stays on the team car through a team-mate's
    // stint.
    mocks.sessionCarIdx = 3;

    expect(own()).toEqual({ carIdx: 13, classId: 30 });
  });

  it('is the session’s own slot where the session bar has none', () => {
    mocks.sessionCarIdx = 3;
    expect(own()).toEqual({ carIdx: 3, classId: 10 });

    // The bar is there and names nobody.
    mocks.barCarIdx = null;
    expect(own()).toEqual({ carIdx: 3, classId: 10 });
  });

  it('is nobody while neither names a car, as for a spectator', () => {
    expect(own()).toEqual({ carIdx: null, classId: null });

    mocks.barCarIdx = -1;
    mocks.sessionCarIdx = -1;
    expect(own()).toEqual({ carIdx: null, classId: null });
  });

  it('has no class while the session has not said one', () => {
    mocks.barCarIdx = 20;
    expect(own()).toEqual({ carIdx: 20, classId: null });

    // A car the grid does not list yet.
    mocks.barCarIdx = 40;
    expect(own()).toEqual({ carIdx: 40, classId: null });

    mocks.drivers = undefined;
    mocks.barCarIdx = 13;
    expect(own()).toEqual({ carIdx: 13, classId: null });
  });

  it('hands back the same answer while nothing has changed', () => {
    mocks.barCarIdx = 13;
    const { result, rerender } = renderHook(() => useOwnCar());
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });
});
