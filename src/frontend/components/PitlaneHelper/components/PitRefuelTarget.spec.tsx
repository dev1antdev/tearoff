import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PitRefuelTarget } from './PitRefuelTarget';

const badge = (amount: number, isVirtualEnergy: boolean) =>
  render(<PitRefuelTarget amount={amount} isVirtualEnergy={isVirtualEnergy} />)
    .container.firstChild as HTMLElement;

describe('PitRefuelTarget', () => {
  it('shows virtual energy as a whole percentage', () => {
    // The pit menu only offers whole steps, so a decimal would be invented.
    const element = badge(45, true);

    expect(element.textContent).toBe('Refuel45%');
    expect(
      element.querySelector('[aria-label="Virtual energy"]')
    ).not.toBeNull();
    expect(element.querySelector('[aria-label="Fuel"]')).toBeNull();
  });

  it('shows fuel in litres to one decimal', () => {
    const element = badge(47.32, false);

    expect(element.textContent).toBe('Refuel47.3 L');
    expect(element.querySelector('[aria-label="Fuel"]')).not.toBeNull();
    expect(element.querySelector('[aria-label="Virtual energy"]')).toBeNull();
  });

  it('shows a stop set to add nothing, which is worth knowing', () => {
    expect(badge(0, false).textContent).toBe('Refuel0.0 L');
    expect(badge(0, true).textContent).toBe('Refuel0%');
  });
});
