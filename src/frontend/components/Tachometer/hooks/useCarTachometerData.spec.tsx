import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useCarTachometerData } from './useCarTachometerData';
import * as Context from '@irdashies/context';
import { loadCarData, type CarData } from '../../../utils/carData';

// Mock the dependencies
vi.mock('@irdashies/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@irdashies/context')>();
  return {
    ...actual,
    useActiveSimulator: vi.fn(),
    useSessionStore: vi.fn(),
    useDriverCarIdx: vi.fn(),
    useDriverControlsSnapshot: vi.fn(),
  };
});
vi.mock('../../../utils/carData');

const mockUseSessionStore = vi.mocked(Context.useSessionStore);
const mockUseDriverCarIdx = vi.mocked(Context.useDriverCarIdx);
const mockUseDriverControlsSnapshot = vi.mocked(
  Context.useDriverControlsSnapshot
);

describe('useCarTachometerData', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mocks
    mockUseDriverCarIdx.mockReturnValue(0);
    mockUseDriverControlsSnapshot.mockReturnValue({ gear: 1, version: 1 });
    mockUseSessionStore.mockReturnValue({
      session: {
        DriverInfo: {
          Drivers: [{ CarIdx: 0, CarPath: 'porsche992rgt3' }],
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  });

  it('initializes with default values', () => {
    const { result } = renderHook(() => useCarTachometerData());

    expect(result.current.carData).toBeNull();
    expect(result.current.hasCarData).toBe(false);
    expect(result.current.gearRpmThresholds).toBeNull();
  });

  it('returns null when no car path is available', () => {
    mockUseSessionStore.mockReturnValue({
      session: {
        DriverInfo: {
          Drivers: [],
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const { result } = renderHook(() => useCarTachometerData());

    expect(result.current.carData).toBeNull();
    expect(result.current.hasCarData).toBe(false);
    expect(result.current.gearRpmThresholds).toBeNull();
  });

  it('returns null when session is null', () => {
    mockUseSessionStore.mockReturnValue({
      session: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const { result } = renderHook(() => useCarTachometerData());

    expect(result.current.carData).toBeNull();
    expect(result.current.hasCarData).toBe(false);
    expect(result.current.gearRpmThresholds).toBeNull();
  });

  describe('which cars are looked up in the bundled data', () => {
    const bundledCar = { carId: 'ferrari296gt3', ledRpm: [{}] } as CarData;
    const driving = (driver: { CarPath: string; CarModel?: string }) =>
      mockUseSessionStore.mockImplementation(((
        selector: (state: unknown) => unknown
      ) =>
        selector({
          session: {
            DriverInfo: {
              DriverCarIdx: 0,
              Drivers: [{ CarIdx: 0, ...driver }],
            },
          },
        })) as unknown as typeof Context.useSessionStore);

    beforeEach(() => {
      vi.mocked(Context.useActiveSimulator).mockReturnValue('iracing');
      vi.mocked(loadCarData).mockReturnValue(bundledCar);
    });

    it('finds an iRacing car by its path', () => {
      driving({ CarPath: 'ferrari296gt3' });

      const { result } = renderHook(() => useCarTachometerData());

      expect(loadCarData).toHaveBeenCalledWith('ferrari296gt3');
      expect(result.current.carData).toBe(bundledCar);
    });

    it('leaves out an LMU car, whatever its file is called', () => {
      vi.mocked(Context.useActiveSimulator).mockReturnValue('lmu');
      driving({ CarPath: 'ferrari_296_gt3' });

      const { result } = renderHook(() => useCarTachometerData());

      expect(loadCarData).not.toHaveBeenCalled();
      expect(result.current.carData).toBeNull();
    });
  });
});
