import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useSessionBarSelector,
  useTrackProfileSelector,
} from '@irdashies/context';
import type {
  SessionBarConfig,
  SessionBarSnapshot,
  TrackProfileSnapshot,
} from '@irdashies/types';
import { SessionClockTimeItem } from './SessionClockTimeItem';

vi.mock('@irdashies/context', () => ({
  useSessionBarSelector: vi.fn(),
  useTrackProfileSelector: vi.fn(),
}));

type ClockOptions = SessionBarConfig['sessionClockTime'];

/** The same for the track's profile, which holds its sunrise and sunset. */
const withProfile = (profile: Partial<TrackProfileSnapshot> | undefined) => {
  vi.mocked(useTrackProfileSelector).mockImplementation(((
    selector: (value: TrackProfileSnapshot) => unknown
  ) =>
    profile === undefined
      ? undefined
      : selector(profile as TrackProfileSnapshot)) as never);
};

/** Sunrise 06:00 and sunset 20:00: midday at 13:00, midnight at 01:00. */
const SUN = { sunriseMinutes: 360, sunsetMinutes: 1200 };
const at = (hours: number, minutes = 0, seconds = 0) =>
  hours * 3600 + minutes * 60 + seconds;

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
    vi.mocked(useTrackProfileSelector).mockReset();
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

  describe('the countdown to the next phase of the sun', () => {
    const countdown = { format: '24h', sunPhase: true } as const;

    it('is off unless asked for, and then asks nothing of the track', () => {
      withSnapshot({ sessionTimeOfDay: at(15, 12, 20), timeScale: 1 });
      withProfile(SUN);

      expect(renderItem({ format: '24h' }).container.textContent).toBe('15:12');
      expect(useTrackProfileSelector).not.toHaveBeenCalled();
    });

    it('counts down to sunset in the afternoon, in amber', () => {
      withSnapshot({ sessionTimeOfDay: at(15, 12, 20), timeScale: 1 });
      withProfile(SUN);
      const view = renderItem(countdown);

      expect(view.container.textContent).toBe('15:124:47:40');
      const figure = view.getByTitle('Time to sunset');
      expect(figure.textContent).toBe('4:47:40');
      expect(figure.className).toContain('text-amber-300');
      expect(figure.className).toContain('tabular-nums');
      expect(figure.querySelector('svg')).not.toBeNull();
    });

    it.each([
      [at(4, 30), 'sunrise', '1:30:00', 'text-sky-300'],
      [at(9), 'midday', '4:00:00', 'text-amber-300'],
      [at(15, 12, 20), 'sunset', '4:47:40', 'text-amber-300'],
      [at(23, 30), 'midnight', '1:30:00', 'text-sky-300'],
    ])('at %s s it is %s that is next, in %s', (seconds, phase, text, tone) => {
      withSnapshot({ sessionTimeOfDay: seconds, timeScale: 1 });
      withProfile(SUN);

      const figure = renderItem(countdown).getByTitle(`Time to ${phase}`);
      expect(figure.textContent).toBe(text);
      expect(figure.className).toContain(tone);
    });

    it('is in real time: half as long when the day runs twice as fast', () => {
      withSnapshot({ sessionTimeOfDay: at(15, 12, 20), timeScale: 2 });
      withProfile(SUN);

      expect(renderItem(countdown).container.textContent).toBe(
        '15:12x22:23:50'
      );
    });

    it('is in in-game time when asked, whatever the scale', () => {
      withSnapshot({ sessionTimeOfDay: at(15, 12, 20), timeScale: 2 });
      withProfile(SUN);
      const view = renderItem({ ...countdown, sunPhaseInGameTime: true });

      expect(
        view.getByTitle('Time to sunset, in in-game time').textContent
      ).toBe('4:47:40');
    });

    it('moves with the clock by the second, not by the minute', () => {
      withSnapshot({ sessionTimeOfDay: at(15, 12, 59.9), timeScale: 1 });
      withProfile(SUN);

      expect(
        renderItem(countdown).getByTitle('Time to sunset').textContent
      ).toBe('4:47:01');
    });

    it.each([
      ['no profile at all', undefined],
      ['no times entered', {}],
      ['only a sunrise', { sunriseMinutes: 360 }],
      ['only a sunset', { sunsetMinutes: 1200 }],
    ])('draws nothing with %s: there are no default times', (_, profile) => {
      withSnapshot({ sessionTimeOfDay: at(15, 12, 20), timeScale: 1 });
      withProfile(profile);

      expect(renderItem(countdown).container.textContent).toBe('15:12');
    });

    it('draws nothing in real time until the scale is measured, or while the day stands still', () => {
      withProfile(SUN);

      withSnapshot({ sessionTimeOfDay: at(15, 12, 20) });
      expect(renderItem(countdown).container.textContent).toBe('15:12');

      withSnapshot({ sessionTimeOfDay: at(15, 12, 20), timeScale: 0 });
      expect(renderItem(countdown).container.textContent).toBe('15:12x0');
      // In-game time needs no scale.
      expect(
        renderItem({ ...countdown, sunPhaseInGameTime: true }).container
          .textContent
      ).toBe('15:12x04:47:40');
    });
  });
});
