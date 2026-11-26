import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getWidgetDefaultConfig } from '@irdashies/types';
import { Tachometer } from './Tachometer';

/**
 * When the tachometer is on screen, and what it shows of the own car: its revs
 * whoever is driving it, its temperatures only where the sim sends them.
 */

const state = vi.hoisted(() => ({
  driving: false,
  /** Watching the own car with the sim writing its revs. */
  watchingOwnCarTelemetry: false,
  watchingOtherCar: false,
  sessionVisible: true,
  showOnlyWhenOnTrack: true,
  oilTemp: 105 as number | undefined,
  waterTemp: 92 as number | undefined,
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
vi.mock('./hooks/useTachometerSettings', async () => {
  const { getWidgetDefaultConfig: defaults } =
    await vi.importActual<typeof import('@irdashies/types')>(
      '@irdashies/types'
    );
  return {
    useTachometerSettings: () => ({
      ...defaults('tachometer'),
      showOnlyWhenOnTrack: state.showOnlyWhenOnTrack,
    }),
  };
});
vi.mock('@irdashies/domain/shiftLight/useTachometerData', () => ({
  useTachometerData: () => ({
    rpm: 7200,
    gear: 4,
    maxRpm: 8000,
    shiftRpm: 7600,
    blinkRpm: 7800,
    oilTemp: state.oilTemp,
    waterTemp: state.waterTemp,
    engineWarnings: 0,
  }),
}));
vi.mock('./TachometerComponent/TachometerComponent', () => ({
  Tachometer: ({
    rpm,
    showOilTemp,
    showWaterTemp,
  }: {
    rpm: number;
    showOilTemp: boolean;
    showWaterTemp: boolean;
  }) => (
    <div>
      {rpm} rpm{showOilTemp ? ', oil' : ''}
      {showWaterTemp ? ', water' : ''}
    </div>
  ),
}));

beforeEach(() => {
  state.driving = false;
  state.watchingOwnCarTelemetry = false;
  state.watchingOtherCar = false;
  state.sessionVisible = true;
  state.showOnlyWhenOnTrack =
    getWidgetDefaultConfig('tachometer').showOnlyWhenOnTrack;
  state.oilTemp = 105;
  state.waterTemp = 92;
});

afterEach(cleanup);

describe('Tachometer set to show only when on track', () => {
  it('is on track only by default', () => {
    expect(state.showOnlyWhenOnTrack).toBe(true);
  });

  it('is hidden out of the car with nothing to watch', () => {
    expect(render(<Tachometer />).container).toBeEmptyDOMElement();
  });

  it('shows the revs and temperatures at the wheel', () => {
    state.driving = true;

    expect(render(<Tachometer />).container.textContent).toBe(
      '7200 rpm, oil, water'
    );
  });

  it('follows a team-mate’s revs, without the temperatures the sim does not send', () => {
    state.watchingOwnCarTelemetry = true;
    state.oilTemp = undefined;
    state.waterTemp = undefined;

    expect(render(<Tachometer />).container.textContent).toBe('7200 rpm');
  });

  it('is hidden with the camera on another car', () => {
    state.watchingOtherCar = true;

    expect(render(<Tachometer />).container).toBeEmptyDOMElement();
  });

  it('is hidden in a session it is switched off for', () => {
    state.driving = true;
    state.sessionVisible = false;

    expect(render(<Tachometer />).container).toBeEmptyDOMElement();
  });
});

describe('Tachometer set to show always', () => {
  beforeEach(() => {
    state.showOnlyWhenOnTrack = false;
  });

  it('shows no figure of the own car with the camera on another car', () => {
    state.watchingOtherCar = true;

    expect(render(<Tachometer />).container.textContent).toBe('0 rpm');
  });

  it('follows the own car otherwise', () => {
    expect(render(<Tachometer />).container.textContent).toBe(
      '7200 rpm, oil, water'
    );
  });
});
