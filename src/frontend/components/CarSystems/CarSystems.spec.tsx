import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CarSystemAdjustment,
  CarSystemChange,
  CarSystemsSnapshot,
} from '@irdashies/types';
import * as Context from '@irdashies/context';
import { CarSystems } from './CarSystems';

vi.mock('@irdashies/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@irdashies/context')>();
  return {
    ...actual,
    useActiveSimulator: vi.fn(),
    useCarSystemsSnapshot: vi.fn(),
    useDrivingState: vi.fn(),
    useGeneralSettings: vi.fn(),
    useSessionVisibility: vi.fn(),
    useSessionStore: vi.fn(),
    useDriverCarIdx: vi.fn(),
  };
});

const DEFAULT_SETTINGS = {
  rows: ['dcBrakeBias', 'dcABS'],
  lmuRows: ['dcBrakeBias', 'dcABS', 'dcTractionControl', 'LmuTcSlip'],
  displayMode: 'always' as 'always' | 'onChange',
  changeHoldSeconds: 4,
  flashOnChange: true,
  highlightActive: true,
  showScale: false,
  showBrakeBiasDelta: false,
  showUnsupportedRows: true,
  showOffRows: true,
  background: { opacity: 80 },
  showOnlyWhenOnTrack: false,
};

// Prefixed so Vitest allows the hoisted vi.mock factory to close over it.
const mockSettings = { ...DEFAULT_SETTINGS };

vi.mock('./hooks/useCarSystemsSettings', () => ({
  useCarSystemsSettings: () => mockSettings,
}));

const snapshot: CarSystemsSnapshot = {
  adjustments: [
    {
      key: 'dcBrakeBias',
      label: 'Brake Bias',
      value: 54.5,
      isOff: false,
      precision: 1,
      unit: '%',
    },
    {
      key: 'dcABS',
      label: 'ABS',
      value: 3,
      isOff: false,
      precision: 0,
    },
  ],
  discovered: true,
  lastChange: null,
  sessionNum: 0,
  version: 1,
};

const inCar = (carPath: string | undefined, regenLevel?: string) => {
  vi.mocked(Context.useDriverCarIdx).mockReturnValue(2);
  // The store is read with a selector, so the mock has to apply it rather than
  // hand back the whole state - otherwise every lookup silently reads
  // undefined and the test passes for the wrong reason.
  vi.mocked(Context.useSessionStore).mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((selector: (state: any) => unknown) =>
      selector({
        session: {
          DriverInfo: {
            Drivers: carPath ? [{ CarIdx: 2, CarPath: carPath }] : [],
          },
          LmuRest: regenLevel
            ? {
                garage: {
                  regenLevel: { text: regenLevel, value: 3, positions: 6 },
                },
              }
            : undefined,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      })) as any
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mockSettings, DEFAULT_SETTINGS);
  vi.mocked(Context.useActiveSimulator).mockReturnValue('iracing');
  vi.mocked(Context.useCarSystemsSnapshot).mockReturnValue(snapshot);
  vi.mocked(Context.useDrivingState).mockReturnValue({
    isDriving: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  vi.mocked(Context.useGeneralSettings).mockReturnValue(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { compactMode: 'normal' } as any
  );
  vi.mocked(Context.useSessionVisibility).mockReturnValue(true);
});

describe('CarSystems per-car labels', () => {
  it('uses the catalogue name on a car that does not rename the channel', () => {
    inCar('bmwm4gt3');

    render(<CarSystems />);

    expect(screen.getByText('ABS')).toBeInTheDocument();
    expect(screen.queryByText('MIGR')).not.toBeInTheDocument();
  });

  it('uses the car-specific name where the car renames the channel', () => {
    inCar('cadillacvseriesrgtp');

    render(<CarSystems />);

    expect(screen.getByText('MIGR')).toBeInTheDocument();
    expect(screen.queryByText('ABS')).not.toBeInTheDocument();
  });

  it('still shows the value under the renamed header', () => {
    inCar('cadillacvseriesrgtp');

    render(<CarSystems />);

    // The rename is cosmetic - the row is still matched on dcABS, so a car
    // that renames it must not end up with a blanked-out column.
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('does not let dcPeakBrakeBias overwrite the brake bias column', () => {
    // The W13 publishes both: a live 52% bias and a migration dial reading 3.
    // Folding them into one column showed the migration setting as the bias.
    vi.mocked(Context.useCarSystemsSnapshot).mockReturnValue({
      ...snapshot,
      adjustments: [
        {
          key: 'dcBrakeBias',
          label: 'Brake Bias',
          value: 52,
          isOff: false,
          precision: 1,
          unit: '%',
        },
        {
          key: 'dcPeakBrakeBias',
          label: 'Rear Brake Valve',
          value: 3,
          isOff: false,
          precision: 0,
        },
      ],
    });
    inCar('mercedesw13');

    render(<CarSystems />);

    // Under the old fold the bias column rendered the migration adjustment,
    // so it read a bare "3" - its own precision and no unit - rather than 52.0%.
    expect(screen.getByText('52.0%')).toBeInTheDocument();
    expect(screen.queryByText('3')).not.toBeInTheDocument();
  });

  it('hides a system the driver switched off when asked to', () => {
    vi.mocked(Context.useCarSystemsSnapshot).mockReturnValue({
      ...snapshot,
      adjustments: [
        {
          key: 'dcBrakeBias',
          label: 'Brake Bias',
          value: 54.5,
          isOff: false,
          precision: 1,
          unit: '%',
        },
        {
          key: 'dcABS',
          label: 'ABS',
          value: 0,
          isOff: true,
          precision: 0,
        },
      ],
    });
    mockSettings.showOffRows = false;
    inCar('bmwm4gt3');

    render(<CarSystems />);

    expect(screen.getByText('BB')).toBeInTheDocument();
    expect(screen.queryByText('ABS')).not.toBeInTheDocument();
  });

  it('keeps a switched-off system by default', () => {
    // Off and unsupported are different facts, so turning off one filter must
    // not quietly take the other's rows with it.
    vi.mocked(Context.useCarSystemsSnapshot).mockReturnValue({
      ...snapshot,
      adjustments: [
        {
          key: 'dcABS',
          label: 'ABS',
          value: 0,
          isOff: true,
          precision: 0,
        },
      ],
    });
    mockSettings.showUnsupportedRows = false;
    inCar('bmwm4gt3');

    render(<CarSystems />);

    expect(screen.getByText('ABS')).toBeInTheDocument();
  });

  it('falls back to the catalogue name when session data has no player entry', () => {
    inCar(undefined);

    render(<CarSystems />);

    expect(screen.getByText('ABS')).toBeInTheDocument();
  });
});

/** A row as the processor publishes it for one of LMU's dials. */
const row = (
  key: string,
  value: number,
  extra: Partial<CarSystemAdjustment> = {}
): CarSystemAdjustment => ({
  key,
  label: key,
  value,
  isOff: false,
  precision: key === 'dcBrakeBias' ? 1 : 0,
  unit: key === 'dcBrakeBias' ? '%' : undefined,
  ...extra,
});

/** The recorded LMGT3, as the processor publishes it. */
const lmgt3 = (
  tc = 6,
  lastChange: CarSystemChange | null = null
): CarSystemsSnapshot => ({
  adjustments: [
    row('dcBrakeBias', 51.75),
    row('dcABS', 9, { max: 9, active: false }),
    row('dcTractionControl', tc, { max: 11, active: false }),
    row('LmuTcSlip', 7, { max: 11 }),
    row('LmuTcCut', 7, { max: 11 }),
    row('LmuMotorMap', 1, { max: 1 }),
    row('LmuWiper', 1),
  ],
  discovered: true,
  lastChange,
  sessionNum: 0,
  version: 1,
});

const underLmu = (
  systems: CarSystemsSnapshot = lmgt3(),
  carPath = '74_26_KESS40986092'
) => {
  vi.mocked(Context.useActiveSimulator).mockReturnValue('lmu');
  vi.mocked(Context.useCarSystemsSnapshot).mockReturnValue(systems);
  inCar(carPath);
};

describe('CarSystems under Le Mans Ultimate', () => {
  it('draws the LMU list, not the iRacing one', () => {
    underLmu();

    render(<CarSystems />);

    expect(
      ['BB', 'ABS', 'TC', 'SLIP'].map((short) => !!screen.queryByText(short))
    ).toEqual([true, true, true, true]);
    expect(screen.getByText('51.8%')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
  });

  it('draws the iRacing list under iRacing, whatever the LMU one holds', () => {
    inCar('bmwm4gt3');

    render(<CarSystems />);

    expect(screen.getByText('BB')).toBeInTheDocument();
    expect(screen.getByText('ABS')).toBeInTheDocument();
    expect(screen.queryByText('TC')).not.toBeInTheDocument();
    expect(screen.queryByText('SLIP')).not.toBeInTheDocument();
  });

  it('never draws a column the running sim does not publish', () => {
    // A list edited by hand, or saved by a build that offered more: neither
    // sim gets a column from the other's catalogue, blank or not.
    mockSettings.lmuRows = ['dcBrakeBias', 'dcThrottleShape', 'dcEnginePower'];
    underLmu({
      ...lmgt3(),
      adjustments: [row('dcBrakeBias', 51.75), row('dcThrottleShape', 2)],
    });

    const { unmount } = render(<CarSystems />);

    expect(screen.getByText('BB')).toBeInTheDocument();
    expect(screen.queryByText('THR')).not.toBeInTheDocument();
    expect(screen.queryByText('PWR')).not.toBeInTheDocument();
    unmount();

    mockSettings.rows = ['dcBrakeBias', 'LmuTcSlip', 'LmuWiper'];
    vi.mocked(Context.useActiveSimulator).mockReturnValue('iracing');
    vi.mocked(Context.useCarSystemsSnapshot).mockReturnValue({
      ...snapshot,
      adjustments: [row('dcBrakeBias', 54.5), row('LmuTcSlip', 7)],
    });
    inCar('bmwm4gt3');

    render(<CarSystems />);

    expect(screen.getByText('BB')).toBeInTheDocument();
    expect(screen.queryByText('SLIP')).not.toBeInTheDocument();
    expect(screen.queryByText('WIPE')).not.toBeInTheDocument();
  });

  it('draws the iRacing list while no sim has been detected', () => {
    vi.mocked(Context.useActiveSimulator).mockReturnValue(null);
    inCar('bmwm4gt3');

    render(<CarSystems />);

    expect(screen.getByText('ABS')).toBeInTheDocument();
    expect(screen.queryByText('SLIP')).not.toBeInTheDocument();
  });

  it('does not rename a dial from the iRacing car table', () => {
    // LMU's CarPath is a file name, but nothing stops one normalising to a
    // key of the override table. An LMU dial is what the sim says it is.
    underLmu(lmgt3(), 'cadillacvseriesrgtp');

    render(<CarSystems />);

    expect(screen.getByText('ABS')).toBeInTheDocument();
    expect(screen.getByText('TC')).toBeInTheDocument();
    expect(screen.queryByText('MIGR')).not.toBeInTheDocument();
    expect(screen.queryByText('TCS')).not.toBeInTheDocument();
  });

  it('leaves a dial the car does not have blank, or out', () => {
    mockSettings.lmuRows = ['dcBrakeBias', 'LmuBrakeMigration'];
    underLmu();

    const { unmount } = render(<CarSystems />);
    expect(screen.getByText('MIGR')).toBeInTheDocument();
    expect(screen.getByText('--')).toBeInTheDocument();
    unmount();

    mockSettings.showUnsupportedRows = false;
    render(<CarSystems />);
    expect(screen.queryByText('MIGR')).not.toBeInTheDocument();
  });

  it('names the wiper state rather than numbering it', () => {
    mockSettings.lmuRows = ['LmuWiper'];
    underLmu();

    render(<CarSystems />);

    expect(screen.getByText('WIPE')).toBeInTheDocument();
    expect(screen.getByText('AUTO')).toBeInTheDocument();
    expect(screen.queryByText('1')).not.toBeInTheDocument();
  });

  it('shows a wiper state it has no name for as the number', () => {
    mockSettings.lmuRows = ['LmuWiper'];
    underLmu({ ...lmgt3(), adjustments: [row('LmuWiper', 7)] });

    render(<CarSystems />);

    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('shows the top of the scale only when asked to', () => {
    underLmu();

    const { unmount } = render(<CarSystems />);
    expect(screen.queryByText('/11')).not.toBeInTheDocument();
    unmount();

    mockSettings.showScale = true;
    render(<CarSystems />);

    // TC and slip, both of 11; ABS of 9; the bias has no scale.
    expect(screen.getAllByText('/11')).toHaveLength(2);
    expect(screen.getByText('/9')).toBeInTheDocument();
    expect(screen.getByText('51.8%').textContent).toBe('51.8%');
  });

  it('shows the bias against its baseline only when asked to', () => {
    const moved = {
      ...lmgt3(),
      adjustments: [row('dcBrakeBias', 52.25, { baselineDelta: 0.5 })],
    };
    underLmu(moved);

    const { unmount } = render(<CarSystems />);
    expect(screen.queryByText('+0.5')).not.toBeInTheDocument();
    unmount();

    mockSettings.showBrakeBiasDelta = true;
    render(<CarSystems />);

    expect(screen.getByText('+0.5')).toBeInTheDocument();
  });

  it.each([
    [0.25, '+0.25'],
    [-0.75, '-0.75'],
    [-1, '-1.0'],
    [0, '0.0'],
    // What a quarter point of bias is after a round trip through a float.
    [0.2500000000000071, '+0.25'],
  ])('writes a bias delta of %s as %s', (delta, text) => {
    mockSettings.showBrakeBiasDelta = true;
    underLmu({
      ...lmgt3(),
      adjustments: [row('dcBrakeBias', 52, { baselineDelta: delta })],
    });

    render(<CarSystems />);

    expect(screen.getByText(text)).toBeInTheDocument();
  });

  describe('the regeneration level', () => {
    beforeEach(() => {
      mockSettings.lmuRows = ['dcBrakeBias', 'LmuRegenLevel'];
    });

    it('is drawn from the session, as the garage words it', () => {
      vi.mocked(Context.useActiveSimulator).mockReturnValue('lmu');
      vi.mocked(Context.useCarSystemsSnapshot).mockReturnValue(lmgt3());
      inCar('499P', '60%');

      render(<CarSystems />);

      expect(screen.getByText('REGEN')).toBeInTheDocument();
      expect(screen.getByText('60%')).toBeInTheDocument();
    });

    it('leaves out the note a garage value can carry after the figure', () => {
      vi.mocked(Context.useActiveSimulator).mockReturnValue('lmu');
      vi.mocked(Context.useCarSystemsSnapshot).mockReturnValue(lmgt3());
      inCar('499P', '3 (Default)');

      render(<CarSystems />);

      expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('is blank on a car that has no such setting', () => {
      underLmu();

      const { unmount } = render(<CarSystems />);
      expect(screen.getByText('REGEN')).toBeInTheDocument();
      expect(screen.getByText('--')).toBeInTheDocument();
      unmount();

      mockSettings.showUnsupportedRows = false;
      render(<CarSystems />);
      expect(screen.queryByText('REGEN')).not.toBeInTheDocument();
    });

    it('reads a level of zero as switched off', () => {
      mockSettings.showOffRows = false;
      vi.mocked(Context.useActiveSimulator).mockReturnValue('lmu');
      vi.mocked(Context.useCarSystemsSnapshot).mockReturnValue(lmgt3());
      inCar('499P', '0%');

      render(<CarSystems />);

      expect(screen.queryByText('REGEN')).not.toBeInTheDocument();
    });
  });
});

describe('CarSystems while a system is working', () => {
  const working = (): CarSystemsSnapshot => ({
    ...lmgt3(),
    adjustments: [
      row('dcBrakeBias', 51.75),
      row('dcABS', 9, { active: true }),
      row('dcTractionControl', 6, { active: true }),
      row('LmuTcSlip', 7),
    ],
  });

  it('lights the header of ABS and traction control', () => {
    underLmu(working());

    render(<CarSystems />);

    expect(screen.getByText('ABS')).toHaveClass('bg-yellow-500');
    expect(screen.getByText('TC')).toHaveClass('bg-yellow-500');
    expect(screen.getByText('SLIP')).not.toHaveClass('bg-yellow-500');
    expect(screen.getByText('BB')).not.toHaveClass('bg-yellow-500');
  });

  it('leaves the headers in their own colours when the light is off', () => {
    mockSettings.highlightActive = false;
    underLmu(working());

    render(<CarSystems />);

    expect(screen.getByText('ABS')).toHaveClass('bg-green-600');
    expect(screen.getByText('TC')).toHaveClass('bg-blue-700');
  });

  it('lights ABS under iRacing too', () => {
    vi.mocked(Context.useCarSystemsSnapshot).mockReturnValue({
      ...snapshot,
      adjustments: [row('dcABS', 3, { active: true })],
    });
    inCar('bmwm4gt3');

    render(<CarSystems />);

    expect(screen.getByText('ABS')).toHaveClass('bg-yellow-500');
  });
});

describe('CarSystems when a dial moves', () => {
  const LIT = 'bg-amber-400';
  const tcUp: CarSystemChange = {
    key: 'dcTractionControl',
    from: 6,
    to: 7,
    seq: 1,
  };

  /** Publishes a snapshot to a widget that is already on screen. */
  const publish = (rerender: (ui: React.ReactNode) => void) => {
    return (systems: CarSystemsSnapshot) => {
      vi.mocked(Context.useCarSystemsSnapshot).mockReturnValue(systems);
      rerender(<CarSystems />);
    };
  };

  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lights the value of the dial that moved, and lets it go', () => {
    underLmu();
    const { rerender } = render(<CarSystems />);
    expect(screen.getByText('6')).not.toHaveClass(LIT);

    publish(rerender)(lmgt3(7, tcUp));

    // Traction control and slip both read 7 now; only the first moved.
    const [tc, slip] = screen.getAllByText('7');
    expect(tc).toHaveClass(LIT);
    expect(slip).not.toHaveClass(LIT);
    expect(screen.getByText('9')).not.toHaveClass(LIT);

    advance(599);
    expect(screen.getAllByText('7')[0]).toHaveClass(LIT);
    advance(1);
    expect(screen.getAllByText('7')[0]).not.toHaveClass(LIT);
  });

  it('starts the light again when the dial moves again', () => {
    underLmu();
    const { rerender } = render(<CarSystems />);
    publish(rerender)(lmgt3(7, tcUp));
    advance(500);

    publish(rerender)(lmgt3(8, { ...tcUp, from: 7, to: 8, seq: 2 }));
    advance(500);

    // A second past the first click, half a second past the second.
    expect(screen.getByText('8')).toHaveClass(LIT);
    advance(100);
    expect(screen.getByText('8')).not.toHaveClass(LIT);
  });

  it('does not light anything with the highlight switched off', () => {
    mockSettings.flashOnChange = false;
    underLmu();
    const { rerender } = render(<CarSystems />);

    publish(rerender)(lmgt3(7, tcUp));

    expect(screen.getAllByText('7')[0]).not.toHaveClass(LIT);
  });

  it('does not light a change that was already there when it came up', () => {
    // An overlay reloaded mid-session finds the driver's last movement still
    // on the snapshot, from however long ago.
    underLmu(lmgt3(7, tcUp));

    render(<CarSystems />);

    expect(screen.getAllByText('7')[0]).not.toHaveClass(LIT);
  });

  it('lights a dial under iRacing as well', () => {
    inCar('bmwm4gt3');
    const { rerender } = render(<CarSystems />);

    publish(rerender)({
      ...snapshot,
      adjustments: [row('dcBrakeBias', 54.5), row('dcABS', 4)],
      lastChange: { key: 'dcABS', from: 3, to: 4, seq: 1 },
    });

    expect(screen.getByText('4')).toHaveClass(LIT);
    expect(screen.getByText('54.5%')).not.toHaveClass(LIT);
  });

  describe('shown only when a dial changes', () => {
    beforeEach(() => {
      mockSettings.displayMode = 'onChange';
    });

    it('draws nothing before the first change', () => {
      underLmu();

      const { container } = render(<CarSystems />);
      advance(10_000);

      expect(container).toBeEmptyDOMElement();
    });

    it('draws the whole strip for the hold time after a change', () => {
      underLmu();
      const { container, rerender } = render(<CarSystems />);

      publish(rerender)(lmgt3(7, tcUp));

      // Every column, not only the one that moved.
      expect(
        ['BB', 'ABS', 'TC', 'SLIP'].map((short) => !!screen.queryByText(short))
      ).toEqual([true, true, true, true]);

      advance(3_999);
      expect(screen.getByText('TC')).toBeInTheDocument();
      // Four seconds on it starts to go, and is gone once it has faded.
      advance(1);
      expect(container.firstElementChild).toHaveClass('opacity-0');
      advance(300);
      expect(container).toBeEmptyDOMElement();
    });

    it('holds from the last change, not the first', () => {
      underLmu();
      const { container, rerender } = render(<CarSystems />);
      publish(rerender)(lmgt3(7, tcUp));
      advance(3_000);

      publish(rerender)(lmgt3(8, { ...tcUp, from: 7, to: 8, seq: 2 }));
      advance(3_999);

      // Seven seconds after the first click, and still up.
      expect(container).not.toBeEmptyDOMElement();
      expect(container.firstElementChild).not.toHaveClass('opacity-0');
      advance(301);
      expect(container).toBeEmptyDOMElement();
    });

    it('stays for as long as the setting says', () => {
      mockSettings.changeHoldSeconds = 1.5;
      underLmu();
      const { container, rerender } = render(<CarSystems />);

      publish(rerender)(lmgt3(7, tcUp));
      advance(1_499);
      expect(container.firstElementChild).not.toHaveClass('opacity-0');
      advance(301);

      expect(container).toBeEmptyDOMElement();
    });

    it('holds for the default time when the saved setting is not a number', () => {
      // The setting comes from a file on disk. Handed to a timer as it is, it
      // would take the strip down the moment it came up.
      mockSettings.changeHoldSeconds = Number.NaN;
      underLmu();
      const { container, rerender } = render(<CarSystems />);

      publish(rerender)(lmgt3(7, tcUp));
      advance(3_999);

      expect(container.firstElementChild).not.toHaveClass('opacity-0');
      advance(301);
      expect(container).toBeEmptyDOMElement();
    });

    it('comes back at full strength when a dial moves as it fades', () => {
      underLmu();
      const { container, rerender } = render(<CarSystems />);
      publish(rerender)(lmgt3(7, tcUp));
      advance(4_100);
      expect(container.firstElementChild).toHaveClass('opacity-0');

      publish(rerender)(lmgt3(8, { ...tcUp, from: 7, to: 8, seq: 2 }));

      expect(container.firstElementChild).not.toHaveClass('opacity-0');
      advance(1_000);
      expect(container).not.toBeEmptyDOMElement();
    });

    it('draws nothing for a change that was already there', () => {
      underLmu(lmgt3(7, tcUp));

      const { container } = render(<CarSystems />);

      expect(container).toBeEmptyDOMElement();
    });

    it('draws nothing out of the car, even inside the hold time', () => {
      underLmu();
      const { container, rerender } = render(<CarSystems />);
      publish(rerender)(lmgt3(7, tcUp));
      expect(container).not.toBeEmptyDOMElement();

      vi.mocked(Context.useDrivingState).mockReturnValue({
        isDriving: false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      rerender(<CarSystems />);

      expect(container).toBeEmptyDOMElement();
    });

    it('draws nothing on track only while a team-mate drives the car', () => {
      // The sim sends the dials only for a car the user is in, so watching
      // the own car is not on track here, whatever else is read for it.
      mockSettings.displayMode = 'always';
      mockSettings.showOnlyWhenOnTrack = true;
      underLmu(lmgt3(7));
      vi.mocked(Context.useDrivingState).mockReturnValue({
        isDriving: false,
        isWatching: true,
        isWatchingOwnCar: true,
        isWatchingOtherCar: false,
      });

      const { container } = render(<CarSystems />);

      expect(container).toBeEmptyDOMElement();
    });

    it('is always drawn in the always mode, change or no change', () => {
      mockSettings.displayMode = 'always';
      underLmu();

      const { container } = render(<CarSystems />);
      advance(60_000);

      expect(container).not.toBeEmptyDOMElement();
      expect(container.firstElementChild).not.toHaveClass('opacity-0');
    });
  });
});
