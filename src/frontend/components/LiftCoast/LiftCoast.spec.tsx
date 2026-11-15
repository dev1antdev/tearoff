import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getWidgetDefaultConfig,
  type DriverControlsSnapshot,
  type LiftCoastConfig,
} from '@irdashies/types';
import * as Context from '@irdashies/context';
import { LiftCoast } from './LiftCoast';

vi.mock('@irdashies/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@irdashies/context')>();
  return {
    ...actual,
    useChannelSelector: vi.fn(),
    useDrivingState: vi.fn(),
    useSessionVisibility: vi.fn(),
  };
});

const DEFAULTS = getWidgetDefaultConfig('liftcoast');

// Prefixed so Vitest allows the hoisted vi.mock factory to close over it.
const mockSettings: { current: LiftCoastConfig } = { current: DEFAULTS };

vi.mock('./hooks/useLiftCoastSettings', () => ({
  useLiftCoastSettings: () => mockSettings.current,
}));

/** Puts a driver-controls snapshot behind the widget's channel selector. */
const withControls = (snapshot: Partial<DriverControlsSnapshot> | undefined) =>
  vi
    .mocked(Context.useChannelSelector)
    .mockImplementation(((
      _channel: string,
      selector: (value: DriverControlsSnapshot) => unknown
    ) =>
      snapshot === undefined
        ? undefined
        : selector({ version: 1, ...snapshot })) as never);

const tones = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('[data-tone]')].map(
    (light) => light.getAttribute('data-tone') ?? ''
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockSettings.current = DEFAULTS;
  vi.mocked(Context.useDrivingState).mockReturnValue({
    isDriving: true,
    isWatching: false,
    isWatchingOwnCar: false,
    isWatchingOtherCar: false,
  });
  vi.mocked(Context.useSessionVisibility).mockReturnValue(true);
  withControls({ liftAndCoast: 0 });
});

describe('LiftCoast', () => {
  it('draws a dark strip on a car with no saving target', () => {
    const { container } = render(<LiftCoast />);

    expect(tones(container)).toEqual(Array<string>(10).fill('off'));
  });

  it('draws a dark strip before the channel has delivered anything', () => {
    withControls(undefined);
    const { container } = render(<LiftCoast />);

    expect(tones(container)).toEqual(Array<string>(10).fill('off'));
  });

  it('lights the strip from its start as the signal builds', () => {
    withControls({ liftAndCoast: 0.35 });
    const { container } = render(<LiftCoast />);

    expect(tones(container)).toEqual([
      ...Array<string>(4).fill('low'),
      ...Array<string>(6).fill('off'),
    ]);
  });

  it('changes the lit lights to the critical colour past the threshold', () => {
    withControls({ liftAndCoast: 0.9 });
    const { container } = render(<LiftCoast />);

    expect(tones(container)).toEqual([
      ...Array<string>(9).fill('critical'),
      'off',
    ]);
  });

  it('hands every light to an assist while it works', () => {
    withControls({ liftAndCoast: 0.35, tcActive: true });
    const { container } = render(<LiftCoast />);

    expect(tones(container)).toEqual(Array<string>(10).fill('tc'));
  });

  it('draws as many lights as are set, twice with the mirrored strip', () => {
    mockSettings.current = { ...DEFAULTS, ledCount: 6 };
    expect(tones(render(<LiftCoast />).container)).toHaveLength(6);

    mockSettings.current = { ...DEFAULTS, ledCount: 6, mirrored: true };
    withControls({ liftAndCoast: 0.5 });
    const mirrored = tones(render(<LiftCoast />).container);
    expect(mirrored).toHaveLength(12);
    // Both strips show the same three lights.
    expect(mirrored.filter((tone) => tone === 'low')).toHaveLength(6);
  });

  it('draws nothing while dark when set to hide', () => {
    mockSettings.current = { ...DEFAULTS, hideWhenDark: true };
    const { container, rerender } = render(<LiftCoast />);
    expect(container).toBeEmptyDOMElement();

    // An assist brings it back.
    withControls({ brakeAbsActive: true });
    rerender(<LiftCoast />);
    expect(tones(container)).toEqual(Array<string>(10).fill('abs'));
  });

  it('is hidden out of the car, and shown there once that is switched off', () => {
    vi.mocked(Context.useDrivingState).mockReturnValue({
      isDriving: false,
      // The strip is the driver's own aids: watching a car does not show
      // it, the team car included, whose telemetry block is not read yet.
      isWatching: true,
      isWatchingOwnCar: true,
      isWatchingOtherCar: false,
    });
    const { container, rerender } = render(<LiftCoast />);
    expect(container).toBeEmptyDOMElement();

    mockSettings.current = { ...DEFAULTS, showOnlyWhenOnTrack: false };
    rerender(<LiftCoast />);
    expect(tones(container)).toHaveLength(10);
  });

  it('is hidden in a session it is switched off for', () => {
    vi.mocked(Context.useSessionVisibility).mockReturnValue(false);
    const { container } = render(<LiftCoast />);

    expect(container).toBeEmptyDOMElement();
  });
});
