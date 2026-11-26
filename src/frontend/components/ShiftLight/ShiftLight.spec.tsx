import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getWidgetDefaultConfig } from '@irdashies/types';
import { ShiftLight } from './ShiftLight';

/**
 * When the shift light is on screen. Its revs are the own car's, whoever is
 * driving it: at the wheel, or with a team-mate driving where the sim sends
 * the car's revs.
 */

const state = vi.hoisted(() => ({
  driving: false,
  /** Watching the own car with the sim writing its revs. */
  watchingOwnCarTelemetry: false,
  watchingOtherCar: false,
  sessionVisible: true,
  showOnlyWhenOnTrack: true,
}));

vi.mock('@irdashies/context', async (original) => ({
  ...(await original<typeof import('@irdashies/context')>()),
  useDrivingState: () => ({
    isDriving: state.driving,
    isWatching: state.watchingOwnCarTelemetry || state.watchingOtherCar,
    isWatchingOwnCar: state.watchingOwnCarTelemetry,
    isWatchingOtherCar: state.watchingOtherCar,
  }),
  useWatchingOwnCarTelemetry: () => state.watchingOwnCarTelemetry,
  useSessionVisibility: () => state.sessionVisible,
}));
vi.mock('./hooks/useShiftLightSettings', async () => {
  const { getWidgetDefaultConfig: defaults } =
    await vi.importActual<typeof import('@irdashies/types')>(
      '@irdashies/types'
    );
  return {
    useShiftLightSettings: () => ({
      ...defaults('shiftlight'),
      showOnlyWhenOnTrack: state.showOnlyWhenOnTrack,
    }),
  };
});
vi.mock('@irdashies/domain/shiftLight/useTachometerData', () => ({
  // The own car at 7,200 revs in fourth, as the channel has it.
  useTachometerData: () => ({
    rpm: 7200,
    gear: 4,
    gearCount: 6,
    throttle: 1,
    brake: 0,
    maxRpm: 8000,
    shiftRpm: 7600,
  }),
}));
vi.mock('./ShiftLightComponent/ShiftLightComponent', () => ({
  ShiftLight: ({ rpm }: { rpm: number }) => <div>{rpm} rpm</div>,
}));

beforeEach(() => {
  state.driving = false;
  state.watchingOwnCarTelemetry = false;
  state.watchingOtherCar = false;
  state.sessionVisible = true;
  state.showOnlyWhenOnTrack =
    getWidgetDefaultConfig('shiftlight').showOnlyWhenOnTrack;
});

afterEach(cleanup);

describe('ShiftLight set to show only when on track', () => {
  it('is on track only by default', () => {
    expect(state.showOnlyWhenOnTrack).toBe(true);
  });

  it('is hidden out of the car with nothing to watch', () => {
    expect(render(<ShiftLight />).container).toBeEmptyDOMElement();
  });

  it('follows the revs at the wheel', () => {
    state.driving = true;

    expect(render(<ShiftLight />).container.textContent).toBe('7200 rpm');
  });

  it('follows the team-mate’s revs while watching the own car, where the sim sends them', () => {
    state.watchingOwnCarTelemetry = true;

    expect(render(<ShiftLight />).container.textContent).toBe('7200 rpm');
  });

  it('is hidden with the camera on another car', () => {
    state.watchingOtherCar = true;

    expect(render(<ShiftLight />).container).toBeEmptyDOMElement();
  });

  it('is hidden in a session it is switched off for', () => {
    state.driving = true;
    state.sessionVisible = false;

    expect(render(<ShiftLight />).container).toBeEmptyDOMElement();
  });
});

describe('ShiftLight set to show always', () => {
  beforeEach(() => {
    state.showOnlyWhenOnTrack = false;
  });

  it('stays dark with the camera on another car: the revs are the own car’s', () => {
    state.watchingOtherCar = true;

    expect(render(<ShiftLight />).container.textContent).toBe('0 rpm');
  });

  it('follows the own car otherwise', () => {
    expect(render(<ShiftLight />).container.textContent).toBe('7200 rpm');
  });
});
