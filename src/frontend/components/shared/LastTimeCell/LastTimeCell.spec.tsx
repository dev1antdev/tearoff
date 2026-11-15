import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LastTimeCell } from './LastTimeCell';

const cell = (element: React.ReactElement) =>
  render(
    <table>
      <tbody>
        <tr>{element}</tr>
      </tbody>
    </table>
  ).container.querySelector('[data-column="lastTime"]') as HTMLElement;

describe('LastTimeCell', () => {
  it('prints a plain lap time with no mark', () => {
    const td = cell(<LastTimeCell lastTimeString="1:32.456" />);

    expect(td.textContent).toBe('1:32.456');
    expect(td.querySelector('svg')).toBeNull();
    expect(td.dataset.invalid).toBeUndefined();
    expect(td.className).not.toContain('text-white/60');
  });

  it('colours the session’s fastest lap and a personal best', () => {
    expect(
      cell(
        <LastTimeCell lastTimeString="1:31.0" lastTimeState="session-fastest" />
      ).className
    ).toContain('text-purple-400');
    expect(
      cell(
        <LastTimeCell lastTimeString="1:31.5" lastTimeState="personal-best" />
      ).className
    ).toContain('text-green-400');
  });

  it('dims a lap that did not count and marks it', () => {
    const td = cell(<LastTimeCell lastTimeString="1:37.412" invalid />);

    expect(td.textContent).toBe('1:37.412');
    expect(td.dataset.invalid).toBe('true');
    expect(td.className).toContain('text-white/60');
    const icon = td.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('aria-label')).toBe('Did not count');
    expect(icon?.getAttribute('class')).toContain('text-amber-300');
  });

  it.each(['session-fastest', 'personal-best'] as const)(
    'gives a lap that did not count no %s colour, even at the best’s time',
    (state) => {
      const td = cell(
        <LastTimeCell lastTimeString="1:31.0" lastTimeState={state} invalid />
      );

      expect(td.className).not.toContain('text-purple-400');
      expect(td.className).not.toContain('text-green-400');
      expect(td.className).toContain('text-white/60');
      expect(td.querySelector('svg')).not.toBeNull();
    }
  );

  it('marks nothing where there is no time to mark', () => {
    const td = cell(<LastTimeCell lastTimeString="" invalid />);

    expect(td.textContent).toBe('');
    expect(td.querySelector('svg')).toBeNull();
    expect(td.dataset.invalid).toBeUndefined();
  });

  it.each([
    [undefined, 'px-2'],
    ['compact', 'px-1'],
  ])('pads for compact mode %s', (compactMode, padding) => {
    expect(
      cell(<LastTimeCell lastTimeString="1:32.4" compactMode={compactMode} />)
        .className
    ).toContain(padding);
  });
});
