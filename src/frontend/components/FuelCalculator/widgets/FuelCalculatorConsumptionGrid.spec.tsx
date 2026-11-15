import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { demoFuelData } from '../demoData';
import type { FuelCalculation } from '../types';
import { FuelCalculatorConsumptionGrid } from './FuelCalculatorConsumptionGrid';

const show = (data: FuelCalculation) =>
  render(<FuelCalculatorConsumptionGrid fuelData={data} displayData={data} />);

describe('Fuel Calculator consumption grid heading', () => {
  beforeEach(() => {
    // No snapshot is delivered: the heading is built from the data alone.
    window.channelBridge = { subscribe: () => () => undefined };
  });

  it('gives the race its length', () => {
    show(demoFuelData);

    expect(screen.getByText('Race L3 / 35')).toBeInTheDocument();
  });

  it.each([
    ['rFactor 2', 2147483647],
    ['iRacing', 32767],
    ['a sum that came to nothing', Number.NaN],
    ['none yet', 0],
  ])('gives no length for a total that is not one: %s', (_from, totalLaps) => {
    // The first lap of a timed race under Le Mans Ultimate, where the total
    // was the sim's 2147483647 until a lap had been driven.
    show({ ...demoFuelData, currentLap: 1, totalLaps });

    expect(screen.getByText('Race L1')).toBeInTheDocument();
    expect(screen.queryByText(/^Race L1 \//)).toBeNull();
  });
});
