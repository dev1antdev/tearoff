import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Context from '@irdashies/context';
import { useTachometerData } from './useTachometerData';

const playerCar = vi.hoisted(() => ({
  carPath: 'ferrari296gt3',
  carModel: undefined as string | undefined,
}));

vi.mock('@irdashies/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@irdashies/context')>();
  return {
    ...actual,
    useDriverControlsSnapshot: vi.fn(),
    useSessionStore: vi.fn(),
  };
});
vi.mock('./usePlayerCar', () => ({
  usePlayerCar: () => ({
    ...playerCar,
    carData: null,
    carId: playerCar.carModel ?? playerCar.carPath,
  }),
}));
vi.mock('./useCarTachometerData', () => ({
  useCarTachometerData: () => ({
    carData: null,
    gearRpmThresholds: null,
    hasCarData: false,
  }),
}));

const snapshot = vi.mocked(Context.useDriverControlsSnapshot);
const store = vi.mocked(Context.useSessionStore);

/** The session store, as the hook's selectors read it. */
const session = (info: Record<string, unknown>) =>
  store.mockImplementation(((selector: (state: unknown) => unknown) =>
    selector({ session: { DriverInfo: info } })) as never);

describe('useTachometerData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    playerCar.carModel = undefined;
    session({ DriverCarRedLine: 8000, DriverCarGearNumForward: 6 });
    snapshot.mockReturnValue({ rpm: 7200, gear: 4 } as never);
  });

  it('reads the pedals as the driver presses them, not the sim’s blip', () => {
    snapshot.mockReturnValue({
      rpm: 7200,
      gear: 4,
      throttle: 0.9,
      brake: 0.1,
      throttleRaw: 0.2,
      brakeRaw: 0,
    } as never);

    const { result } = renderHook(() => useTachometerData());

    expect(result.current.throttle).toBe(0.2);
    expect(result.current.brake).toBe(0);
  });

  it('falls back to the processed pedals where the sim sends no raw ones', () => {
    snapshot.mockReturnValue({
      rpm: 7200,
      gear: 4,
      throttle: 0.9,
      brake: 0.1,
    } as never);

    const { result } = renderHook(() => useTachometerData());

    expect(result.current.throttle).toBe(0.9);
    expect(result.current.brake).toBe(0.1);
  });

  it('leaves the temperatures absent where the sim sends none', () => {
    const { result } = renderHook(() => useTachometerData());

    expect(result.current.oilTemp).toBeUndefined();
    expect(result.current.waterTemp).toBeUndefined();
  });

  it('takes the redline from the session, then the shift grind, then 7500', () => {
    expect(renderHook(() => useTachometerData()).result.current.maxRpm).toBe(
      8000
    );

    session({});
    snapshot.mockReturnValue({ rpm: 0, gear: 1, shiftGrindRpm: 9000 } as never);
    expect(renderHook(() => useTachometerData()).result.current.maxRpm).toBe(
      9000
    );

    snapshot.mockReturnValue({ rpm: 0, gear: 1 } as never);
    expect(renderHook(() => useTachometerData()).result.current.maxRpm).toBe(
      7500
    );
  });

  it('gives the widgets the car their shift points are saved under', () => {
    playerCar.carModel = 'Ferrari 499P';

    const { result } = renderHook(() => useTachometerData());

    expect(result.current.carModel).toBe('Ferrari 499P');
    expect(result.current.carPath).toBe('ferrari296gt3');
    expect(result.current.gearCount).toBe(6);
  });
});
