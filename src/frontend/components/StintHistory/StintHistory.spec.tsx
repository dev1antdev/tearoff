import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useDashboard,
  useDrivingState,
  usePlayerLedgerSnapshot,
  usePlayerStintSnapshot,
  useSessionVisibility,
} from '@irdashies/context';
import type { StintHistoryConfig } from '@irdashies/types';
import {
  ENDURANCE_SAMPLE_STINTS,
  sampleLedger,
  type SampleLedger,
} from '@irdashies/domain/ledger/ledgerSample';
import { StintHistory } from './StintHistory';

vi.mock('@irdashies/context', () => ({
  useDashboard: vi.fn(),
  useDrivingState: vi.fn(),
  // The compound glyph reads the session's tyre list for iRacing's naming.
  useDriverTires: vi.fn(),
  usePlayerLedgerSnapshot: vi.fn(),
  usePlayerStintSnapshot: vi.fn(),
  useSessionVisibility: vi.fn(),
}));

/** Where the user is, as useDrivingState says it; nowhere unless told. */
const where = (
  state: Partial<ReturnType<typeof useDrivingState>> = {}
): ReturnType<typeof useDrivingState> => ({
  isDriving: false,
  isWatching: false,
  isWatchingOwnCar: false,
  isWatchingOtherCar: false,
  ...state,
});

/**
 * An endurance race two stops in, in a car on virtual energy: stints of 12,
 * 13 and 11 laps behind it and five laps into the fourth. The first stop
 * took energy only, the other two all four tyres as well.
 */
const race = sampleLedger({ stints: ENDURANCE_SAMPLE_STINTS });

interface Drawn {
  config?: Partial<StintHistoryConfig>;
  sample?: SampleLedger | null;
  isDemoMode?: boolean;
}

const draw = ({
  config = {},
  sample = race,
  isDemoMode = false,
}: Drawn = {}) => {
  vi.mocked(useDashboard).mockReturnValue({
    isDemoMode,
    currentDashboard: {
      widgets: [{ id: 'stinthistory', enabled: true, config }],
    },
  } as unknown as ReturnType<typeof useDashboard>);
  vi.mocked(usePlayerLedgerSnapshot).mockReturnValue(sample?.ledger);
  vi.mocked(usePlayerStintSnapshot).mockReturnValue(sample?.live);
  return render(<StintHistory />).container;
};

const all = (container: HTMLElement, id: string) => [
  ...container.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`),
];

/** The text of each cell of each row, top to bottom. */
const table = (container: HTMLElement) =>
  all(container, 'stint-row').map((row) =>
    [...row.children].map((cell) => cell.textContent)
  );

const captions = (container: HTMLElement) =>
  [...(all(container, 'stint-header')[0]?.children ?? [])].map(
    (cell) => cell.textContent
  );

/** What the stop cell of a row drew: the marks, by what they stand for. */
const marks = (row: HTMLElement) =>
  [...row.querySelectorAll<SVGElement>('[data-did], [data-end]')].map(
    (icon) => icon.dataset.did ?? icon.dataset.end
  );

describe('StintHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useDrivingState).mockReturnValue(where({ isDriving: true }));
    vi.mocked(useSessionVisibility).mockReturnValue(true);
  });

  describe('the table', () => {
    it('lists the stint under way first, then the last three', () => {
      const container = draw();

      expect(captions(container)).toEqual([
        '#',
        'Laps',
        'Time',
        'NRG',
        'Tyre',
        'Wear',
        'Best',
        'Stop',
      ]);
      const rows = table(container);
      expect(rows.map((row) => row[0])).toEqual(['4', '3', '2', '1']);
      expect(rows.map((row) => row[1])).toEqual(['5', '11', '13', '12']);
      expect(
        all(container, 'stint-row').map((row) => row.dataset.current)
      ).toEqual(['true', 'false', 'false', 'false']);
    });

    it('draws the stint under way bold, and the finished ones muted', () => {
      const [current, finished] = all(draw(), 'stint-row');

      expect(current.className).toContain('font-bold');
      expect(current.className).not.toContain('text-slate-300');
      expect(finished.className).toContain('text-slate-300');
    });

    it('selects the stint under way and stripes none of the others', () => {
      const [current, ...finished] = all(draw(), 'stint-row');

      expect(current.className).toContain('overlay-selected');
      for (const row of finished) {
        expect(row.className).not.toMatch(/bg-slate-(800|900)\/70/);
      }
      // A hairline between finished stints, drawn in no extra height.
      expect(finished[1].className).toContain('bg-[length:100%_1px]');
    });

    it('gives each stint its time, what it used, its wear and its best', () => {
      const [current, third] = table(draw());

      // Five laps of about 1:44, one of them out of the pits, and four
      // tenths of the sixth: 5.4 laps at 2.35 % a lap.
      expect(current[2]).toMatch(/^9:3\d$/);
      expect(current[3]).toBe('12.7');
      // Eleven laps, the first out of the pits, three in the rain and the
      // last into the pits: 11 laps at 2.35 %, and 0.6 % of tread a lap.
      expect(third[2]).toMatch(/^19:5\d$/);
      expect(Math.abs(Number(third[3]) - 25.85)).toBeLessThan(0.06);
      expect(Math.abs(Number(third[5]) - 6.47)).toBeLessThan(0.06);
      expect(third[6]).toMatch(/^1:4\d\.\d{3}$/);
    });

    it("marks the best lap of the session, which is the current stint's", () => {
      const rows = all(draw(), 'stint-row');
      const purple = rows.map(
        (row) => row.querySelector('.text-purple-400') !== null
      );

      expect(purple).toEqual([true, false, false, false]);
    });

    it('says what each stop did', () => {
      const [current, third, second, first] = all(draw(), 'stint-row');

      // Nothing has ended the stint under way.
      expect(marks(current)).toEqual([]);
      expect(marks(third)).toEqual(['refill', 'tyres']);
      expect(marks(second)).toEqual(['refill', 'tyres']);
      // Energy only.
      expect(marks(first)).toEqual(['refill']);
      // Seconds in the pit lane, then what went in, in percent.
      expect(first.lastElementChild?.textContent).toBe('38.628');
    });

    it('marks a stint that ended in the garage or with its session', () => {
      const container = draw({
        sample: sampleLedger({
          stints: [
            { laps: 6, closedBy: 'garage' },
            {
              laps: 9,
              closedBy: 'service',
              stop: { driverChanged: true, brakesChanged: true },
            },
            { laps: 4, closedBy: 'session' },
          ],
        }),
      });

      expect(all(container, 'stint-row').map(marks)).toEqual([
        ['session'],
        ['brakes', 'driver'],
        ['garage'],
      ]);
    });

    it('counts a car on fuel in litres, or in gallons', () => {
      const sample = sampleLedger({
        stints: ENDURANCE_SAMPLE_STINTS,
        budget: 'fuel',
      });

      // The caption follows what the car runs on; the unit is the driver's.
      const litres = draw({ sample });
      expect(captions(litres)[3]).toBe('Fuel');
      expect(table(litres)[1][3]).toBe('31.9');

      const gallons = draw({ sample, config: { fuelUnits: 'gal' } });
      expect(captions(gallons)[3]).toBe('Fuel');
      expect(table(gallons)[1][3]).toBe('8.4');
    });

    it('draws only the columns switched on', () => {
      const container = draw({
        config: {
          showLaps: false,
          showTime: false,
          showTyres: false,
          showWear: false,
          showStop: false,
          showBrakes: true,
        },
      });

      expect(captions(container)).toEqual(['#', 'NRG', 'Brk', 'Best']);
      expect(table(container)[1]).toHaveLength(4);
    });

    it('adds the driver, the use per lap and the consistency when asked', () => {
      const container = draw({
        config: {
          showDriver: true,
          showFuelPerLap: true,
          showConsistency: true,
        },
      });
      const [, third] = table(container);

      expect(third[0]).toBe('3Morgan');
      // The total, with a lap's share under it.
      expect(third[3]).toMatch(/^25\.[89]2\.35$/);
      expect(third[6]).toMatch(/^1:4\d\.\d{3}9\d\.\d%$/);
    });

    it('lists as many finished stints as asked for, oldest first if asked', () => {
      expect(
        table(draw({ config: { historyCount: 1 } })).map((row) => row[0])
      ).toEqual(['4', '3']);
      expect(
        table(draw({ config: { newestFirst: false } })).map((row) => row[0])
      ).toEqual(['1', '2', '3', '4']);
      expect(
        table(draw({ config: { showCurrent: false } })).map((row) => row[0])
      ).toEqual(['3', '2', '1']);
    });

    it('draws a dash where the sim gives no wear', () => {
      // iRacing: tread is read only in the pits, and no discs at all.
      const container = draw({
        sample: sampleLedger({
          stints: ENDURANCE_SAMPLE_STINTS,
          budget: 'fuel',
          treadPerLap: null,
          brakePerLap: null,
        }),
        config: { showBrakes: true },
      });

      expect(table(container).map((row) => [row[5], row[6]])).toEqual([
        ['--', '--'],
        ['--', '--'],
        ['--', '--'],
        ['--', '--'],
      ]);
    });

    it('draws its header alone with no stint at all', () => {
      const container = draw({ sample: null });

      expect(captions(container)).toHaveLength(8);
      // Fuel, until a car says otherwise.
      expect(captions(container)[3]).toBe('Fuel');
      expect(all(container, 'stint-row')).toHaveLength(0);
      expect(all(container, 'stint-note')).toHaveLength(0);
    });

    it('draws fixed sample rows in demo mode, reading no channel', () => {
      const container = draw({ sample: null, isDemoMode: true });

      expect(table(container).map((row) => row[0])).toEqual([
        '4',
        '3',
        '2',
        '1',
      ]);
      expect(usePlayerLedgerSnapshot).toHaveBeenLastCalledWith(false);
      expect(usePlayerStintSnapshot).toHaveBeenLastCalledWith(false);
    });
  });

  describe('where the user is', () => {
    it('is on screen in the garage, where a stint is read after it', () => {
      vi.mocked(useDrivingState).mockReturnValue(where());

      const container = draw();

      expect(all(container, 'stint-row')).toHaveLength(4);
      expect(usePlayerLedgerSnapshot).toHaveBeenLastCalledWith(true);
    });

    it('hides off the track when told to show only on it', () => {
      vi.mocked(useDrivingState).mockReturnValue(where());

      const container = draw({ config: { showOnlyWhenOnTrack: true } });

      expect(container.innerHTML).toBe('');
      expect(usePlayerLedgerSnapshot).toHaveBeenLastCalledWith(false);
      expect(usePlayerStintSnapshot).toHaveBeenLastCalledWith(false);
    });

    it('stays up while a team-mate drives the car, and says whose stints these are', () => {
      vi.mocked(useDrivingState).mockReturnValue(
        where({ isWatching: true, isWatchingOwnCar: true })
      );
      // The team-mate's stint is under way: the fifth, and not the user's.
      const teamMate = race.live.stint && {
        ...race.live.stint,
        id: 'sample:2:5',
        ordinal: 5,
        own: false,
        laps: 3,
      };
      const closed = race.live.stint && {
        ...race.live.stint,
        closedBy: 'service' as const,
      };

      const container = draw({
        config: { showOnlyWhenOnTrack: true },
        sample: {
          ledger: {
            ...race.ledger,
            stints: closed ? [closed, ...race.ledger.stints] : [],
          },
          live: { ...race.live, stint: teamMate },
        },
      });

      expect(all(container, 'stint-note')[0].textContent).toBe(
        'Team-mate driving · your stints'
      );
      // The user's own, none of them under way: nothing here grows.
      expect(table(container).map((row) => row[0])).toEqual(['4', '3', '2']);
      expect(
        all(container, 'stint-row').map((row) => row.dataset.current)
      ).toEqual(['false', 'false', 'false']);
    });

    it('goes on showing the same rows however far the team-mate drives', () => {
      vi.mocked(useDrivingState).mockReturnValue(
        where({ isWatching: true, isWatchingOwnCar: true })
      );
      const theirs = (laps: number) =>
        race.live.stint && {
          ...race.live.stint,
          id: 'sample:2:5',
          ordinal: 5,
          own: false,
          laps,
          endTime: (race.live.stint.endTime ?? 0) + laps * 104,
          endEnergy: 0.9 - laps * 0.0235,
        };
      const ledger = { ...race.ledger, stints: race.ledger.stints };

      const early = table(
        draw({ sample: { ledger, live: { ...race.live, stint: theirs(1) } } })
      );
      const late = table(
        draw({ sample: { ledger, live: { ...race.live, stint: theirs(14) } } })
      );

      expect(late).toEqual(early);
      expect(late.map((row) => row[0])).toEqual(['3', '2', '1']);
    });

    it('hides while the camera is on another car, whatever the setting', () => {
      // The stints are the user's, and that is not the car on screen.
      vi.mocked(useDrivingState).mockReturnValue(
        where({ isWatching: true, isWatchingOtherCar: true })
      );

      expect(draw().innerHTML).toBe('');
      expect(draw({ config: { showOnlyWhenOnTrack: true } }).innerHTML).toBe(
        ''
      );
      expect(usePlayerLedgerSnapshot).toHaveBeenLastCalledWith(false);
    });

    it('hides in a session it is switched off for', () => {
      vi.mocked(useSessionVisibility).mockReturnValue(false);

      expect(draw().innerHTML).toBe('');
    });

    it('has no note while the user drives', () => {
      expect(all(draw(), 'stint-note')).toHaveLength(0);
    });
  });
});
