import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDashboard, useSessionStore } from '@irdashies/context';
import type { CrewConfig } from '@irdashies/types';
import {
  raceHistoryStage,
  raceHistoryStageBridge,
  raceHistoryStageChannels,
  type RaceHistoryStageOptions,
} from '../../../../.storybook/raceHistoryStage';
import { Crew } from './Crew';
import { completeCrewConfig } from './hooks/useCrewSettings';

vi.mock('@irdashies/context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@irdashies/context')>()),
  useDashboard: vi.fn(),
}));

/**
 * Crew and Stints over a stub channel bridge and a stub of the race
 * history's bridge, on the STAGED eight-hour race the stories are told
 * with. Every lap and stint is a staged record; nothing here was recorded,
 * because no recording has a pit stop or a driver change.
 */

const PRACTICE_ONLY = {
  race: false,
  loneQualify: false,
  openQualify: false,
  practice: true,
  offlineTesting: false,
};

const show = (
  options: RaceHistoryStageOptions = {},
  config: Partial<CrewConfig> = {},
  { withHistory = true }: { withHistory?: boolean } = {}
) => {
  const stage = raceHistoryStage(options);
  const channels = raceHistoryStageChannels(stage.snapshots);
  window.channelBridge = channels.bridge;
  const history = raceHistoryStageBridge(stage.records);
  vi.spyOn(history, 'getCarLaps');
  vi.spyOn(history, 'getCarStints');
  window.raceHistoryBridge = withHistory ? history : undefined;
  useSessionStore.setState({ session: stage.session });
  vi.mocked(useDashboard).mockReturnValue({
    currentDashboard: { widgets: [{ id: 'crew', config }] },
  } as unknown as ReturnType<typeof useDashboard>);
  const summary = stage.snapshots['race-history.summary'];
  if (!summary) throw new Error('the stage has no summary');
  const view = render(<Crew />);
  return { stage, channels, history, summary, ...view };
};

/** The cells of a row, as text. */
const cells = (row: HTMLElement): string[] =>
  Array.from(row.children).map((cell) => cell.textContent ?? '');

/** Waits for the race history's answer to be drawn. */
const settled = () => screen.findAllByTestId('crew-stint');

const driverRows = (): string[][] =>
  screen
    .getAllByTestId('crew-driver')
    .map((row) => cells(row.firstElementChild as HTMLElement));

const stintRows = (): string[][] =>
  screen.getAllByTestId('crew-stint').map((row) => cells(row));

const chooseCar = (carIdx: number) =>
  fireEvent.change(screen.getByTestId('car-choice'), {
    target: { value: String(carIdx) },
  });

describe('Crew (staged)', () => {
  beforeEach(() => {
    vi.mocked(useDashboard).mockReset();
  });

  afterEach(() => {
    window.raceHistoryBridge = undefined;
    vi.restoreAllMocks();
  });

  describe('our car', () => {
    it('lists the drivers in the order they first drove, with their totals', async () => {
      show();
      await settled();
      expect(driverRows()).toEqual([
        ['M. Ivanov', '3', '2:14', '1:54.70', '1:54.098'],
        ['A. Petrov', '2', '2:00', '1:54.67', '1:54.096'],
        ['D. Sokolov', '1', '0:59', '1:54.70', '1:54.076'],
      ]);
      expect(screen.getByTestId('crew-count')).toHaveTextContent(
        '3 drivers · 6 stints'
      );
    });

    it('marks who is at the wheel', async () => {
      show();
      await settled();
      expect(
        screen.getAllByTestId('crew-driver').map((row) => row.dataset.driving)
      ).toEqual(['true', 'false', 'false']);
    });

    it('lists the stints newest first, each with the stop that ended it', async () => {
      show();
      await settled();
      expect(stintRows()).toEqual([
        // The pace is against the last stint somebody else drove.
        [
          '6',
          'M. Ivanov',
          '7',
          '0:11',
          '1:54.58',
          '1:54.335',
          '2.5 %',
          'under way-0.12 vs D. Sokolov',
        ],
        [
          '5',
          'D. Sokolov',
          '31',
          '0:59',
          '1:54.70',
          '1:54.076',
          '2.4 %',
          '58 s: energy, tyres, driver',
        ],
        [
          '4',
          'A. Petrov',
          '31',
          '0:59',
          '1:54.63',
          '1:54.107',
          '2.5 %',
          '58 s: energy, driver',
        ],
        [
          '3',
          'A. Petrov',
          '31',
          '1:00',
          '1:54.71',
          '1:54.096',
          '2.3 %',
          '41 s: energy',
        ],
        [
          '2',
          'M. Ivanov',
          '31',
          '0:59',
          '1:54.72',
          '1:54.098',
          '2.5 %',
          '62 s: energy, tyres, driver',
        ],
        [
          '1',
          'M. Ivanov',
          '31',
          '1:04',
          '1:54.69',
          '1:54.137',
          '2.4 %',
          '40 s: energy',
        ],
      ]);
    });

    it('holds the stint under way against the driver before, in green when quicker', async () => {
      show();
      await settled();
      const pace = screen.getByTestId('crew-stint-pace');
      expect(pace).toHaveTextContent('-0.12 vs D. Sokolov');
      expect(pace).toHaveAttribute('data-tone', 'faster');
      // Only the stint under way carries one.
      expect(screen.getAllByTestId('crew-stint-pace')).toHaveLength(1);
      expect(screen.getAllByTestId('crew-stint')[0]).toHaveAttribute(
        'data-under-way',
        'true'
      );
    });

    it('has no pace while the stint has fewer than three clean laps', async () => {
      // Three laps into the race there is no earlier stint either.
      show({ ownLaps: 3 });
      await settled();
      expect(screen.queryByTestId('crew-stint-pace')).toBeNull();
      expect(screen.getByTestId('crew-stint-end')).toHaveTextContent(
        'under way'
      );
    });

    it('counts virtual energy a lap for a car that runs on it', async () => {
      show();
      await settled();
      expect(screen.getByTestId('crew-stint-captions')).toHaveTextContent(
        'VE/lap'
      );
    });
  });

  describe('the drive-time limits', () => {
    const LIMITS = { enabled: true, maxMinutes: 240, minMinutes: 90 };

    it('are off until switched on', async () => {
      show();
      await settled();
      expect(screen.queryByTestId('crew-driver-bar')).toBeNull();
      expect(screen.queryByTestId('crew-limits')).toBeNull();
    });

    it('draw a bar against the maximum with a mark at the minimum', async () => {
      show({}, { driveTime: LIMITS });
      await settled();
      const bars = screen.getAllByTestId('crew-driver-bar');
      expect(bars).toHaveLength(3);
      // Fifty-nine minutes of four hours.
      const fill = bars[2].firstElementChild as HTMLElement;
      expect(Number.parseFloat(fill.style.width)).toBeCloseTo(24.7, 0);
      for (const mark of screen.getAllByTestId('crew-driver-minimum')) {
        expect(mark.style.left).toBe('37.5%');
      }
      expect(screen.getByTestId('crew-limits')).toHaveTextContent(
        'Bar: time driven against the maximum of 4:00. Mark: the minimum of 1:30.'
      );
    });

    it('say what a driver still owes, and what the others have left', async () => {
      show({}, { driveTime: LIMITS });
      await settled();
      const status = screen.getAllByTestId('crew-driver-status');
      expect(status.map((entry) => entry.textContent)).toEqual([
        '1:45 to the maximum',
        '1:59 to the maximum',
        'needs 0:31',
      ]);
      expect(status.map((entry) => entry.dataset.tone)).toEqual([
        'quiet',
        'quiet',
        'owed',
      ]);
    });

    it('say who is past the maximum', async () => {
      show(
        {},
        { driveTime: { enabled: true, maxMinutes: 120, minMinutes: 0 } }
      );
      await settled();
      const [first] = screen.getAllByTestId('crew-driver-status');
      expect(first).toHaveTextContent('over by 0:15');
      expect(first).toHaveAttribute('data-tone', 'over');
      // No minimum: no mark, and the line under the bars does not name one.
      expect(screen.queryByTestId('crew-driver-minimum')).toBeNull();
      expect(screen.getByTestId('crew-limits')).not.toHaveTextContent('Mark');
    });
  });

  describe('the car chosen', () => {
    it('is our own until another is chosen', async () => {
      const { stage } = show();
      await settled();
      expect(screen.getByTestId('car-choice')).toHaveValue(
        String(stage.slotOf('77'))
      );
      expect(screen.getByTestId('crew')).toHaveAttribute(
        'data-car',
        String(stage.slotOf('77'))
      );
    });

    it('offers our car, then our class by place, then the other classes', async () => {
      show();
      await settled();
      const groups = Array.from(
        screen.getByTestId('car-choice').querySelectorAll('optgroup')
      );
      expect(groups.map((group) => group.label)).toEqual([
        'Our car',
        'LMGT3',
        'Other classes',
      ]);
      const options = (group: HTMLOptGroupElement): string[] =>
        Array.from(group.querySelectorAll('option')).map(
          (option) => option.textContent ?? ''
        );
      expect(options(groups[0])).toEqual(['#77 Tearoff Endurance']);
      expect(options(groups[1]).slice(0, 4)).toEqual([
        '#33 Nordwind Racing',
        '#46 Blue Harbor Motorsport',
        '#91 Atlas GT',
        '#54 Scuderia Meridiano',
      ]);
      expect(options(groups[1])).toHaveLength(13);
      expect(options(groups[2]).slice(0, 2)).toEqual([
        '#50 Hypercar Rosso Corsa Lab',
        '#7 Hypercar Aurora Hypersport',
      ]);
    });

    it('shows a rival’s crew and stints once chosen', async () => {
      const { stage, history } = show();
      await settled();
      const rival = stage.slotOf('33');
      chooseCar(rival);
      await waitFor(() =>
        expect(driverRows().map(([name]) => name)).toEqual([
          'L. Hartmann',
          'J. Weber',
          'E. Brandl',
        ])
      );
      expect(history.getCarLaps).toHaveBeenLastCalledWith(rival);
      expect(history.getCarStints).toHaveBeenLastCalledWith(rival);
      expect(screen.getByTestId('crew')).toHaveAttribute(
        'data-car',
        String(rival)
      );
    });

    it('shows none of the car before while the one chosen is read', async () => {
      const { stage } = show();
      await settled();
      chooseCar(stage.slotOf('33'));
      // Before the answer is in: a line, not the stints of our own car.
      expect(screen.queryByTestId('crew-stint')).toBeNull();
      expect(screen.getByTestId('crew-notice')).toHaveTextContent(
        'Reading the race history.'
      );
      await settled();
    });

    it('says the record could not be read where the read failed', async () => {
      const { stage, history } = show();
      await settled();
      vi.mocked(history.getCarLaps).mockRejectedValueOnce(
        new Error('The connection closed before the race history answered')
      );
      chooseCar(stage.slotOf('33'));

      // It went on reading "Reading the race history." with nothing on its
      // way.
      await waitFor(() =>
        expect(screen.getByTestId('crew-notice')).toHaveTextContent(
          'The race history could not be read.'
        )
      );
    });

    it('counts fuel a lap for a car that runs on fuel', async () => {
      const { stage } = show();
      await settled();
      chooseCar(stage.slotOf('22'));
      await waitFor(() =>
        expect(screen.getByTestId('crew-stint-captions')).toHaveTextContent(
          'Fuel/lap'
        )
      );
      expect(stintRows()[1][7]).toBe('59 s: fuel');
    });
  });

  describe('the race history', () => {
    it('is read once for the car, and again when its revision moves', async () => {
      const { stage, history, channels, summary } = show();
      await settled();
      expect(history.getCarLaps).toHaveBeenCalledTimes(1);
      const own = stage.slotOf('77');
      const other = stage.slotOf('33');

      // Another car's records move: not a reason to read ours again.
      act(() =>
        channels.publish('race-history.summary', {
          ...summary,
          revision: summary.revision.map((revision, carIdx) =>
            carIdx === other ? revision + 1 : revision
          ),
          version: 2,
        })
      );
      expect(history.getCarLaps).toHaveBeenCalledTimes(1);

      act(() =>
        channels.publish('race-history.summary', {
          ...summary,
          revision: summary.revision.map((revision, carIdx) =>
            carIdx === own ? revision + 1 : revision
          ),
          version: 3,
        })
      );
      expect(history.getCarLaps).toHaveBeenCalledTimes(2);
      expect(history.getCarLaps).toHaveBeenLastCalledWith(own);
      await settled();
    });

    it('says how many laps were not recorded, after a restart', async () => {
      show({ outage: { afterOwnLap: 40, untilOwnLap: 47 } });
      await settled();
      expect(screen.getByTestId('crew-missing')).toHaveTextContent(
        '7 laps not recorded'
      );
      // The stint that was under way when the app stopped ends where its
      // laps do, and what was driven since is a stint of its own.
      const rows = stintRows();
      expect(rows).toHaveLength(7);
      expect(rows[5].slice(0, 3)).toEqual(['2', 'M. Ivanov', '9']);
      expect(rows[5][7]).toBe('laps after it not recorded');
      expect(rows[4].slice(0, 3)).toEqual(['3', 'M. Ivanov', '15']);
      expect(rows[4][7]).toBe('62 s: energy, tyres, driver');
    });

    it('shows the first stint before it has a lap', async () => {
      show({ ownLaps: 0 });
      await settled();
      expect(driverRows()).toEqual([['M. Ivanov', '1', '0:03', '--', '--']]);
      const [row] = stintRows();
      expect(row.slice(0, 6)).toEqual([
        '1',
        'M. Ivanov',
        '0',
        '0:03',
        '--',
        '--',
      ]);
      expect(row[row.length - 1]).toBe('under way');
    });

    it('says the history is not available where there is no bridge to it', () => {
      // A page that was given no bridge to the race history. No page of
      // the app is one: a window has it over IPC, a browser page over
      // its socket.
      const { channels } = show({}, {}, { withHistory: false });
      expect(screen.getByTestId('crew-notice')).toHaveTextContent(
        'The race history is not available on this page.'
      );
      expect(screen.queryByTestId('crew-stint')).toBeNull();
      // Nothing to read it for: the summary is left alone.
      expect(channels.readers('race-history.summary')).toBe(0);
    });

    it('says it is waiting while no race is recorded', () => {
      const { channels, summary } = show();
      act(() =>
        channels.publish('race-history.summary', {
          ...summary,
          raceToken: '',
        })
      );
      expect(screen.getByTestId('crew-notice')).toHaveTextContent(
        'Waiting for a session to record.'
      );
    });
  });

  describe('under iRacing', () => {
    it('has no energy column, and of a stop only what can be seen', async () => {
      show({ iracing: true });
      await settled();
      const captions = screen.getByTestId('crew-stint-captions');
      expect(captions).not.toHaveTextContent('lap');
      expect(screen.queryByTestId('crew-stint-energy')).toBeNull();
      expect(stintRows().map((row) => row[row.length - 1])).toEqual([
        'under way-0.12 vs D. Sokolov',
        '58 s: driver',
        '58 s: driver',
        '41 s',
        '62 s: driver',
        '40 s',
      ]);
    });
  });

  describe('its settings', () => {
    it('leaves out the drivers or the stints when switched off', async () => {
      const drivers = show({}, { showStints: false });
      await screen.findAllByTestId('crew-driver');
      expect(screen.queryByTestId('crew-stints')).toBeNull();
      drivers.unmount();

      show({}, { showDrivers: false });
      await settled();
      expect(screen.queryByTestId('crew-drivers')).toBeNull();
    });

    it('hides in a session it is not set to show in, and reads nothing', () => {
      const { container, channels, history } = show(
        {},
        { sessionVisibility: PRACTICE_ONLY }
      );
      expect(container).toBeEmptyDOMElement();
      // Reading the summary is what has a race recorded.
      expect(channels.readers('race-history.summary')).toBe(0);
      expect(history.getCarLaps).not.toHaveBeenCalled();
    });

    it('takes limits it was never offered as the nearest it has', () => {
      expect(
        completeCrewConfig({
          driveTime: { enabled: true, maxMinutes: 0, minMinutes: -30 },
        }).driveTime
      ).toEqual({ enabled: true, maxMinutes: 1, minMinutes: 0 });
      expect(
        completeCrewConfig({
          driveTime: { enabled: 'yes', maxMinutes: 'long', minMinutes: 9e9 },
        }).driveTime
      ).toEqual({ enabled: false, maxMinutes: 240, minMinutes: 1440 });
    });

    it('is complete from a config saved without its groups', () => {
      const config = completeCrewConfig({ showStints: false });
      expect(config.showStints).toBe(false);
      expect(config.showDrivers).toBe(true);
      expect(config.driveTime).toEqual({
        enabled: false,
        maxMinutes: 240,
        minMinutes: 90,
      });
      expect(config.background.opacity).toBe(80);
      expect(completeCrewConfig(null)).toEqual(completeCrewConfig(undefined));
    });
  });

  it('draws the stints of our car inside one scrolling body', async () => {
    show();
    await settled();
    const body = screen.getByTestId('crew-body');
    expect(within(body).getAllByTestId('crew-stint')).toHaveLength(6);
    expect(body.className).toContain('overflow-y-auto');
  });
});
