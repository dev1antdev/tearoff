import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StintPaceCell } from './StintPaceCell';

const cell = (element: React.ReactElement) =>
  render(
    <table>
      <tbody>
        <tr>{element}</tr>
      </tbody>
    </table>
  ).container.querySelector('[data-column="stintPace"]') as HTMLElement;

describe('StintPaceCell', () => {
  it('prints a quicker stint in green, with its sign', () => {
    const td = cell(<StintPaceCell delta={-0.38} />);

    expect(td.textContent).toBe('-0.38');
    expect(td.dataset.tone).toBe('faster');
    expect(td.className).toContain('text-green-400');
  });

  it('prints a slower stint in red, with its sign', () => {
    const td = cell(<StintPaceCell delta={0.42} />);

    expect(td.textContent).toBe('+0.42');
    expect(td.dataset.tone).toBe('slower');
    expect(td.className).toContain('text-red-400');
  });

  it('prints a level stint without colour', () => {
    const td = cell(<StintPaceCell delta={0.001} />);

    expect(td.textContent).toBe('0.00');
    expect(td.className).not.toContain('text-green-400');
    expect(td.className).not.toContain('text-red-400');
  });

  it.each([[null], [undefined]])(
    'prints two dashes, dimmed, for %s',
    (delta) => {
      const td = cell(<StintPaceCell delta={delta} />);

      expect(td.textContent).toBe('--');
      expect(td.dataset.tone).toBe('none');
      expect(td.className).not.toContain('text-green-400');
      expect(td.className).not.toContain('text-red-400');
    }
  );

  it.each([
    [undefined, 'px-2'],
    ['compact', 'px-1'],
  ])('pads for compact mode %s', (compactMode, padding) => {
    expect(
      cell(<StintPaceCell delta={0.1} compactMode={compactMode} />).className
    ).toContain(padding);
  });
});
