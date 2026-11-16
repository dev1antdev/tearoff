import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { VirtualEnergyCell } from './VirtualEnergyCell';

const cell = (props: Parameters<typeof VirtualEnergyCell>[0]) =>
  render(
    <table>
      <tbody>
        <tr>
          <VirtualEnergyCell {...props} />
        </tr>
      </tbody>
    </table>
  ).container.querySelector('[data-column="lmuVirtualEnergy"]') as HTMLElement;

describe('VirtualEnergyCell', () => {
  it('shows a whole percentage', () => {
    // No decimal: the fuel source is byte-quantised, so a decimal place would
    // be showing the quantisation rather than the fuel.
    expect(cell({ remaining: 0.42 }).textContent).toBe('42%');
    expect(cell({ remaining: 1 }).textContent).toBe('100%');
  });

  it('renders nothing for a car with no reading', () => {
    // Blank, not 0%: the sim has not said this car is empty.
    expect(cell({ remaining: undefined }).textContent).toBe('');
  });

  it('shows an empty car as 0%, which is a reading', () => {
    expect(cell({ remaining: 0 }).textContent).toBe('0%');
  });

  it('escalates as the budget runs down', () => {
    const tone = (remaining: number) =>
      cell({ remaining }).querySelector('span')?.className ?? '';
    expect(tone(0.5)).not.toMatch(/text-(amber|red)-/);
    expect(tone(0.3)).toContain('text-amber-300');
    expect(tone(0.2)).toContain('text-amber-300');
    expect(tone(0.1)).toContain('text-red-400');
    expect(tone(0)).toContain('text-red-400');
  });

  it('marks a fuel figure, so it is not read as energy', () => {
    // The column is headed VE. A bare 20% under it on an LMP2 row would be
    // taken for virtual energy, which that car does not have.
    const fuel = cell({ remaining: 0.2, isVirtual: false });
    expect(fuel.querySelector('[aria-label="Fuel"]')).not.toBeNull();
    expect(fuel.textContent).toBe('20%');
    expect(fuel.querySelector('span')?.title).toBe('Fuel remaining');
  });

  it('leaves an energy figure unmarked', () => {
    const energy = cell({ remaining: 0.2, isVirtual: true });
    expect(energy.querySelector('[aria-label="Fuel"]')).toBeNull();
    expect(energy.querySelector('span')?.title).toBe(
      'Virtual energy remaining'
    );
  });

  it('leaves the figure unmarked when nothing says which it is', () => {
    // An older snapshot carries no flag. Guessing fuel would put a pump on
    // every Hypercar.
    expect(
      cell({ remaining: 0.2 }).querySelector('[aria-label="Fuel"]')
    ).toBeNull();
  });
});
