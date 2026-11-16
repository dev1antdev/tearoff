import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DeltaCell } from './DeltaCell';

describe('signed player gap cells', () => {
  it.each([
    [{ value: 12.34, laps: 0 }, '+12.3'],
    [{ value: -12.34, laps: 0 }, '-12.3'],
    [{ value: 0, laps: 0 }, '0.0'],
    [{ value: undefined, laps: 1 }, '+1L'],
    [{ value: undefined, laps: -2 }, '-2L'],
    [{ value: 70, laps: 0 }, '+1:10'],
  ])('formats %j as %s', (gap, text) => {
    render(
      <table>
        <tbody>
          <tr>
            <DeltaCell delta={gap} showSign decimalPlaces={1} />
          </tr>
        </tbody>
      </table>
    );
    expect(screen.getByRole('cell').textContent).toBe(text);
  });

  it('preserves unsigned leader display by default', () => {
    render(
      <table>
        <tbody>
          <tr>
            <DeltaCell delta={{ value: 12.34, laps: 0 }} decimalPlaces={1} />
          </tr>
        </tbody>
      </table>
    );
    expect(screen.getByRole('cell').textContent).toBe('12.3');
  });
});

describe('interval and class-leader gap cells', () => {
  it.each([
    // A car two laps behind the one ahead, in laps mode and in time mode.
    [{ value: undefined, laps: -2 }, '-2L'],
    [168.9, '2:48'],
    // Laps win over the time carried beside them.
    [{ value: 243.8, laps: -1 }, '-1L'],
    // On the same lap: seconds.
    [{ value: 33.94, laps: 0 }, '33.9'],
    [6.36, '6.4'],
  ])('prints %j as %s', (delta, text) => {
    render(
      <table>
        <tbody>
          <tr>
            <DeltaCell delta={delta} decimalPlaces={1} />
          </tr>
        </tbody>
      </table>
    );
    expect(screen.getByRole('cell').textContent).toBe(text);
  });
});
