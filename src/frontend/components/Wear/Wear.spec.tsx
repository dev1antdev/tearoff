import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useDashboard,
  useDrivingState,
  useSessionVisibility,
  useWearSnapshot,
} from '@irdashies/context';
import {
  EMPTY_WEAR,
  type WearConfig,
  type WearSnapshot,
  type WearWheelSnapshot,
} from '@irdashies/types';
import { Wear } from './Wear';

vi.mock('@irdashies/context', () => ({
  useDashboard: vi.fn(),
  useDrivingState: vi.fn(),
  // The compound glyph reads the session's tyre list; none is given, so it
  // is drawn in the colour of an unknown compound.
  useDriverTires: vi.fn(),
  useSessionVisibility: vi.fn(),
  useWearSnapshot: vi.fn(),
}));

const wheel = (over: Partial<WearWheelSnapshot> = {}): WearWheelSnapshot => ({
  treadPct: 97.4,
  treadLapPct: 0.25,
  treadProjectedPct: 0.61,
  treadPerLapPct: 0.49,
  treadRateSource: 'tyre',
  treadLapsLeft: 197,
  treadEndOfStintPct: 89.2,
  compound: 1,
  flat: false,
  brakeMm: 36,
  brakeLifePct: 99.9,
  brakeLapMm: 0.0011,
  brakePerLapMm: 0.0018,
  brakeRateSource: 'stint',
  brakeLapsLeft: 999,
  brakeFailed: false,
  ...over,
});

/** LF, RF, LR, RR. */
const wear = (
  wheels: WearWheelSnapshot[] = [wheel(), wheel(), wheel(), wheel()],
  over: Partial<WearSnapshot> = {}
): WearSnapshot => ({
  available: true,
  wheels,
  paceLapTime: 90,
  budgetLapsLeft: 16.6,
  brakeNewMm: [36, 32],
  brakeFailureMm: [30, 30],
  brakeFailureSource: ['class', 'class'],
  brakeStale: false,
  sessionNum: 0,
  version: 1,
  ...over,
});

/** A config as saved: the groups may be partial, as an older build left them. */
type SavedConfig = Partial<Omit<WearConfig, 'tyres' | 'brakes'>> & {
  tyres?: Partial<WearConfig['tyres']>;
  brakes?: Partial<WearConfig['brakes']>;
};

const draw = (snapshot: WearSnapshot = wear(), config: SavedConfig = {}) => {
  vi.mocked(useDashboard).mockReturnValue({
    currentDashboard: {
      widgets: [{ id: 'wear', enabled: true, config }],
    },
  } as unknown as ReturnType<typeof useDashboard>);
  vi.mocked(useWearSnapshot).mockReturnValue(snapshot);
  return render(<Wear />).container;
};

const all = (container: HTMLElement, id: string) => [
  ...container.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`),
];

const texts = (container: HTMLElement, id: string) =>
  all(container, id).map((element) => element.textContent);

describe('Wear', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useDrivingState).mockReturnValue({
      isDriving: true,
      isWatching: false,
      isWatchingOwnCar: false,
      isWatchingOtherCar: false,
    });
    vi.mocked(useSessionVisibility).mockReturnValue(true);
  });

  describe('tyres', () => {
    it('draws the tread on each wheel, front left first, with its forecast', () => {
      const container = draw(
        wear([
          wheel(),
          wheel({ treadPct: 97.1, treadPerLapPct: 0.53, treadLapsLeft: 181 }),
          wheel({ treadPct: 97, treadEndOfStintPct: 88.6 }),
          wheel({ treadPct: 96.9 }),
        ])
      );

      expect(texts(container, 'wear-tread')).toEqual([
        '97.4%',
        '97.1%',
        '97.0%',
        '96.9%',
      ]);
      expect(texts(container, 'wear-tread-forecast').slice(0, 2)).toEqual([
        '0.49/lap197 laps',
        '0.53/lap181 laps',
      ]);
      expect(texts(container, 'wear-tread-end')[2]).toBe('END88.6');
    });

    it('colours the tread amber at the warning and red at half of it', () => {
      const container = draw(
        wear([
          wheel({ treadPct: 30.1 }),
          wheel({ treadPct: 30 }),
          wheel({ treadPct: 15 }),
          wheel({ treadPct: 62 }),
        ])
      );
      const tones = all(container, 'wear-tread').map(
        (figure) =>
          ['text-amber-400', 'text-red-400', 'text-white'].find((tone) =>
            figure.className.includes(tone)
          ) ?? ''
      );

      expect(tones).toEqual([
        'text-white',
        'text-amber-400',
        'text-red-400',
        'text-white',
      ]);
    });

    it('turns few laps red and a high wear per lap amber', () => {
      const container = draw(
        wear([
          wheel({ treadLapsLeft: 5, treadPerLapPct: 3.2 }),
          wheel({ treadLapsLeft: 6, treadPerLapPct: 3 }),
          wheel(),
          wheel(),
        ])
      );
      const [few, enough] = all(container, 'wear-tread-forecast');

      expect(few.querySelector('.text-red-400')?.textContent).toBe('5 laps');
      expect(few.querySelector('.text-amber-400')?.textContent).toBe(
        '3.20/lap'
      );
      expect(enough.querySelector('.text-red-400')).toBeNull();
      expect(enough.querySelector('.text-amber-400')).toBeNull();
    });

    it('draws a forecast that rests on no lap of the tyre as an estimate', () => {
      const container = draw(
        wear([
          wheel(),
          wheel({ treadRateSource: 'session' }),
          wheel({ treadRateSource: 'baseline' }),
          wheel({ treadRateSource: 'projected' }),
        ])
      );
      const italic = all(container, 'wear-tread-forecast').map((line) =>
        line.className.includes('italic')
      );

      expect(italic).toEqual([false, true, true, true]);
      expect(
        all(container, 'wear-tread-end').map((line) =>
          line.className.includes('italic')
        )
      ).toEqual([false, true, true, true]);
    });

    it('keeps the wear per lap as a placeholder until there is a rate', () => {
      const container = draw(
        wear([
          wheel({
            treadPerLapPct: null,
            treadProjectedPct: null,
            treadRateSource: null,
            treadLapsLeft: null,
            treadEndOfStintPct: null,
          }),
          wheel(),
          wheel(),
          wheel(),
        ])
      );

      expect(texts(container, 'wear-tread-forecast')[0]).toBe('--/lap');
      // Three wheels have an end of stint; the one without a rate has none.
      expect(all(container, 'wear-tread-end')).toHaveLength(3);
    });

    it('writes what the lap under way is heading for when asked to', () => {
      const container = draw(wear(), { tyres: { perLapSource: 'thisLap' } });

      // The laps left are still the forecast's.
      expect(texts(container, 'wear-tread-forecast')[0]).toBe(
        '0.61/lap197 laps'
      );
    });

    it('adds the minutes those laps take at the pace', () => {
      const container = draw(
        wear([wheel({ treadLapsLeft: 124 }), wheel(), wheel(), wheel()]),
        { tyres: { showMinutesLeft: true } }
      );

      expect(texts(container, 'wear-tread-forecast')[0]).toBe(
        '0.49/lap124 laps186 min'
      );
    });

    it('writes 999+ at the cap, and no minutes for it', () => {
      const container = draw(
        wear([wheel({ treadLapsLeft: 999 }), wheel(), wheel(), wheel()]),
        { tyres: { showMinutesLeft: true } }
      );

      expect(texts(container, 'wear-tread-forecast')[0]).toBe('0.49/lap999+');
    });

    it('leaves out each line that is switched off', () => {
      const container = draw(wear(), {
        tyres: {
          showPerLap: false,
          showLapsLeft: false,
          showEndOfStint: false,
        },
      });

      expect(all(container, 'wear-tread-forecast')).toHaveLength(0);
      expect(all(container, 'wear-tread-end')).toHaveLength(0);
      expect(texts(container, 'wear-tread')[0]).toBe('97.4%');
    });

    it('marks a flat tyre in place of its figure, with no forecast', () => {
      const container = draw(
        wear([wheel(), wheel({ flat: true, treadPct: 96.2 }), wheel(), wheel()])
      );
      const [, flat] = all(container, 'wear-tread');

      expect(flat.textContent).toBe('FLAT');
      expect(flat.className).toContain('text-red-400');
      expect(texts(container, 'wear-tread-forecast')[1]).toBe('96.2%');
      expect(all(container, 'wear-tread-end')).toHaveLength(3);
    });
  });

  describe('brakes', () => {
    it('draws the thickness on each wheel, with the life and wear under it', () => {
      const container = draw(
        wear([
          wheel(),
          wheel({ brakeMm: 35.99, brakePerLapMm: 0.0026 }),
          wheel({ brakeMm: 32 }),
          wheel({ brakeMm: 32 }),
        ])
      );

      expect(texts(container, 'wear-brake')).toEqual([
        '36.00mm',
        '35.99mm',
        '32.00mm',
        '32.00mm',
      ]);
      // Laps left at the cap are left out: a GT car's discs are always there.
      expect(texts(container, 'wear-brake-forecast').slice(0, 2)).toEqual([
        '99.9%0.002/lap',
        '99.9%0.003/lap',
      ]);
    });

    it('adds the laps left once they are below the cap, red when few', () => {
      const container = draw(
        wear([
          wheel({ brakeMm: 27.82, brakeLifePct: 23.5, brakeLapsLeft: 68 }),
          wheel({ brakeMm: 25.08, brakeLifePct: 1.1, brakeLapsLeft: 3 }),
          wheel(),
          wheel(),
        ])
      );
      const [some, few] = all(container, 'wear-brake-forecast');

      expect(some.textContent).toBe('23.5%0.002/lap68 laps');
      expect(some.querySelector('.text-red-400')).toBeNull();
      expect(few.querySelector('.text-red-400')?.textContent).toBe('3 laps');
    });

    it('colours the figure by the life left', () => {
      const container = draw(
        wear([
          wheel({ brakeLifePct: 30.1 }),
          wheel({ brakeLifePct: 30 }),
          wheel({ brakeLifePct: 15 }),
          wheel({ brakeLifePct: null }),
        ])
      );
      const tones = all(container, 'wear-brake').map(
        (figure) =>
          ['text-amber-400', 'text-red-400', 'text-white'].find((tone) =>
            figure.className.includes(tone)
          ) ?? ''
      );

      expect(tones).toEqual([
        'text-white',
        'text-amber-400',
        'text-red-400',
        // No failure thickness: nothing to colour by.
        'text-white',
      ]);
    });

    it('makes life the large figure when asked, with the thickness under it', () => {
      const container = draw(wear(), { brakes: { primary: 'life' } });

      expect(texts(container, 'wear-brake')[0]).toBe('99.9%');
      expect(texts(container, 'wear-brake-forecast')[0]).toBe(
        '36.00 mm0.002/lap'
      );
    });

    it('shows thickness and wear alone where no failure thickness is known', () => {
      const container = draw(
        wear(
          [0, 1, 2, 3].map(() =>
            wheel({ brakeLifePct: null, brakeLapsLeft: null })
          )
        ),
        { brakes: { primary: 'life' } }
      );

      // Life cannot be the large figure without a failure thickness.
      expect(texts(container, 'wear-brake')[0]).toBe('36.00mm');
      expect(texts(container, 'wear-brake-forecast')[0]).toBe('0.002/lap');
    });

    it('writes FAIL for a failed brake, with what it stopped at', () => {
      const container = draw(
        wear([
          wheel(),
          wheel({
            brakeMm: 24.98,
            brakeLifePct: 0,
            brakeLapsLeft: 0,
            brakeFailed: true,
          }),
          wheel(),
          wheel(),
        ])
      );
      const [, failed] = all(container, 'wear-brake');

      expect(failed.textContent).toBe('FAIL');
      expect(failed.className).toContain('text-red-400');
      expect(texts(container, 'wear-brake-forecast')[1]).toBe('24.98 mm');
    });

    it('draws a rate from earlier sessions as an estimate', () => {
      const container = draw(
        wear([
          wheel({ brakeRateSource: 'baseline' }),
          wheel(),
          wheel(),
          wheel(),
        ])
      );
      const [estimate, measured] = all(container, 'wear-brake-forecast');

      expect(estimate.querySelector('.italic')?.textContent).toBe('0.002/lap');
      expect(measured.querySelector('.italic')).toBeNull();
    });

    it('shows dashes and says why when the REST API has stopped answering', () => {
      const none = {
        brakeMm: null,
        brakeLifePct: null,
        brakeLapMm: null,
        brakePerLapMm: null,
        brakeRateSource: null,
        brakeLapsLeft: null,
      };
      const container = draw(
        wear(
          [0, 1, 2, 3].map(() => wheel(none)),
          { brakeStale: true }
        )
      );

      expect(texts(container, 'wear-brake')).toEqual(['--', '--', '--', '--']);
      expect(all(container, 'wear-brake-forecast')).toHaveLength(0);
      expect(texts(container, 'wear-brakes-stale')).toEqual([
        'No answer from the sim',
      ]);
      // The tyres do not come over REST, and carry on.
      expect(texts(container, 'wear-tread')[0]).toBe('97.4%');
    });

    it('shows dashes and no note where the sim never gave a thickness', () => {
      const container = draw(
        wear(
          [0, 1, 2, 3].map(() => wheel({ brakeMm: null, brakeLifePct: null }))
        )
      );

      expect(texts(container, 'wear-brake')).toEqual(['--', '--', '--', '--']);
      expect(all(container, 'wear-brakes-stale')).toHaveLength(0);
    });
  });

  describe('sections', () => {
    it('draws both by default, and each alone when the other is off', () => {
      const both = draw();
      expect(all(both, 'wear-tyres')).toHaveLength(1);
      expect(all(both, 'wear-brakes')).toHaveLength(1);

      const tyres = draw(wear(), { brakes: { show: false } });
      expect(all(tyres, 'wear-tyres')).toHaveLength(1);
      expect(all(tyres, 'wear-brakes')).toHaveLength(0);

      const brakes = draw(wear(), { tyres: { show: false } });
      expect(all(brakes, 'wear-tyres')).toHaveLength(0);
      expect(all(brakes, 'wear-brakes')).toHaveLength(1);
    });
  });

  describe('out of the car', () => {
    it('keeps its shape with placeholders when shown off track', () => {
      const container = draw(EMPTY_WEAR, { showOnlyWhenOnTrack: false });

      expect(texts(container, 'wear-tread')).toEqual(['--', '--', '--', '--']);
      expect(texts(container, 'wear-brake')).toEqual(['--', '--', '--', '--']);
      expect(all(container, 'wear-tread-forecast')).toHaveLength(0);
      expect(container.querySelector('.text-red-400')).toBeNull();
    });

    it('does the same before a snapshot has arrived', () => {
      vi.mocked(useDashboard).mockReturnValue({
        currentDashboard: { widgets: [{ id: 'wear', enabled: true }] },
      } as unknown as ReturnType<typeof useDashboard>);
      vi.mocked(useWearSnapshot).mockReturnValue(undefined);

      const { container } = render(<Wear />);

      expect(texts(container, 'wear-tread')).toEqual(['--', '--', '--', '--']);
    });

    it('hides while the user is not driving, and reads nothing', () => {
      vi.mocked(useDrivingState).mockReturnValue({
        isDriving: false,
        isWatching: false,
        isWatchingOwnCar: false,
        isWatchingOtherCar: false,
      });

      const container = draw();

      expect(container.innerHTML).toBe('');
      expect(useWearSnapshot).toHaveBeenLastCalledWith(false);
    });

    it('hides while a team-mate drives the car, whatever is kept up while watching', () => {
      vi.mocked(useDrivingState).mockReturnValue({
        isDriving: false,
        isWatching: true,
        isWatchingOwnCar: true,
        isWatchingOtherCar: false,
      });

      const container = draw();

      // The wear of a car somebody else is driving is not shown as the
      // user's own.
      expect(container.innerHTML).toBe('');
      expect(useWearSnapshot).toHaveBeenLastCalledWith(false);
    });

    it('hides in a session it is switched off for', () => {
      vi.mocked(useSessionVisibility).mockReturnValue(false);

      expect(draw().innerHTML).toBe('');
    });

    it('subscribes while it is drawn', () => {
      draw();

      expect(useWearSnapshot).toHaveBeenLastCalledWith(true);
    });
  });
});
