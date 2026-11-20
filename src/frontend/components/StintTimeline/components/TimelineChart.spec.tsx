import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TimelineBar, TimelineRow } from '@irdashies/domain/raceForecast';
import {
  driverColour,
  driverFillClass,
  driverMarkClass,
  driverStrokeClass,
} from '../../shared/DriverColour/driverColours';
import { TimelineChart } from './TimelineChart';

vi.mock('@irdashies/context', () => ({
  useElementSize: () => ({ width: 700, height: 0 }),
}));

const NAMES = ['Ada', 'Ben', 'Cho', 'Dee', 'Eli', 'Fay'];

/** Six stints of an hour, each by another driver, then one to come. */
const bars: TimelineBar[] = [
  ...NAMES.map((driver, index): TimelineBar => ({
    from: index * 3600,
    to: index * 3600 + 3500,
    kind: 'driven',
    driver,
    driverIndex: index,
    driverChanges: index,
    current: index === NAMES.length - 1,
  })),
  {
    from: 6 * 3600,
    to: 7 * 3600,
    kind: 'forecast',
    driver: 'Fay',
    driverIndex: 5,
    driverChanges: 5,
    current: true,
  },
];

const axis = { kind: 'time' as const, end: 7 * 3600, now: 6 * 3600, ticks: [] };
const row = (own: boolean): TimelineRow => ({ carIdx: own ? 0 : 1, own, bars });

const classesOf = (kind: 'driven' | 'forecast'): string[] =>
  screen
    .getAllByTestId('stint-bar')
    .filter((bar) => bar.dataset.kind === kind)
    .map((bar) => bar.querySelector('rect')?.getAttribute('class') ?? '');

describe('TimelineChart', () => {
  it('colours our drivers as Crew and Stints and the Race Charts do', () => {
    render(<TimelineChart axis={axis} rows={[row(true)]} showDrivers />);

    // The same rule, driver for driver. The chart had six colours of its
    // own and took the first again after the sixth; the others take it
    // again after the fourth, so our fifth driver was rose here and amber
    // there.
    expect(classesOf('driven')).toEqual(
      NAMES.map((_, index) => driverMarkClass(driverColour(index, true)))
    );
    expect(classesOf('driven')[4]).toBe('fill-amber-400');
    expect(classesOf('driven')[4]).toBe(classesOf('driven')[0]);
    // The swatch Crew and Stints puts beside the same driver.
    expect(driverFillClass(driverColour(4, true))).toBe('bg-amber-400');
    // What is left of the stint under way is outlined in its driver's.
    expect(classesOf('forecast')[0]).toContain(
      driverStrokeClass(driverColour(5, true))
    );
  });

  it('writes the name on a stint to come in its driver’s colour', () => {
    render(<TimelineChart axis={axis} rows={[row(true)]} showDrivers />);

    const label = screen
      .getAllByTestId('stint-bar')
      .find((bar) => bar.dataset.kind === 'forecast')
      ?.querySelector('text');
    expect(label).toHaveTextContent('Fay');
    expect(label?.getAttribute('class')).toContain('fill-current');
    expect(label?.getAttribute('class')).toContain('text-teal-300');
  });

  it('leaves a rival’s bars grey, one shade and the other after each change', () => {
    render(<TimelineChart axis={axis} rows={[row(false)]} showDrivers />);

    // Restrained greys, so our own car's driver colours stand out.
    expect(classesOf('driven')).toEqual([
      'fill-slate-700',
      'fill-slate-600',
      'fill-slate-700',
      'fill-slate-600',
      'fill-slate-700',
      'fill-slate-600',
    ]);
  });
});
