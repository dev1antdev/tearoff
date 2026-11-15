import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionBarSelector } from '@irdashies/context';
import type { SessionBarConfig, SessionBarSnapshot } from '@irdashies/types';
import { SessionClockTimeItem } from './SessionClockTimeItem';

vi.mock('@irdashies/context', () => ({
  useSessionBarSelector: vi.fn(),
}));

type ClockOptions = SessionBarConfig['sessionClockTime'];

/** Runs the item's own selector over a snapshot, as the store would. */
const withSnapshot = (snapshot: Partial<SessionBarSnapshot> | undefined) => {
  vi.mocked(useSessionBarSelector).mockImplementation(((
    selector: (value: SessionBarSnapshot) => unknown
  ) =>
    snapshot === undefined
      ? undefined
      : selector(snapshot as SessionBarSnapshot)) as never);
};

const renderItem = (options: Partial<ClockOptions> = {}) =>
  render(
    <SessionClockTimeItem
      settings={
        {
          sessionClockTime: { enabled: true, ...options },
        } as unknown as SessionBarConfig
      }
      standalone={false}
    />
  );

describe('SessionClockTimeItem', () => {
  beforeEach(() => {
    vi.mocked(useSessionBarSelector).mockReset();
  });

  it('writes the clock on the 24-hour and the 12-hour clock', () => {
    withSnapshot({ sessionTimeOfDay: 54_739.8, timeScale: 1 });

    expect(renderItem({ format: '24h' }).container.textContent).toBe('15:12');
    expect(renderItem({ format: '12h' }).container.textContent).toBe('3:12 PM');
  });

  it('follows the system clock format when none is chosen, as before', () => {
    withSnapshot({ sessionTimeOfDay: 54_739.8, timeScale: 1 });
    const expected = new Date(2026, 0, 1, 15, 12).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });

    expect(renderItem().container.textContent).toBe(expected);
  });

  it('adds the scale in amber when the day does not run in real time', () => {
    withSnapshot({ sessionTimeOfDay: 54_739.8, timeScale: 2 });
    const view = renderItem({ format: '24h' });

    expect(view.container.textContent).toBe('15:12x2');
    expect(view.getByText('x2').className).toContain('text-amber-300');
  });

  it('leaves real time unmarked unless always asked for', () => {
    withSnapshot({ sessionTimeOfDay: 54_739.8, timeScale: 1 });

    expect(renderItem({ format: '24h' }).container.textContent).toBe('15:12');
    const always = renderItem({ format: '24h', timeScale: 'always' });
    expect(always.container.textContent).toBe('15:12x1');
    expect(always.getByText('x1').className).toContain('text-white/60');
  });

  it('marks a time of day that stands still as x0', () => {
    withSnapshot({ sessionTimeOfDay: 43_200, timeScale: 0 });

    expect(renderItem({ format: '24h' }).container.textContent).toBe('12:00x0');
  });

  it('never shows the scale when it is switched off', () => {
    withSnapshot({ sessionTimeOfDay: 54_739.8, timeScale: 30 });

    expect(
      renderItem({ format: '24h', timeScale: 'never' }).container.textContent
    ).toBe('15:12');
  });

  it('shows no scale until one has been measured', () => {
    withSnapshot({ sessionTimeOfDay: 54_739.8 });

    expect(
      renderItem({ format: '24h', timeScale: 'always' }).container.textContent
    ).toBe('15:12');
  });

  it('shows an empty value without a reading', () => {
    withSnapshot(undefined);
    expect(renderItem({ format: '24h' }).container.textContent).toBe('');

    withSnapshot({});
    expect(renderItem({ format: '24h' }).container.textContent).toBe('');
  });
});
