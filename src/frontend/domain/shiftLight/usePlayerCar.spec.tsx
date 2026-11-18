import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CarData } from '@irdashies/utils/carData';
import { loadCarData } from '@irdashies/utils/carData';
import { usePlayerCar } from './usePlayerCar';

const state = vi.hoisted(() => ({
  simulator: null as string | null,
  driver: undefined as { CarPath?: string; CarModel?: string } | undefined,
}));

vi.mock('@irdashies/context', () => ({
  useActiveSimulator: () => state.simulator,
  useSessionStore: (selector: (store: unknown) => unknown) =>
    selector({
      session: {
        DriverInfo: {
          DriverCarIdx: 3,
          Drivers: [
            { CarIdx: 0, CarPath: 'someone_else', CarModel: 'Other Car' },
            { CarIdx: 3, ...state.driver },
          ],
        },
      },
    }),
}));
vi.mock('@irdashies/utils/carData', () => ({ loadCarData: vi.fn() }));

const bundledCar = { carId: 'ferrari296gt3', carName: 'Ferrari' } as CarData;

describe('usePlayerCar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadCarData).mockReturnValue(bundledCar);
    state.simulator = 'iracing';
    state.driver = { CarPath: 'Ferrari 296 GT3' };
  });

  it('keys an iRacing car by its bundled id', () => {
    const { result } = renderHook(() => usePlayerCar());

    expect(loadCarData).toHaveBeenCalledWith('Ferrari 296 GT3');
    expect(result.current.carData).toBe(bundledCar);
    expect(result.current.carId).toBe('ferrari296gt3');
  });

  it('keys a car without bundled data by its path', () => {
    vi.mocked(loadCarData).mockReturnValue(null);

    expect(renderHook(() => usePlayerCar()).result.current.carId).toBe(
      'Ferrari 296 GT3'
    );
  });

  it('works with no simulator detected, as demo mode does', () => {
    state.simulator = null;

    expect(renderHook(() => usePlayerCar()).result.current.carId).toBe(
      'ferrari296gt3'
    );
  });

  it('leaves the bundled data alone while disabled', () => {
    const { result } = renderHook(() => usePlayerCar(false));

    expect(loadCarData).not.toHaveBeenCalled();
    expect(result.current.carData).toBeNull();
  });

  it('keys an LMU car by its model, without the bundled data', () => {
    state.simulator = 'lmu';
    state.driver = { CarPath: 'ferrari_296_gt3', CarModel: 'Ferrari 296 LMGT3' };

    const { result } = renderHook(() => usePlayerCar());

    expect(loadCarData).not.toHaveBeenCalled();
    expect(result.current.carData).toBeNull();
    expect(result.current.carId).toBe('Ferrari 296 LMGT3');
  });

  it('gives an LMU car no key until its model arrives', () => {
    state.simulator = 'lmu';
    state.driver = { CarPath: 'ferrari_296_gt3' };

    const { result } = renderHook(() => usePlayerCar());

    expect(loadCarData).not.toHaveBeenCalled();
    expect(result.current.carId).toBeUndefined();
  });

  it('trusts a model before the simulator has been detected', () => {
    state.simulator = null;
    state.driver = { CarPath: 'ferrari_296_gt3', CarModel: 'Ferrari 296 LMGT3' };

    const { result } = renderHook(() => usePlayerCar());

    expect(loadCarData).not.toHaveBeenCalled();
    expect(result.current.carId).toBe('Ferrari 296 LMGT3');
  });
});
