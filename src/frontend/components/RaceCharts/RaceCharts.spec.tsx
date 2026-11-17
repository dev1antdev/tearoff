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
import { formatLapTime } from '@irdashies/domain/raceHistory';
import type {
  RaceChartsConfig,
  RaceForecastSnapshot,
  RaceHistorySummarySnapshot,
} from '@irdashies/types';
import {
  RACE_HISTORY_STAGE_FOR_CHARTS,
  raceHistoryStage,
  raceHistoryStageBridge,
  raceHistoryStageChannels,
  type RaceHistoryStageOptions,
} from '../../../../.storybook/raceHistoryStage';
import { RaceCharts } from './RaceCharts';

vi.mock('@irdashies/context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@irdashies/context')>()),
  useDashboard: vi.fn(),
  // The box a chart is drawn in: the test DOM lays nothing out.
  useElementSize: () => ({ width: 640, height: 200 }),
}));

/**
 * The Race Charts over a stub channel bridge and a stub of the race
 * history's bridge, on the STAGED eight-hour race the stories are told
 * with. Every lap is a staged record; nothing here was recorded, because no
 * recording has a pit stop, a driver change or a full-course yellow.
 *
 * Our #77 is fifth in its class after 162 laps: #33 leads, #54 is the car
 * ahead and #23 the car behind. Its stints end at laps 31, 62, 93, 124 and
 * 155, driven by Ivanov twice, Petrov twice, Sokolov, and Ivanov again.
 */

const PRACTICE_ONLY = {
  race: false,
  loneQualify: false,
  openQualify: false,
  practice: true,
  offlineTesting: false,
};

const withConfig = (config: Partial<RaceChartsConfig>) =>
  ({
    currentDashboard: { widgets: [{ id: 'racecharts', config }] },
  }) as unknown as ReturnType<typeof useDashboard>;

const show = (
  options: RaceHistoryStageOptions = RACE_HISTORY_STAGE_FOR_CHARTS,
  config: Partial<RaceChartsConfig> = {},
  { withHistory = true }: { withHistory?: boolean } = {}
) => {
  const stage = raceHistoryStage(options);
  const channels = raceHistoryStageChannels(stage.snapshots);
  window.channelBridge = channels.bridge;
  const history = raceHistoryStageBridge(stage.records);
  vi.spyOn(history, 'getCarLaps');
  window.raceHistoryBridge = withHistory ? history : undefined;
  useSessionStore.setState({ session: stage.session });
  vi.mocked(useDashboard).mockReturnValue(withConfig(config));
  const summary = stage.snapshots['race-history.summary'];
  const forecast = stage.snapshots['race-forecast.snapshot'];
  if (!summary || !forecast) throw new Error('the stage is not whole');
  const view = render(<RaceCharts />);
  return { stage, channels, history, summary, forecast, ...view };
};

/** A lap of a car as the race history holds it, printed as a chart does. */
const timeOf = (
  stage: ReturnType<typeof raceHistoryStage>,
  carNumber: string,
  lap: number
): string =>
  formatLapTime(
    stage.records
      .get(stage.slotOf(carNumber))
      ?.laps.find((entry) => entry.lap === lap)?.lapTime
  );

/** Waits for the panel to say this in place of a chart. */
const noticed = (text: string) =>
  waitFor(() =>
    expect(screen.getByTestId('race-charts-notice')).toHaveTextContent(text)
  );

/** Waits for a chart to be drawn. */
const settled = () => screen.findByTestId('race-charts-plot');

/** Waits for this many cars to be on the chart. */
const drawn = (cars: number) =>
  waitFor(() =>
    expect(screen.getAllByTestId('race-charts-series')).toHaveLength(cars)
  );

const seriesOf = (carIdx: number): HTMLElement => {
  const series = screen
    .getAllByTestId('race-charts-series')
    .find((entry) => entry.dataset.car === String(carIdx));
  if (!series) throw new Error(`car ${carIdx} is not on the chart`);
  return series;
};

/** The runs of a car's line, as [first lap, last lap]. */
const runsOf = (carIdx: number): [number, number][] =>
  within(seriesOf(carIdx))
    .queryAllByTestId('race-charts-line')
    .map((line) => [Number(line.dataset.from), Number(line.dataset.to)]);

const marksOf = (carIdx: number): number[] =>
  within(seriesOf(carIdx))
    .queryAllByTestId('race-charts-mark')
    .map((mark) => Number(mark.dataset.lap));

const legend = (): string[] =>
  Array.from(screen.getByTestId('race-charts-legend').children).map(
    (entry) => entry.textContent ?? ''
  );

const tab = (id: string) =>
  fireEvent.click(screen.getByTestId(`race-charts-tab-${id}`));

const lapsShown = (laps: number) =>
  fireEvent.click(screen.getByTestId(`race-charts-laps-${laps}`));

const bumped = (
  summary: RaceHistorySummarySnapshot,
  car: number,
  version: number
): RaceHistorySummarySnapshot => ({
  ...summary,
  revision: summary.revision.map((revision, carIdx) =>
    carIdx === car ? revision + 1 : revision
  ),
  version,
});

/** The cars the race history was asked for, in the order asked. */
const askedFor = (history: { getCarLaps: unknown }): number[] =>
  vi
    .mocked(history.getCarLaps as (carIdx: number) => unknown)
    .mock.calls.map(([carIdx]) => carIdx);

describe('RaceCharts (staged)', () => {
  beforeEach(() => {
    vi.mocked(useDashboard).mockReset();
  });

  afterEach(() => {
    window.raceHistoryBridge = undefined;
    vi.restoreAllMocks();
  });

  describe('pace', () => {
    it('draws our car and the three cars around it in class', async () => {
      const { stage } = show();
      await settled();
      await drawn(4);
      expect(screen.getByTestId('race-charts')).toHaveAttribute(
        'data-tab',
        'pace'
      );
      expect(screen.getByTestId('race-charts-caption')).toHaveTextContent(
        'Lap time'
      );
      // Ours is drawn last, over the others.
      expect(
        screen
          .getAllByTestId('race-charts-series')
          .map((series) => Number(series.dataset.car))
      ).toEqual([
        stage.slotOf('33'),
        stage.slotOf('54'),
        stage.slotOf('23'),
        stage.slotOf('77'),
      ]);
      expect(legend()).toEqual([
        '#77 M. Ivanov',
        '#77 A. Petrov',
        '#77 D. Sokolov',
        '#33 E. Brandlleader',
        '#54 R. Castellanoahead',
        '#23 E. Vasquezbehind',
        'our pit stop',
        'lap off the scale',
      ]);
    });

    it('says which way is faster', async () => {
      show();
      await settled();
      expect(
        screen
          .getAllByTestId('race-charts-side')
          .map((side) => side.textContent)
      ).toEqual(['slower', 'faster']);
    });

    it('colours our line by who drove, and breaks it at each stop', async () => {
      const { stage } = show();
      await settled();
      const own = stage.slotOf('77');
      const lines = within(seriesOf(own)).getAllByTestId('race-charts-line');
      // The last forty laps: the end of Petrov's stint, Sokolov's, and
      // Ivanov's under way.
      const strokeOf = (line: HTMLElement) =>
        Array.from(line.classList).find((name) => name.startsWith('stroke-'));
      const byDriver = new Map<string, Set<string | undefined>>();
      for (const line of lines) {
        const driver = line.dataset.driver ?? '';
        byDriver.set(
          driver,
          (byDriver.get(driver) ?? new Set()).add(strokeOf(line))
        );
      }
      expect([...byDriver]).toEqual([
        ['1', new Set(['stroke-teal-400'])],
        ['2', new Set(['stroke-purple-400'])],
        ['0', new Set(['stroke-amber-400'])],
      ]);
      // No run of the line crosses a stop: laps 125 and 156.
      for (const [from, to] of runsOf(own)) {
        expect(from <= 124 && to >= 125).toBe(false);
        expect(from <= 155 && to >= 156).toBe(false);
      }
      expect(runsOf(own)[0]).toEqual([123, 124]);
    });

    it('marks the laps that do not fit the scale at its edge', async () => {
      const { stage } = show();
      await settled();
      // The two stops and their out-laps, two laps under a yellow and two
      // lost to traffic: none of them is on the line.
      expect(marksOf(stage.slotOf('77'))).toEqual([
        125, 126, 132, 140, 141, 150, 156, 157,
      ]);
      const top = screen.getAllByTestId('race-charts-tick').length;
      expect(top).toBeGreaterThanOrEqual(2);
      expect(top).toBeLessThanOrEqual(7);
    });

    it('draws the other cars thinner, each with a line of its own', async () => {
      const { stage } = show();
      await settled();
      await drawn(4);
      const lineOf = (number: string) =>
        within(seriesOf(stage.slotOf(number))).getAllByTestId(
          'race-charts-line'
        )[0];
      const widths = ['77', '33', '54', '23'].map((number) =>
        Number(lineOf(number).getAttribute('stroke-width'))
      );
      expect(widths[0]).toBeGreaterThan(widths[1]);
      expect(new Set(widths.slice(1)).size).toBe(1);
      expect(lineOf('33').getAttribute('stroke-dasharray')).toBeNull();
      const looks = ['33', '54', '23'].map(
        (number) =>
          `${lineOf(number).getAttribute('stroke-dasharray')} ${Array.from(
            lineOf(number).classList
          ).find((name) => name.startsWith('stroke-'))}`
      );
      expect(new Set(looks).size).toBe(3);
    });

    it('bands the lap of each stop of ours', async () => {
      show();
      await settled();
      expect(
        screen
          .getAllByTestId('race-charts-band')
          .map((band) => [band.dataset.kind, band.dataset.from])
      ).toEqual([
        ['stop', '125'],
        ['stop', '156'],
      ]);
      expect(screen.getAllByText('stop, driver change')).toHaveLength(2);
    });
  });

  describe('the lap pointed at', () => {
    it('says what every car did on it, from the keyboard', async () => {
      const { stage } = show();
      const plot = await settled();
      await drawn(4);
      expect(screen.queryByTestId('race-charts-readout')).toBeNull();

      // The newest lap first.
      fireEvent.keyDown(plot, { key: 'ArrowLeft' });
      const readout = screen.getByTestId('race-charts-readout');
      expect(readout).toHaveTextContent('Lap 162');
      expect(
        within(readout)
          .getAllByTestId('race-charts-reading')
          .map((reading) => reading.textContent)
      ).toEqual([
        '#771:54.606M. Ivanov',
        `#33${timeOf(stage, '33', 162)}E. Brandl`,
        // The note Car Laps has for the lap comes with it.
        `#54${timeOf(stage, '54', 162)}R. Castellanobest of the stint`,
        `#23${timeOf(stage, '23', 162)}E. Vasquez`,
      ]);

      fireEvent.keyDown(plot, { key: 'Escape' });
      expect(screen.queryByTestId('race-charts-readout')).toBeNull();
    });

    it('gives the real time of a lap that is off the scale, and why', async () => {
      show();
      const plot = await settled();
      await drawn(4);
      // Seven steps back from past the newest lap: lap 156, our last stop.
      for (let step = 0; step < 7; step += 1) {
        fireEvent.keyDown(plot, { key: 'ArrowLeft' });
      }
      const readout = screen.getByTestId('race-charts-readout');
      expect(readout).toHaveTextContent('Lap 156');
      expect(
        within(readout).getAllByTestId('race-charts-reading')[0]
      ).toHaveTextContent(
        '#773:00.795M. Ivanovstop 58 s: energy, tyres, driver change'
      );
    });

    it('follows a pointer, and lets go when a mouse leaves', async () => {
      show();
      const plot = await settled();
      vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        right: 640,
        bottom: 200,
        width: 640,
        height: 200,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
      // The plot runs from 46 to 630 of the 640 its box is wide: forty
      // laps of 14.6 each, from lap 123.
      fireEvent.pointerMove(plot, { clientX: 46 + 14.6 * 10.5 });
      expect(screen.getByTestId('race-charts-crosshair')).toHaveAttribute(
        'data-lap',
        '133'
      );
      fireEvent.pointerMove(plot, { clientX: 5 });
      expect(screen.getByTestId('race-charts-crosshair')).toHaveAttribute(
        'data-lap',
        '123'
      );
      fireEvent.pointerLeave(plot, { pointerType: 'mouse' });
      expect(screen.queryByTestId('race-charts-crosshair')).toBeNull();
    });
  });

  describe('gap', () => {
    it('draws each other car against ours, and not ours', async () => {
      const { stage } = show(
        { ...RACE_HISTORY_STAGE_FOR_CHARTS },
        { tab: 'gap' }
      );
      await settled();
      await drawn(3);
      expect(screen.getByTestId('race-charts')).toHaveAttribute(
        'data-tab',
        'gap'
      );
      expect(screen.getByTestId('race-charts-caption')).toHaveTextContent(
        'Gap to #77 at the line, seconds'
      );
      expect(
        screen
          .getAllByTestId('race-charts-side')
          .map((side) => side.textContent)
      ).toEqual(['ahead of us', 'behind us']);
      expect(
        screen
          .getAllByTestId('race-charts-series')
          .map((series) => Number(series.dataset.car))
      ).toEqual([stage.slotOf('33'), stage.slotOf('54'), stage.slotOf('23')]);
      // One unbroken line a car: every lap of the forty is held for both.
      expect(runsOf(stage.slotOf('33'))).toEqual([[123, 162]]);
      expect(legend()).toEqual([
        '#33 E. Brandlleader',
        '#54 R. Castellanoahead',
        '#23 E. Vasquezbehind',
        'our pit stop',
      ]);
    });

    it('says each gap in words, with the stop of ours the lap is', async () => {
      show({ ...RACE_HISTORY_STAGE_FOR_CHARTS }, { tab: 'gap' });
      const plot = await settled();
      await drawn(3);
      for (let step = 0; step < 7; step += 1) {
        fireEvent.keyDown(plot, { key: 'ArrowLeft' });
      }
      const readout = screen.getByTestId('race-charts-readout');
      expect(readout).toHaveTextContent('Lap 156 · stop, driver change');
      const readings = within(readout)
        .getAllByTestId('race-charts-reading')
        .map((reading) => reading.textContent ?? '');
      expect(readings).toHaveLength(3);
      expect(readings[0]).toMatch(/^#33\d+\.\d s aheadE\. Brandl$/);
      expect(readings[2]).toMatch(/^#23\d+\.\d s behindE\. Vasquez$/);
    });

    it('breaks every line at laps that were not recorded', async () => {
      const { stage } = show(
        { ownLaps: 60, outage: { afterOwnLap: 40, untilOwnLap: 47 } },
        { tab: 'gap' }
      );
      await settled();
      await drawn(3);
      for (const series of screen.getAllByTestId('race-charts-series')) {
        const runs = runsOf(Number(series.dataset.car));
        expect(runs.length).toBeGreaterThanOrEqual(2);
        for (const [from, to] of runs) {
          expect(to < 41 || from > 47).toBe(true);
        }
      }
      expect(stage.slotOf('77')).toBeGreaterThanOrEqual(0);
      const missing = screen
        .getAllByTestId('race-charts-band')
        .filter((band) => band.dataset.kind === 'missing');
      expect(missing).toHaveLength(1);
      expect(missing[0]).toHaveAttribute('data-from', '41');
      expect(missing[0]).toHaveAttribute('data-to', '47');
      expect(screen.getByTestId('race-charts-missing')).toHaveTextContent(
        '7 laps not recorded'
      );
    });

    it('says so while there is no other car to draw', async () => {
      show({ ownLaps: 3 }, { tab: 'gap', others: 'chosen', carNumbers: '999' });
      await noticed(
        'None of the car numbers chosen in the settings is in this session.'
      );
    });
  });

  describe('usage', () => {
    it('draws what each lap of ours used, and no other car', async () => {
      const { stage } = show(
        { ...RACE_HISTORY_STAGE_FOR_CHARTS },
        { tab: 'usage' }
      );
      await settled();
      await waitFor(() =>
        expect(screen.getByTestId('race-charts')).toHaveAttribute(
          'data-tab',
          'usage'
        )
      );
      expect(screen.getByTestId('race-charts-caption')).toHaveTextContent(
        'Energy a lap, % of a full budget'
      );
      expect(screen.getAllByTestId('race-charts-series')).toHaveLength(1);
      // The laps of the stops are refills, and have no figure.
      const runs = runsOf(stage.slotOf('77'));
      for (const [from, to] of runs) {
        expect(from <= 125 && to >= 125).toBe(false);
        expect(from <= 156 && to >= 156).toBe(false);
      }
      expect(legend()).toEqual([
        '#77 M. Ivanov',
        '#77 A. Petrov',
        '#77 D. Sokolov',
        'our pit stop',
      ]);
    });

    it('is not offered under iRacing, and the widget opens on Pace', async () => {
      show({ iracing: true }, { tab: 'usage' });
      await settled();
      expect(screen.queryByTestId('race-charts-tab-usage')).toBeNull();
      expect(screen.getByTestId('race-charts-tab-pace')).toBeInTheDocument();
      expect(screen.getByTestId('race-charts')).toHaveAttribute(
        'data-tab',
        'pace'
      );
    });

    it('is offered under Le Mans Ultimate', async () => {
      show();
      await settled();
      expect(screen.getByTestId('race-charts-tab-usage')).toBeInTheDocument();
    });
  });

  describe('the view', () => {
    it('changes chart with the buttons, and keeps the laps', async () => {
      show();
      await settled();
      lapsShown(20);
      tab('gap');
      expect(screen.getByTestId('race-charts')).toHaveAttribute(
        'data-tab',
        'gap'
      );
      expect(screen.getByTestId('race-charts-tab-gap')).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      expect(screen.getByTestId('race-charts-laps-20')).toHaveAttribute(
        'aria-pressed',
        'true'
      );
    });

    it('draws the laps asked for: twenty, eighty, the whole race', async () => {
      const { stage } = show();
      await settled();
      const own = stage.slotOf('77');
      const first = () => Math.min(...runsOf(own).map(([from]) => from));
      expect(first()).toBe(123);
      lapsShown(20);
      expect(first()).toBe(143);
      lapsShown(80);
      expect(first()).toBe(83);
      lapsShown(0);
      // The lap from the grid is off the scale: a mark, and the line from 2.
      expect(first()).toBe(2);
      expect(marksOf(own)).toContain(1);
      // The three laps under the full-course yellow.
      expect(marksOf(own)).toEqual(expect.arrayContaining([68, 69, 70]));
    });

    it('opens as its settings say', async () => {
      show({ ...RACE_HISTORY_STAGE_FOR_CHARTS }, { tab: 'gap', laps: 80 });
      await settled();
      expect(screen.getByTestId('race-charts-tab-gap')).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      expect(screen.getByTestId('race-charts-laps-80')).toHaveAttribute(
        'aria-pressed',
        'true'
      );
    });

    it('goes back to its settings when they are changed', async () => {
      const { rerender } = show();
      await settled();
      tab('gap');
      lapsShown(20);
      vi.mocked(useDashboard).mockReturnValue(withConfig({ laps: 80 }));
      rerender(<RaceCharts />);
      expect(screen.getByTestId('race-charts')).toHaveAttribute(
        'data-tab',
        'pace'
      );
      expect(screen.getByTestId('race-charts-laps-80')).toHaveAttribute(
        'aria-pressed',
        'true'
      );
    });

    it('fills from the left early in a race', async () => {
      const { stage } = show({ ownLaps: 3 });
      await settled();
      // Lap 1 began on the grid: laps 2 and 3 are the line.
      expect(runsOf(stage.slotOf('77'))).toEqual([[2, 3]]);
      expect(marksOf(stage.slotOf('77'))).toEqual([1]);
    });
  });

  describe('the other cars', () => {
    it('are the ones named by number when chosen', async () => {
      const { stage, history } = show(
        { ...RACE_HISTORY_STAGE_FOR_CHARTS },
        { others: 'chosen', carNumbers: '46, #91' }
      );
      await settled();
      await drawn(3);
      expect(askedFor(history)).toEqual([
        stage.slotOf('77'),
        stage.slotOf('46'),
        stage.slotOf('91'),
      ]);
      expect(legend().slice(3, 5)).toEqual([
        '#46 T. Okafor',
        '#91 S. Lindqvist',
      ]);
    });

    it('are none with no number entered: our car alone', async () => {
      const { stage, history, channels } = show(
        { ...RACE_HISTORY_STAGE_FOR_CHARTS },
        { others: 'chosen', carNumbers: '' }
      );
      await settled();
      await drawn(1);
      expect(askedFor(history)).toEqual([stage.slotOf('77')]);
      // The forecast is read for the cars around us only.
      expect(channels.readers('race-forecast.snapshot')).toBe(0);
    });

    it('keep their lines when the cars around us change', async () => {
      const { stage, channels, forecast } = show();
      await settled();
      await drawn(4);
      const strokeOf = (number: string) =>
        Array.from(
          within(seriesOf(stage.slotOf(number))).getAllByTestId(
            'race-charts-line'
          )[0].classList
        ).find((name) => name.startsWith('stroke-'));
      const before = { leader: strokeOf('33'), behind: strokeOf('23') };

      // We pass #54: the car ahead is now #91, and #54 the car behind.
      const cars = [...forecast.cars];
      const own = cars.findIndex((car) => car.own);
      [cars[own - 1], cars[own]] = [cars[own], cars[own - 1]];
      const moved: RaceForecastSnapshot = {
        ...forecast,
        cars: cars.map((car, index) => ({ ...car, classPosition: index + 1 })),
        version: 2,
      };
      act(() => channels.publish('race-forecast.snapshot', moved));
      await waitFor(() =>
        expect(
          screen
            .getAllByTestId('race-charts-series')
            .map((series) => Number(series.dataset.car))
        ).toEqual([
          stage.slotOf('33'),
          stage.slotOf('91'),
          stage.slotOf('54'),
          stage.slotOf('77'),
        ])
      );
      expect(strokeOf('33')).toBe(before.leader);
      // #54 was the second line and still is; #91 took the one #23 left.
      expect(strokeOf('91')).toBe(before.behind);
      expect(
        new Set([strokeOf('33'), strokeOf('91'), strokeOf('54')]).size
      ).toBe(3);
    });
  });

  describe('the race history', () => {
    it('is asked once for each car drawn', async () => {
      const { stage, history } = show();
      await settled();
      await drawn(4);
      expect(askedFor(history).sort((a, b) => a - b)).toEqual(
        ['33', '54', '23', '77']
          .map((number) => stage.slotOf(number))
          .sort((a, b) => a - b)
      );
    });

    it('is asked again for a car when that car’s revision moves', async () => {
      const { stage, history, channels, summary } = show();
      await settled();
      await drawn(4);
      expect(history.getCarLaps).toHaveBeenCalledTimes(4);

      // A car that is not drawn completes a lap.
      const elsewhere = bumped(summary, stage.slotOf('88'), 2);
      act(() => channels.publish('race-history.summary', elsewhere));
      expect(history.getCarLaps).toHaveBeenCalledTimes(4);

      const rival = bumped(elsewhere, stage.slotOf('23'), 3);
      act(() => channels.publish('race-history.summary', rival));
      expect(history.getCarLaps).toHaveBeenCalledTimes(5);
      expect(history.getCarLaps).toHaveBeenLastCalledWith(stage.slotOf('23'));

      act(() =>
        channels.publish(
          'race-history.summary',
          bumped(rival, stage.slotOf('77'), 4)
        )
      );
      expect(history.getCarLaps).toHaveBeenCalledTimes(6);
      expect(history.getCarLaps).toHaveBeenLastCalledWith(stage.slotOf('77'));
      await settled();
    });

    it('is never asked on a timer', async () => {
      vi.useFakeTimers();
      try {
        const { history } = show();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
        });
        expect(history.getCarLaps).toHaveBeenCalledTimes(4);
      } finally {
        vi.useRealTimers();
      }
    });

    it('draws a new lap when our car completes one', async () => {
      const { stage, channels, summary } = show({ ownLaps: 4 });
      await settled();
      const own = stage.slotOf('77');
      expect(runsOf(own)).toEqual([[2, 4]]);

      const later = raceHistoryStage({ ownLaps: 5 }).records.get(own);
      if (!later) throw new Error('no record');
      stage.records.set(own, later);
      act(() =>
        channels.publish('race-history.summary', bumped(summary, own, 2))
      );
      await waitFor(() => expect(runsOf(own)).toEqual([[2, 5]]));
    });

    it('says there is no lap yet in the first minute of a race', async () => {
      show({ ownLaps: 0 });
      await noticed('No lap of #77 has been recorded yet.');
      expect(screen.queryByTestId('race-charts-plot')).toBeNull();
      // What a car has left is not known yet, so no chart of it is offered.
      expect(screen.queryByTestId('race-charts-tab-usage')).toBeNull();
    });

    it('says the history is not available where there is no bridge to it', () => {
      // The page served to a browser has no race history bridge.
      const { channels } = show(undefined, {}, { withHistory: false });
      expect(screen.getByTestId('race-charts-notice')).toHaveTextContent(
        'The race history is not available in a browser yet.'
      );
      expect(channels.readers('race-history.summary')).toBe(0);
    });
  });

  describe('its settings', () => {
    it('hides in a session it is not set to show in, and reads nothing', () => {
      const { container, channels, history } = show(undefined, {
        sessionVisibility: PRACTICE_ONLY,
      });
      expect(container).toBeEmptyDOMElement();
      // Reading the summary is what has a race recorded.
      expect(channels.readers('race-history.summary')).toBe(0);
      expect(channels.readers('race-forecast.snapshot')).toBe(0);
      expect(history.getCarLaps).not.toHaveBeenCalled();
    });

    it('falls back to its defaults for a choice it does not know', async () => {
      show(undefined, {
        tab: 'laps' as RaceChartsConfig['tab'],
        laps: 33 as RaceChartsConfig['laps'],
        others: 'everyone' as RaceChartsConfig['others'],
      });
      await settled();
      await drawn(4);
      expect(screen.getByTestId('race-charts')).toHaveAttribute(
        'data-tab',
        'pace'
      );
      expect(screen.getByTestId('race-charts-laps-40')).toHaveAttribute(
        'aria-pressed',
        'true'
      );
    });
  });
});
