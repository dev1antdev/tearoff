import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDashboard, useSessionStore } from '@irdashies/context';
import type { CarLapsConfig } from '@irdashies/types';
import {
  raceHistoryStage,
  raceHistoryStageBridge,
  raceHistoryStageChannels,
  type RaceHistoryStageOptions,
} from '../../../../.storybook/raceHistoryStage';
import { CAR_LAPS_SHOWN, CarLaps } from './CarLaps';

vi.mock('@irdashies/context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@irdashies/context')>()),
  useDashboard: vi.fn(),
}));

/**
 * Car Laps over a stub channel bridge and a stub of the race history's
 * bridge, on the STAGED eight-hour race the stories are told with. Every
 * lap is a staged record; nothing here was recorded, because no recording
 * has a pit stop or a driver change.
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
  config: Partial<CarLapsConfig> = {},
  { withHistory = true }: { withHistory?: boolean } = {}
) => {
  const stage = raceHistoryStage(options);
  const channels = raceHistoryStageChannels(stage.snapshots);
  window.channelBridge = channels.bridge;
  const history = raceHistoryStageBridge(stage.records);
  vi.spyOn(history, 'getCarLaps');
  window.raceHistoryBridge = withHistory ? history : undefined;
  useSessionStore.setState({ session: stage.session });
  vi.mocked(useDashboard).mockReturnValue({
    currentDashboard: { widgets: [{ id: 'carlaps', config }] },
  } as unknown as ReturnType<typeof useDashboard>);
  const summary = stage.snapshots['race-history.summary'];
  if (!summary) throw new Error('the stage has no summary');
  const view = render(<CarLaps />);
  return { stage, channels, history, summary, ...view };
};

/** The cells of a row, as text. */
const cells = (row: HTMLElement): string[] =>
  Array.from(row.children).map((cell) => cell.textContent ?? '');

/** Waits for the race history's answer to be drawn. */
const settled = () => screen.findAllByTestId('car-lap');

const rowOf = (lap: number): HTMLElement => {
  const row = screen
    .getAllByTestId('car-lap')
    .find((entry) => entry.dataset.lap === String(lap));
  if (!row) throw new Error(`no row for lap ${lap}`);
  return row;
};

const captions = (): string[] => cells(screen.getByTestId('car-laps-captions'));

const chooseCar = (carIdx: number) =>
  fireEvent.change(screen.getByTestId('car-choice'), {
    target: { value: String(carIdx) },
  });

describe('CarLaps (staged)', () => {
  beforeEach(() => {
    vi.mocked(useDashboard).mockReset();
  });

  afterEach(() => {
    window.raceHistoryBridge = undefined;
    vi.restoreAllMocks();
  });

  describe('our car', () => {
    it('lists its laps newest first, under every column', async () => {
      show();
      const rows = await settled();
      expect(captions()).toEqual([
        'Lap',
        'Time',
        'S1',
        'S2',
        'S3',
        'Energy',
        'Note',
      ]);
      expect(rows.slice(0, 3).map(cells)).toEqual([
        ['162', '1:54.606', '36.263', '45.873', '32.470', '2.3 %', ''],
        [
          '161',
          '1:54.335',
          '36.172',
          '45.728',
          '32.435',
          '2.5 %',
          'best of the stint',
        ],
        ['160', '1:54.432', '36.349', '45.647', '32.436', '2.5 %', ''],
      ]);
      expect(screen.getByTestId('car-laps-count')).toHaveTextContent(
        '162 laps'
      );
    });

    it('draws the best lap of the stint green, and its best sectors', async () => {
      show();
      await settled();
      expect(rowOf(161)).toHaveAttribute('data-tone', 'stintBest');
      expect(rowOf(162)).toHaveAttribute('data-tone', 'plain');
      const best = (lap: number): string[] =>
        Array.from(rowOf(lap).querySelectorAll('[data-best="true"]')).map(
          (cell) => cell.textContent ?? ''
        );
      expect(best(161)).toEqual(['36.172']);
      expect(best(160)).toEqual(['45.647']);
      expect(best(162)).toEqual([]);
    });

    it('says the out-lap, and the stop with what it is seen to have done', async () => {
      show();
      await settled();
      expect(cells(rowOf(157))).toEqual([
        '157',
        '2:06.641',
        '46.158',
        '45.792',
        '34.691',
        '2.5 %',
        'out lap',
      ]);
      // The lap the car stood still on: its time and third sector hold the
      // stop, and it ended with more aboard than it began.
      expect(cells(rowOf(156))).toEqual([
        '156',
        '3:00.795',
        '36.305',
        '45.722',
        '1:38.768',
        'refilled',
        'stop 58 s: energy, tyres, driver change',
      ]);
      expect(rowOf(156)).toHaveAttribute('data-tone', 'quiet');
      expect(rowOf(157)).toHaveAttribute('data-tone', 'quiet');
    });

    it('has no purple lap while another car holds the best of the class', async () => {
      show();
      const rows = await settled();
      expect(rows.some((row) => row.dataset.tone === 'classBest')).toBe(false);
    });

    it('draws no more rows than it says until all are asked for', async () => {
      show();
      const rows = await settled();
      expect(rows).toHaveLength(CAR_LAPS_SHOWN);
      expect(screen.getByTestId('car-laps-older')).toHaveTextContent(
        'The 12 older rows are not drawn.'
      );

      fireEvent.click(screen.getByTestId('car-laps-show-all'));
      expect(screen.getAllByTestId('car-lap')).toHaveLength(162);
      expect(screen.queryByTestId('car-laps-show-all')).toBeNull();
      // The lap that began on the grid, and one the sim gave no time.
      expect(cells(rowOf(1))[6]).toBe('from the grid');
      expect(cells(rowOf(147)).slice(1, 2)).toEqual(['--']);
      expect(cells(rowOf(147))[6]).toBe('no time from the sim');
      expect(cells(rowOf(140))[6]).toBe('yellow');
      expect(cells(rowOf(69))[6]).toBe('full-course yellow');
    });
  });

  describe('the car chosen', () => {
    it('shows a rival’s laps once chosen, with the best of the class purple', async () => {
      const { stage, history } = show();
      await settled();
      const rival = stage.slotOf('33');
      chooseCar(rival);
      await waitFor(() =>
        expect(screen.getByTestId('car-laps')).toHaveAttribute(
          'data-car',
          String(rival)
        )
      );
      await waitFor(() =>
        expect(screen.getByTestId('car-laps-count')).toHaveTextContent(
          '163 laps'
        )
      );
      expect(history.getCarLaps).toHaveBeenLastCalledWith(rival);

      fireEvent.click(screen.getByTestId('car-laps-show-all'));
      const purple = screen
        .getAllByTestId('car-lap')
        .filter((row) => row.dataset.tone === 'classBest');
      // The lap the stage has the class leader set its best on.
      expect(purple).toHaveLength(1);
      expect(purple[0]).toBe(rowOf(160));
      expect(cells(purple[0])[6]).toBe('best of the class');
      // Its time is the class's best as the standings have it.
      const best = stage.snapshots['standings.snapshot']?.carIdxBestLapTime;
      expect(cells(purple[0])[1]).toBe(
        `1:${((best?.[rival] ?? 0) - 60).toFixed(3)}`
      );
    });

    it('starts short again for another car after all were asked for', async () => {
      const { stage } = show();
      await settled();
      fireEvent.click(screen.getByTestId('car-laps-show-all'));
      expect(screen.getAllByTestId('car-lap')).toHaveLength(162);

      chooseCar(stage.slotOf('33'));
      await waitFor(() =>
        expect(screen.getByTestId('car-laps-count')).toHaveTextContent(
          '163 laps'
        )
      );
      expect(screen.getAllByTestId('car-lap')).toHaveLength(CAR_LAPS_SHOWN);
    });

    it('counts fuel for a car that runs on fuel', async () => {
      const { stage } = show();
      await settled();
      chooseCar(stage.slotOf('22'));
      await waitFor(() => expect(captions()[5]).toBe('Fuel'));
    });
  });

  describe('the race history', () => {
    it('is read again when the car’s revision moves', async () => {
      const { stage, history, channels, summary } = show();
      await settled();
      expect(history.getCarLaps).toHaveBeenCalledTimes(1);
      const own = stage.slotOf('77');
      act(() =>
        channels.publish('race-history.summary', {
          ...summary,
          revision: summary.revision.map((revision, carIdx) =>
            carIdx === own ? revision + 1 : revision
          ),
          version: 2,
        })
      );
      expect(history.getCarLaps).toHaveBeenCalledTimes(2);
      await settled();
    });

    it('draws a new lap when the car completes one', async () => {
      const { stage, channels, summary } = show({ ownLaps: 3 });
      await settled();
      expect(screen.getAllByTestId('car-lap')).toHaveLength(3);

      // The record gains a lap, and the summary says the car's has moved.
      const own = stage.slotOf('77');
      const record = stage.records.get(own);
      const later = raceHistoryStage({ ownLaps: 4 }).records.get(own);
      if (!record || !later) throw new Error('no record');
      stage.records.set(own, later);
      act(() =>
        channels.publish('race-history.summary', {
          ...summary,
          revision: summary.revision.map((revision, carIdx) =>
            carIdx === own ? revision + 1 : revision
          ),
          version: 2,
        })
      );
      await waitFor(() =>
        expect(screen.getAllByTestId('car-lap')).toHaveLength(4)
      );
    });

    it('draws one quiet line for a run of laps that were not recorded', async () => {
      show({ ownLaps: 49, outage: { afterOwnLap: 40, untilOwnLap: 47 } });
      await settled();
      const missing = screen.getAllByTestId('car-laps-missing');
      expect(missing).toHaveLength(1);
      expect(missing[0]).toHaveTextContent('laps 41 to 47 were not recorded');
      // Where they would have been: between lap 48 and lap 40.
      expect(missing[0].previousElementSibling).toBe(rowOf(48));
      expect(missing[0].nextElementSibling).toBe(rowOf(40));
      expect(screen.getByTestId('car-laps-count')).toHaveTextContent('42 laps');
      expect(screen.getByTestId('car-laps-missing-count')).toHaveTextContent(
        '7 not recorded'
      );
      // What lap 48 used is not known: the lap before it is not held.
      expect(cells(rowOf(48))[5]).toBe('--');
    });

    it('says there is no lap yet in the first minute of a race', async () => {
      show({ ownLaps: 0 });
      expect(await screen.findByTestId('car-laps-notice')).toHaveTextContent(
        'No lap of #77 has been recorded yet.'
      );
      expect(screen.queryByTestId('car-lap')).toBeNull();
    });

    it('says the history is not available where there is no bridge to it', () => {
      // The page served to a browser has no race history bridge.
      const { channels } = show({}, {}, { withHistory: false });
      expect(screen.getByTestId('car-laps-notice')).toHaveTextContent(
        'The race history is not available in a browser yet.'
      );
      expect(channels.readers('race-history.summary')).toBe(0);
    });
  });

  describe('under iRacing', () => {
    it('has no sector columns and no energy column', async () => {
      show({ iracing: true });
      const rows = await settled();
      expect(captions()).toEqual(['Lap', 'Time', 'Note']);
      expect(cells(rows[1])).toEqual(['161', '1:54.335', 'best of the stint']);
      // A stop is its standing time and the driver: nothing else can be seen.
      expect(cells(rowOf(156))).toEqual([
        '156',
        '3:00.795',
        'stop 58 s: driver change',
      ]);
    });
  });

  describe('its settings', () => {
    it('leaves out the sectors and the energy when switched off', async () => {
      show({}, { showSectors: false, showEnergy: false });
      await settled();
      expect(captions()).toEqual(['Lap', 'Time', 'Note']);
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
  });
});
