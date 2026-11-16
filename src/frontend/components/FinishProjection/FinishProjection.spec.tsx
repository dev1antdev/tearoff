import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useDashboard,
  useDrivingState,
  useFinishProjectionSnapshot,
  useSessionDrivers,
  useSessionVisibility,
  useWeekendInfoNumCarClasses,
} from '@irdashies/context';
import type {
  FinishCar,
  FinishProjectionConfig,
  FinishProjectionSnapshot,
  FinishRival,
} from '@irdashies/types';
import { FinishProjection } from './FinishProjection';

vi.mock('@irdashies/context', () => ({
  useDashboard: vi.fn(),
  useDrivingState: vi.fn(),
  useFinishProjectionSnapshot: vi.fn(),
  useSessionDrivers: vi.fn(),
  useSessionVisibility: vi.fn(),
  useWeekendInfoNumCarClasses: vi.fn(),
}));

const PLAYER = 0;
const LEADER = 9;

const car = (
  carIdx: number,
  paceS: number,
  progress: number,
  lastStopLossS = 0
): FinishCar => ({ carIdx, paceS, progress, lastStopLossS });

const rival = (
  carIdx: number,
  classPosition: number,
  gapS: number,
  values: Partial<FinishRival> = {}
): FinishRival => ({
  carIdx,
  classPosition,
  ahead: gapS < 0,
  gapS,
  lapsLeft: 6.3,
  stopsOwed: 1,
  stopLossS: 40,
  basis: 'energy',
  projectedGapS: gapS,
  paceDeltaS: 0,
  inPit: false,
  ...values,
});

/** As the channel lists them: each side nearest first. */
const RIVALS = [
  rival(2, 4, -3.4, { projectedGapS: 2.2 }),
  rival(1, 3, -14.2, { projectedGapS: -12.7 }),
  rival(5, 2, -31.9, { projectedGapS: -30.4 }),
  rival(3, 6, 5.1, { stopsOwed: 2, projectedGapS: 46.6 }),
  rival(4, 7, 11.8, { projectedGapS: 0.4 }),
  rival(6, 8, 48.3, { projectedGapS: 49.9 }),
];

/**
 * A timed race with ten minutes on the clock: the leader a quarter of the
 * way round its eleventh lap at 90 s a lap, the player four fifths of the
 * way round its tenth at 100 s, with 9 % of its energy aboard at 2.3 % a
 * lap. The flag falls in 607.5 s, 7.5 s after the clock; the player is then
 * at 15.875 laps, so 6.2 laps to go and 12.5 s short of a line.
 */
const snapshot = (
  values: Partial<FinishProjectionSnapshot> = {}
): FinishProjectionSnapshot => ({
  valid: true,
  reason: null,
  raceType: 'time',
  timeLeftS: 600,
  lapLimit: null,
  leader: car(LEADER, 90, 10.25),
  player: car(PLAYER, 100, 9.8),
  lapsToGo: 6.2,
  energy: { isVirtualEnergy: true, perLap: 2.3, aboard: 9, capacity: 100 },
  laneLossS: 17.2,
  plannedStandingS: 14.2,
  refuelLines: [
    { fixedS: 0, perUnitS: 0.4 },
    { fixedS: 2.42, perUnitS: 0.303 },
  ],
  separateS: 0,
  overlapS: 0,
  playerStopsOwed: 1,
  rivals: RIVALS,
  sessionNum: 0,
  version: 1,
  ...values,
});

interface Scene {
  config?: Partial<FinishProjectionConfig>;
  isDriving?: boolean;
  isWatchingOwnCar?: boolean;
  isWatchingOtherCar?: boolean;
  sessionVisible?: boolean;
}

const show = (
  finish: FinishProjectionSnapshot | undefined,
  {
    config = {},
    isDriving = true,
    isWatchingOwnCar = false,
    isWatchingOtherCar = false,
    sessionVisible = true,
  }: Scene = {}
) => {
  vi.mocked(useDashboard).mockReturnValue({
    currentDashboard: { widgets: [{ id: 'finishorder', config }] },
  } as unknown as ReturnType<typeof useDashboard>);
  vi.mocked(useFinishProjectionSnapshot).mockReturnValue(finish);
  vi.mocked(useDrivingState).mockReturnValue({
    isDriving,
    isWatching: isWatchingOwnCar || isWatchingOtherCar,
    isWatchingOwnCar,
    isWatchingOtherCar,
  });
  vi.mocked(useSessionVisibility).mockReturnValue(sessionVisible);
  vi.mocked(useSessionDrivers).mockReturnValue([
    { CarIdx: 1, CarNumber: '92', UserName: 'Mika Christensen' },
    { CarIdx: 2, CarNumber: '46', UserName: 'Valentin Rossi' },
    { CarIdx: 3, CarNumber: '27', UserName: 'Ian James' },
    { CarIdx: 4, CarNumber: '85', UserName: 'Sarah Bovy' },
    { CarIdx: 5, CarNumber: '54', UserName: 'Francesco Castellacci' },
    { CarIdx: 6, CarNumber: '31', UserName: 'Augusto Farfus' },
  ] as unknown as ReturnType<typeof useSessionDrivers>);
  vi.mocked(useWeekendInfoNumCarClasses).mockReturnValue(3);
  return render(<FinishProjection />);
};

const isDrawn = () => screen.queryByTestId('finish-projection') !== null;
const text = (testId: string) => screen.getByTestId(testId).textContent;

/** One cell of each column, by its test id. */
const cells = (testId: string) =>
  screen.getAllByTestId('finish-column').map((column) => {
    const cell = within(column).queryByTestId(testId);
    return cell ? cell.textContent : null;
  });

/** A data attribute of one cell of each column. */
const marks = (testId: string, attribute: string) =>
  screen
    .getAllByTestId('finish-column')
    .map(
      (column) => within(column).getByTestId(testId).dataset[attribute] ?? null
    );

/** Each rival's row as "place|number|name|gap|stops|after|outcome". */
const rivalRows = () =>
  screen.getAllByTestId('finish-rival').map((row) => {
    const [place, number, name] = [...row.children].map(
      (cell) => cell.textContent
    );
    const figure = (testId: string) =>
      within(row).getByTestId(testId).textContent;
    return [
      place,
      number,
      name,
      figure('finish-rival-gap'),
      figure('finish-rival-stops'),
      figure('finish-rival-projected'),
      row.dataset.outcome,
    ].join('|');
  });

describe('FinishProjection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('the finish table', () => {
    it('gives a column for no stop, each stop length, the planned stop and the stop to finish', () => {
      show(snapshot());
      expect(cells('finish-column-label')).toEqual([
        'NOW',
        '30s',
        '40s',
        '50s',
        '60s',
        'PLAN',
        'FIN',
      ]);
      // The leader takes the flag 7.5 s after the clock, and as much later
      // as it stands; the planned stop and the stop to finish are the
      // player's alone.
      expect(cells('finish-leader')).toEqual([
        '+8s',
        '+38s',
        '+48s',
        '+58s',
        '+68s',
        '+8s',
        '+8s',
      ]);
      // The same lap whatever the stop: 6.2 to go.
      expect(cells('finish-laps')).toEqual([
        '6.2',
        '6.2',
        '6.2',
        '6.2',
        '6.2',
        '6.2',
        '6.2',
      ]);
      // 14.3 % for 6.2 laps against 9 % aboard, and one lap more.
      expect(cells('finish-refuel')[0]).toBe('+5.3');
      expect(cells('finish-refuel-extra')[0]).toBe('+7.6');
    });

    it('marks a finish that hangs on a few seconds, and which way it would go', () => {
      show(snapshot());
      // No stop: across the line 12.5 s after the flag, so that much
      // quicker is a lap more. The planned stop of 33.4 s puts the last
      // crossing 54 s before the flag; the stop to finish, 23.2 s, is
      // further from a line than the 20 s that count as near.
      expect(marks('finish-laps', 'near')).toEqual([
        'more',
        'more',
        'more',
        'more',
        'more',
        'none',
        'none',
      ]);
      const [now, , , , , planned] = screen.getAllByTestId('finish-column');
      expect(
        within(now).getByLabelText('A few seconds quicker is one lap more')
      ).toBeTruthy();
      expect(within(planned).queryByLabelText(/A few seconds/)).toBeNull();
      expect(within(now).getByTestId('finish-laps').className).toContain(
        'text-amber-300'
      );
    });

    it('points down where a little slower is a lap fewer', () => {
      // 10 s past a line at the flag.
      show(snapshot({ player: car(PLAYER, 100, 10.025), lapsToGo: null }), {
        config: { scenarios: [] },
      });
      expect(marks('finish-laps', 'near')[0]).toBe('fewer');
      expect(
        screen.getAllByLabelText('A few seconds slower is one lap fewer').length
      ).toBeGreaterThan(0);
    });

    it('marks a leader that takes the flag within seconds of the clock', () => {
      show(snapshot(), { config: { leaderStops: 'none' } });
      // 7.5 s after the clock in every column: the leader does not stop.
      expect(cells('finish-leader')).toEqual(Array(7).fill('+8s'));
      expect(marks('finish-leader', 'near')).toEqual(Array(7).fill('true'));

      show(snapshot());
      const second = screen.getAllByTestId('finish-table')[1];
      expect(
        within(second)
          .getAllByTestId('finish-leader')
          .map((cell) => cell.dataset.near)
      ).toEqual(['true', 'false', 'false', 'false', 'false', 'true', 'true']);
    });

    it('follows the stop lengths it is set', () => {
      show(snapshot(), {
        config: {
          scenarios: [25, 45],
          showPlanned: false,
          showToFinish: false,
        },
      });
      expect(cells('finish-column-label')).toEqual(['NOW', '25s', '45s']);
    });

    it('has no planned stop or stop to finish without what they are costed with', () => {
      show(snapshot({ laneLossS: null }));
      expect(cells('finish-column-label')).toEqual([
        'NOW',
        '30s',
        '40s',
        '50s',
        '60s',
      ]);

      // iRacing: a lane and a planned stop, and no refuelling rates.
      show(snapshot({ refuelLines: null }));
      const second = screen.getAllByTestId('finish-table')[1];
      expect(
        within(second)
          .getAllByTestId('finish-column-label')
          .map((label) => label.textContent)
      ).toEqual(['NOW', '30s', '40s', '50s', '60s', 'PLAN']);
    });

    it('shows the last stop once either car has made one', () => {
      show(snapshot({ leader: car(LEADER, 90, 10.25, 31.5) }));
      expect(cells('finish-column-label').at(-1)).toBe('LAST');
      // The leader 31.5 s later, the player with no stop behind it.
      expect(cells('finish-leader').at(-1)).toBe('+39s');

      show(snapshot({ leader: car(LEADER, 90, 10.25, 31.5) }), {
        config: { showLast: false },
      });
      const second = screen.getAllByTestId('finish-table')[1];
      expect(
        within(second)
          .getAllByTestId('finish-column-label')
          .map((label) => label.textContent)
      ).not.toContain('LAST');
    });

    it('writes a dash for the leader when the player leads', () => {
      show(
        snapshot({
          leader: null,
          player: car(PLAYER, 90, 10.25),
          lapsToGo: 6.75,
        }),
        { config: { scenarios: [40] } }
      );
      expect(cells('finish-leader').slice(0, 2)).toEqual(['--', '--']);
      expect(cells('finish-laps').slice(0, 2)).toEqual(['6.8', '6.8']);
      expect(screen.queryByTestId('finish-projection-lap-lost')).toBeNull();
    });

    it('can add the lap fractions TinyPedal shows', () => {
      show(snapshot(), { config: { scenarios: [40], leaderStops: 'none' } });
      expect(screen.queryByTestId('finish-leader-fraction')).toBeNull();

      show(snapshot(), {
        config: {
          scenarios: [40],
          leaderStops: 'none',
          showLapFractions: true,
        },
      });
      const second = screen.getAllByTestId('finish-table')[1];
      const fractions = (testId: string) =>
        within(second)
          .getAllByTestId(testId)
          .map((cell) => cell.textContent)
          .slice(0, 2);
      // 16.92 and 15.80 laps as the clock runs out; 15.40 with the stop.
      expect(fractions('finish-leader-fraction')).toEqual(['0.92', '0.92']);
      expect(fractions('finish-player-fraction')).toEqual(['0.80', '0.40']);
    });
  });

  describe('what has to go in', () => {
    it('writes a green 0 once what is aboard covers the laps', () => {
      show(
        snapshot({
          energy: {
            isVirtualEnergy: true,
            perLap: 2.3,
            aboard: 15,
            capacity: 100,
          },
        }),
        { config: { scenarios: [] } }
      );
      // 14.3 % needed with 15 % aboard; one lap more needs 16.6 %.
      expect(cells('finish-refuel')[0]).toBe('0');
      expect(marks('finish-refuel', 'tone')[0]).toBe('enough');
      expect(cells('finish-refuel-extra')[0]).toBe('+1.6');
      expect(marks('finish-refuel-extra', 'tone')[0]).toBe('needed');
    });

    it('can write the whole amount instead, and leave the extra row out', () => {
      show(snapshot(), {
        config: {
          scenarios: [],
          refuelDisplay: 'total',
          showExtraRefuel: false,
        },
      });
      expect(cells('finish-refuel')[0]).toBe('14.3');
      expect(cells('finish-refuel-extra')[0]).toBeNull();
      expect(text('finish-table')).toContain('Needs');
      expect(text('finish-table')).not.toContain('+1 lap');
    });

    it('adds as many extra laps as it is set to', () => {
      show(snapshot(), { config: { scenarios: [], extraLaps: 3 } });
      // 9.2 laps at 2.3 % against 9 %.
      expect(cells('finish-refuel-extra')[0]).toBe('+12.2');
      expect(text('finish-table')).toContain('+3 laps');
    });

    it('counts a car on fuel in litres, or in gallons when set to', () => {
      const fuelCar = snapshot({
        energy: { isVirtualEnergy: false, perLap: 3, aboard: 4, capacity: 110 },
        refuelLines: null,
      });
      show(fuelCar, { config: { scenarios: [] } });
      expect(cells('finish-refuel')[0]).toBe('+14.6');
      expect(text('finish-refuel-unit')).toBe('L');
      expect(screen.getByLabelText('Fuel')).toBeTruthy();

      show(fuelCar, { config: { scenarios: [], fuelUnits: 'gal' } });
      const second = screen.getAllByTestId('finish-table')[1];
      expect(
        within(second).getAllByTestId('finish-refuel')[0].textContent
      ).toBe('+3.9');
      expect(within(second).getByTestId('finish-refuel-unit').textContent).toBe(
        'gal'
      );
    });

    it('counts a car on virtual energy in percent whatever the fuel unit', () => {
      show(snapshot(), { config: { scenarios: [], fuelUnits: 'gal' } });
      expect(cells('finish-refuel')[0]).toBe('+5.3');
      expect(text('finish-refuel-unit')).toBe('%');
      expect(screen.getByLabelText('Virtual energy')).toBeTruthy();
    });

    it('draws a stop to finish that the car cannot hold in red, and only that one', () => {
      // An hour and a half to run: 54 laps at 2.3 % is more than the car
      // holds.
      show(snapshot({ timeLeftS: 5400, lapsToGo: null }), {
        config: { scenarios: [30] },
      });
      expect(cells('finish-column-label')).toEqual([
        'NOW',
        '30s',
        'PLAN',
        'FIN',
      ]);
      expect(marks('finish-refuel', 'tone')).toEqual([
        'needed',
        'needed',
        'needed',
        'over',
      ]);
    });

    it('writes dashes before a lap has been measured', () => {
      show(snapshot({ energy: null }), { config: { scenarios: [30] } });
      expect(cells('finish-refuel')).toEqual(['--', '--', '--']);
      expect(cells('finish-refuel-extra')).toEqual(['--', '--', '--']);
      expect(marks('finish-refuel', 'tone')).toEqual(['none', 'none', 'none']);
      // Which budget the car runs on is not known yet: no unit is named.
      expect(screen.queryByTestId('finish-refuel-unit')).toBeNull();
      // And no stop to finish, which is an amount to add.
      expect(cells('finish-column-label')).toEqual(['NOW', '30s', 'PLAN']);
    });
  });

  describe('the header', () => {
    it('gives the clock and the lap lost to the leader every lap', () => {
      show(snapshot());
      expect(text('finish-projection-length')).toBe('10:00');
      expect(screen.getByTestId('finish-projection').textContent).toContain(
        'Time'
      );
      // Ten seconds a lap on a lap of a hundred.
      expect(text('finish-projection-lap-lost')).toBe('Loses 0.10 lap/lap');
    });

    it('gives the laps left of a race run to laps', () => {
      show(
        snapshot({
          raceType: 'laps',
          timeLeftS: null,
          lapLimit: 30,
          leader: car(LEADER, 90, 20.5),
          player: car(PLAYER, 92, 19.9),
          lapsToGo: 10.1,
        }),
        { config: { scenarios: [] } }
      );
      expect(text('finish-projection-length')).toBe('9.5 left');
      expect(cells('finish-leader')[0]).toBe('--');
      expect(cells('finish-laps')[0]).toBe('10.1');
    });

    it('leaves the lap lost out when the player is not the slower', () => {
      show(snapshot({ player: car(PLAYER, 89, 9.8) }));
      expect(screen.queryByTestId('finish-projection-lap-lost')).toBeNull();
    });
  });

  describe('the class rivals', () => {
    it('lists two each side in class order, with the gap now, the stops and the gap after them', () => {
      show(snapshot());
      expect(rivalRows()).toEqual([
        '3|#92|M. Christensen|-14.2|1 v 1|-14.7|behind',
        '4|#46|V. Rossi|-3.4|1 v 1|+0.2|level',
        '6|#27|I. James|+5.1|2 v 1|+44.6|ahead',
        '7|#85|S. Bovy|+11.8|1 v 1|-1.6|behind',
      ]);
      // The player's place in the order, between the two sides.
      expect(screen.getByTestId('finish-rivals-player')).toBeTruthy();
    });

    it('gives the player’s own stops their extra time', () => {
      // The figures above carry the 2 s of the default: without it the
      // gaps are the channel's own.
      show(snapshot(), { config: { extraTime: 0 } });
      expect(rivalRows().map((row) => row.split('|')[5])).toEqual([
        '-12.7',
        '+2.2',
        '+46.6',
        '+0.4',
      ]);
    });

    it('colours the gap after the stops by who ends ahead', () => {
      show(snapshot(), { config: { extraTime: 0 } });
      const colour = (carIdx: number) =>
        within(
          screen
            .getAllByTestId('finish-rival')
            .find((row) => row.dataset.car === String(carIdx)) as HTMLElement
        ).getByTestId('finish-rival-projected').className;
      expect(colour(1)).toContain('text-red-400');
      expect(colour(2)).toContain('text-green-400');
      // Inside a second.
      expect(colour(4)).toContain('text-slate-300');
    });

    it('shows as many rows as it is set to', () => {
      show(snapshot(), { config: { rivalsAhead: 3, rivalsBehind: 1 } });
      expect(rivalRows().map((row) => row.split('|')[1])).toEqual([
        '#54',
        '#92',
        '#46',
        '#27',
      ]);

      show(snapshot(), { config: { rivalsAhead: 0, rivalsBehind: 2 } });
      const second = screen.getAllByTestId('finish-rivals')[1];
      expect(
        within(second)
          .getAllByTestId('finish-rival')
          .map((row) => row.dataset.car)
      ).toEqual(['3', '4']);
      // Nobody ahead is listed: no line for the player's place.
      expect(within(second).queryByTestId('finish-rivals-player')).toBeNull();
    });

    it('draws a rival whose stops are assumed fainter, with a ~', () => {
      show(
        snapshot({
          rivals: [
            rival(2, 4, -3.4, { basis: 'observed' }),
            rival(3, 6, 5.1, { basis: 'assumed' }),
          ],
        })
      );
      const [observed, assumed] = screen.getAllByTestId('finish-rival');
      expect(observed.dataset.assumed).toBe('false');
      expect(observed.className).not.toContain('opacity-60');
      expect(
        within(observed).getByTestId('finish-rival-stops').textContent
      ).toBe('1 v 1');
      expect(assumed.dataset.assumed).toBe('true');
      expect(assumed.className).toContain('opacity-60');
      expect(
        within(assumed).getByTestId('finish-rival-stops').textContent
      ).toBe('~1 v 1');
    });

    it('badges a rival in the pit lane', () => {
      show(
        snapshot({
          rivals: [rival(2, 4, -3.4, { inPit: true }), rival(3, 6, 5.1)],
        })
      );
      const [inPit, onTrack] = screen.getAllByTestId('finish-rival');
      expect(inPit.textContent).toContain('PIT');
      expect(onTrack.textContent).not.toContain('PIT');
    });

    it('writes a dash for a gap that could not be costed', () => {
      show(
        snapshot({
          rivals: [rival(2, 4, -3.4, { projectedGapS: null, stopLossS: null })],
        })
      );
      expect(rivalRows()).toEqual(['4|#46|V. Rossi|-3.4|1 v 1|--|unknown']);
    });

    it('can add the pace over the laps left', () => {
      const rivals = [
        rival(2, 4, -3.4, { projectedGapS: -2, paceDeltaS: 6.3 }),
      ];
      show(snapshot({ rivals, playerStopsOwed: 0 }), {
        config: { includePace: true },
      });
      expect(rivalRows()).toEqual(['4|#46|V. Rossi|-3.4|1 v 0|+4.3|ahead']);
    });

    it('goes when the class has no other car, and when switched off', () => {
      show(snapshot({ rivals: [] }));
      expect(screen.queryByTestId('finish-rivals')).toBeNull();
      expect(screen.getByTestId('finish-table')).toBeTruthy();

      show(snapshot(), { config: { showRivals: false } });
      expect(screen.queryByTestId('finish-rivals')).toBeNull();
    });
  });

  describe('with nothing to project', () => {
    it.each([
      ['notRace', 'Race only'],
      ['notStarted', 'Waiting for the green flag'],
      ['finished', 'Race finished'],
      ['noCar', 'No car in the race'],
      ['otherCar', 'Camera on another car'],
      ['noPace', 'Waiting for a lap time'],
    ] as const)('says why: %s', (reason, line) => {
      show(snapshot({ valid: false, reason, player: null, leader: null }));
      expect(text('finish-projection-reason')).toBe(line);
      expect(screen.queryByTestId('finish-table')).toBeNull();
      expect(screen.queryByTestId('finish-rivals')).toBeNull();
      expect(screen.getByTestId('finish-projection').dataset.valid).toBe(
        'false'
      );
    });

    it('keeps its place before the first snapshot', () => {
      show(undefined);
      expect(isDrawn()).toBe(true);
      expect(text('finish-projection-reason')).toBe('Waiting for the session');
    });
  });

  describe('when it shows', () => {
    it('hides outside the sessions it is set to show in', () => {
      show(snapshot(), { sessionVisible: false });
      expect(isDrawn()).toBe(false);
    });

    it('stays up out of the car, unless set to show only on track', () => {
      // At the pit wall it is as useful as at the wheel.
      show(snapshot(), { isDriving: false });
      expect(isDrawn()).toBe(true);
    });

    it('hides out of the car when set to show only on track', () => {
      show(snapshot(), {
        isDriving: false,
        config: { showOnlyWhenOnTrack: true },
      });
      expect(isDrawn()).toBe(false);
    });

    it('stays up while a team-mate drives the car, whatever that setting', () => {
      show(snapshot(), {
        isDriving: false,
        isWatchingOwnCar: true,
        config: { showOnlyWhenOnTrack: true },
      });
      expect(isDrawn()).toBe(true);
      expect(cells('finish-laps')[0]).toBe('6.2');
      expect(rivalRows()).toHaveLength(4);
    });

    it('hides with the camera on a rival, whatever the settings', () => {
      show(snapshot(), {
        isDriving: false,
        isWatchingOtherCar: true,
        config: { showOnlyWhenOnTrack: false },
      });
      expect(isDrawn()).toBe(false);
    });
  });

  it('survives a saved config with a list of stop lengths that is not one', () => {
    show(snapshot(), {
      config: {
        scenarios: 'thirty' as unknown as number[],
        showPlanned: false,
        showToFinish: false,
      },
    });
    // The defaults.
    expect(cells('finish-column-label')).toEqual([
      'NOW',
      '30s',
      '40s',
      '50s',
      '60s',
    ]);
  });
});
