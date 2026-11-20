import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useCurrentSessionType,
  useDashboard,
  useDrivingState,
  useLovelyTrackData,
  usePitLaneStore,
  useSessionDrivers,
  useSessionStore,
  useSessionVisibility,
  useTrackLength,
  useTrackStateSelector,
  useTrafficSnapshot,
  useWeekendInfoNumCarClasses,
} from '@irdashies/context';
import {
  EMPTY_TRAFFIC,
  LMU_CLASS_COLOURS,
  getWidgetDefaultConfig,
  type LovelyTrackSection,
  type TrackStateSnapshot,
  type TrafficCar,
  type TrafficConfig,
  type TrafficForecast,
  type TrafficPick,
  type TrafficSnapshot,
} from '@irdashies/types';
import { Traffic } from './Traffic';

vi.mock('@irdashies/context', () => ({
  useCurrentSessionType: vi.fn(),
  useDashboard: vi.fn(),
  useDrivingState: vi.fn(),
  useLovelyTrackData: vi.fn(),
  usePitLaneStore: vi.fn(),
  useSessionDrivers: vi.fn(),
  useSessionStore: vi.fn(),
  useSessionVisibility: vi.fn(),
  useTrackLength: vi.fn(),
  useTrackStateSelector: vi.fn(),
  useTrafficSnapshot: vi.fn(),
  useWeekendInfoNumCarClasses: vi.fn(),
}));

const HIGHLIGHT = 960745;
const PLAYER = 0;
const LMP2 = 1;
const HYPERCAR = 2;
const RIVAL = 3;
const LMP2_SECOND = 4;

const entry = (
  carIdx: number,
  number: string,
  driver: string,
  carClass: string
) => ({
  CarIdx: carIdx,
  CarNumber: number,
  UserName: driver,
  CarClassShortName: carClass,
  CarClassColor: LMU_CLASS_COLOURS[carClass],
});

/** A grid of three classes: only what the widget reads of each entry. */
const drivers = [
  entry(PLAYER, '77', 'Alex Mercer', 'LMGT3'),
  entry(LMP2, '22', 'Jonas Lindqvist', 'LMP2'),
  entry(HYPERCAR, '8', 'Dominik Karl Gessler', 'Hypercar'),
  entry(RIVAL, '54', 'Kenji Watanabe', 'LMGT3'),
  entry(LMP2_SECOND, '31', 'Rafael Monteiro', 'LMP2'),
];

const corner = (
  name: string,
  start: number,
  end: number,
  number?: string
): LovelyTrackSection => ({
  section_id: name.toLowerCase().replace(/\W+/g, '_'),
  name,
  type: 'corner',
  start_pct: start,
  end_pct: end,
  length_pct: end - start,
  corner_number: number,
});

/** Three corners the track data only numbers. */
const sections = [
  corner('Turn 5', 0.4, 0.465, 'T5'),
  corner('Turn 6', 0.52, 0.575, 'T6'),
  corner('Turn 7', 0.661, 0.72, 'T7'),
];

const defaults = getWidgetDefaultConfig('traffic');

const car = (overrides: Partial<TrafficCar> = {}): TrafficCar => ({
  carIdx: LMP2,
  relation: 'lapping',
  distanceM: 230,
  gapS: 4.2,
  measured: true,
  closingS: 0.17,
  lapsAhead: 1,
  ...overrides,
});

const pick = (overrides: Partial<TrafficPick> = {}): TrafficPick => ({
  carIdx: HYPERCAR,
  gapS: 48.2,
  laps: 4.6,
  thisLap: false,
  ...overrides,
});

const forecast = (
  overrides: Partial<TrafficForecast> = {}
): TrafficForecast => ({
  carIdx: LMP2,
  etaS: 18,
  lowS: 14,
  highS: 23,
  steady: true,
  laps: 0.2,
  meetPct: 0.555,
  meetLowPct: 0.51,
  meetHighPct: 0.6,
  ...overrides,
});

const traffic = (
  overrides: Partial<TrafficSnapshot> = {}
): TrafficSnapshot => ({
  ...EMPTY_TRAFFIC,
  lapS: 88,
  sessionNum: 0,
  version: 1,
  ...overrides,
});

interface Scene {
  config?: Partial<TrafficConfig>;
  sessionType?: string;
  sessionVisible?: boolean;
  isDriving?: boolean;
  isWatchingOwnCar?: boolean;
  isWatchingOtherCar?: boolean;
  /** The session clock, the player's place in the lane, and the lane. */
  trackState?: Partial<TrackStateSnapshot>;
  pitExitPct?: number | null;
  corners?: LovelyTrackSection[];
}

const show = (
  snapshot: TrafficSnapshot | undefined,
  {
    config = {},
    sessionType = 'Race',
    sessionVisible = true,
    isDriving = true,
    isWatchingOwnCar = false,
    isWatchingOtherCar = false,
    trackState = {},
    pitExitPct = 0.154,
    corners = sections,
  }: Scene = {}
) => {
  vi.mocked(useDashboard).mockReturnValue({
    currentDashboard: {
      widgets: [{ id: 'traffic', config: { ...defaults, ...config } }],
      generalSettings: { highlightColor: HIGHLIGHT },
    },
  } as unknown as ReturnType<typeof useDashboard>);
  vi.mocked(useTrafficSnapshot).mockReturnValue(snapshot);
  vi.mocked(useDrivingState).mockReturnValue({
    isDriving,
    isWatching: isWatchingOwnCar || isWatchingOtherCar,
    isWatchingOwnCar,
    isWatchingOtherCar,
  });
  vi.mocked(useSessionVisibility).mockReturnValue(sessionVisible);
  vi.mocked(useCurrentSessionType).mockReturnValue(
    sessionType as ReturnType<typeof useCurrentSessionType>
  );
  vi.mocked(useSessionDrivers).mockReturnValue(
    drivers as unknown as ReturnType<typeof useSessionDrivers>
  );
  vi.mocked(useWeekendInfoNumCarClasses).mockReturnValue(3);
  vi.mocked(useTrackLength).mockReturnValue(3590);
  vi.mocked(useLovelyTrackData).mockReturnValue({
    sections: corners,
    info: null,
  });
  const state = {
    sessionTime: 1000,
    onPitRoad: false,
    lapDistPct: 0,
    speed: 0,
    ...trackState,
  } as TrackStateSnapshot;
  vi.mocked(useTrackStateSelector).mockImplementation(((
    selector: (snapshot: TrackStateSnapshot) => unknown
  ) => selector(state)) as typeof useTrackStateSelector);
  vi.mocked(usePitLaneStore).mockImplementation(((
    selector: (store: unknown) => unknown
  ) => selector({ pitEntryPct: 0.87, pitExitPct })) as typeof usePitLaneStore);
  vi.mocked(useSessionStore).mockImplementation(((
    selector: (store: unknown) => unknown
  ) =>
    selector({
      session: { WeekendInfo: { TrackPitSpeedLimit: '60.00 kph' } },
    })) as typeof useSessionStore);
  return render(<Traffic />).container;
};

const all = (container: HTMLElement, id: string) =>
  [...container.querySelectorAll(`[data-testid="${id}"]`)] as HTMLElement[];

const one = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

const text = (container: HTMLElement, id: string) =>
  one(container, id)?.textContent ?? null;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Traffic', () => {
  describe('the mirror', () => {
    it('shows a car behind with its number, driver, gap and closing', () => {
      const container = show(traffic({ behind: [car()] }));
      const row = one(container, 'traffic-row');

      expect(one(container, 'traffic')?.dataset.block).toBe('closing');
      expect(row?.dataset.relation).toBe('lapping');
      expect(text(row as HTMLElement, 'car-number')).toBe('#22');
      expect(row?.textContent).toContain('J. Lindqvist');
      expect(text(container, 'traffic-gap')).toBe('4.2 s');
      // 0.17 s a second on an 88 s lap.
      expect(text(container, 'traffic-per-lap')).toBe('15/lap');
      expect(one(container, 'traffic-closing')?.dataset.level).toBe('fast');
      expect(text(container, 'traffic-laps')).toBe('+1 lap');
    });

    it('draws no arrow until the closing has been measured', () => {
      const container = show(
        traffic({ behind: [car({ closingS: null, gapS: 7.6 })] })
      );
      expect(one(container, 'traffic-closing')).toBeNull();
      expect(one(container, 'traffic-per-lap')).toBeNull();
      expect(text(container, 'traffic-gap')).toBe('7.6 s');
    });

    it('marks a rival for position as one, with no blue and no laps', () => {
      const container = show(
        traffic({
          behind: [
            car({
              carIdx: RIVAL,
              relation: 'position',
              gapS: 0.8,
              closingS: 0.01,
              lapsAhead: 0,
            }),
          ],
        })
      );
      const row = one(container, 'traffic-row');

      expect(row?.dataset.relation).toBe('position');
      expect(text(container, 'traffic-tag')).toBe('Rival');
      expect(one(container, 'traffic-laps')).toBeNull();
      expect(row?.className).not.toContain('ring-sky');
      // Under a second is urgent for traffic, not for a car being raced.
      expect(one(container, 'traffic-gap')?.className).not.toContain('red');
    });

    it('turns the gap of traffic red under a second', () => {
      const container = show(traffic({ behind: [car({ gapS: 0.6 })] }));
      expect(one(container, 'traffic-gap')?.className).toContain(
        'text-red-400'
      );
    });

    it('leaves the rival out when the setting says so', () => {
      const behind = [
        car({ carIdx: RIVAL, relation: 'position', gapS: 1.1, lapsAhead: 0 }),
        car({ gapS: 3.4 }),
      ];
      expect(all(show(traffic({ behind })), 'traffic-row')).toHaveLength(2);

      const without = show(traffic({ behind }), {
        config: { showRival: false },
      });
      const rows = all(without, 'traffic-row');
      expect(rows).toHaveLength(1);
      expect(rows[0].dataset.relation).toBe('lapping');
    });

    it('draws as many rows as asked and counts the traffic left over', () => {
      const behind = [
        car({ carIdx: HYPERCAR, gapS: 1.4 }),
        car({ gapS: 2.9 }),
        car({ carIdx: LMP2_SECOND, gapS: 5.1 }),
      ];
      const three = show(traffic({ behind, moreBehind: 2 }));
      expect(all(three, 'traffic-row')).toHaveLength(3);
      expect(text(three, 'traffic-more')).toBe('+2');

      const two = show(traffic({ behind, moreBehind: 2 }), {
        config: { mirrorRows: 2 },
      });
      expect(all(two, 'traffic-row')).toHaveLength(2);
      expect(text(two, 'traffic-more')).toBe('+3');
    });

    it('writes the class or nothing beside the number when asked', () => {
      const byClass = show(traffic({ behind: [car()] }), {
        config: { label: 'class' },
      });
      expect(one(byClass, 'traffic-row')?.textContent).toContain('LMP2');
      expect(one(byClass, 'traffic-row')?.textContent).not.toContain(
        'Lindqvist'
      );

      const bare = show(traffic({ behind: [car()] }), {
        config: { label: 'number' },
      });
      expect(one(bare, 'traffic-row')?.textContent).not.toContain('LMP2');
    });

    it('says clear with nobody inside the window, and goes when switched off', () => {
      expect(text(show(traffic()), 'traffic-clear')).toBe('Clear behind');
      const off = show(traffic({ behind: [car()] }), {
        config: { showMirror: false },
      });
      expect(one(off, 'traffic-clear')).toBeNull();
      expect(all(off, 'traffic-row')).toHaveLength(0);
    });
  });

  describe('the forecast', () => {
    it('says when the car arrives and at which corner', () => {
      const container = show(
        traffic({ behind: [car()], forecast: forecast() })
      );
      expect(text(container, 'traffic-forecast-time')).toBe('in about 18 s');
      // The track data lists it as T6; a sentence says Turn 6.
      expect(text(container, 'traffic-forecast-place')).toBe(', at Turn 6');
      // The car in the first row needs no naming.
      expect(
        one(container, 'traffic-forecast')?.querySelector(
          '[data-testid="car-number"]'
        )
      ).toBeNull();
    });

    it('numbers the corner when the setting asks for numbers', () => {
      const container = show(
        traffic({ behind: [car()], forecast: forecast() }),
        { config: { cornerLabel: 'number' } }
      );
      expect(text(container, 'traffic-forecast-place')).toBe(', at T6');
    });

    it('names the car when it is not the one in the first row', () => {
      const container = show(
        traffic({
          behind: [
            car({ carIdx: RIVAL, relation: 'position', lapsAhead: 0 }),
            car({ carIdx: LMP2_SECOND }),
          ],
          forecast: forecast({ carIdx: LMP2_SECOND }),
        })
      );
      expect(
        one(container, 'traffic-forecast')?.querySelector(
          '[data-testid="car-number"]'
        )?.textContent
      ).toBe('#31');
    });

    it('gives a range and no place when the forecast is not steady', () => {
      const container = show(
        traffic({
          behind: [car()],
          forecast: forecast({
            etaS: 28,
            lowS: 14,
            highS: 42,
            steady: false,
            meetPct: null,
            meetLowPct: null,
            meetHighPct: null,
          }),
        })
      );
      expect(text(container, 'traffic-forecast-time')).toBe('in 14 to 40 s');
      expect(one(container, 'traffic-forecast-place')).toBeNull();
    });

    it('counts in laps, with no corner, an arrival a lap or more off', () => {
      const container = show(
        traffic({
          behind: [car({ closingS: 0.01 })],
          forecast: forecast({
            etaS: 284,
            lowS: 213,
            highS: 355,
            laps: 3.23,
            meetPct: null,
            meetLowPct: null,
            meetHighPct: null,
          }),
        })
      );
      expect(text(container, 'traffic-forecast-time')).toBe('in about 3 laps');
      expect(one(container, 'traffic-forecast-place')).toBeNull();
    });

    it('says how far round the lap on a track with no corner list', () => {
      const container = show(
        traffic({ behind: [car()], forecast: forecast() }),
        { corners: [] }
      );
      expect(text(container, 'traffic-forecast-place')).toBe(
        ', 56 % round the lap'
      );
    });

    it('is not drawn when switched off, or when there is none', () => {
      expect(
        one(
          show(traffic({ behind: [car()], forecast: forecast() }), {
            config: { showForecast: false },
          }),
          'traffic-forecast'
        )
      ).toBeNull();
      expect(
        one(show(traffic({ behind: [car()] })), 'traffic-forecast')
      ).toBeNull();
    });
  });

  describe('the table of contacts', () => {
    const picks = {
      slowerAhead: pick({ carIdx: RIVAL, gapS: 6.4, laps: 2.34 }),
      leader: pick({ carIdx: HYPERCAR, gapS: 61, laps: 3.1 }),
      fasterBehind: pick({ carIdx: LMP2, gapS: 4.2, laps: 0.2, thisLap: true }),
    };

    it('shows the car, the laps and the gap in each column', () => {
      const tiles = all(show(traffic(picks)), 'traffic-contact');

      expect(tiles).toHaveLength(3);
      expect(tiles[0].textContent).toContain('Catching');
      expect(text(tiles[0], 'car-number')).toBe('#54');
      expect(text(tiles[0], 'traffic-contact-laps')).toBe('2.3 L');
      expect(text(tiles[0], 'traffic-contact-gap')).toBe('6.4 s');
      expect(tiles[1].textContent).toContain('Leader');
      expect(tiles[2].textContent).toContain('Caught by');
    });

    it('marks a meeting inside the lap under way', () => {
      const tiles = all(show(traffic(picks)), 'traffic-contact');
      expect(one(tiles[2], 'traffic-contact-laps')?.className).toContain(
        'text-amber-400'
      );
      expect(one(tiles[2], 'car-number')?.className).toContain('outline-sky');
      expect(one(tiles[1], 'traffic-contact-laps')?.className).not.toContain(
        'amber'
      );

      const plain = all(
        show(traffic(picks), { config: { highlightThisLap: false } }),
        'traffic-contact'
      );
      expect(one(plain[2], 'traffic-contact-laps')?.className).not.toContain(
        'amber'
      );
    });

    it('draws a dash for no car, no laps, and laps beyond the furthest wanted', () => {
      const tiles = all(
        show(
          traffic({
            slowerAhead: pick({ laps: null }),
            leader: pick({ laps: 12 }),
            fasterBehind: null,
          })
        ),
        'traffic-contact'
      );
      expect(text(tiles[0], 'traffic-contact-laps')).toBe('-- L');
      expect(text(tiles[1], 'traffic-contact-laps')).toBe('-- L');
      expect(one(tiles[2], 'traffic-contact-laps')).toBeNull();
      expect(tiles[2].textContent).toContain('--');
    });

    it('draws only the columns switched on', () => {
      const container = show(traffic(picks), {
        config: { showSlowerAhead: false, showFasterBehind: false },
      });
      const tiles = all(container, 'traffic-contact');
      expect(tiles).toHaveLength(1);
      expect(tiles[0].textContent).toContain('Leader');
    });
  });

  describe('the pit exit and the rejoin', () => {
    /** 180 m short of the exit line at the limit: 11 s. */
    const inLane = { onPitRoad: true, lapDistPct: 0.104, speed: 16.7 };
    const arriving = [
      { carIdx: RIVAL, gapS: 4.2, speedMs: 62 },
      { carIdx: LMP2, gapS: 9.6, speedMs: 68 },
      { carIdx: HYPERCAR, gapS: 15.8, speedMs: 71 },
    ];

    it('in the pit lane lists who goes by first and who arrives behind', () => {
      const container = show(traffic({ inPitLane: true, arriving }), {
        trackState: inLane,
      });
      const block = one(container, 'traffic');
      const rows = all(container, 'traffic-rejoin-row');

      expect(block?.dataset.block).toBe('exit');
      expect(block?.dataset.state).toBe('caution');
      // One bright spot: the state's word, and an outline in its colour.
      expect(block?.className).toContain('outline-amber-400');
      expect(one(container, 'traffic-rejoin-state')?.className).toContain(
        'bg-amber-500'
      );
      expect(text(container, 'traffic-to-exit')).toBe('exit line in 11 s');
      expect(rows.map((row) => row.dataset.side)).toEqual([
        'ahead',
        'behind',
        'behind',
      ]);
      expect(rows[0].textContent).toContain('−3.5 s');
      expect(rows[1].textContent).toContain('+1.7 s');
      expect(rows[1].textContent).toContain('J. Lindqvist');
      // The mirror and the table give way to it.
      expect(all(container, 'traffic-row')).toHaveLength(0);
      expect(all(container, 'traffic-contact')).toHaveLength(0);
    });

    it('is red with a car arriving inside the danger gap, green with none', () => {
      const danger = show(
        traffic({
          inPitLane: true,
          arriving: [{ carIdx: HYPERCAR, gapS: 8.8, speedMs: 71 }],
        }),
        { trackState: inLane }
      );
      expect(one(danger, 'traffic')?.dataset.state).toBe('danger');
      expect(one(danger, 'traffic')?.className).toContain('outline-red-500');
      expect(one(danger, 'traffic-rejoin-state')?.className).toContain(
        'bg-red-600'
      );
      expect(text(danger, 'traffic-rejoin-state')).toBe('Wait');

      const clear = show(traffic({ inPitLane: true }), { trackState: inLane });
      expect(one(clear, 'traffic')?.className).not.toContain('outline-');
      expect(one(clear, 'traffic-rejoin-state')?.className).toContain(
        'text-green-300'
      );
      expect(text(clear, 'traffic-rejoin-clear')).toBe('Nobody within 15 s');
    });

    it('says so when the pit exit of the track has not been seen', () => {
      const container = show(traffic({ inPitLane: true, arriving }), {
        trackState: inLane,
        pitExitPct: null,
      });
      expect(container.textContent).toContain('exit not measured yet');
      expect(one(container, 'traffic-to-exit')).toBeNull();
      // The cars behind by how far back they are now.
      expect(all(container, 'traffic-rejoin-row')[0].textContent).toContain(
        '+4.2 s'
      );
    });

    it('stays for the hold after the pit exit, then gives way', () => {
      const snapshot = traffic({
        exitedAt: 996,
        arriving,
        behind: [car()],
      });
      expect(one(show(snapshot), 'traffic')?.dataset.block).toBe('exit');
      // Eleven seconds on, with a hold of ten.
      expect(
        one(show(snapshot, { trackState: { sessionTime: 1007 } }), 'traffic')
          ?.dataset.block
      ).toBe('closing');
    });

    it('shows the car arriving behind when slow on the track', () => {
      const snapshot = traffic({
        slowAt: 999,
        arriving: [
          { carIdx: RIVAL, gapS: 0.7, speedMs: 55 },
          { carIdx: LMP2, gapS: 3.2, speedMs: 68 },
        ],
      });
      const container = show(snapshot);
      expect(one(container, 'traffic')?.dataset.block).toBe('rejoin');
      expect(one(container, 'traffic')?.dataset.state).toBe('danger');
      // One row: the nearest.
      expect(all(container, 'traffic-rejoin-row')).toHaveLength(1);

      expect(
        one(show(snapshot, { config: { showWhenSlow: false } }), 'traffic')
          ?.dataset.block
      ).toBe('closing');
    });

    it('is not drawn at all with the pit exit switched off', () => {
      const container = show(
        traffic({ inPitLane: true, arriving, behind: [car()] }),
        { trackState: inLane, config: { showPitExit: false } }
      );
      expect(one(container, 'traffic')?.dataset.block).toBe('closing');
    });
  });

  describe('when it shows', () => {
    const busy = traffic({ behind: [car()], forecast: forecast() });

    it('is for races, unless the settings say more', () => {
      expect(show(busy, { sessionType: 'Practice' }).innerHTML).toBe('');
      expect(
        one(
          show(busy, {
            sessionType: 'Practice',
            config: { showOutsideRace: true },
          }),
          'traffic'
        )
      ).not.toBeNull();
    });

    it('still warns at the pit exit outside a race', () => {
      const container = show(traffic({ inPitLane: true }), {
        sessionType: 'Practice',
      });
      expect(one(container, 'traffic')?.dataset.block).toBe('exit');
    });

    it('hides in a session it is switched off for', () => {
      expect(show(busy, { sessionVisible: false }).innerHTML).toBe('');
    });

    it('hides off track, unless told to stay', () => {
      expect(show(busy, { isDriving: false }).innerHTML).toBe('');
      expect(
        one(
          show(busy, {
            isDriving: false,
            config: { showOnlyWhenOnTrack: false },
          }),
          'traffic'
        )
      ).not.toBeNull();
    });

    it('shows for the user’s own car while a team-mate drives it', () => {
      expect(
        one(show(busy, { isDriving: false, isWatchingOwnCar: true }), 'traffic')
      ).not.toBeNull();
    });

    it('hides while the camera is on another car, whatever the setting', () => {
      expect(
        show(busy, { isDriving: false, isWatchingOtherCar: true }).innerHTML
      ).toBe('');
      expect(
        show(busy, {
          isDriving: false,
          isWatchingOtherCar: true,
          config: { showOnlyWhenOnTrack: false },
        }).innerHTML
      ).toBe('');
    });

    it('keeps its shape with nothing from the sim yet', () => {
      const container = show(undefined);
      expect(text(container, 'traffic-clear')).toBe('Clear behind');
      expect(all(container, 'traffic-contact')).toHaveLength(3);
    });

    it('follows the background opacity', () => {
      const container = show(busy, {
        config: { background: { opacity: 40 } },
      });
      expect(
        one(container, 'traffic')?.style.getPropertyValue('--bg-opacity')
      ).toBe('40%');
    });
  });
});
