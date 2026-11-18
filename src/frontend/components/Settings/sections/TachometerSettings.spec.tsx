import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardLayout, TachometerConfig } from '@irdashies/types';
import { TachometerSettings } from './TachometerSettings';

const mocks = vi.hoisted(() => ({
  onDashboardUpdated: vi.fn(),
  session: undefined as unknown,
}));

vi.mock('@irdashies/context', async () => {
  const { DEFAULT_SIM_WIDGET_SUPPORT } = await import('@irdashies/types');
  return {
    useDashboard: () => ({
      currentDashboard: dashboard,
      onDashboardUpdated: mocks.onDashboardUpdated,
    }),
    useActiveSimulator: () => 'lmu',
    useSimWidgetSupport: () => DEFAULT_SIM_WIDGET_SUPPORT,
    useSessionStore: (selector: (state: { session: unknown }) => unknown) =>
      selector({ session: mocks.session }),
  };
});

const config = {
  shiftPointSettings: {
    enabled: true,
    indicatorType: 'glow',
    indicatorColor: '#00ff00',
    carConfigs: {},
  },
  ledRpmOverrides: {},
  background: { opacity: 80 },
  showRpmText: true,
  showOnlyWhenOnTrack: true,
  sessionVisibility: { race: true },
} as unknown as TachometerConfig;

const dashboard = {
  widgets: [
    {
      id: 'tachometer',
      enabled: true,
      layout: { x: 0, y: 0, width: 500, height: 60 },
      config,
    },
  ],
} as unknown as DashboardLayout;

const FERRARI = 'Ferrari 296 LMGT3';
const saved = {
  carName: FERRARI,
  firstRpm: 6000,
  fullRpm: 7000,
  blinkRpm: 7200,
};

const session = (driver: { CarPath?: string; CarModel?: string }) => ({
  DriverInfo: {
    DriverCarIdx: 1,
    DriverCarRedLine: 8500,
    DriverCarGearNumForward: 6,
    DriverCarSLFirstRPM: 6900,
    DriverCarSLShiftRPM: 7300,
    DriverCarSLBlinkRPM: 8245,
    Drivers: [
      { CarIdx: 0, CarModel: 'BMW M4 LMGT3' },
      { CarIdx: 1, ...driver },
    ],
  },
});

const lastConfig = () => {
  const layout = mocks.onDashboardUpdated.mock.lastCall?.[0] as DashboardLayout;
  return layout.widgets.find((w) => w.id === 'tachometer')
    ?.config as unknown as TachometerConfig;
};

const edit = (name: string, value: string) => {
  const input = screen.getByRole('spinbutton', { name });
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
  return input;
};

beforeEach(() => {
  mocks.onDashboardUpdated.mockClear();
  mocks.session = session({ CarPath: 'livery.veh', CarModel: FERRARI });
  config.ledRpmOverrides = {};
  localStorage.setItem('tachometerTab', 'options');
});

describe('TachometerSettings custom shift points', () => {
  it('offers the LMU car being driven, keyed by its model', () => {
    render(<TachometerSettings />);

    fireEvent.change(screen.getAllByRole('combobox')[1], {
      target: { value: FERRARI },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    const carConfigs = lastConfig().shiftPointSettings.carConfigs;
    expect(Object.keys(carConfigs)).toEqual([FERRARI]);
    expect(carConfigs[FERRARI].gearShiftPoints['3']).toEqual({
      shiftRpm: 7300,
    });
  });

  it('offers no current car where the sim names none by model', () => {
    mocks.session = session({ CarPath: 'ferrari296gt3' });
    render(<TachometerSettings />);

    expect(screen.queryByText(/\(current car\)/)).not.toBeInTheDocument();
  });
});

describe('TachometerSettings LED thresholds', () => {
  it('adds the car being driven with the thresholds it has now', () => {
    render(<TachometerSettings />);

    fireEvent.click(screen.getByRole('button', { name: `Add ${FERRARI}` }));

    expect(lastConfig().ledRpmOverrides).toEqual({
      [FERRARI]: {
        carName: FERRARI,
        firstRpm: 6900,
        fullRpm: 7300,
        blinkRpm: 8245,
      },
    });
  });

  it('keys an iRacing car by its bundled id', () => {
    mocks.session = session({ CarPath: 'Ferrari 296 GT3' });
    render(<TachometerSettings />);

    fireEvent.click(screen.getByRole('button', { name: /^Add .+/ }));

    expect(Object.keys(lastConfig().ledRpmOverrides ?? {})).toEqual([
      'ferrari296gt3',
    ]);
  });

  it('asks for a session when no car is being driven', () => {
    mocks.session = undefined;
    render(<TachometerSettings />);

    expect(screen.getByText(/Start a session/)).toBeInTheDocument();
  });

  it('does not offer a car that already has thresholds', () => {
    config.ledRpmOverrides = { [FERRARI]: saved };
    render(<TachometerSettings />);

    expect(
      screen.queryByRole('button', { name: `Add ${FERRARI}` })
    ).not.toBeInTheDocument();
  });

  it('saves an edited value, above the rev limit too', () => {
    config.ledRpmOverrides = { [FERRARI]: saved };
    render(<TachometerSettings />);

    edit(`${FERRARI}, Flash RPM`, '9000');

    expect(lastConfig().ledRpmOverrides?.[FERRARI]).toEqual({
      ...saved,
      blinkRpm: 9000,
    });
  });

  it.each([
    ['First LED', 'firstRpm', '7000'],
    ['All LEDs', 'fullRpm', '7300'],
    ['Flash', 'blinkRpm', '6999'],
    ['Flash', 'blinkRpm', ''],
  ] as const)('keeps %s (%s) instead of "%s"', (label, key, value) => {
    config.ledRpmOverrides = { [FERRARI]: saved };
    render(<TachometerSettings />);

    const input = edit(`${FERRARI}, ${label} RPM`, value);

    expect(mocks.onDashboardUpdated).not.toHaveBeenCalled();
    expect(input).toHaveValue(saved[key]);
  });

  it('returns a deleted car to the automatic thresholds', () => {
    config.ledRpmOverrides = { [FERRARI]: saved };
    render(<TachometerSettings />);

    fireEvent.click(
      screen.getByRole('button', {
        name: `Delete LED thresholds for ${FERRARI}`,
      })
    );

    expect(lastConfig().ledRpmOverrides).toEqual({});
  });
});
