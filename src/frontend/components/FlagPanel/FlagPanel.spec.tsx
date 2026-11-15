import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  trackStateSelectors,
  useActiveSimulator,
  useCurrentSessionType,
  useDashboard,
  useDrivingState,
  useFlagStateSnapshot,
  useSessionDrivers,
  useSessionVisibility,
  useTrackStateSelector,
  useWeekendInfoNumCarClasses,
} from '@irdashies/context';
import {
  EMPTY_FLAG_STATE,
  FLAG_ACTIVE_BLUE,
  FLAG_ACTIVE_BLUE_TRAFFIC,
  FLAG_ACTIVE_FULL_COURSE_YELLOW,
  FLAG_ACTIVE_GREEN,
  FLAG_ACTIVE_PENALTY,
  FLAG_ACTIVE_START,
  FLAG_ACTIVE_YELLOW,
  FLAG_ACTIVE_YELLOW_NEAR,
  LMU_CLASS_COLOURS,
  LMU_PENALTY_CODE,
  getWidgetDefaultConfig,
  type FlagBlueCar,
  type FlagPanelConfig,
  type FlagStateSnapshot,
} from '@irdashies/types';
import { FlagPanel } from './FlagPanel';

vi.mock('@irdashies/context', () => ({
  trackStateSelectors: { displayUnits: 'displayUnits' },
  useActiveSimulator: vi.fn(),
  useCurrentSessionType: vi.fn(),
  useDashboard: vi.fn(),
  useDrivingState: vi.fn(),
  useFlagStateSnapshot: vi.fn(),
  useSessionDrivers: vi.fn(),
  useSessionVisibility: vi.fn(),
  useTrackStateSelector: vi.fn(),
  useWeekendInfoNumCarClasses: vi.fn(),
}));

const HIGHLIGHT = 960745;
const PLAYER = 0;
const HYPERCAR = 1;
const LMP2 = 2;
const NO_TEAM = 3;

/** A grid of three classes: only what the panel reads of each entry. */
const drivers = [
  {
    CarIdx: PLAYER,
    CarNumber: '77',
    UserName: 'Alex Mercer',
    TeamName: 'Iron Coast Racing',
    CarClassShortName: 'LMGT3',
    CarClassColor: LMU_CLASS_COLOURS.LMGT3,
  },
  {
    CarIdx: HYPERCAR,
    CarNumber: '8',
    UserName: 'Dominik Karl Gessler',
    TeamName: 'Northstar Motorsport',
    CarClassShortName: 'Hypercar',
    CarClassColor: LMU_CLASS_COLOURS.Hypercar,
  },
  {
    CarIdx: LMP2,
    CarNumber: '22',
    UserName: 'Jonas Lindqvist',
    TeamName: 'United Nordic',
    CarClassShortName: 'LMP2',
    CarClassColor: LMU_CLASS_COLOURS.LMP2,
  },
  {
    CarIdx: NO_TEAM,
    CarNumber: '777',
    UserName: 'Kenji Watanabe',
    TeamName: '',
    CarClassShortName: 'LMGT3',
    CarClassColor: LMU_CLASS_COLOURS.LMGT3,
  },
];

const defaults = getWidgetDefaultConfig('flagpanel');

const state = (overrides: Partial<FlagStateSnapshot>): FlagStateSnapshot => ({
  ...EMPTY_FLAG_STATE,
  sessionNum: 0,
  version: 1,
  ...overrides,
});

const blueCar = (overrides: Partial<FlagBlueCar> = {}): FlagBlueCar => ({
  carIdx: HYPERCAR,
  distanceM: 15,
  gapS: 0.3,
  closingMs: 0.5,
  lapsAhead: 1,
  fasterClass: true,
  confirmed: true,
  othersCount: 0,
  ...overrides,
});

const green = state({
  kind: 'green',
  detail: 'trackClear',
  active: FLAG_ACTIVE_GREEN,
});

const blue = (car: Partial<FlagBlueCar> | null = {}) =>
  state({
    kind: 'blue',
    detail: 'blueLapping',
    active: FLAG_ACTIVE_BLUE | FLAG_ACTIVE_GREEN,
    blue: car === null ? null : blueCar(car),
  });

const yellowElsewhere = state({
  kind: 'yellow',
  detail: 'yellowElsewhere',
  active: FLAG_ACTIVE_YELLOW | FLAG_ACTIVE_GREEN,
  yellowSectors: [false, false, true],
});

interface Scene {
  config?: Partial<FlagPanelConfig>;
  displayUnits?: number;
  sessionType?: string;
  isDriving?: boolean;
  sessionVisible?: boolean;
  simulator?: 'iracing' | 'lmu' | null;
  classes?: number;
}

const show = (
  snapshot: FlagStateSnapshot | undefined,
  {
    config = {},
    displayUnits,
    sessionType = 'Race',
    isDriving = true,
    sessionVisible = true,
    simulator = 'lmu',
    classes = 3,
  }: Scene = {}
) => {
  vi.mocked(useDashboard).mockReturnValue({
    currentDashboard: {
      widgets: [{ id: 'flagpanel', config: { ...defaults, ...config } }],
      generalSettings: { highlightColor: HIGHLIGHT },
    },
  } as unknown as ReturnType<typeof useDashboard>);
  vi.mocked(useFlagStateSnapshot).mockReturnValue(snapshot);
  vi.mocked(useDrivingState).mockReturnValue({ isDriving });
  vi.mocked(useSessionVisibility).mockReturnValue(sessionVisible);
  vi.mocked(useTrackStateSelector).mockImplementation(((selector: unknown) =>
    selector === trackStateSelectors.displayUnits
      ? displayUnits
      : undefined) as typeof useTrackStateSelector);
  vi.mocked(useCurrentSessionType).mockReturnValue(
    sessionType as ReturnType<typeof useCurrentSessionType>
  );
  vi.mocked(useSessionDrivers).mockReturnValue(
    drivers as unknown as ReturnType<typeof useSessionDrivers>
  );
  vi.mocked(useWeekendInfoNumCarClasses).mockReturnValue(classes);
  vi.mocked(useActiveSimulator).mockReturnValue(simulator);
  return render(<FlagPanel />).container;
};

const byTestId = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

const text = (container: HTMLElement, id: string) =>
  byTestId(container, id)?.textContent ?? null;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FlagPanel', () => {
  describe('under a blue with a car to name', () => {
    it('shows the car number on the block, without a hash', () => {
      const container = show(blue());

      expect(text(container, 'flag-title')).toBe('BLUE FLAG');
      expect(text(container, 'flag-plate')).toBe('8');
      expect(byTestId(container, 'flag-block')?.dataset.flag).toBe('blue');
      expect(container.textContent).not.toContain('#');
    });

    it('sizes a longer number down to fit the block', () => {
      const short = byTestId(show(blue()), 'flag-plate');
      const long = byTestId(show(blue({ carIdx: NO_TEAM })), 'flag-plate');

      expect(long?.textContent).toBe('777');
      expect(long?.className).not.toBe(short?.className);
    });

    it('names the driver in the chosen format', () => {
      expect(text(show(blue()), 'flag-name')).toBe('Dominik Karl Gessler');
      expect(
        text(
          show(blue(), { config: { driverNameFormat: 'n.-surname' } }),
          'flag-name'
        )
      ).toBe('D. Gessler');
      expect(
        text(
          show(blue(), { config: { driverNameFormat: 'name-surname' } }),
          'flag-name'
        )
      ).toBe('Dominik Gessler');
    });

    it('names the team when asked to', () => {
      const container = show(blue(), { config: { blueName: 'team' } });

      expect(text(container, 'flag-name')).toBe('Northstar Motorsport');
    });

    it('names the driver again when the entry has no team name', () => {
      const container = show(blue({ carIdx: NO_TEAM }), {
        config: { blueName: 'team' },
      });

      expect(text(container, 'flag-name')).toBe('Kenji Watanabe');
    });

    it('shows the name in place of the explanation, even with that line off', () => {
      const container = show(blue(), { config: { showExplanation: false } });

      expect(text(container, 'flag-name')).toBe('Dominik Karl Gessler');
      expect(byTestId(container, 'flag-explanation')).toBeNull();
    });

    it('greys the name of a car that is only the nearest behind', () => {
      const confirmed = byTestId(show(blue()), 'flag-name');
      const nearest = byTestId(
        show(blue({ confirmed: false, lapsAhead: 0 })),
        'flag-name'
      );

      expect(confirmed?.className).toContain('text-slate-200');
      expect(nearest?.className).toContain('text-slate-400');
    });

    it('draws the class as the standings do, in the class colour', () => {
      const label = byTestId(show(blue()), 'class-label');

      expect(label?.textContent).toBe('Hypercar');
      expect(label?.className).toContain('bg-[#ff000a] border-[#ff000a]');
      expect(label?.className).toContain('border-l-4');
    });

    it('uses the highlight colour in a single-class session', () => {
      const label = byTestId(show(blue(), { classes: 1 }), 'class-label');

      expect(label?.textContent).toBe('Hypercar');
      expect(label?.className).not.toContain('#ff000a');
    });

    it('counts the cars queued behind it in a pill before the class', () => {
      const queued = show(blue({ carIdx: LMP2, othersCount: 2 }));
      const pair = byTestId(queued, 'flag-pair');

      expect(text(queued, 'flag-queue')).toBe('+2');
      expect(pair?.textContent?.startsWith('+2LMP2')).toBe(true);
      expect(byTestId(show(blue()), 'flag-queue')).toBeNull();
    });

    it('turns the distance red under 50 m and marks a closing car', () => {
      const near = show(blue({ distanceM: 15, closingMs: 3.5 }));
      const far = show(blue({ distanceM: 120, closingMs: 0.5 }));

      expect(byTestId(near, 'flag-distance')?.className).toContain(
        'text-red-300'
      );
      expect(byTestId(near, 'flag-closing')).not.toBeNull();
      expect(byTestId(far, 'flag-distance')?.className).not.toContain(
        'text-red-300'
      );
      expect(byTestId(far, 'flag-closing')).toBeNull();
    });
  });

  describe('the distance unit', () => {
    it('prints metres when set to metres', () => {
      const container = show(blue(), {
        config: { distanceUnit: 'm' },
        displayUnits: 0,
      });

      expect(text(container, 'flag-distance')).toBe('15 m');
    });

    it('prints feet when set to feet', () => {
      const container = show(blue(), {
        config: { distanceUnit: 'ft' },
        displayUnits: 1,
      });

      expect(text(container, 'flag-distance')).toBe('49 ft');
    });

    it('follows the sim on auto, and reads metres without a reading', () => {
      expect(text(show(blue(), { displayUnits: 0 }), 'flag-distance')).toBe(
        '49 ft'
      );
      expect(text(show(blue(), { displayUnits: 1 }), 'flag-distance')).toBe(
        '15 m'
      );
      expect(text(show(blue()), 'flag-distance')).toBe('15 m');
    });
  });

  describe('with no blue out', () => {
    it('names the flag and explains it', () => {
      const container = show(green);

      expect(text(container, 'flag-title')).toBe('GREEN FLAG');
      expect(text(container, 'flag-explanation')).toBe('Track clear');
      expect(byTestId(container, 'flag-block')?.dataset.flag).toBe('green');
      expect(byTestId(container, 'flag-plate')).toBeNull();
      expect(byTestId(container, 'flag-name')).toBeNull();
    });

    it('reads dashes twice on the right', () => {
      const pair = byTestId(show(green), 'flag-pair');

      expect(pair?.textContent).toBe('----');
      expect(byTestId(show(green), 'class-label')).toBeNull();
    });

    it('draws no pair at all when it is set to hidden', () => {
      const container = show(green, { config: { bluePair: 'hidden' } });

      expect(byTestId(container, 'flag-pair')).toBeNull();
      expect(text(container, 'flag-title')).toBe('GREEN FLAG');
    });

    it('leaves the explanation out when that line is off', () => {
      const container = show(green, { config: { showExplanation: false } });

      expect(byTestId(container, 'flag-explanation')).toBeNull();
    });
  });

  describe('under a blue with no car to name', () => {
    it('explains the flag in place of a name, with dashes and no number', () => {
      const container = show(blue(null));

      expect(text(container, 'flag-title')).toBe('BLUE FLAG');
      expect(text(container, 'flag-explanation')).toBe(
        'Faster car behind, let it by'
      );
      expect(byTestId(container, 'flag-name')).toBeNull();
      expect(byTestId(container, 'flag-plate')).toBeNull();
      expect(byTestId(container, 'flag-pair')?.textContent).toBe('----');
    });

    it('keeps that explanation with the explanation line off', () => {
      const container = show(blue(null), {
        config: { showExplanation: false },
      });

      expect(text(container, 'flag-explanation')).toBe(
        'Faster car behind, let it by'
      );
    });

    it('does the same for a car the session does not list', () => {
      const container = show(blue({ carIdx: 42 }));

      expect(byTestId(container, 'flag-plate')).toBeNull();
      expect(byTestId(container, 'flag-pair')?.textContent).toBe('----');
    });
  });

  describe('the card tint', () => {
    const tintOf = (
      snapshot: FlagStateSnapshot,
      tintCard: FlagPanelConfig['tintCard'],
      opacity = 80
    ) => {
      const container = show(snapshot, {
        config: { tintCard, background: { opacity } },
      });
      return {
        layer: byTestId(container, 'flag-tint'),
        panel: byTestId(container, 'flag-panel') as HTMLElement,
      };
    };

    it('is never drawn with the tint off', () => {
      expect(tintOf(blue(), 'off').layer).toBeNull();
      expect(tintOf(green, 'off').layer).toBeNull();
      expect(tintOf(yellowElsewhere, 'off').layer).toBeNull();
    });

    it('is drawn for a blue, and not for the calm states, when active', () => {
      const tint = tintOf(blue(), 'active').layer;

      expect(tint?.className).toContain('bg-blue-900/(--tint-opacity)');
      expect(tint?.className).toContain('ring-blue-400/40');
      expect(tintOf(green, 'active').layer).toBeNull();
      expect(tintOf(yellowElsewhere, 'active').layer).toBeNull();
    });

    it('is drawn for the calm states too when always', () => {
      expect(tintOf(blue(), 'always').layer).not.toBeNull();
      expect(tintOf(green, 'always').layer?.className).toContain(
        'bg-green-900/(--tint-opacity)'
      );
      expect(tintOf(yellowElsewhere, 'always').layer?.className).toContain(
        'bg-yellow-700/(--tint-opacity)'
      );
    });

    it('follows the background opacity', () => {
      const opaque = tintOf(blue(), 'active', 100).panel;
      const default80 = tintOf(blue(), 'active', 80).panel;
      const seeThrough = tintOf(blue(), 'active', 30).panel;
      const tintOpacity = (panel: HTMLElement) =>
        Number.parseFloat(panel.style.getPropertyValue('--tint-opacity'));

      // A blue tints at 70 % of whatever the card's own opacity is.
      expect(tintOpacity(opaque)).toBeCloseTo(70);
      expect(tintOpacity(default80)).toBeCloseTo(56);
      expect(tintOpacity(seeThrough)).toBeCloseTo(21);
      expect(seeThrough.style.getPropertyValue('--bg-opacity')).toBe('30%');
    });

    it('never tints the start', () => {
      const start = state({
        kind: 'start',
        detail: 'formationLap',
        active: FLAG_ACTIVE_START,
      });

      expect(tintOf(start, 'always').layer).toBeNull();
    });
  });

  describe('a local yellow with a distance', () => {
    const yellowAhead = state({
      kind: 'yellow',
      detail: 'yellowAhead',
      active: FLAG_ACTIVE_YELLOW | FLAG_ACTIVE_YELLOW_NEAR | FLAG_ACTIVE_GREEN,
      incidentDistM: 320,
      incidentCarIdx: LMP2,
    });

    it('reuses the pair for the metres to the incident', () => {
      const container = show(yellowAhead);

      expect(text(container, 'flag-title')).toBe('YELLOW FLAG');
      expect(text(container, 'flag-explanation')).toBe('Incident 320 m ahead');
      expect(byTestId(container, 'flag-pair')?.textContent).toBe(
        'INCIDENT320 m'
      );
    });

    it('prints the distance behind without its sign', () => {
      const container = show({
        ...yellowAhead,
        detail: 'yellowBehind',
        incidentDistM: -30,
      });

      expect(text(container, 'flag-distance')).toBe('30 m');
      expect(text(container, 'flag-explanation')).toBe('Incident behind');
    });

    it('pulses the block while the incident is within 200 m', () => {
      const far = byTestId(show(yellowAhead), 'flag-block');
      const near = byTestId(
        show({ ...yellowAhead, incidentDistM: 120 }),
        'flag-block'
      );
      const still = byTestId(
        show(
          { ...yellowAhead, incidentDistM: 120 },
          {
            config: { animate: false },
          }
        ),
        'flag-block'
      );

      expect(far?.className).not.toContain('animate-pulse');
      expect(near?.className).toContain('animate-pulse');
      expect(still?.className).not.toContain('animate-pulse');
    });
  });

  describe('the other states', () => {
    it('adds a pit closed chip after the explanation', () => {
      const container = show(
        state({
          kind: 'fullCourseYellow',
          detail: 'fcyPitLeadLap',
          active: FLAG_ACTIVE_FULL_COURSE_YELLOW,
          pitLaneClosed: true,
        })
      );

      expect(text(container, 'flag-explanation')).toBe(
        'Pit lane open for lead-lap cars'
      );
      expect(text(container, 'flag-pit-closed')).toBe('Pit closed');
    });

    it('does not repeat an explanation that already says pit lane closed', () => {
      const container = show(
        state({
          kind: 'start',
          detail: 'beforeSession',
          active: FLAG_ACTIVE_START,
          pitLaneClosed: true,
        })
      );

      expect(text(container, 'flag-explanation')).toBe('Pit lane closed');
      expect(byTestId(container, 'flag-pit-closed')).toBeNull();
    });

    it('calls a full-course yellow a caution under iRacing', () => {
      const fullCourse = state({
        kind: 'fullCourseYellow',
        detail: 'fcy',
        active: FLAG_ACTIVE_FULL_COURSE_YELLOW,
      });

      expect(text(show(fullCourse), 'flag-title')).toBe('FULL COURSE YELLOW');
      expect(
        text(show(fullCourse, { simulator: 'iracing' }), 'flag-title')
      ).toBe('CAUTION');
    });

    it('lights the red lights of the start sequence', () => {
      const container = show(
        state({
          kind: 'start',
          detail: 'lights',
          active: FLAG_ACTIVE_START,
          startLights: { lit: 3, total: 5 },
        })
      );
      const lights = byTestId(container, 'flag-lights')?.children ?? [];

      expect(text(container, 'flag-explanation')).toBe('3 of 5 lights');
      expect(lights).toHaveLength(5);
      expect(
        Array.from(lights, (light) => (light as HTMLElement).dataset.lit)
      ).toEqual(['true', 'true', 'true', 'false', 'false']);
    });

    it('writes the penalty the sim has named on the block', () => {
      const container = show(
        state({
          kind: 'penalty',
          detail: 'timePenalty',
          active: FLAG_ACTIVE_PENALTY | FLAG_ACTIVE_GREEN,
          penalty: { count: 1, kind: LMU_PENALTY_CODE.time, seconds: 10 },
        })
      );

      expect(text(container, 'flag-title')).toBe('TIME PENALTY');
      expect(byTestId(container, 'flag-block')?.textContent).toBe('+10');
      expect(text(container, 'flag-explanation')).toBe(
        '+10 s at your next stop'
      );
    });
  });

  describe('what the settings leave out', () => {
    const penaltyUnderGreen = state({
      kind: 'penalty',
      detail: 'driveThrough',
      active: FLAG_ACTIVE_PENALTY | FLAG_ACTIVE_GREEN,
      penalty: { count: 1, kind: LMU_PENALTY_CODE.driveThrough, seconds: null },
    });

    it('shows the flag that ranks next when a kind is switched off', () => {
      expect(text(show(penaltyUnderGreen), 'flag-title')).toBe('DRIVE-THROUGH');
      expect(
        text(
          show(penaltyUnderGreen, { config: { showPenalty: false } }),
          'flag-title'
        )
      ).toBe('GREEN FLAG');
    });

    it('leaves a race-only blue out of practice', () => {
      const practiceBlue = state({
        kind: 'blue',
        detail: 'blueTraffic',
        active: FLAG_ACTIVE_BLUE | FLAG_ACTIVE_BLUE_TRAFFIC | FLAG_ACTIVE_GREEN,
        blue: blueCar(),
      });
      const raceOnly = { blue: { raceOnly: true } };

      expect(
        text(show(practiceBlue, { sessionType: 'Practice' }), 'flag-title')
      ).toBe('BLUE FLAG');
      const container = show(practiceBlue, {
        sessionType: 'Practice',
        config: raceOnly,
      });
      expect(text(container, 'flag-title')).toBe('GREEN FLAG');
      expect(byTestId(container, 'flag-plate')).toBeNull();
      expect(
        text(
          show(practiceBlue, { sessionType: 'Race', config: raceOnly }),
          'flag-title'
        )
      ).toBe('BLUE FLAG');
    });

    it('leaves race-only yellows out of practice', () => {
      const container = show(yellowElsewhere, {
        sessionType: 'Practice',
        config: { yellow: { ...defaults.yellow, raceOnly: true } },
      });

      expect(text(container, 'flag-title')).toBe('GREEN FLAG');
    });

    it('hides the card on a clear track when set to', () => {
      const hide = { whenClear: 'hide' as const };

      expect(show(green, { config: hide }).innerHTML).toBe('');
      expect(show(state({}), { config: hide }).innerHTML).toBe('');
      // The announced green and every other flag are still shown.
      expect(
        text(
          show({ ...green, detail: 'greenStart' }, { config: hide }),
          'flag-title'
        )
      ).toBe('GREEN FLAG');
      expect(text(show(blue(), { config: hide }), 'flag-title')).toBe(
        'BLUE FLAG'
      );
    });

    it('hides when not driving only if asked to', () => {
      expect(
        show(green, { isDriving: false }).querySelector(
          '[data-testid="flag-panel"]'
        )
      ).not.toBeNull();
      expect(
        show(green, {
          isDriving: false,
          config: { showOnlyWhenOnTrack: true },
        }).innerHTML
      ).toBe('');
    });

    it('hides in a session it is switched off for', () => {
      expect(show(green, { sessionVisible: false }).innerHTML).toBe('');
    });
  });

  it('is a grey NO FLAG before any data has arrived', () => {
    const container = show(undefined);

    expect(text(container, 'flag-title')).toBe('NO FLAG');
    expect(byTestId(container, 'flag-block')?.dataset.flag).toBe('none');
    expect(byTestId(container, 'flag-explanation')).toBeNull();
    expect(byTestId(container, 'flag-tint')).toBeNull();
  });
});
