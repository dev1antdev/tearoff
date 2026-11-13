import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionBarSnapshot } from '@irdashies/context';
import { FuelLevelItem, formatVirtualEnergy } from './FuelLevelItem';

vi.mock('@irdashies/context', async () => {
  const actual = await vi.importActual('@irdashies/context');
  return { ...actual, useSessionBarSnapshot: vi.fn() };
});

const props = { settings: undefined, standalone: false };

const withSnapshot = (snapshot: Record<string, unknown> | undefined) =>
  vi.mocked(useSessionBarSnapshot).mockReturnValue(snapshot as never);

beforeEach(() => {
  vi.mocked(useSessionBarSnapshot).mockReset();
});

describe('FuelLevelItem', () => {
  it('shows litres for a fuel-limited car', () => {
    withSnapshot({ fuelLevel: 32.5, displayUnits: 1 });

    const { container } = render(<FuelLevelItem {...props} />);

    expect(container.textContent).toBe('32.5 L');
    expect(container.querySelector('[aria-label="Virtual energy"]')).toBeNull();
  });

  it('shows gallons when the sim is set to imperial units', () => {
    withSnapshot({ fuelLevel: 37.854, displayUnits: 0 });

    const { container } = render(<FuelLevelItem {...props} />);

    expect(container.textContent).toBe('10.0 gal');
  });

  it('puts virtual energy first for a car that runs on it', () => {
    // The energy is what ends the stint, so it leads; the litres stay
    // because they are what the pit crew pours.
    withSnapshot({ fuelLevel: 44.9, virtualEnergy: 0.452, displayUnits: 1 });

    const { container } = render(<FuelLevelItem {...props} />);

    expect(container.textContent).toBe('45.2%44.9 L');
    expect(
      container.querySelector('[aria-label="Virtual energy"]')
    ).not.toBeNull();
  });

  it('shows an empty energy budget as 0.0%, which is a reading', () => {
    withSnapshot({ fuelLevel: 12.3, virtualEnergy: 0, displayUnits: 1 });

    const { container } = render(<FuelLevelItem {...props} />);

    expect(container.textContent).toBe('0.0%12.3 L');
  });

  it('renders nothing when the player has no car', () => {
    // Out of the car there is no reading. "0.0 L" would claim an empty tank.
    withSnapshot({ displayUnits: 1 });

    const { container } = render(<FuelLevelItem {...props} />);

    expect(container.firstChild).toBeNull();
  });

  it('renders nothing before the first snapshot', () => {
    withSnapshot(undefined);

    const { container } = render(<FuelLevelItem {...props} />);

    expect(container.firstChild).toBeNull();
  });
});

describe('formatVirtualEnergy', () => {
  it('keeps one decimal, because a lap costs only a point or two', () => {
    expect(formatVirtualEnergy(0.452)).toBe('45.2%');
    expect(formatVirtualEnergy(1)).toBe('100.0%');
    expect(formatVirtualEnergy(0)).toBe('0.0%');
  });
});
